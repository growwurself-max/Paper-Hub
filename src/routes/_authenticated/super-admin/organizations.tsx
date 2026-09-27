import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/GlassCard";
import { useSession } from "@/lib/useSession";
import {
  listOrganizations,
  createOrganization,
  updateOrganization,
  resetOrgAdminPassword,
} from "@/lib/superadmin.functions";
import { PasswordInput } from "@/components/PasswordInput";

export const Route = createFileRoute("/_authenticated/super-admin/organizations")({
  head: () => ({
    meta: [{ title: "Manage Organizations" }, { name: "robots", content: "noindex" }],
  }),
  component: OrgsPage,
});

type CreateInput = {
  orgName: string;
  adminName: string;
  adminEmail: string;
  tempPassword: string;
  plan: "free" | "basic" | "pro";
  expiryDate: string | null;
  status: "active" | "inactive" | "suspended";
  address: string;
  aiDailyQuota: number;
  paperCreditBalance: number | null;
  paperDailyLimit: number;
};

function OrgsPage() {
  const { data: session, isLoading: sLoading } = useSession();
  const listFn = useServerFn(listOrganizations);
  const createFn = useServerFn(createOrganization);
  const updateFn = useServerFn(updateOrganization);
  const resetFn = useServerFn(resetOrgAdminPassword);
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);

  const { data: orgs, isLoading } = useQuery({
    queryKey: ["super-admin-orgs"],
    queryFn: () => listFn(),
    enabled: session?.role === "super_admin",
  });

  const createMut = useMutation({
    mutationFn: (input: CreateInput) => createFn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super-admin-orgs"] });
      qc.invalidateQueries({ queryKey: ["super-admin-stats"] });
      setShowCreate(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: (input: {
      organizationId: string;
      status?: "active" | "inactive" | "suspended";
      plan?: "free" | "basic" | "pro";
      expiryDate?: string | null;
      aiDailyQuota?: number;
      paperCreditBalance?: number | null;
      paperDailyLimit?: number;
    }) => updateFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super-admin-orgs"] }),
  });

  if (sLoading) return null;
  if (!session) return <Navigate to="/super-admin/login" />;
  if (session.role !== "super_admin") return <Navigate to="/dashboard" />;

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <div>
          <Link to="/super-admin" className="text-xs text-muted-foreground hover:text-foreground">
            ← Back
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Organizations</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          + New organization
        </button>
      </header>

      <main className="mx-auto mt-8 max-w-6xl">
        <GlassCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expiry</th>
                  <th className="px-4 py-3">AI quota/day</th>
                  <th className="px-4 py-3">Paper credits</th>
                  <th className="px-4 py-3">Paper limit/day</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={9} className="px-4 py-4">
                        <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))}
                {!isLoading && (orgs?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      No organizations yet. Create your first one.
                    </td>
                  </tr>
                )}
                {orgs?.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{o.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div>{o.adminName ?? "—"}</div>
                      <div className="text-xs">{o.adminEmail ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={o.plan}
                        onChange={(e) =>
                          updateMut.mutate({
                            organizationId: o.id,
                            plan: e.target.value as "free" | "basic" | "pro",
                          })
                        }
                        className="rounded border border-border bg-input px-2 py-1"
                      >
                        <option value="free">Free</option>
                        <option value="basic">Basic</option>
                        <option value="pro">Pro</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={o.status}
                        onChange={(e) =>
                          updateMut.mutate({
                            organizationId: o.id,
                            status: e.target.value as "active" | "inactive" | "suspended",
                          })
                        }
                        className="rounded border border-border bg-input px-2 py-1"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{o.expiry_date ?? "—"}</td>
                    <td className="px-4 py-3">{o.ai_daily_quota}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        placeholder="Unlimited"
                        defaultValue={o.paper_credit_balance ?? ""}
                        onBlur={(e) => {
                          const value = e.currentTarget.value.trim();
                          updateMut.mutate({
                            organizationId: o.id,
                            paperCreditBalance: value === "" ? null : Number(value),
                          });
                        }}
                        className="w-28 rounded border border-border bg-input px-2 py-1"
                        aria-label={`${o.name} paper credits`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        defaultValue={o.paper_daily_limit}
                        onBlur={(e) =>
                          updateMut.mutate({
                            organizationId: o.id,
                            paperDailyLimit: Number(e.currentTarget.value),
                          })
                        }
                        className="w-24 rounded border border-border bg-input px-2 py-1"
                        aria-label={`${o.name} paper daily limit`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setResetting(o.id)}
                        className="text-xs text-accent underline"
                      >
                        Reset password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </main>

      <AnimatePresence>
        {showCreate && (
          <CreateOrgModal
            onClose={() => setShowCreate(false)}
            onSubmit={(input) => createMut.mutateAsync(input)}
            error={createMut.error instanceof Error ? createMut.error.message : null}
            loading={createMut.isPending}
          />
        )}
        {resetting && (
          <ResetPasswordModal
            onClose={() => setResetting(null)}
            onSubmit={async (newPassword) => {
              await resetFn({ data: { organizationId: resetting, newPassword } });
              setResetting(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateOrgModal({
  onClose,
  onSubmit,
  error,
  loading,
}: {
  onClose: () => void;
  onSubmit: (input: CreateInput) => Promise<unknown>;
  error: string | null;
  loading: boolean;
}) {
  const [form, setForm] = useState<CreateInput>({
    orgName: "",
    adminName: "",
    adminEmail: "",
    tempPassword: "",
    plan: "free",
    expiryDate: null,
    status: "active",
    address: "",
    aiDailyQuota: 20,
    paperCreditBalance: null,
    paperDailyLimit: 0,
  });

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
        className="w-full max-w-lg"
      >
        <GlassCard className="max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold">New organization</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onSubmit(form);
            }}
            className="mt-4 space-y-3"
          >
            <TextField
              label="Organization name"
              value={form.orgName}
              onChange={(v) => setForm({ ...form, orgName: v })}
              required
            />
            <TextField
              label="Admin name"
              value={form.adminName}
              onChange={(v) => setForm({ ...form, adminName: v })}
              required
            />
            <TextField
              label="Admin email"
              type="email"
              value={form.adminEmail}
              onChange={(v) => setForm({ ...form, adminEmail: v })}
              required
            />
            <label className="block">
              <span className="text-sm font-medium">Temporary password (min 8)</span>
              <PasswordInput
                required
                minLength={8}
                value={form.tempPassword}
                onChange={(e) => setForm({ ...form, tempPassword: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
              />
            </label>
            <TextField
              label="Expiry date"
              type="date"
              value={form.expiryDate ?? ""}
              onChange={(v) => setForm({ ...form, expiryDate: v || null })}
            />
            <TextField
              label="Address"
              value={form.address}
              onChange={(v) => setForm({ ...form, address: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium">Plan</span>
                <select
                  value={form.plan}
                  onChange={(e) =>
                    setForm({ ...form, plan: e.target.value as CreateInput["plan"] })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
                >
                  <option value="free">Free</option>
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Status</span>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as CreateInput["status"] })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium">Daily AI quota</span>
              <input
                type="number"
                min={0}
                value={form.aiDailyQuota}
                onChange={(e) => setForm({ ...form, aiDailyQuota: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium">Paper credits</span>
                <input
                  type="number"
                  min={0}
                  placeholder="Unlimited"
                  value={form.paperCreditBalance ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      paperCreditBalance: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Paper limit/day</span>
                <input
                  type="number"
                  min={0}
                  value={form.paperDailyLimit}
                  onChange={(e) => setForm({ ...form, paperDailyLimit: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
                />
              </label>
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-border bg-card/50 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {loading ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
      />
    </label>
  );
}

function ResetPasswordModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (newPassword: string) => Promise<void>;
}) {
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md"
      >
        <GlassCard>
          <h2 className="text-lg font-bold">Reset organization admin password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The admin will be required to change it on next login.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setLoading(true);
              try {
                await onSubmit(pw);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
                setLoading(false);
              }
            }}
            className="mt-4 space-y-3"
          >
            <PasswordInput
              required
              minLength={8}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="New password (min 8 characters)"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
            />
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-border bg-card/50 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {loading ? "Resetting…" : "Reset password"}
              </button>
            </div>
          </form>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}
