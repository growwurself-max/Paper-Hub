import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPreset } from "@/lib/exam-presets";
import { readPlatformLimits } from "@/lib/platform-limits";

const STRICT_PRESET_IDS = new Set(["eamcet", "neet", "jee-main", "jee-advanced"]);

const generateInput = z.object({
  title: z.string().min(1).max(200),
  collegeName: z.string().max(200).optional().default(""),
  subject: z.string().min(1).max(100),
  stream: z.enum(["MPC", "BiPC", "General"]).optional().default("General"),
  className: z.string().min(1).max(50),
  board: z.string().max(100).optional().default(""),
  examPreset: z.string().max(50).optional().default("custom"),
  negativeMarking: z.number().min(0).max(5).optional().default(0),
  omr: z.boolean().optional().default(false),
  syllabusId: z.string().uuid().nullable().optional().default(null),
  totalMarks: z.number().int().min(5).max(500),
  duration: z.string().max(50).default("3 hours"),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
  chapters: z.string().max(2000).default(""),
  instructions: z.string().max(1000).default(""),
  distribution: z
    .object({
      mcq: z.number().int().min(0).max(300).default(10),
      numeric: z.number().int().min(0).max(300).default(0),
      short: z.number().int().min(0).max(300).default(5),
      long: z.number().int().min(0).max(300).default(3),
    })
    .default({ mcq: 10, numeric: 0, short: 5, long: 3 }),
  marks: z
    .object({
      mcq: z.number().min(0).max(20).default(1),
      numeric: z.number().min(0).max(20).default(4),
      short: z.number().min(0).max(20).default(3),
      long: z.number().min(0).max(20).default(5),
    })
    .default({ mcq: 1, numeric: 4, short: 3, long: 5 }),
});

export type GeneratedQuestion = {
  id: number;
  type: "mcq" | "numeric" | "short" | "long";
  marks: number;
  question: string;
  options?: string[];
  answer: string;
};

export const listMyPapers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("generated_papers")
      .select("id, title, ai_source, created_at, config")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getPaper = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: paper, error } = await context.supabase
      .from("generated_papers")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return paper;
  });

export const getTodayQuota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .single();
    if (!profile?.organization_id) return { used: 0, quota: 0, status: "inactive" as const };
    const [{ data: org }, { data: usage }] = await Promise.all([
      context.supabase
        .from("organizations")
        .select("ai_daily_quota, status")
        .eq("id", profile.organization_id)
        .single(),
      context.supabase
        .from("ai_usage")
        .select("count")
        .eq("organization_id", profile.organization_id)
        .eq("usage_date", today)
        .maybeSingle(),
    ]);
    return {
      used: usage?.count ?? 0,
      quota: org?.ai_daily_quota ?? 20,
      status: (org?.status ?? "active") as string,
    };
  });

const questionSchema = z.object({
  id: z.number().int(),
  type: z.enum(["mcq", "numeric", "short", "long"]),
  marks: z.number().min(0).max(100),
  question: z.string().max(4000),
  options: z.array(z.string().max(1000)).max(10).optional(),
  answer: z.string().max(6000),
});

const updateInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  collegeName: z.string().max(200).default(""),
  subject: z.string().max(100).default(""),
  className: z.string().max(50).default(""),
  board: z.string().max(100).default(""),
  duration: z.string().max(50).default(""),
  instructions: z.string().max(2000).default(""),
  questions: z.array(questionSchema).max(300),
});

/** Edit an existing paper: header fields, questions, options and answers. */
export const updatePaper = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing, error: readErr } = await context.supabase
      .from("generated_papers")
      .select("config")
      .eq("id", data.id)
      .single();
    if (readErr) throw new Error(readErr.message);

    const config = {
      ...((existing?.config as Record<string, unknown>) ?? {}),
      title: data.title,
      collegeName: data.collegeName,
      subject: data.subject,
      className: data.className,
      board: data.board,
      duration: data.duration,
      instructions: data.instructions,
    };

    const { error } = await context.supabase
      .from("generated_papers")
      .update({
        title: data.title,
        config: config as never,
        questions: data.questions as never,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generatePaper = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => generateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const preset = getPreset(data.examPreset);
    const isStrictPreset = STRICT_PRESET_IDS.has(data.examPreset);
    const strictStream = data.examPreset === "neet" || data.stream === "BiPC" ? "BiPC" : "MPC";
    const allowedSubjects =
      data.examPreset === "eamcet" && data.stream === "BiPC"
        ? ["Biology"]
        : data.examPreset === "eamcet"
          ? ["Mathematics", "Physics", "Chemistry"]
          : preset.subjectSuggestions;
    const selectedSubject = allowedSubjects.includes(data.subject)
      ? data.subject
      : (allowedSubjects[0] ?? data.subject);
    const generationData = isStrictPreset
      ? {
          ...data,
          subject: selectedSubject,
          stream: strictStream,
          board: preset.board,
          className: preset.className,
          totalMarks: preset.totalMarks,
          duration: preset.duration,
          difficulty: preset.difficulty,
          distribution: preset.distribution,
          marks: preset.marks,
          negativeMarking: preset.negativeMarking,
          omr: preset.omr,
          instructions: preset.instructions,
        }
      : data;

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .single();
    const orgId = profile?.organization_id;
    if (!orgId) throw new Error("No organization assigned to your account.");

    const { data: org } = await supabase
      .from("organizations")
      .select("ai_daily_quota, status")
      .eq("id", orgId)
      .single();
    if (!org) throw new Error("Organization not found.");
    if (org.status !== "active") throw new Error("Your organization is not active.");

    const today = new Date().toISOString().slice(0, 10);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const platformLimits = await readPlatformLimits(supabaseAdmin);
    if (platformLimits.maxDailyPapers > 0) {
      const { count, error: paperCountError } = await supabaseAdmin
        .from("generated_papers")
        .select("id", { count: "exact", head: true })
        .gte("created_at", `${today}T00:00:00.000Z`);
      if (paperCountError) throw new Error(paperCountError.message);
      if ((count ?? 0) >= platformLimits.maxDailyPapers) {
        throw new Error(
          `Platform daily paper limit reached (${count}/${platformLimits.maxDailyPapers}).`,
        );
      }
    }
    const { data: usageRow } = await supabase
      .from("ai_usage")
      .select("id, count")
      .eq("organization_id", orgId)
      .eq("usage_date", today)
      .maybeSingle();
    const used = usageRow?.count ?? 0;
    if (used >= org.ai_daily_quota) {
      throw new Error(
        `Daily AI quota reached (${used}/${org.ai_daily_quota}). Try again tomorrow.`,
      );
    }

    let syllabusText = "";
    if (data.syllabusId) {
      const { data: syl } = await supabase
        .from("uploaded_syllabi")
        .select("subject, extracted_text")
        .eq("id", data.syllabusId)
        .maybeSingle();
      if (syl?.subject && syl.subject.toLowerCase() !== data.subject.toLowerCase()) {
        throw new Error(`The selected syllabus is for ${syl.subject}, not ${data.subject}.`);
      }
      syllabusText = (syl?.extracted_text ?? "").slice(0, 12000);
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    console.info(
      `[AI] init · gemini_key=${geminiKey ? "loaded" : "missing"} subject=${data.subject} preset=${data.examPreset} syllabus_chars=${syllabusText.length}`,
    );

    if (!geminiKey) {
      throw new Error(
        "AI question generation is unavailable because GEMINI_API_KEY is not configured. Add a valid Gemini API key and restart the server.",
      );
    }

    const { data: creditReserved, error: reserveError } = await supabaseAdmin.rpc(
      "reserve_paper_generation_credit",
      { p_organization_id: orgId },
    );
    if (reserveError) throw new Error(reserveError.message);
    if (!creditReserved) {
      throw new Error(
        "This institute has no paper credits remaining or has reached its daily paper limit.",
      );
    }

    let creditHeld = true;
    try {
      let questions: GeneratedQuestion[];
      try {
        questions = await generateWithGemini(geminiKey, generationData, syllabusText);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[AI] Gemini question generation failed: ${message}`);
        throw new Error(
          `AI question generation failed. No paper was created. Gemini reported: ${message}`,
        );
      }
      const aiSource = "gemini" as const;
      console.info(`[AI] success via ${aiSource} · ${questions.length} questions`);

      const { data: paper, error: insertErr } = await supabase
        .from("generated_papers")
        .insert({
          organization_id: orgId,
          created_by: userId,
          syllabus_id: data.syllabusId ?? null,
          title: data.title,
          config: generationData as never,
          questions: questions as never,
          ai_source: aiSource,
        })
        .select("id")
        .single();
      if (insertErr) throw new Error(insertErr.message);
      creditHeld = false;

      if (usageRow) {
        await supabase
          .from("ai_usage")
          .update({ count: used + 1 })
          .eq("id", usageRow.id);
      } else {
        await supabase
          .from("ai_usage")
          .insert({ organization_id: orgId, user_id: userId, usage_date: today, count: 1 });
      }

      return { id: paper.id, aiSource, questionCount: questions.length };
    } catch (error) {
      if (creditHeld) {
        const { error: releaseError } = await supabaseAdmin.rpc("release_paper_generation_credit", {
          p_organization_id: orgId,
        });
        if (releaseError)
          console.error(`[AI] failed to refund paper credit: ${releaseError.message}`);
      }
      throw error;
    }
  });

/** Shared prompt used by every AI provider. */
function buildPrompts(cfg: z.infer<typeof generateInput>, syllabusText: string) {
  const totalTarget =
    cfg.distribution.mcq +
    cfg.distribution.numeric +
    cfg.distribution.short +
    cfg.distribution.long;
  const exam = (cfg.examPreset || "custom").toLowerCase();
  const examStandard =
    exam === "neet"
      ? "NEET standard: Biology must test NCERT-grounded facts, mechanisms and applications; Physics must use solvable multi-step numerical problems with stated units; Chemistry must distinguish physical calculations, inorganic trends and organic mechanisms."
      : exam.includes("jee")
        ? "JEE standard: Physics and Mathematics must require multi-step reasoning with exact numerical data; Chemistry must test quantitative calculations, mechanisms, bonding, periodic trends and carefully chosen exceptions. Avoid routine one-step recall unless it is genuinely diagnostic."
        : exam === "eamcet"
          ? "EAMCET standard: use concise, time-efficient but rigorous intermediate-level Physics, Chemistry, Mathematics or Biology questions with concrete values, direct application and syllabus-accurate distractors."
          : "Use the official difficulty and syllabus standard of the requested board or entrance examination.";
  const system = `You are an expert ${cfg.subject} examiner and assessment writer for ${cfg.examPreset?.toUpperCase() || "competitive examinations"}. ${examStandard} Write original, rigorous, domain-specific questions that a real examination board could publish. Every question must have a clear learning objective, accurate content and exactly one defensible answer. You must follow the requested question counts and marks exactly: never add, omit, merge or substitute questions. MCQs and numerical value questions are different types and must never be mixed. An MCQ has exactly four distinct options labelled A, B, C and D, with exactly one correct answer key. A numerical value question has no options at all and asks for one specific integer or decimal answer. Never use templates, placeholders or filler wording. Never mention a scenario number, case number, question number placeholder, or generic example. Respond with ONLY valid JSON — no prose and no markdown fences.`;
  const user = `Create a question paper with these requirements:
- Subject: ${cfg.subject}
- Stream: ${cfg.stream}
- Class / level: ${cfg.className}
- Total marks: ${cfg.totalMarks}
- Duration: ${cfg.duration}
- Difficulty: ${cfg.difficulty}
- Chapters/topics: ${cfg.chapters || "Full syllabus for this level"}
- MCQ questions (${cfg.marks.mcq} mark(s) each): ${cfg.distribution.mcq}
- Numerical value questions (${cfg.marks.numeric} mark(s) each): ${cfg.distribution.numeric}
- Short-answer questions (${cfg.marks.short} mark(s) each): ${cfg.distribution.short}
- Long-answer questions (${cfg.marks.long} mark(s) each): ${cfg.distribution.long}
${examStandard}
${cfg.instructions ? `- Extra instructions: ${cfg.instructions}` : ""}
${cfg.examPreset && cfg.examPreset !== "custom" ? `- Exam pattern: ${cfg.examPreset.toUpperCase()} — match its official style, depth, phrasing and time pressure.` : ""}
${cfg.negativeMarking ? `- Negative marking: ${cfg.negativeMarking} mark(s) per wrong answer, so each MCQ must have exactly one unambiguous correct option.` : ""}
${
  syllabusText
    ? `\nFirst analyse the syllabus below, list its major topics mentally, then generate questions distributed PROPORTIONALLY across those topics. Use ONLY this content as the source of topics:\n"""\n${syllabusText}\n"""\n`
    : ""
}

Return JSON with this exact shape:
{
  "questions": [
    { "id": 1, "type": "mcq", "marks": ${cfg.marks.mcq}, "question": "...", "options": ["A ...","B ...","C ...","D ..."], "answer": "A ..." },
    { "id": 2, "type": "numeric", "marks": ${cfg.marks.numeric}, "question": "...", "answer": "42" },
    { "id": 3, "type": "short", "marks": ${cfg.marks.short}, "question": "...", "answer": "..." },
    { "id": 4, "type": "long", "marks": ${cfg.marks.long}, "question": "...", "answer": "..." }
  ]
}

Rules:
- Generate EXACTLY ${totalTarget} questions in the ratio specified.
- Numerical value questions must require an integer or decimal response and must not include options.
- Generate exactly the requested number of each type: ${cfg.distribution.mcq} MCQs, ${cfg.distribution.numeric} numerical value questions, ${cfg.distribution.short} short-answer questions and ${cfg.distribution.long} long-answer questions. The array length must be exactly ${totalTarget}; never return extra questions or fewer questions.
- The marks on the generated questions must match the requested blueprint exactly, for a blueprint total of ${blueprintMarks(cfg)} marks. The requested paper total is ${cfg.totalMarks}; do not change any question's marks to compensate for a count error.
- Every question must be materially different in concept, method, data, and wording. Do not reuse a stem, question structure, values, or answer pattern.
- Use real domain content: named laws, reactions, organisms, mathematical expressions, physical quantities, units, constants, or experimentally meaningful observations where appropriate.
- Numerical questions must provide all necessary values and units and must be internally solvable. Do not invent meaningless numbers merely to vary wording.
- Do not write generic prompts such as "Which of the following best describes...", "Briefly explain...", or "Discuss ... in detail" without a specific concept, data set, reaction, diagram description, claim, or calculation.
- Never use placeholder text or artificial uniqueness markers, including "scenario 1", "case 1", "application 1", "example 1", "question 1", or any equivalent numbered label.
- Every MCQ has exactly 4 options prefixed "A. ", "B. ", "C. ", "D. ".
- Spread the correct option evenly across A, B, C and D — do not favour any letter.
- Distractors must be plausible (common misconceptions, near-miss values, swapped terms) — never obviously wrong filler.
- No duplicate or near-duplicate questions; each must test a different idea.
- Question difficulty and phrasing must resemble real ${cfg.board || "NEET / JEE / EAMCET / school"} examinations.
- Answers must be accurate and concise.`;
  return { system, user, totalTarget };
}

/** Direct Google Gemini API (GEMINI_API_KEY from the environment). */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const FALLBACK_GEMINI_MODEL = "gemini-3.5-flash-lite";
const MAX_GEMINI_ATTEMPTS = 3;
const RETRYABLE_GEMINI_STATUSES = new Set([429, 500, 502, 503, 504]);

function isRetryableGeminiStatus(status: number): boolean {
  return RETRYABLE_GEMINI_STATUSES.has(status);
}

function geminiRetryDelay(attempt: number): number {
  return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}

async function generateWithGemini(
  apiKey: string,
  cfg: z.infer<typeof generateInput>,
  syllabusText = "",
): Promise<GeneratedQuestion[]> {
  const { system, user } = buildPrompts(cfg, syllabusText);
  // The key is never inspected or format-checked; only Google's own response decides validity.
  const configured = process.env.GEMINI_MODEL?.trim();
  const primaryModel =
    configured && configured !== "gemini-flash-latest" ? configured : DEFAULT_GEMINI_MODEL;
  const models = [...new Set([primaryModel, FALLBACK_GEMINI_MODEL])];

  let lastError = "";
  for (const model of models) {
    for (let attempt = 0; attempt < MAX_GEMINI_ATTEMPTS; attempt++) {
      const started = Date.now();
      console.info(`[AI] Gemini request → model=${model} attempt=${attempt + 1}`);
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: user }] }],
              generationConfig: {
                temperature: 0.65,
                topP: 0.85,
                topK: 40,
                responseMimeType: "application/json",
              },
            }),
          },
        );
      } catch (error) {
        lastError = `Gemini network request failed for model "${model}": ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[AI] ${lastError}`);
        if (attempt + 1 < MAX_GEMINI_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, geminiRetryDelay(attempt)));
          continue;
        }
        break;
      }

      if (!res.ok) {
        const body = await res.text();
        let apiMessage = body.slice(0, 400);
        try {
          const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
          if (parsed.error?.message) {
            apiMessage = `${parsed.error.status ?? res.status}: ${parsed.error.message}`;
          }
        } catch {
          /* keep the raw body */
        }
        lastError = `Google Gemini API error (HTTP ${res.status}) for model "${model}" — ${apiMessage}`;
        console.error(`[AI] ${lastError}`);
        if (isRetryableGeminiStatus(res.status) && attempt + 1 < MAX_GEMINI_ATTEMPTS) {
          const delay = geminiRetryDelay(attempt);
          console.warn(`[AI] transient Gemini failure; retrying in ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        // A model that is unavailable for this key, or a transient failure after retries: try the next model.
        if (res.status === 404 || res.status === 400 || isRetryableGeminiStatus(res.status)) break;
        throw new Error(lastError);
      }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const content = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      console.info(
        `[AI] Gemini response ← model=${model} ${content.length} chars in ${Date.now() - started}ms`,
      );
      if (!content.trim()) {
        lastError = `Google Gemini returned an empty response for model "${model}".`;
        console.error(`[AI] ${lastError}`);
        break;
      }
      try {
        const questions = normalizeQuestions(parseQuestions(content), cfg);
        validateGeneratedQuestions(questions, cfg);
        return questions;
      } catch (error) {
        lastError = `Gemini returned an invalid question paper for model "${model}": ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`[AI] ${lastError}`);
        if (attempt + 1 < MAX_GEMINI_ATTEMPTS) {
          const delay = geminiRetryDelay(attempt);
          console.warn(`[AI] invalid paper; retrying in ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        break;
      }
    }
  }

  throw new Error(lastError || "Google Gemini API request failed.");
}

function parseQuestions(content: string): GeneratedQuestion[] {
  const cleaned = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed = JSON.parse(cleaned) as { questions?: GeneratedQuestion[] };
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error("AI returned no questions");
  }
  return parsed.questions;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function totalQuestionCount(cfg: z.infer<typeof generateInput>): number {
  return (
    cfg.distribution.mcq + cfg.distribution.numeric + cfg.distribution.short + cfg.distribution.long
  );
}

function blueprintMarks(cfg: z.infer<typeof generateInput>): number {
  return (
    cfg.distribution.mcq * cfg.marks.mcq +
    cfg.distribution.numeric * cfg.marks.numeric +
    cfg.distribution.short * cfg.marks.short +
    cfg.distribution.long * cfg.marks.long
  );
}

function validateGeneratedQuestions(
  questions: GeneratedQuestion[],
  cfg: z.infer<typeof generateInput>,
): void {
  const expectedCounts = cfg.distribution;
  const actualCounts = questions.reduce(
    (counts, question) => ({ ...counts, [question.type]: counts[question.type] + 1 }),
    { mcq: 0, numeric: 0, short: 0, long: 0 },
  );
  const countMismatch = (["mcq", "numeric", "short", "long"] as const).find(
    (type) => actualCounts[type] !== expectedCounts[type],
  );
  if (questions.length !== totalQuestionCount(cfg) || countMismatch) {
    throw new Error(
      `expected exactly ${totalQuestionCount(cfg)} questions with counts ${JSON.stringify(expectedCounts)}, received ${questions.length} with counts ${JSON.stringify(actualCounts)}`,
    );
  }

  const actualMarks = questions.reduce((sum, question) => sum + question.marks, 0);
  if (actualMarks !== blueprintMarks(cfg)) {
    throw new Error(`expected ${blueprintMarks(cfg)} blueprint marks, received ${actualMarks}`);
  }

  for (const question of questions) {
    if (!question.question?.trim() || !question.answer?.trim()) {
      throw new Error(`question ${question.id} is missing its question text or answer`);
    }
    if (/\b(?:scenario|case|application|example|question)\s*\d+\b/i.test(question.question)) {
      throw new Error("Gemini returned placeholder-like question wording.");
    }
    if (question.type === "mcq") {
      if (!question.options || question.options.length !== 4) {
        throw new Error(`MCQ ${question.id} must contain exactly four options`);
      }
      const optionTexts = question.options.map((option) =>
        option.replace(/^\s*[A-D][.)]\s*/, "").trim(),
      );
      if (
        optionTexts.some((option) => !option) ||
        new Set(optionTexts.map((option) => option.toLowerCase())).size !== 4 ||
        question.options.some(
          (option, index) => !new RegExp(`^${String.fromCharCode(65 + index)}\\.\\s+`).test(option),
        )
      ) {
        throw new Error(
          `MCQ ${question.id} must have four distinct options labelled A, B, C and D`,
        );
      }
      const answer = question.answer.trim();
      if (!/^[A-D]\.\s+/.test(answer) || !question.options.includes(answer)) {
        throw new Error(`MCQ ${question.id} must have one answer key matching A, B, C or D`);
      }
    } else if (question.type === "numeric" && question.options?.length) {
      throw new Error(`numeric question ${question.id} must not contain options`);
    }
  }
}

function canonicalQuestionText(question: string): string {
  return question
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionSimilarity(left: string, right: string): number {
  const leftWords = new Set(left.split(" ").filter(Boolean));
  const rightWords = new Set(right.split(" ").filter(Boolean));
  if (leftWords.size < 6 || rightWords.size < 6) return 0;
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  return intersection / new Set([...leftWords, ...rightWords]).size;
}

/** Dedupe exact and near-duplicate prompts, renumber, apply marks and rebalance answers. */
function normalizeQuestions(
  raw: GeneratedQuestion[],
  cfg: z.infer<typeof generateInput>,
): GeneratedQuestion[] {
  const seen = new Set<string>();
  const acceptedTexts: string[] = [];
  const unique = raw.filter((q) => {
    const key = canonicalQuestionText(q.question ?? "");
    if (
      !key ||
      seen.has(key) ||
      acceptedTexts.some((text) => questionSimilarity(key, text) >= 0.8)
    ) {
      return false;
    }
    seen.add(key);
    acceptedTexts.push(key);
    return true;
  });
  if (unique.length < raw.length) {
    console.info(`[AI] removed ${raw.length - unique.length} duplicate question(s)`);
  }

  // Balanced-but-unpredictable target slots: shuffled blocks of A/B/C/D.
  const slotBag: number[] = [];
  const nextSlot = (optionCount: number) => {
    if (slotBag.length === 0) {
      const block = Array.from({ length: Math.max(2, optionCount) }, (_, i) => i);
      for (let i = block.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [block[i], block[j]] = [block[j]!, block[i]!];
      }
      slotBag.push(...block);
    }
    return slotBag.shift()! % optionCount;
  };
  return unique.slice(0, totalQuestionCount(cfg)).map((q, i) => {
    const marks =
      q.type === "mcq"
        ? cfg.marks.mcq
        : q.type === "numeric"
          ? cfg.marks.numeric
          : q.type === "short"
            ? cfg.marks.short
            : cfg.marks.long;
    const base: GeneratedQuestion = {
      id: i + 1,
      type: q.type,
      marks: marks || q.marks || 1,
      question: q.question,
      options: q.options,
      answer: q.answer,
    };
    if (q.type !== "mcq" || !q.options || q.options.length < 2) return base;

    // Strip existing letter prefixes, move the correct option to a rotating slot,
    // then re-label so correct answers are spread evenly over A/B/C/D.
    const strip = (s: string) => s.replace(/^\s*[A-Fa-f][.)]\s*/, "").trim();
    const texts = q.options.map(strip);
    const answerText = strip(q.answer ?? "");
    let correct = texts.findIndex((t) => t.toLowerCase() === answerText.toLowerCase());
    if (correct < 0)
      correct = texts.findIndex((t) => answerText.toLowerCase().includes(t.toLowerCase()));
    if (correct < 0) return base;

    const target = nextSlot(texts.length);
    const reordered = [...texts];
    const [picked] = reordered.splice(correct, 1);
    reordered.splice(target, 0, picked!);
    const labelled = reordered.map((t, idx) => `${LETTERS[idx]}. ${t}`);
    return { ...base, options: labelled, answer: labelled[target]! };
  });
}
