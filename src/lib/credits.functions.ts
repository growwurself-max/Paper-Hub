import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SuperAdmin institute credit quota management.
 *
 * Institutes are `public.organizations` rows; the prepaid bundle balance lives
 * in `organizations.paper_credit_balance`, where NULL means unlimited. Every
 * change is written to the append-only `credit_transactions` ledger by the
 * `set_credits` / `top_up_credits` RPCs, so the balance and its history can
 * never drift apart.
 *
 * Both mutations delegate to SECURITY DEFINER RPCs rather than issuing a plain
 * UPDATE, because the balance is a prepaid balance: the read, the guard and the
 * ledger write have to happen under the same row lock as the deduction that
 * `reserve_paper_generation_credit` performs during paper generation.
 */

/** The repeated super-admin guard. Kept here rather than duplicated per handler. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireSuperAdmin(supabase: any, userId: string): Promise<void> {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (!roles?.some((r: { role: string }) => r.role === "super_admin")) {
    throw new Response("Forbidden", { status: 403 });
  }
}

const SetCreditsInput = z.object({
  organizationId: z.string().uuid(),
  // null puts the institute back on an unlimited balance.
  credits: z.number().int().min(0).max(1_000_000).nullable(),
  reason: z.string().max(200).optional(),
});

const TopUpInput = z.object({
  organizationId: z.string().uuid(),
  // Signed: negative values deduct, positive values add.
  amount: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, {
      message: "Amount must not be zero.",
    }),
  reason: z.string().max(200).optional(),
});

const HistoryInput = z.object({
  organizationId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

/** Credit balance for every institute, with lifetime grant totals for context. */
export const listInstituteCredits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: orgs, error } = await supabaseAdmin
      .from("organizations")
      .select("id, name, plan, status, paper_credit_balance, paper_daily_limit, created_at")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    const orgIds = (orgs ?? []).map((o) => o.id);
    if (orgIds.length === 0) return [];

    const [admins, ledger, papers] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("organization_id, email, full_name")
        .in("organization_id", orgIds),
      // Positive deltas only: the total ever granted to each institute.
      supabaseAdmin
        .from("credit_transactions")
        .select("organization_id, delta")
        .in("organization_id", orgIds)
        .gt("delta", 0),
      supabaseAdmin
        .from("generated_papers")
        .select("organization_id")
        .in("organization_id", orgIds),
    ]);

    const granted = new Map<string, number>();
    for (const row of ledger.data ?? []) {
      granted.set(row.organization_id, (granted.get(row.organization_id) ?? 0) + row.delta);
    }
    const paperCounts = new Map<string, number>();
    for (const row of papers.data ?? []) {
      paperCounts.set(row.organization_id, (paperCounts.get(row.organization_id) ?? 0) + 1);
    }

    return (orgs ?? []).map((o) => {
      const admin = admins.data?.find((a) => a.organization_id === o.id);
      return {
        ...o,
        lifetimeGranted: granted.get(o.id) ?? 0,
        papersGenerated: paperCounts.get(o.id) ?? 0,
        adminName: admin?.full_name ?? null,
        adminEmail: admin?.email ?? null,
      };
    });
  });

/** Assign an exact balance. `credits: null` means unlimited. */
export const setInstituteCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SetCreditsInput.parse(raw))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before, error: readErr } = await supabaseAdmin
      .from("organizations")
      .select("paper_credit_balance")
      .eq("id", data.organizationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!before) throw new Error("Institute not found");

    const { error } = await supabaseAdmin.rpc("set_credits", {
      p_organization_id: data.organizationId,
      p_credits: data.credits,
      p_reason: data.reason?.trim() || "credits.set",
      p_actor_user_id: context.userId,
    });
    if (error) throw new Error(error.message);

    // The ledger is only written for finite balances, so the unlimited
    // transition is recorded here to keep a full trail either way.
    if (data.credits === null || before.paper_credit_balance === null) {
      await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: context.userId,
        organization_id: data.organizationId,
        action: "organization.credits_set",
        target_type: "organization",
        target_id: data.organizationId,
        metadata: {
          from: before.paper_credit_balance,
          to: data.credits,
          reason: data.reason?.trim() || "credits.set",
        },
      });
    }

    return { ok: true, credits: data.credits };
  });

/** Add (or deduct) credits relative to the current balance. */
export const topUpInstituteCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => TopUpInput.parse(raw))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: result, error } = await supabaseAdmin.rpc("top_up_credits", {
      p_organization_id: data.organizationId,
      p_delta: data.amount,
      p_reason: data.reason?.trim() || "credits.top_up",
      p_actor_user_id: context.userId,
    });
    if (error) throw new Error(error.message);

    return { ok: true, credits: result?.[0]?.new_balance ?? null };
  });

/** Most recent credit movements, newest first. Optionally scoped to one institute. */
export const listCreditTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => HistoryInput.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("credit_transactions")
      .select("id, organization_id, delta, balance_after, reason, actor_user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.organizationId) {
      query = query.eq("organization_id", data.organizationId);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    if (!rows?.length) return [];

    const orgIds = [...new Set(rows.map((r) => r.organization_id))];
    const actorIds = [
      ...new Set(rows.map((r) => r.actor_user_id).filter((v): v is string => Boolean(v))),
    ];

    const [orgs, actors] = await Promise.all([
      supabaseAdmin.from("organizations").select("id, name").in("id", orgIds),
      actorIds.length
        ? supabaseAdmin.from("profiles").select("id, email, full_name").in("id", actorIds)
        : Promise.resolve({ data: [] as { id: string; email: string; full_name: string }[] }),
    ]);

    return rows.map((r) => {
      const org = orgs.data?.find((o) => o.id === r.organization_id);
      const actor = actors.data?.find((a) => a.id === r.actor_user_id);
      return {
        ...r,
        organizationName: org?.name ?? "—",
        actorEmail: actor?.email ?? null,
        actorName: actor?.full_name ?? null,
      };
    });
  });
