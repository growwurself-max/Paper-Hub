import { BookOpen, Check, Loader2, Pencil } from "lucide-react";
import type { TextbookSource } from "@/lib/textbook-images";

type TextbookSourceSummaryProps = {
  source: TextbookSource;
  onEdit: () => void;
  onContinue: () => void;
  busy?: boolean;
};

/**
 * What Paper Hub read off the photographed pages, shown before anything is
 * generated.
 *
 * This is a confirmation, not a form: the teacher can send the paper straight
 * on, or go back and change the topic or the pages if the read looks wrong.
 */
export function TextbookSourceSummary({
  source,
  onEdit,
  onContinue,
  busy = false,
}: TextbookSourceSummaryProps) {
  return (
    <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <BookOpen className="h-4 w-4 text-primary" />
        Textbook content detected
      </p>

      <dl className="mt-3 space-y-3 text-sm">
        {source.chapter && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Chapter</dt>
            <dd className="mt-0.5 font-medium">{source.chapter}</dd>
          </div>
        )}
        {source.subject && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Subject</dt>
            <dd className="mt-0.5 font-medium">{source.subject}</dd>
          </div>
        )}
        {source.topics.length > 0 && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Topics</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {source.topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full border border-border bg-background px-2 py-0.5 text-xs"
                >
                  {topic}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-3 text-xs text-muted-foreground">
        Source: {source.pageCount} textbook page{source.pageCount === 1 ? "" : "s"} ·{" "}
        {source.keyPoints.length} key point{source.keyPoints.length === 1 ? "" : "s"} extracted
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onContinue}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Continue
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-card disabled:opacity-60"
        >
          <Pencil className="h-4 w-4" />
          Edit topic
        </button>
      </div>
    </div>
  );
}
