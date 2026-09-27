import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { getPaper, updatePaper, type GeneratedQuestion } from "@/lib/paper.functions";
import { getOmrExamPackage, type OmrExamPackage } from "@/lib/omr-package.functions";
import { buildOmrAnswerKey, inPrintedOrder, resolveAnswerLetter } from "@/lib/answer-key";
import { OmrSheet } from "@/components/OmrSheet";
import { downloadOmrSheetImage, type OmrImageType, type OmrSheetProps } from "@/lib/omr-sheet";
import { formatExamText } from "@/lib/exam-text";

export const Route = createFileRoute("/_authenticated/papers/$id")({
  head: () => ({
    meta: [
      { title: "Paper — Question Paper Studio" },
      { name: "description", content: "View, edit, print, or export a generated question paper." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PaperView,
});

type Header = {
  collegeName: string;
  title: string;
  subject: string;
  className: string;
  board: string;
  duration: string;
  instructions: string;
};

function PaperView() {
  const { id } = Route.useParams();
  const getFn = useServerFn(getPaper);
  const updateFn = useServerFn(updatePaper);
  const paper = useQuery({
    queryKey: ["paper", id],
    queryFn: () => getFn({ data: { id } }),
  });
  const [view, setView] = useState<"paper" | "answers" | "omr">("paper");
  const [editing, setEditing] = useState(false);
  const [omrPreview, setOmrPreview] = useState<"sheet" | "key">("sheet");
  const [omrFormat, setOmrFormat] = useState<OmrImageType>("png");
  const [header, setHeader] = useState<Header | null>(null);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [omrError, setOmrError] = useState<string | null>(null);

  // Hydrate the editable copy once the paper loads.
  useEffect(() => {
    if (!paper.data) return;
    const cfg = (paper.data.config as Record<string, unknown>) || {};
    setHeader({
      collegeName: String(cfg.collegeName ?? ""),
      title: String(paper.data.title ?? ""),
      subject: String(cfg.subject ?? ""),
      className: String(cfg.className ?? ""),
      board: String(cfg.board ?? ""),
      duration: String(cfg.duration ?? ""),
      instructions: String(cfg.instructions ?? ""),
    });
    setQuestions(
      ((paper.data.questions as unknown as GeneratedQuestion[]) || []).map((q) => ({ ...q })),
    );
  }, [paper.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!header) return;
      return updateFn({ data: { id, ...header, questions } });
    },
    onSuccess: () => {
      setSaveNote("Changes saved.");
      setError(null);
      paper.refetch();
      setTimeout(() => setSaveNote(null), 2500);
    },
    onError: (e: Error) => setError(e.message),
  });

  const packageFn = useServerFn(getOmrExamPackage);
  const downloadPackage = useMutation({
    mutationFn: () => packageFn({ data: { id } }),
    onSuccess: (data: OmrExamPackage) => {
      downloadJson(data, `${data.exam.examId}-omr-key.json`);
    },
    onError: (e: Error) => setOmrError(e.message),
  });

  if (paper.isLoading || (paper.data && !header)) {
    return (
      <div className="min-h-screen px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="glass h-32 animate-pulse rounded-2xl" />
        </div>
      </div>
    );
  }
  if (paper.error || !paper.data || !header) {
    return (
      <div className="min-h-screen px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <GlassCard>
            <p className="text-sm text-destructive">Could not load this paper.</p>
            <Link to="/papers" className="mt-3 inline-block text-sm hover:underline">
              ← Back to papers
            </Link>
          </GlassCard>
        </div>
      </div>
    );
  }

  const cfg = (paper.data.config as Record<string, unknown>) || {};
  const totalMarks = questions.reduce((s, q) => s + (Number(q.marks) || 0), 0);

  // The same signal the OMR sheet itself keys off, so the export button and the
  // printable sheet can never disagree about whether this exam is OMR.
  const supportsOmr = Boolean(cfg.omr) || paper.data.omr_pdf_path != null;

  const mcqs = questions.filter((q) => q.type === "mcq");
  const numerics = questions.filter((q) => q.type === "numeric");
  const shorts = questions.filter((q) => q.type === "short");
  const longs = questions.filter((q) => q.type === "long");

  const setQ = (index: number, patch: Partial<GeneratedQuestion>) =>
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));

  // One source of truth for the sheet: the preview, the printed page and the
  // downloaded image are all rendered from these props, so a bubbled option can
  // never differ between what a reviewer checks and what Result Hub scans.
  const omrProps = (mode: "sheet" | "key"): OmrSheetProps => ({
    mode,
    title: header.title,
    collegeName: header.collegeName,
    subject: header.subject,
    className: header.className,
    board: header.board,
    duration: header.duration,
    examDate: typeof cfg.examDate === "string" ? cfg.examDate : undefined,
    maxMarks: mcqs.reduce((sum, question) => sum + (Number(question.marks) || 0), 0),
    questionCount: Math.max(mcqs.length, 1),
    optionCount: Math.min(6, Math.max(4, ...mcqs.map((question) => question.options?.length ?? 0))),
    negativeMarking: Number(cfg.negativeMarking || 0),
    answerKey: mode === "key" ? buildOmrAnswerKey(questions) : undefined,
  });

  const downloadOmrKey = () => {
    setOmrError(null);
    try {
      downloadOmrSheetImage(omrProps("key"), {
        type: omrFormat,
        filename: `${slugify(header.title)}-bubbled-omr-key.${omrFormat === "jpeg" ? "jpg" : "png"}`,
      });
    } catch (error) {
      setOmrError(error instanceof Error ? error.message : "The OMR image could not be created.");
    }
    downloadPackage.mutate();
  };

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link to="/papers" className="text-sm text-muted-foreground hover:underline">
            ← Back to papers
          </Link>
          <div className="flex flex-wrap gap-2">
            {(["paper", "answers", "omr"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  view === v ? "border-primary bg-primary/10" : "border-border hover:bg-card"
                }`}
              >
                {v === "paper" ? "Question paper" : v === "answers" ? "Answer key" : "OMR sheet"}
              </button>
            ))}
            <button
              onClick={() => setEditing((e) => !e)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                editing ? "border-primary bg-primary/10" : "border-border hover:bg-card"
              }`}
            >
              {editing ? "Close editor" : "Edit paper"}
            </button>
            <button
              onClick={() => window.print()}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Print / Save as PDF
            </button>
          </div>
        </div>

        {editing && (
          <GlassCard className="mb-6 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Edit paper</h2>
              <div className="flex items-center gap-3">
                {saveNote ? <span className="text-xs text-primary">{saveNote}</span> : null}
                {error ? <span className="text-xs text-destructive">{error}</span> : null}
                <button
                  onClick={() => save.mutate()}
                  disabled={save.isPending || !header.title}
                  className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {save.isPending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <EditField label="College / School name">
                <input
                  value={header.collegeName}
                  onChange={(e) => setHeader({ ...header, collegeName: e.target.value })}
                  className="input"
                />
              </EditField>
              <EditField label="Exam title">
                <input
                  value={header.title}
                  onChange={(e) => setHeader({ ...header, title: e.target.value })}
                  className="input"
                />
              </EditField>
              <EditField label="Subject">
                <input
                  value={header.subject}
                  onChange={(e) => setHeader({ ...header, subject: e.target.value })}
                  className="input"
                />
              </EditField>
              <EditField label="Class / Level">
                <input
                  value={header.className}
                  onChange={(e) => setHeader({ ...header, className: e.target.value })}
                  className="input"
                />
              </EditField>
              <EditField label="Board / Exam">
                <input
                  value={header.board}
                  onChange={(e) => setHeader({ ...header, board: e.target.value })}
                  className="input"
                />
              </EditField>
              <EditField label="Duration">
                <input
                  value={header.duration}
                  onChange={(e) => setHeader({ ...header, duration: e.target.value })}
                  className="input"
                />
              </EditField>
              <div className="sm:col-span-2">
                <EditField label="Instructions">
                  <textarea
                    rows={2}
                    value={header.instructions}
                    onChange={(e) => setHeader({ ...header, instructions: e.target.value })}
                    className="input"
                  />
                </EditField>
              </div>
            </div>

            <p className="mt-5 text-xs text-muted-foreground">
              Total marks recalculate automatically: <b>{totalMarks}</b>
            </p>

            <div className="mt-4 space-y-4">
              {questions.map((q, i) => (
                <div key={i} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      Q{i + 1} · {q.type}
                    </span>
                    <label className="flex items-center gap-2 text-xs">
                      Marks
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={q.marks}
                        onChange={(e) => setQ(i, { marks: Number(e.target.value) })}
                        className="input w-20"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={q.question}
                    onChange={(e) => setQ(i, { question: e.target.value })}
                    className="input mt-2"
                  />
                  {q.options?.map((o, oi) => (
                    <input
                      key={oi}
                      value={o}
                      onChange={(e) =>
                        setQ(i, {
                          options: q.options!.map((x, xi) => (xi === oi ? e.target.value : x)),
                        })
                      }
                      className="input mt-2"
                    />
                  ))}
                  <textarea
                    rows={2}
                    value={q.answer}
                    onChange={(e) => setQ(i, { answer: e.target.value })}
                    placeholder="Answer key"
                    className="input mt-2"
                  />
                  <button
                    onClick={() => setQuestions((prev) => prev.filter((_, xi) => xi !== i))}
                    className="mt-2 text-xs text-destructive hover:underline"
                  >
                    Remove question
                  </button>
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        {view === "omr" ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
            <span className="text-sm text-muted-foreground">Preview:</span>
            {(["sheet", "key"] as const).map((variant) => (
              <button
                key={variant}
                onClick={() => setOmrPreview(variant)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  omrPreview === variant
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-card"
                }`}
              >
                {variant === "sheet" ? "Blank sheet" : "Bubbled key"}
              </button>
            ))}
          </div>
        ) : null}

        {view === "omr" ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-lg print:rounded-none print:shadow-none">
            <OmrSheet {...omrProps(omrPreview)} />
          </div>
        ) : (
          <article className="rounded-2xl bg-white p-8 text-black shadow-lg print:shadow-none print:rounded-none print:p-0">
            <header className="border-b-2 border-black pb-5 text-center">
              {header.collegeName ? (
                <p className="text-xl font-bold uppercase tracking-[0.12em]">
                  {header.collegeName}
                </p>
              ) : null}
              <h1 className="mt-1 text-3xl font-bold tracking-tight">{header.title}</h1>
              {view === "answers" ? (
                <p className="mt-1 text-sm font-semibold uppercase tracking-[0.18em]">Answer Key</p>
              ) : null}
              <div className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-1 text-[15px]">
                <span>
                  Subject: <b>{header.subject}</b>
                </span>
                <span>
                  Class: <b>{header.className}</b>
                </span>
                {header.board ? (
                  <span>
                    Board: <b>{header.board}</b>
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap justify-center gap-x-6 text-[15px]">
                <span>
                  Duration: <b>{header.duration}</b>
                </span>
                <span>
                  Max Marks: <b>{totalMarks}</b>
                </span>
              </div>
              {header.instructions ? (
                <p className="mt-3 text-xs italic leading-relaxed">
                  Instructions: {header.instructions}
                </p>
              ) : null}
            </header>

            {view === "answers" ? (
              <AnswerKey questions={questions} />
            ) : (
              <>
                {mcqs.length > 0 && (
                  <Section title={`Section A — Multiple Choice (${mcqs.length} questions)`}>
                    {mcqs.map((q, i) => (
                      <QuestionBlock key={i} num={i + 1} q={q} showAnswer={false} />
                    ))}
                  </Section>
                )}
                {numerics.length > 0 && (
                  <Section title={`Section B — Numerical Value (${numerics.length} questions)`}>
                    {numerics.map((q, i) => (
                      <QuestionBlock key={i} num={mcqs.length + i + 1} q={q} showAnswer={false} />
                    ))}
                  </Section>
                )}
                {shorts.length > 0 && (
                  <Section title={`Section C — Short Answer (${shorts.length} questions)`}>
                    {shorts.map((q, i) => (
                      <QuestionBlock
                        key={i}
                        num={mcqs.length + numerics.length + i + 1}
                        q={q}
                        showAnswer={false}
                      />
                    ))}
                  </Section>
                )}
                {longs.length > 0 && (
                  <Section title={`Section D — Long Answer (${longs.length} questions)`}>
                    {longs.map((q, i) => (
                      <QuestionBlock
                        key={i}
                        num={mcqs.length + numerics.length + shorts.length + i + 1}
                        q={q}
                        showAnswer={false}
                      />
                    ))}
                  </Section>
                )}
              </>
            )}

            <footer className="mt-8 border-t border-black/20 pt-3 text-center text-xs">
              {view === "answers" ? "— End of answer key —" : "— End of paper —"}
            </footer>
          </article>
        )}

        {supportsOmr && (view === "answers" || view === "omr") && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 print:hidden">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Image format
              <select
                value={omrFormat}
                onChange={(event) => setOmrFormat(event.target.value as OmrImageType)}
                className="input h-9 w-auto py-0 text-sm"
              >
                <option value="png">PNG (300 dpi)</option>
                <option value="jpeg">JPEG (300 dpi)</option>
              </select>
            </label>
            <button
              onClick={downloadOmrKey}
              disabled={downloadPackage.isPending}
              className="rounded-lg bg-primary px-6 py-3 text-base font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 shadow-lg"
            >
              {downloadPackage.isPending
                ? "Preparing export…"
                : "Download bubbled OMR key and exam package"}
            </button>
          </div>
        )}
        {omrError && supportsOmr && (view === "answers" || view === "omr") ? (
          <p role="alert" className="mt-2 text-center text-sm text-destructive print:hidden">
            {omrError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Trigger a client-side download of the package as pretty-printed JSON. */
function downloadJson(data: OmrExamPackage, filename: string) {
  downloadBlob(JSON.stringify(data, null, 2), filename, "application/json;charset=utf-8");
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "exam"
  );
}

function downloadBlob(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="text-base font-bold underline">{title}</h2>
      <ol className="mt-3 space-y-3">{children}</ol>
    </section>
  );
}

function answerLetter(question: GeneratedQuestion): string {
  return resolveAnswerLetter(question) || "—";
}

function AnswerKey({ questions }: { questions: GeneratedQuestion[] }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="text-base font-bold underline">Answers</h2>
      <ol className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
        {inPrintedOrder(questions).map(({ question, number }) => (
          <li key={question.id}>
            <b>Q{number}:</b>{" "}
            {question.type === "mcq" ? (
              answerLetter(question)
            ) : (
              <span dangerouslySetInnerHTML={{ __html: formatExamText(question.answer) }} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function QuestionBlock({
  num,
  q,
  showAnswer,
}: {
  num: number;
  q: GeneratedQuestion;
  showAnswer: boolean;
}) {
  return (
    <li className="break-inside-avoid rounded-xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[16px] leading-8 tracking-[0.01em]">
          <b>Q{num}.</b>
          <span dangerouslySetInnerHTML={{ __html: formatExamText(q.question) }} />
        </p>
        <span className="shrink-0 text-xs font-semibold tracking-wide text-slate-500">
          [{q.marks}]
        </span>
      </div>
      {q.options && (
        <ul className="ml-6 mt-2 space-y-1 text-[15px] leading-7 text-slate-800">
          {q.options.map((o, idx) => (
            <li key={idx} className="list-[lower-alpha] pl-1">
              <span dangerouslySetInnerHTML={{ __html: formatExamText(o) }} />
            </li>
          ))}
        </ul>
      )}
      {showAnswer && (
        <p className="ml-6 mt-2 text-[15px] text-green-800">
          <b>Ans:</b>
          <span dangerouslySetInnerHTML={{ __html: formatExamText(q.answer) }} />
        </p>
      )}
    </li>
  );
}
