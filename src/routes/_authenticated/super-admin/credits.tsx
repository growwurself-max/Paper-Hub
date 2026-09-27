import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/GlassCard";
import { useSession } from "@/lib/useSession";
import {
  listInstituteCredits,
  setInstituteCredits,
  topUpInstituteCredits,
  listCreditTransactions,
} from "@/lib/credits.functions";

export const Route = createFileRoute("/_authenticated/super-admin/credits")({
  head: () => ({
    meta: [{ title: "Institute Credits" }, { name: "robots", content: "noindex" }],
  }),
  component: CreditsPage,
});

type InstituteCredit = {
  id: string;
  name: string;
  plan: "free" | "basic" | "pro";
  status: "active" | "inactive" | "suspended";
  paper_credit_balance: number | null;
  paper_daily_limit: number;
  lifetimeGranted: number;
  papersGenerated: number;
  adminName: string | null;
  adminEmail: string | null;
};

type HistoryRow = {
  id: string;
  organization_id: string;
  organizationName: string;
  delta: number;
  balance_after: number;
  reason: string;
  actorEmail: string | null;
  created_at: string;
};

const REASON_LABELS: Record<string, string> = {
  "credits.set": "Balance assigned",
  "credits.top_up": "Top up",
  "credits.adjust": "Manual adjustment",
  "paper.generation": "Paper generated",
  "paper.generation.refund": "Generation refunded",
};

function CreditsPage() {
  const { data: session, isLoading: sLoading } = useSession();
  const listFn = useServerFn(listInstituteCredits);
  const historyFn = useServerFn(listCreditTransactions);
  const setFn = useServerFn(setInstituteCredits);
  const topUpFn = useServerFn(topUpInstituteCredits);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<InstituteCredit | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const isSuperAdmin = session?.role === "super_admin";

  const { data: institutes, isLoading } = useQuery({
    queryKey: ["super-admin-credits"],
    queryFn: () => listFn(),
    enabled: isSuperAdmin,
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["super-admin-credit-history", historyFor],
    queryFn: () => historyFn({ data: { organizationId: historyFor ?? undefined, limit: 50 } }),
    enabled: isSuperAdmin,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["super-admin-credits"] });
    qc.invalidateQueries({ queryKey: ["super-admin-credit-history"] });
    qc.invalidateQueries({ queryKey: ["super-admin-orgs"] });
  }

  const setMut = useMutation({
    mutationFn: (input: { organizationId: string; credits: number | null; reason: string }) =>
      setFn({ data: input }),
    onSuccess: refresh,
  });

  const topUpMut = useMutation({
    mutationFn: (input: { organizationId: string; amount: number; reason: string }) =>
      topUpFn({ data: input }),
    onSuccess: refresh,
  });

  if (sLoading) return null;
  if (!session) return <Navigate to="/super-admin/login" />;
  if (session.role !== "super_admin") return <Navigate to="/dashboard" />;

  const term = search.trim().toLowerCase();
  const visible = (institutes ?? []).filter(
    (i) =>
      term === "" ||
      i.name.toLowerCase().includes(term) ||
      (i.adminEmail ?? "").toLowerCase().includes(term),
  );

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <div>
          <Link to="/super-admin" className="text-xs text-muted-foreground hover:text-foreground">
            ← Back
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Institute credits</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Prepaid exam generation quota. Each generated paper spends one credit.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search institutes…"
          className="input w-56"
          aria-label="Search institutes"
        />
      </header>

      <main className="mx-auto mt-8 max-w-6xl space-y-8">
        <GlassCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Institute</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Credits</th>
                  <th className="px-4 py-3">Lifetime granted</th>
                  <th className="px-4 py-3">Papers</th>
                  <th className="px-4 py-3">Limit/day</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={7} className="px-4 py-4">
                        <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))}
                {!isLoading && visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      {term ? "No institutes match that search." : "No institutes yet."}
                    </td>
                  </tr>
                )}
                {visible.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-muted-foreground">{i.adminEmail ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          i.status === "active"
                            ? "text-xs text-green-600 dark:text-green-400"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {i.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {i.paper_credit_balance === null ? (
                        <span className="text-xs text-muted-foreground">Unlimited</span>
                      ) : (
                        <span
                          className={
                            i.paper_credit_balance === 0
                              ? "font-semibold text-destructive"
                              : "font-semibold"
                          }
                        >
                          {i.paper_credit_balance}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{i.lifetimeGranted}</td>
                    <td className="px-4 py-3 text-muted-foreground">{i.papersGenerated}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {i.paper_daily_limit === 0 ? "Unlimited" : i.paper_daily_limit}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => setEditing(i)}
                          className="text-xs text-accent underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setHistoryFor(historyFor === i.id ? null : i.id)}
                          className="text-xs text-accent underline"
                        >
                          History
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Credit history
              {historyFor && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {visible.find((i) => i.id === historyFor)?.name ?? "selected institute"}
                </span>
              )}
            </h2>
            {historyFor && (
              <button onClick={() => setHistoryFor(null)} className="text-xs text-accent underline">
                Show all institutes
              </button>
            )}
          </div>

          <GlassCard className="mt-3 overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Institute</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Change</th>
                    <th className="px-4 py-3">Balance after</th>
                    <th className="px-4 py-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historyLoading && (
                    <tr>
                      <td colSpan={6} className="px-4 py-4">
                        <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  )}
                  {!historyLoading && (history?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        No credit movements recorded yet.
                      </td>
                    </tr>
                  )}
                  {history?.map((h: HistoryRow) => (
                    <tr key={h.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(h.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">{h.organizationName}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {REASON_LABELS[h.reason] ?? h.reason}
                      </td>
                      <td
                        className={
                          h.delta > 0
                            ? "px-4 py-3 font-medium text-green-600 dark:text-green-400"
                            : "px-4 py-3 font-medium text-destructive"
                        }
                      >
                        {h.delta > 0 ? `+${h.delta}` : h.delta}
                      </td>
                      <td className="px-4 py-3">{h.balance_after}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {h.actorEmail ?? "System"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </section>
      </main>

      <AnimatePresence>
        {editing && (
          <CreditsModal
            institute={editing}
            onClose={() => setEditing(null)}
            onSet={async (credits, reason) => {
              await setMut.mutateAsync({ organizationId: editing.id, credits, reason });
              setEditing(null);
            }}
            onTopUp={async (amount, reason) => {
              await topUpMut.mutateAsync({ organizationId: editing.id, amount, reason });
              setEditing(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CreditsModal({
  institute,
  onClose,
  onSet,
  onTopUp,
}: {
  institute: InstituteCredit;
  onClose: () => void;
  onSet: (credits: number | null, reason: string) => Promise<void>;
  onTopUp: (amount: number, reason: string) => Promise<void>;
}) {
  const unlimited = institute.paper_credit_balance === null;
  const [mode, setMode] = useState<"set" | "topup">("topup");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const parsed = Number(amount);
  const isBlank = amount.trim() === "";
  // In set mode a blank field is meaningful: it restores the unlimited balance.
  // In top-up mode a value is required and must be a non-zero integer.
  const valid = isBlank
    ? mode === "set"
    : Number.isInteger(parsed) && (mode === "set" || parsed !== 0);

  async function run() {
    if (!valid) return;
    setError(null);
    setLoading(true);
    try {
      if (mode === "set") {
        await onSet(isBlank ? null : parsed, reason.trim());
      } else {
        await onTopUp(parsed, reason.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update credits");
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md"
      >
        <GlassCard>
          <h2 className="text-lg font-bold">{institute.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Current balance:{" "}
            <span className="font-medium text-foreground">
              {unlimited ? "Unlimited" : institute.paper_credit_balance}
            </span>{" "}
            · {institute.lifetimeGranted} granted all time
          </p>

          {unlimited && (
            <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              This institute is on an unlimited balance, so a top up is not possible. Use &ldquo;Set
              balance&rdquo; to move it onto a prepaid quota.
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <ModeButton
              active={mode === "topup"}
              onClick={() => setMode("topup")}
              disabled={unlimited}
            >
              Top up
            </ModeButton>
            <ModeButton active={mode === "set"} onClick={() => setMode("set")}>
              Set balance
            </ModeButton>
          </div>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-sm font-medium">
                {mode === "set" ? "New balance" : "Amount to add (use a minus to deduct)"}
              </span>
              <input
                type="number"
                min={mode === "set" ? 0 : undefined}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={mode === "set" ? "12" : "12"}
                className="input mt-1"
              />
            </label>
            {mode === "set" && (
              <p className="text-xs text-muted-foreground">
                Leave blank to restore an unlimited balance.
              </p>
            )}
            <label className="block">
              <span className="text-sm font-medium">Reason (optional)</span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Annual prepaid bundle"
                className="input mt-1"
              />
            </label>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-border bg-card/50 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={loading || !valid}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {loading
                  ? "Saving…"
                  : mode === "set"
                    ? isBlank
                      ? "Make unlimited"
                      : "Set balance"
                    : "Apply top up"}
              </button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        active
          ? "flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          : "flex-1 rounded-lg border border-border bg-card/50 px-4 py-2 text-sm disabled:opacity-40"
      }
    >
      {children}
    </button>
  );
}
