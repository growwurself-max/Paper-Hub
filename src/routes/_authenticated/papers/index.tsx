import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GlassCard } from "@/components/ui/GlassCard";
import { listMyPapers, getTodayQuota } from "@/lib/paper.functions";

export const Route = createFileRoute("/_authenticated/papers/")({
  head: () => ({
    meta: [
      { title: "My Papers — Question Paper Studio" },
      { name: "description", content: "Your generated question papers." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PapersList,
});

function PapersList() {
  const list = useServerFn(listMyPapers);
  const quotaFn = useServerFn(getTodayQuota);
  const navigate = useNavigate();
  const papers = useQuery({ queryKey: ["papers"], queryFn: () => list() });
  const quota = useQuery({ queryKey: ["quota"], queryFn: () => quotaFn() });

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline">
              ← Back to dashboard
            </Link>
            <h1 className="mt-1 text-2xl font-bold gradient-text">My Papers</h1>
            {quota.data && (
              <p className="mt-1 text-sm text-muted-foreground">
                AI quota today: {quota.data.used} / {quota.data.quota}
              </p>
            )}
          </div>
          <button
            onClick={() => navigate({ to: "/papers/new" })}
            className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90"
          >
            + New paper
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {papers.isLoading && <div className="glass h-20 animate-pulse rounded-2xl" />}
          {papers.data?.length === 0 && (
            <GlassCard>
              <p className="text-sm text-muted-foreground">
                No papers yet. Click <b>New paper</b> to generate your first one.
              </p>
            </GlassCard>
          )}
          {papers.data?.map((p) => (
            <Link
              key={p.id}
              to="/papers/$id"
              params={{ id: p.id }}
              className="block"
            >
              <GlassCard className="transition hover:border-primary/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">{p.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleString()} · via {p.ai_source || "unknown"}
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground">Open →</span>
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
