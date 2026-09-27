import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GlassCard } from "@/components/ui/GlassCard";
import { EXAM_PRESETS } from "@/lib/exam-presets";
import { deleteTemplate, listTemplates } from "@/lib/templates.functions";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({
    meta: [
      { title: "Templates — Question Paper Studio" },
      {
        name: "description",
        content: "Built-in NEET, JEE, EAMCET and board exam patterns plus your saved templates.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTemplates);
  const delFn = useServerFn(deleteTemplate);
  const saved = useQuery({ queryKey: ["templates"], queryFn: () => listFn() });
  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-bold gradient-text">Exam templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start from a competitive-exam pattern or one of your saved configurations.
        </p>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Built-in patterns
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EXAM_PRESETS.map((p) => (
            <GlassCard key={p.id} className="flex flex-col">
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{p.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                <li>
                  {p.distribution.mcq} MCQ · {p.distribution.short} short · {p.distribution.long}{" "}
                  long
                </li>
                <li>
                  {p.totalMarks} marks · {p.duration}
                </li>
                <li>
                  {p.negativeMarking ? `−${p.negativeMarking} negative marking` : "No negative marking"}
                  {p.omr ? " · OMR sheet" : ""}
                </li>
              </ul>
              <Link
                to="/papers/new"
                search={{ preset: p.id }}
                className="mt-4 rounded-lg bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Use this pattern
              </Link>
            </GlassCard>
          ))}
        </div>

        <h2 className="mt-10 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Your saved templates
        </h2>
        <div className="mt-3 space-y-3">
          {saved.isLoading && <div className="glass h-20 animate-pulse rounded-2xl" />}
          {saved.data?.length === 0 && (
            <GlassCard>
              <p className="text-sm text-muted-foreground">
                No saved templates yet — save one from the paper wizard.
              </p>
            </GlassCard>
          )}
          {saved.data?.map((t) => {
            const cfg = (t.config as Record<string, unknown>) || {};
            return (
              <GlassCard key={t.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{t.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {String(cfg.subject ?? "")} · {String(cfg.className ?? "")} ·{" "}
                      {String(cfg.totalMarks ?? "")} marks
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      to="/papers/new"
                      search={{ templateId: t.id }}
                      className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      Use
                    </Link>
                    <button
                      onClick={() => remove.mutate(t.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-card"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      </div>
    </div>
  );
}
