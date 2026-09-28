import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/GlassCard";
import { BrandLogo } from "@/components/BrandLogo";
import { useSession } from "@/lib/useSession";
import {
  getPlatformLimits,
  getSuperAdminStats,
  updatePlatformLimits,
} from "@/lib/superadmin.functions";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/super-admin/")({
  head: () => ({
    meta: [{ title: "Super Admin Dashboard" }, { name: "robots", content: "noindex" }],
  }),
  component: SuperAdminHome,
});

function SuperAdminHome() {
  const navigate = useNavigate();
  const { data: session, isLoading: sLoading } = useSession();
  const stats = useServerFn(getSuperAdminStats);
  const getLimits = useServerFn(getPlatformLimits);
  const updateLimits = useServerFn(updatePlatformLimits);
  const { data: statsData, isLoading } = useQuery({
    queryKey: ["super-admin-stats"],
    queryFn: () => stats(),
    enabled: session?.role === "super_admin",
  });
  const limits = useQuery({
    queryKey: ["platform-limits"],
    queryFn: () => getLimits(),
    enabled: session?.role === "super_admin",
  });
  const [maxDailyPapers, setMaxDailyPapers] = useState(0);
  const [maxActiveCollegeAdmins, setMaxActiveCollegeAdmins] = useState(0);
  const limitsMutation = useMutation({
    mutationFn: () => updateLimits({ data: { maxDailyPapers, maxActiveCollegeAdmins } }),
    onSuccess: () => limits.refetch(),
  });

  useEffect(() => {
    if (!limits.data) return;
    setMaxDailyPapers(limits.data.maxDailyPapers);
    setMaxActiveCollegeAdmins(limits.data.maxActiveCollegeAdmins);
  }, [limits.data]);

  if (sLoading) return null;
  if (!session) return <Navigate to="/super-admin/login" />;
  if (session.role !== "super_admin") return <Navigate to="/dashboard" />;

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/super-admin/login" });
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo height="sm" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              Platform administration
            </p>
            <h1 className="text-2xl font-bold">Super Admin</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/super-admin/organizations"
            className="rounded-lg border border-border bg-card/50 px-3 py-1.5 text-sm hover:bg-card"
          >
            Organizations
          </Link>
          <Link
            to="/super-admin/credits"
            className="rounded-lg border border-border bg-card/50 px-3 py-1.5 text-sm hover:bg-card"
          >
            Credits
          </Link>
          <button
            onClick={signOut}
            className="rounded-lg border border-border bg-card/50 px-3 py-1.5 text-sm hover:bg-card"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto mt-8 grid max-w-6xl gap-6 md:grid-cols-3">
        {[
          { label: "Organizations", value: statsData?.totalOrganizations ?? 0 },
          { label: "Papers generated", value: statsData?.totalPapers ?? 0 },
          { label: "AI calls (all time)", value: statsData?.totalAiCalls ?? 0 },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <GlassCard>
              <h3 className="text-sm font-medium text-muted-foreground">{s.label}</h3>
              <p className="mt-2 text-3xl font-bold">
                {isLoading ? (
                  <span className="inline-block h-8 w-16 animate-pulse rounded bg-muted" />
                ) : (
                  s.value
                )}
              </p>
            </GlassCard>
          </motion.div>
        ))}

        <div className="md:col-span-3">
          <GlassCard>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <h2 className="text-lg font-semibold">Platform safeguards</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Set global limits across all colleges. Use 0 for unlimited.
                </p>
              </div>
              <form
                className="grid w-full max-w-xl gap-3 sm:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  limitsMutation.mutate();
                }}
              >
                <label className="text-sm">
                  <span className="font-medium">Daily papers</span>
                  <input
                    type="number"
                    min={0}
                    value={maxDailyPapers}
                    onChange={(event) => setMaxDailyPapers(Number(event.target.value))}
                    className="input mt-1"
                  />
                </label>
                <label className="text-sm">
                  <span className="font-medium">Active college admins</span>
                  <input
                    type="number"
                    min={0}
                    value={maxActiveCollegeAdmins}
                    onChange={(event) => setMaxActiveCollegeAdmins(Number(event.target.value))}
                    className="input mt-1"
                  />
                </label>
                <button
                  type="submit"
                  disabled={limitsMutation.isPending || limits.isLoading}
                  className="self-end rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {limitsMutation.isPending ? "Saving…" : "Save limits"}
                </button>
              </form>
            </div>
            {limitsMutation.error && (
              <p className="mt-3 text-sm text-destructive">
                {limitsMutation.error instanceof Error
                  ? limitsMutation.error.message
                  : "Could not save limits."}
              </p>
            )}
          </GlassCard>

          <GlassCard>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-semibold">Manage organizations</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create new institutions, assign admins, and control plans.
                </p>
              </div>
              <Link
                to="/super-admin/organizations"
                className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
              >
                Open organizations
              </Link>
            </div>
          </GlassCard>

          <GlassCard>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-semibold">Institute credits</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Top up prepaid exam generation quotas and review credit history.
                </p>
              </div>
              <Link
                to="/super-admin/credits"
                className="rounded-lg border border-border bg-card/50 px-4 py-2 text-center font-medium hover:bg-card"
              >
                Manage credits
              </Link>
            </div>
          </GlassCard>
        </div>
      </main>
    </div>
  );
}
