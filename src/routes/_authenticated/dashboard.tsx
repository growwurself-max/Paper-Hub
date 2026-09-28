import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useSession } from "@/lib/useSession";
import { GlassCard } from "@/components/ui/GlassCard";
import { BrandLogo } from "@/components/BrandLogo";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTodayQuota, listMyPapers } from "@/lib/paper.functions";
import { listTemplates } from "@/lib/templates.functions";
import { listSyllabi } from "@/lib/syllabus.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Question Paper Studio" },
      { name: "description", content: "Create AI-generated question papers for your institution." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrgDashboard,
});

function OrgDashboard() {
  const navigate = useNavigate();
  const { data: session, isLoading } = useSession();
  const papersFn = useServerFn(listMyPapers);
  const templatesFn = useServerFn(listTemplates);
  const quotaFn = useServerFn(getTodayQuota);
  const syllabiFn = useServerFn(listSyllabi);
  const enabled = Boolean(session && session.role === "org_admin" && !session.mustChangePassword);
  const papers = useQuery({ queryKey: ["papers"], queryFn: () => papersFn(), enabled });
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => templatesFn(), enabled });
  const quota = useQuery({ queryKey: ["quota"], queryFn: () => quotaFn(), enabled });
  const syllabi = useQuery({ queryKey: ["syllabi"], queryFn: () => syllabiFn(), enabled });
  const quotaPct =
    quota.data && quota.data.quota > 0
      ? Math.min(100, Math.round((quota.data.used / quota.data.quota) * 100))
      : 0;

  if (isLoading) return <DashboardSkeleton />;
  if (!session) return <Navigate to="/" />;
  if (session.role === "super_admin") return <Navigate to="/super-admin" />;
  if (session.mustChangePassword) return <Navigate to="/change-password" />;
  if (!session.isActive || !session.organizationId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <GlassCard className="max-w-md text-center">
          <h2 className="text-xl font-semibold">Account inactive</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your organization is not active. Please contact your platform administrator.
          </p>
        </GlassCard>
      </div>
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo height="md" />
          <h1 className="sr-only">Paper Hub by Groww Tech</h1>
          <span className="hidden truncate text-xs font-medium uppercase tracking-widest text-muted-foreground sm:inline">
            Institution workspace
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {session.fullName || session.email}
          </span>
          <button
            onClick={signOut}
            className="rounded-lg border border-border bg-card/50 px-3 py-1.5 text-sm hover:bg-card"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto mt-8 grid max-w-6xl gap-6 md:grid-cols-3">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard>
            <h3 className="text-sm font-medium text-muted-foreground">Papers generated</h3>
            <p className="mt-2 text-3xl font-bold">{papers.data?.length ?? "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {syllabi.data?.length ?? 0} syllabus documents uploaded
            </p>
          </GlassCard>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <GlassCard>
            <h3 className="text-sm font-medium text-muted-foreground">Templates saved</h3>
            <p className="mt-2 text-3xl font-bold">{templates.data?.length ?? "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Plus NEET, JEE, EAMCET &amp; board patterns built in
            </p>
          </GlassCard>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <GlassCard>
            <h3 className="text-sm font-medium text-muted-foreground">AI quota (today)</h3>
            <p className="mt-2 text-3xl font-bold">
              {quota.data ? `${quota.data.used} / ${quota.data.quota}` : "—"}
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${quotaPct}%` }} />
            </div>
          </GlassCard>
        </motion.div>

        <div className="md:col-span-3">
          <GlassCard>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-semibold">Create a new paper</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload a syllabus or concept PDF, pick a NEET / JEE / EAMCET / board pattern, and
                  generate the paper, answer key and OMR sheet with AI.
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  to="/syllabi"
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-card"
                >
                  Syllabus library
                </Link>
                <Link
                  to="/templates"
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-card"
                >
                  Templates
                </Link>
                <Link
                  to="/papers"
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-card"
                >
                  My papers
                </Link>
                <Link
                  to="/papers/new"
                  className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90"
                >
                  Start new paper
                </Link>
              </div>
            </div>
          </GlassCard>
        </div>
      </main>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass h-32 animate-pulse rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
