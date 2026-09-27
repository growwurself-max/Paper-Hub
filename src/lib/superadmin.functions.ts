import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readPlatformLimits, type PlatformLimits } from "@/lib/platform-limits";

const BootstrapInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1).max(120),
});

/**
 * Bootstrap the very first super admin. Public endpoint that self-destructs:
 * only succeeds when NO super admin exists yet.
 */
export const bootstrapSuperAdmin = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => BootstrapInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: exists, error: existsErr } = await supabaseAdmin.rpc("super_admin_exists");
    if (existsErr) throw new Error(existsErr.message);
    if (exists) throw new Error("A super admin already exists.");

    // Create the auth user, or recover a half-finished earlier attempt for the same email.
    let userId: string | null = null;
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (created?.user) {
      userId = created.user.id;
    } else {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
      if (!existing) throw new Error(createErr?.message ?? "Failed to create user");
      userId = existing.id;
      const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: data.password,
        email_confirm: true,
      });
      if (upErr) throw new Error(upErr.message);
    }

    await grantActiveSuperAdmin(supabaseAdmin, userId, data.email, data.fullName);
    return { ok: true };
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function grantActiveSuperAdmin(admin: any, userId: string, email: string, fullName: string) {
  const { error: profileErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: fullName,
      must_change_password: false,
      is_active: true,
      organization_id: null,
    },
    { onConflict: "id" },
  );
  if (profileErr) throw new Error(profileErr.message);

  const { data: existingRole } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (!existingRole) {
    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: userId, role: "super_admin", organization_id: null });
    if (roleErr) throw new Error(roleErr.message);
  }
}

/**
 * Self-healing: if the platform has NO super admin yet, the signed-in user is
 * promoted to an active super admin. Once one exists, this does nothing.
 */
export const claimSuperAdminIfNone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: exists, error } = await supabaseAdmin.rpc("super_admin_exists");
    if (error) throw new Error(error.message);
    if (exists) return { promoted: false };
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = u?.user?.email ?? "";
    const fullName = (u?.user?.user_metadata?.full_name as string | undefined) ?? "";
    await grantActiveSuperAdmin(supabaseAdmin, context.userId, email, fullName);
    return { promoted: true };
  });

const CreateOrgInput = z.object({
  orgName: z.string().min(1).max(200),
  adminName: z.string().min(1).max(120),
  adminEmail: z.string().email(),
  tempPassword: z.string().min(8),
  plan: z.enum(["free", "basic", "pro"]),
  expiryDate: z.string().nullable().optional(),
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
  address: z.string().max(500).optional().default(""),
  aiDailyQuota: z.number().int().min(0).max(10000).default(20),
  paperCreditBalance: z.number().int().min(0).max(1_000_000).nullable().default(null),
  paperDailyLimit: z.number().int().min(0).max(1_000_000).default(0),
});

export const createOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CreateOrgInput.parse(raw))
  .handler(async ({ data, context }) => {
    // Verify caller is a super admin via authenticated (user-scoped) client, RLS applies.
    const { data: roles, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleErr) throw new Error(roleErr.message);
    if (!roles?.some((r) => r.role === "super_admin")) {
      throw new Response("Forbidden", { status: 403 });
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limits = await readPlatformLimits(supabaseAdmin);
    if (limits.maxActiveCollegeAdmins > 0) {
      const { count, error: countError } = await supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .not("organization_id", "is", null)
        .eq("is_active", true);
      if (countError) throw new Error(countError.message);
      if ((count ?? 0) >= limits.maxActiveCollegeAdmins) {
        throw new Error(
          `Active college admin limit reached (${count}/${limits.maxActiveCollegeAdmins}).`,
        );
      }
    }

    // 1. Create org
    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .insert({
        name: data.orgName,
        address: data.address ?? "",
        plan: data.plan,
        status: data.status,
        expiry_date: data.expiryDate ?? null,
        ai_daily_quota: data.aiDailyQuota,
        paper_credit_balance: data.paperCreditBalance,
        paper_daily_limit: data.paperDailyLimit,
      })
      .select("id")
      .single();
    if (orgErr || !org) throw new Error(orgErr?.message ?? "Failed to create organization");

    // 2. Create auth user
    const { data: created, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.adminEmail,
      password: data.tempPassword,
      email_confirm: true,
      user_metadata: { full_name: data.adminName },
    });
    if (userErr || !created.user) {
      // rollback org
      await supabaseAdmin.from("organizations").delete().eq("id", org.id);
      throw new Error(userErr?.message ?? "Failed to create admin user");
    }
    const userId = created.user.id;

    // 3. Profile + role
    const { error: profErr } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      email: data.adminEmail,
      full_name: data.adminName,
      organization_id: org.id,
      must_change_password: true,
      is_active: true,
    });
    if (profErr) throw new Error(profErr.message);

    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "org_admin", organization_id: org.id });
    if (rErr) throw new Error(rErr.message);

    // Audit
    await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: context.userId,
      organization_id: org.id,
      action: "organization.create",
      target_type: "organization",
      target_id: org.id,
      metadata: { adminEmail: data.adminEmail, plan: data.plan },
    });

    return { organizationId: org.id, adminUserId: userId };
  });

export const listOrganizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!roles?.some((r) => r.role === "super_admin")) {
      throw new Response("Forbidden", { status: 403 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: orgs, error } = await supabaseAdmin
      .from("organizations")
      .select(
        "id, name, plan, status, expiry_date, ai_daily_quota, paper_credit_balance, paper_daily_limit, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const orgIds = (orgs ?? []).map((o) => o.id);
    const { data: admins } = orgIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("organization_id, email, full_name")
          .in("organization_id", orgIds)
      : { data: [] as { organization_id: string | null; email: string; full_name: string }[] };

    return (orgs ?? []).map((o) => {
      const admin = admins?.find((a) => a.organization_id === o.id);
      return { ...o, adminEmail: admin?.email ?? null, adminName: admin?.full_name ?? null };
    });
  });

const UpdateOrgInput = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
  plan: z.enum(["free", "basic", "pro"]).optional(),
  expiryDate: z.string().nullable().optional(),
  aiDailyQuota: z.number().int().min(0).max(10000).optional(),
  paperCreditBalance: z.number().int().min(0).max(1_000_000).nullable().optional(),
  paperDailyLimit: z.number().int().min(0).max(1_000_000).optional(),
});

export const updateOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => UpdateOrgInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!roles?.some((r) => r.role === "super_admin")) {
      throw new Response("Forbidden", { status: 403 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      status?: "active" | "inactive" | "suspended";
      plan?: "free" | "basic" | "pro";
      expiry_date?: string | null;
      ai_daily_quota?: number;
      paper_credit_balance?: number | null;
      paper_daily_limit?: number;
    } = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.plan !== undefined) patch.plan = data.plan;
    if (data.expiryDate !== undefined) patch.expiry_date = data.expiryDate;
    if (data.aiDailyQuota !== undefined) patch.ai_daily_quota = data.aiDailyQuota;
    if (data.paperCreditBalance !== undefined) patch.paper_credit_balance = data.paperCreditBalance;
    if (data.paperDailyLimit !== undefined) patch.paper_daily_limit = data.paperDailyLimit;
    const { error } = await supabaseAdmin
      .from("organizations")
      .update(patch)
      .eq("id", data.organizationId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: context.userId,
      organization_id: data.organizationId,
      action: "organization.update",
      target_type: "organization",
      target_id: data.organizationId,
      metadata: patch as Record<string, string | number | null>,
    });
    return { ok: true };
  });

const ResetPasswordInput = z.object({
  organizationId: z.string().uuid(),
  newPassword: z.string().min(8),
});

export const resetOrgAdminPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ResetPasswordInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!roles?.some((r) => r.role === "super_admin")) {
      throw new Response("Forbidden", { status: 403 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("organization_id", data.organizationId)
      .limit(1)
      .maybeSingle();
    if (!profile) throw new Error("No admin found for organization");
    const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      password: data.newPassword,
    });
    if (upErr) throw new Error(upErr.message);
    await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", profile.id);
    await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: context.userId,
      organization_id: data.organizationId,
      action: "org_admin.password_reset",
      target_type: "profile",
      target_id: profile.id,
      metadata: {},
    });
    return { ok: true };
  });

export const getSuperAdminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!roles?.some((r) => r.role === "super_admin")) {
      throw new Response("Forbidden", { status: 403 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [orgs, papers, aiUsage] = await Promise.all([
      supabaseAdmin.from("organizations").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("generated_papers").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("ai_usage").select("count"),
    ]);
    const totalAiCalls = (aiUsage.data ?? []).reduce((s, r) => s + (r.count ?? 0), 0);
    return {
      totalOrganizations: orgs.count ?? 0,
      totalPapers: papers.count ?? 0,
      totalAiCalls,
    };
  });

export const getPlatformLimits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!roles?.some((r) => r.role === "super_admin")) {
      throw new Response("Forbidden", { status: 403 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return readPlatformLimits(supabaseAdmin);
  });

const PlatformLimitsInput = z.object({
  maxDailyPapers: z.number().int().min(0).max(1_000_000),
  maxActiveCollegeAdmins: z.number().int().min(0).max(1_000_000),
});

export const updatePlatformLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => PlatformLimitsInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!roles?.some((r) => r.role === "super_admin")) {
      throw new Response("Forbidden", { status: 403 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings: PlatformLimits = data;
    const { error } = await supabaseAdmin.from("platform_settings").upsert([
      { key: "max_daily_papers", value: settings.maxDailyPapers },
      { key: "max_active_college_admins", value: settings.maxActiveCollegeAdmins },
    ]);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: context.userId,
      action: "platform.limits.update",
      target_type: "platform_settings",
      metadata: settings as Record<string, number>,
    });
    return settings;
  });

export const markPasswordChanged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
