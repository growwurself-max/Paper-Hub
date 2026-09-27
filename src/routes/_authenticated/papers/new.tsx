import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { GlassCard } from "@/components/ui/GlassCard";
import { generatePaper, getTodayQuota } from "@/lib/paper.functions";
import { EXAM_PRESETS, getPreset } from "@/lib/exam-presets";
import { listSyllabi } from "@/lib/syllabus.functions";
import { listTemplates, saveTemplate } from "@/lib/templates.functions";

const searchSchema = z.object({
  preset: z.string().optional(),
  syllabusId: z.string().optional(),
  templateId: z.string().optional(),
});

const STRICT_PRESET_IDS = new Set(["eamcet", "neet", "jee-main", "jee-advanced"]);

export const Route = createFileRoute("/_authenticated/papers/new")({
  validateSearch: (s: Record<string, unknown>) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "New Paper — Question Paper Studio" },
      {
        name: "description",
        content: "Configure a NEET, JEE, EAMCET or board pattern paper and generate it with AI.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewPaper,
});

function NewPaper() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const generateFn = useServerFn(generatePaper);
  const quotaFn = useServerFn(getTodayQuota);
  const syllabiFn = useServerFn(listSyllabi);
  const templatesFn = useServerFn(listTemplates);
  const saveTemplateFn = useServerFn(saveTemplate);

  const quota = useQuery({ queryKey: ["quota"], queryFn: () => quotaFn() });
  const syllabi = useQuery({ queryKey: ["syllabi"], queryFn: () => syllabiFn() });
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => templatesFn() });

  const [presetId, setPresetId] = useState(search.preset ?? "custom");
  const [title, setTitle] = useState("");
  const [collegeName, setCollegeName] = useState("");
  const [subject, setSubject] = useState("");
  const [stream, setStream] = useState<"MPC" | "BiPC" | "General">("General");
  const [className, setClassName] = useState("");
  const [board, setBoard] = useState("");
  const [totalMarks, setTotalMarks] = useState<string>("100");
  const [duration, setDuration] = useState("3 hours");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "mixed">("mixed");
  const [chapters, setChapters] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mcq, setMcq] = useState<string>("10");
  const [numeric, setNumeric] = useState<string>("0");
  const [short, setShort] = useState<string>("5");
  const [long, setLong] = useState<string>("3");
  const [mcqMarks, setMcqMarks] = useState<string>("1");
  const [numericMarks, setNumericMarks] = useState<string>("0");
  const [shortMarks, setShortMarks] = useState<string>("3");
  const [longMarks, setLongMarks] = useState<string>("5");
  const [negativeMarking, setNegativeMarking] = useState<string>("0");
  const [omr, setOmr] = useState(false);
  const [syllabusId, setSyllabusId] = useState<string>(search.syllabusId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // Helper function to handle number input changes with proper decimal support
  const handleNumberChange = (
    value: string,
    setter: (val: string) => void
  ) => {
    setter(value);
  };

  // Helper to convert string to number for API calls and calculations
  const toNumber = (val: string) => {
    if (val === "" || val === "-" || val === "." || val === "-.") {
      return 0;
    }
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  };

  function applyPreset(id: string) {
    setPresetId(id);
    const p = getPreset(id);
    setBoard(p.board);
    setClassName(p.className);
    setDuration(p.duration);
    setTotalMarks(String(p.totalMarks));
    setDifficulty(p.difficulty);
    setMcq(String(p.distribution.mcq));
    setNumeric(String(p.distribution.numeric));
    setShort(String(p.distribution.short));
    setLong(String(p.distribution.long));
    setMcqMarks(String(p.marks.mcq));
    setNumericMarks(String(p.marks.numeric));
    setShortMarks(String(p.marks.short));
    setLongMarks(String(p.marks.long));
    setNegativeMarking(String(p.negativeMarking));
    setOmr(p.omr);
    setInstructions(p.instructions);
    const nextStream = p.stream ?? "General";
    setStream(nextStream);
    setSubject(
      p.id === "custom"
        ? ""
        : nextStream === "BiPC"
          ? "Biology"
          : p.subjectSuggestions[0] ?? "",
    );
  }

  // Apply preset / saved template coming in from a link.
  useEffect(() => {
    if (search.preset) applyPreset(search.preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.preset]);

  useEffect(() => {
    if (!search.templateId || !templates.data) return;
    const t = templates.data.find((x) => x.id === search.templateId);
    if (!t) return;
    const c = t.config as Record<string, unknown>;
    setTitle(String(c.title ?? ""));
    setCollegeName(String(c.collegeName ?? ""));
    setSubject(String(c.subject ?? ""));
    setStream((c.stream as "MPC" | "BiPC" | "General") ?? "General");
    setClassName(String(c.className ?? ""));
    setBoard(String(c.board ?? ""));
    setTotalMarks(String(c.totalMarks ?? 100));
    setDuration(String(c.duration ?? "3 hours"));
    setDifficulty((c.difficulty as typeof difficulty) ?? "mixed");
    setChapters(String(c.chapters ?? ""));
    setInstructions(String(c.instructions ?? ""));
    const d = (c.distribution as { mcq?: number; numeric?: number; short?: number; long?: number }) ?? {};
    const loadedPreset = String(c.examPreset ?? "custom");
    const loadedBlueprint = getPreset(loadedPreset);
    const strictTemplate = STRICT_PRESET_IDS.has(loadedPreset);
    setMcq(String(strictTemplate ? loadedBlueprint.distribution.mcq : Number(d.mcq ?? 10)));
    setNumeric(String(strictTemplate ? loadedBlueprint.distribution.numeric : Number(d.numeric ?? 0)));
    setShort(String(strictTemplate ? 0 : Number(d.short ?? 5)));
    setLong(String(strictTemplate ? 0 : Number(d.long ?? 3)));
    const m = (c.marks as { mcq?: number; numeric?: number; short?: number; long?: number }) ?? {};
    setMcqMarks(String(strictTemplate ? loadedBlueprint.marks.mcq : Number(m.mcq ?? 1)));
    setNumericMarks(String(strictTemplate ? loadedBlueprint.marks.numeric : Number(m.numeric ?? 0)));
    setShortMarks(String(strictTemplate ? loadedBlueprint.marks.short : Number(m.short ?? 3)));
    setLongMarks(String(strictTemplate ? loadedBlueprint.marks.long : Number(m.long ?? 5)));
    setNegativeMarking(String(c.negativeMarking ?? 0));
    setOmr(Boolean(c.omr));
    setPresetId(loadedPreset);
    if (strictTemplate) {
      const loadedStream = loadedPreset === "neet" ? "BiPC" : ((c.stream as "MPC" | "BiPC") ?? "MPC");
      setStream(loadedStream);
      setSubject(String(c.subject ?? loadedBlueprint.subjectSuggestions[0] ?? ""));
      setBoard(loadedBlueprint.board);
      setClassName(loadedBlueprint.className);
      setTotalMarks(String(loadedBlueprint.totalMarks));
      setDuration(loadedBlueprint.duration);
      setDifficulty(loadedBlueprint.difficulty);
      setNegativeMarking(String(loadedBlueprint.negativeMarking));
      setOmr(loadedBlueprint.omr);
      setInstructions(loadedBlueprint.instructions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.templateId, templates.data]);

  const payload = () => ({
    title,
    collegeName,
    subject,
    stream,
    className,
    board,
    examPreset: presetId,
    negativeMarking: toNumber(negativeMarking),
    omr,
    syllabusId: syllabusId || null,
    totalMarks: toNumber(totalMarks),
    duration,
    difficulty,
    chapters,
    instructions,
    distribution: { 
      mcq: toNumber(mcq), 
      numeric: toNumber(numeric), 
      short: toNumber(short), 
      long: toNumber(long) 
    },
    marks: isStrictPreset
      ? getPreset(presetId).marks
      : { 
          mcq: toNumber(mcqMarks), 
          numeric: toNumber(numericMarks), 
          short: toNumber(shortMarks), 
          long: toNumber(longMarks) 
        },
  });

  const gen = useMutation({
    mutationFn: async () => generateFn({ data: payload() }),
    onSuccess: (res) => navigate({ to: "/papers/$id", params: { id: res.id } }),
    onError: (e: Error) => setError(e.message),
  });

  const tpl = useMutation({
    mutationFn: async () =>
      saveTemplateFn({ data: { name: templateName || `${subject} — ${className}`, config: payload() } }),
    onSuccess: () => {
      setSavedNote("Template saved.");
      setTemplateName("");
      templates.refetch();
    },
    onError: (e: Error) => setError(e.message),
  });

  const isStrictPreset = STRICT_PRESET_IDS.has(presetId);
  const totalQuestions = toNumber(mcq) + toNumber(numeric) + toNumber(short) + toNumber(long);
  const canSubmit = Boolean(title && subject && className && totalQuestions > 0) && !gen.isPending;
  const quotaFull = quota.data ? quota.data.used >= quota.data.quota : false;

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link to="/papers" className="text-sm text-muted-foreground hover:underline">
          ← Back to papers
        </Link>
        <h1 className="mt-1 text-2xl font-bold gradient-text">New question paper</h1>
        {quota.data && (
          <p className="mt-1 text-sm text-muted-foreground">
            AI quota today: {quota.data.used} / {quota.data.quota}
          </p>
        )}

        <GlassCard className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            1 · Choose an exam pattern
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {EXAM_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={`rounded-xl border p-3 text-left transition ${
                  presetId === p.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-card/60"
                }`}
              >
                <span className="block text-sm font-medium">{p.name}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{p.tagline}</span>
              </button>
            ))}
          </div>
        </GlassCard>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            gen.mutate();
          }}
          className="mt-4 space-y-4"
        >
          <GlassCard>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              2 · Paper details
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Paper title *">
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="NEET Mock Test 01 — Physics"
                  className="input"
                />
              </Field>
              {isStrictPreset && (
                <Field label="Stream *">
                  <select
                    value={stream}
                    onChange={(e) => {
                      const next = e.target.value as "MPC" | "BiPC";
                      setStream(next);
                      setSubject(next === "BiPC" ? "Biology" : "Mathematics");
                    }}
                    className="input"
                    disabled={presetId !== "eamcet"}
                  >
                    <option value="MPC">MPC · Engineering</option>
                    <option value="BiPC">BiPC · Medical / Agriculture</option>
                  </select>
                </Field>
              )}
              <Field label="Subject *">
                {isStrictPreset ? (
                  <select
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="input"
                  >
                    {getPreset(presetId).subjectSuggestions
                      .filter(
                        (option) =>
                          presetId !== "eamcet" || stream !== "BiPC" || option === "Biology",
                      )
                      .filter(
                        (option) =>
                          presetId !== "eamcet" ||
                          stream !== "MPC" ||
                          !["Biology", "Botany", "Zoology"].includes(option),
                      )
                      .map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                  </select>
                ) : (
                  <>
                    <input
                      required
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Physics"
                      className="input"
                      list="subject-suggestions"
                    />
                    <datalist id="subject-suggestions">
                      {getPreset(presetId).subjectSuggestions.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              <Field label="Class / Level *">
                <input
                  required
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="Class 12"
                  className="input"
                />
              </Field>
              <Field label="College / School name">
                <input
                  value={collegeName}
                  onChange={(e) => setCollegeName(e.target.value)}
                  placeholder="Printed at the top of the paper"
                  className="input"
                />
              </Field>
              <Field label="Board / Exam">
                <input
                  value={board}
                  onChange={(e) => setBoard(e.target.value)}
                  placeholder="NEET"
                  className="input"
                />
              </Field>
              <Field label="Total marks">
                <input
                  type="number"
                  min={5}
                  max={500}
                  step="1"
                  value={totalMarks}
                  onChange={(e) => handleNumberChange(e.target.value, setTotalMarks)}
                  readOnly={isStrictPreset}
                  className="input"
                />
              </Field>
              <Field label="Duration">
                <input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  readOnly={isStrictPreset}
                  className="input"
                />
              </Field>
              <Field label="Difficulty">
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
                  disabled={isStrictPreset}
                  className="input"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                  <option value="mixed">Mixed</option>
                </select>
              </Field>
              <Field label="Negative marking (per wrong answer)">
                <input
                  type="number"
                  min={0}
                  max={5}
                  step="0.25"
                  value={negativeMarking}
                  onChange={(e) => handleNumberChange(e.target.value, setNegativeMarking)}
                  readOnly={isStrictPreset}
                  className="input"
                />
              </Field>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={omr}
                onChange={(e) => setOmr(e.target.checked)}
                disabled={isStrictPreset}
                className="h-4 w-4"
              />
              Generate a printable OMR answer sheet with this paper
            </label>
          </GlassCard>

          <GlassCard>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              3 · Source content
            </h2>
            <div className="mt-3 grid gap-4">
              <Field label="Syllabus / concept PDF (optional)">
                <select
                  value={syllabusId}
                  onChange={(e) => setSyllabusId(e.target.value)}
                  className="input"
                >
                  <option value="">No document — use general curriculum</option>
                  {syllabi.data
                    ?.filter((s) => !s.subject || !subject || s.subject.toLowerCase() === subject.toLowerCase())
                    .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject ? `${s.subject} · ` : ""}{s.filename}
                    </option>
                    ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Link to="/syllabi" className="underline">
                    Upload a PDF
                  </Link>{" "}
                  to generate questions strictly from your own material.
                </p>
              </Field>
              <Field label="Chapters / topics (comma separated)">
                <textarea
                  rows={3}
                  value={chapters}
                  onChange={(e) => setChapters(e.target.value)}
                  placeholder="Laws of Motion, Work Energy Power, Thermodynamics"
                  className="input"
                />
              </Field>
              <Field label="Extra instructions printed on the paper">
                <textarea
                  rows={3}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="input"
                />
              </Field>
            </div>
          </GlassCard>

          {isStrictPreset && (
            <GlassCard>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                4 · Strict MCQ blueprint
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {toNumber(mcq)} MCQs and {toNumber(numeric)} numerical value questions · {toNumber(mcq) + toNumber(numeric)} total questions
              </p>
            </GlassCard>
          )}

          {!isStrictPreset && <GlassCard>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              4 · Question mix
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              <Field label="MCQ (1 mark)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={mcq}
                  onChange={(e) => handleNumberChange(e.target.value, setMcq)}
                  className="input"
                />
              </Field>
              <Field label="Numerical value">
                <input
                  type="number"
                  min={0}
                  max={300}
                  step="1"
                  value={numeric}
                  onChange={(e) => handleNumberChange(e.target.value, setNumeric)}
                  className="input"
                />
              </Field>
              <Field label="Short answer (3 marks)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={short}
                  onChange={(e) => handleNumberChange(e.target.value, setShort)}
                  className="input"
                />
              </Field>
              <Field label="Long answer (5 marks)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={long}
                  onChange={(e) => handleNumberChange(e.target.value, setLong)}
                  className="input"
                />
              </Field>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {toNumber(mcq) + toNumber(numeric) + toNumber(short) + toNumber(long)} questions in total.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              <Field label="Marks per MCQ">
                <input
                  type="number"
                  min={0}
                  max={20}
                  step="1"
                  value={mcqMarks}
                  onChange={(e) => handleNumberChange(e.target.value, setMcqMarks)}
                  className="input"
                />
              </Field>
              <Field label="Marks per numerical">
                <input
                  type="number"
                  min={0}
                  max={20}
                  step="1"
                  value={numericMarks}
                  onChange={(e) => handleNumberChange(e.target.value, setNumericMarks)}
                  className="input"
                />
              </Field>
              <Field label="Marks per short answer">
                <input
                  type="number"
                  min={0}
                  max={20}
                  step="1"
                  value={shortMarks}
                  onChange={(e) => handleNumberChange(e.target.value, setShortMarks)}
                  className="input"
                />
              </Field>
              <Field label="Marks per long answer">
                <input
                  type="number"
                  min={0}
                  max={20}
                  step="1"
                  value={longMarks}
                  onChange={(e) => handleNumberChange(e.target.value, setLongMarks)}
                  className="input"
                />
              </Field>
            </div>
          </GlassCard>}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {quotaFull && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Daily AI quota reached. Papers can be generated again tomorrow.
            </p>
          )}
          {savedNote && <p className="text-sm text-muted-foreground">{savedNote}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit || quotaFull}
              className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground disabled:opacity-60"
            >
              {gen.isPending ? "Generating with AI…" : "Generate paper"}
            </button>
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
              className="input max-w-[200px]"
            />
            <button
              type="button"
              disabled={tpl.isPending || !subject || !className}
              onClick={() => {
                setError(null);
                tpl.mutate();
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-card disabled:opacity-60"
            >
              {tpl.isPending ? "Saving…" : "Save as template"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
