import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAnswerKey, buildOmrAnswerKey, TYPE_ORDER } from "@/lib/answer-key";
import type { SubjectSection } from "@/lib/paper-sections";
import type { KeyableQuestion } from "@/lib/answer-key";

/**
 * OMR key / exam package export.
 *
 * Exam identity comes from the `exams` table (Task 1); the answer key comes
 * from `generated_papers.questions`, which is the single source of truth for
 * question content today. There is deliberately no second copy of the questions.
 *
 * The paper and its exam row are read through the caller's own client, so RLS
 * decides whether the request may see the paper at all. Only the on-demand
 * insert of a missing `exams` row goes through the service-role client, and it
 * runs after that check has already established ownership.
 */

const PackageInput = z.object({
  id: z.string().uuid(),
  paperId: z.string().uuid().optional(),
});

type PaperRow = {
  id: string;
  title: string;
  organization_id: string;
  config: Record<string, unknown> | null;
  questions: unknown;
  omr_pdf_path: string | null;
};

type ExamRow = {
  id: string;
  exam_id: string;
  exam_name: string;
  template_type: string;
  requires_omr: boolean;
};

/** Same scheme as the Task 1 backfill, so codes stay consistent across the two paths. */
function derivedExamCode(paperId: string): string {
  return `PAP-${paperId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function str(value: unknown, fallback = ""): string {
  return value == null ? fallback : String(value);
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Accepts a JSONB value that should be a question array, tolerating legacy shapes. */
function coerceQuestions(raw: unknown): KeyableQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
    .map((q, i) => ({
      id: num(q.id, i + 1),
      // An unrecognised type is coerced to "long" rather than passed through:
      // it still belongs in the full key, and it is correctly kept out of the
      // OMR key, whereas a type the ordering does not know about would be
      // dropped from the export entirely.
      type: TYPE_ORDER.includes(str(q.type) as (typeof TYPE_ORDER)[number])
        ? (str(q.type) as KeyableQuestion["type"])
        : "long",
      marks: num(q.marks, 0),
      question: str(q.question),
      options: Array.isArray(q.options) ? q.options.map((o) => str(o)) : undefined,
      answer: str(q.answer),
      subject: q.subject == null ? undefined : str(q.subject),
    }));
}

/**
 * Accepts a JSONB value that should be a subject-band list.
 *
 * Malformed or empty input yields no bands, which keeps an older or hand-edited
 * paper on its original type-major numbering rather than rejecting the export.
 * Bands that do not account for every question are dropped for the same reason:
 * a partial band list would renumber the key, and a key whose numbers disagree
 * with the printed sheet is worse than one that is merely type-major.
 */
function coerceSubjectSections(raw: unknown, questionCount: number): SubjectSection[] {
  if (!Array.isArray(raw) || questionCount <= 0) return [];
  const sections = raw.flatMap((entry): SubjectSection[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { subject, questionCount } = entry as { subject?: unknown; questionCount?: unknown };
    const count = Math.floor(Number(questionCount));
    if (typeof subject !== "string" || !subject.trim() || !Number.isFinite(count) || count < 1) {
      return [];
    }
    return [{ subject, questionCount: count }];
  });
  const covered = sections.reduce((sum, section) => sum + section.questionCount, 0);
  return covered === questionCount ? sections : [];
}

export type OmrExamPackage = {
  schemaVersion: string;
  generatedAt: string;
  exam: {
    examId: string;
    examName: string;
    templateType: string;
    subject: string;
    board: string;
    stream: string;
    className: string;
    duration: string;
    requiresOmr: boolean;
    declaredTotalMarks: number;
    computedTotalMarks: number;
  };
  markingScheme: {
    negativeMarking: number;
    marksPerQuestionType: Record<string, number>;
    questionCounts: Record<string, number>;
    totalQuestions: number;
  };
  /** OMR-readable key: multiple-choice questions only, Q number -> option letter. */
  omrAnswerKey: { questionNumber: number; correctOption: string; marks: number }[];
  /** Every question, for auditing or for a result pipeline that scores more than MCQ. */
  answerKey: {
    questionNumber: number;
    type: string;
    correctOption: string;
    answer: string;
    marks: number;
  }[];
};

export const getOmrExamPackage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => PackageInput.parse(raw))
  .handler(async ({ data, context }): Promise<OmrExamPackage> => {
    const paperId = data.paperId || data.id;
    const { data: paper, error: paperErr } = await context.supabase
      .from("generated_papers")
      .select("id, title, organization_id, config, questions, omr_pdf_path")
      .eq("id", paperId)
      .maybeSingle();
    if (paperErr) throw new Error(paperErr.message);
    // RLS already scoped this query; a miss means absent or not this institute's.
    if (!paper) throw new Error("Paper not found or not accessible.");
    const row = paper as PaperRow;

    const cfg = (row.config ?? {}) as Record<string, unknown>;
    const requiresOmr = Boolean(cfg.omr) || row.omr_pdf_path != null;
    if (!requiresOmr) {
      throw new Error("This exam has no OMR sheet, so there is no OMR key to export.");
    }

    const { data: existingExam } = await context.supabase
      .from("exams")
      .select("id, exam_id, exam_name, template_type, requires_omr")
      .eq("paper_id", row.id)
      .maybeSingle();
    let exam = existingExam as ExamRow | null;

    // Papers generated after the exams migration have no row yet. Create it on
    // first export so every downloadable package carries a real, joinable ID.
    if (!exam) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const examId = derivedExamCode(row.id);
      const { error: insertErr } = await supabaseAdmin.from("exams").insert({
        exam_id: examId,
        organization_id: row.organization_id,
        exam_name: str(cfg.title, row.title) || row.title,
        template_type: str(cfg.examPreset, "custom") || "custom",
        requires_omr: true,
        paper_id: row.id,
        created_by: context.userId,
      });
      // A concurrent export may have won the unique exam_id race; re-read.
      if (insertErr) {
        const { data: retry } = await supabaseAdmin
          .from("exams")
          .select("id, exam_id, exam_name, template_type, requires_omr")
          .eq("paper_id", row.id)
          .maybeSingle();
        if (!retry) throw new Error(insertErr.message);
        exam = retry as ExamRow;
      } else {
        const { data: created } = await supabaseAdmin
          .from("exams")
          .select("id, exam_id, exam_name, template_type, requires_omr")
          .eq("paper_id", row.id)
          .maybeSingle();
        exam = (created as ExamRow | null) ?? {
          id: "",
          exam_id: examId,
          exam_name: row.title,
          template_type: str(cfg.examPreset, "custom"),
          requires_omr: true,
        };
      }
    }

    const questions = coerceQuestions(row.questions);
    // A subject-banded paper prints in band order, so the exported key must be
    // numbered the same way or Q1 in the package would not be Q1 on the sheet.
    const subjectSections = coerceSubjectSections(cfg.subjectSections, questions.length);
    const answerKey = buildAnswerKey(questions, subjectSections);
    const omrAnswerKey = buildOmrAnswerKey(questions, subjectSections);

    const rawMarks = (cfg.marks ?? {}) as Record<string, unknown>;
    const questionCounts: Record<string, number> = {};
    const marksPerQuestionType: Record<string, number> = {};
    for (const type of TYPE_ORDER) {
      const inType = answerKey.filter((entry) => entry.type === type);
      questionCounts[type] = inType.length;
      // Fall back to the average actually used when config carries no rule for
      // this type, so a hand-edited paper still reports a usable value.
      marksPerQuestionType[type] =
        num(rawMarks[type]) ||
        (inType.length > 0
          ? Math.round((inType.reduce((sum, e) => sum + e.marks, 0) / inType.length) * 100) / 100
          : 0);
    }

    return {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      exam: {
        examId: exam.exam_id,
        examName: exam.exam_name || row.title,
        templateType: exam.template_type,
        subject: str(cfg.subject),
        board: str(cfg.board),
        stream: str(cfg.stream),
        className: str(cfg.className),
        duration: str(cfg.duration),
        requiresOmr: exam.requires_omr,
        declaredTotalMarks: num(cfg.totalMarks),
        computedTotalMarks: answerKey.reduce((sum, e) => sum + e.marks, 0),
      },
      markingScheme: {
        negativeMarking: num(cfg.negativeMarking),
        marksPerQuestionType,
        questionCounts,
        totalQuestions: answerKey.length,
      },
      omrAnswerKey: omrAnswerKey.map((e) => ({
        questionNumber: e.questionNumber,
        correctOption: e.correctOption,
        marks: e.marks,
      })),
      answerKey,
    };
  });
