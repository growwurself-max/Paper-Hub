import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreAnswers, type StudentAnswer, type ScoringResult } from "./scoring.service";
import type { OmrExamPackage } from "./omr-package.functions";

/**
 * Scoring Service Server Function
 *
 * Accepts student answers extracted from OMR scanner, compares against the official
 * answer key, applies marking scheme, and stores results in the database.
 */

/**
 * Helper function to coerce questions from raw JSONB data.
 * Matches the logic in omr-package.functions.ts to ensure consistency.
 */
function coerceQuestions(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
    .map((q, i) => ({
      id: Number(q.id) || i + 1,
      type: ["mcq", "numeric", "short", "long"].includes(String(q.type))
        ? (String(q.type) as "mcq" | "numeric" | "short" | "long")
        : "long",
      marks: Number(q.marks) || 0,
      question: String(q.question || ""),
      options: Array.isArray(q.options) ? q.options.map((o) => String(o)) : undefined,
      answer: String(q.answer || ""),
    }));
}

const ScoreInput = z.object({
  examId: z.string().uuid(),
  studentAnswers: z.array(
    z.object({
      questionNumber: z.number().int().positive(),
      selectedOption: z.string().nullable(),
      isMultipleBubbles: z.boolean().default(false),
    }),
  ),
  studentIdentifier: z.string().optional(), // Roll number or other student ID
});

/**
 * Server function to score a student's OMR answers.
 *
 * This function:
 * 1. Validates the input
 * 2. Fetches the exam package (answer key and marking scheme)
 * 3. Scores the answers using the scoring service
 * 4. Stores the result in the exam_results table
 * 5. Returns the complete scoring result
 */
export const scoreStudentAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ScoreInput.parse(raw))
  .handler(async ({ data, context }): Promise<ScoringResult> => {
    const { examId, studentAnswers, studentIdentifier } = data;

    // Fetch the exam details to get organization_id and validate access
    const { data: exam, error: examErr } = await context.supabase
      .from("exams")
      .select("id, exam_id, exam_name, organization_id, paper_id")
      .eq("id", examId)
      .maybeSingle();

    if (examErr) throw new Error(examErr.message);
    if (!exam) throw new Error("Exam not found or not accessible.");

    // Fetch the paper to get the exam package (answer key and marking scheme)
    // We'll reconstruct the package using the existing getOmrExamPackage logic
    const { data: paper, error: paperErr } = await context.supabase
      .from("generated_papers")
      .select("id, title, organization_id, config, questions")
      .eq("id", exam.paper_id)
      .maybeSingle();

    if (paperErr) throw new Error(paperErr.message);
    if (!paper) throw new Error("Paper not found for this exam.");

    // Verify the user has access to this exam (same organization)
    if (exam.organization_id !== context.organizationId) {
      throw new Error("You do not have access to this exam.");
    }

    // Build the answer key and marking scheme from the paper
    const { buildOmrAnswerKey } = await import("./answer-key");

    const questions = coerceQuestions(paper.questions);
    const answerKey = buildOmrAnswerKey(questions); // Use OMR answer key (MCQs only)

    const cfg = (paper.config ?? {}) as Record<string, unknown>;
    const rawMarks = (cfg.marks ?? {}) as Record<string, unknown>;

    // Build marking scheme
    const markingScheme = {
      negativeMarking: Number(cfg.negativeMarking) || 0,
      marksPerQuestionType: {} as Record<string, number>,
    };

    // Calculate marks per question type
    for (const type of ["mcq", "numeric", "short", "long"]) {
      const inType = answerKey.filter((entry) => entry.type === type);
      if (inType.length > 0) {
        markingScheme.marksPerQuestionType[type] =
          Number(rawMarks[type]) ||
          Math.round((inType.reduce((sum, e) => sum + e.marks, 0) / inType.length) * 100) / 100;
      }
    }

    // Convert student answers to the expected format
    const formattedAnswers: StudentAnswer[] = studentAnswers.map((ans) => ({
      questionNumber: ans.questionNumber,
      selectedOption: ans.selectedOption?.toUpperCase() || null,
      isMultipleBubbles: ans.isMultipleBubbles,
    }));

    // Score the answers
    const scoringResult = scoreAnswers(formattedAnswers, answerKey, markingScheme, {
      examId: exam.exam_id,
      examName: exam.exam_name,
    });

    // Store the result in the database
    const { error: resultErr } = await context.supabase.from("exam_results").insert({
      exam_id: examId,
      organization_id: exam.organization_id,
      status: "verified", // Auto-verify since scoring is deterministic
      total_marks: scoringResult.summary.totalMarks,
      obtained_marks: scoringResult.summary.obtainedMarks,
      student_count: 1, // Single student result
      notes: studentIdentifier
        ? `Student: ${studentIdentifier}. Score: ${scoringResult.summary.obtainedMarks}/${scoringResult.summary.totalMarks}`
        : `Score: ${scoringResult.summary.obtainedMarks}/${scoringResult.summary.totalMarks}`,
    });

    if (resultErr) {
      console.error("Failed to store exam result:", resultErr);
      // Don't throw - still return the scoring result to the caller
    }

    return scoringResult;
  });

/**
 * Batch scoring function for processing multiple student answer sheets at once.
 * Useful for bulk processing of OMR scans.
 */
const BatchScoreInput = z.object({
  examId: z.string().uuid(),
  studentAnswerSets: z.array(
    z.object({
      studentIdentifier: z.string(),
      answers: z.array(
        z.object({
          questionNumber: z.number().int().positive(),
          selectedOption: z.string().nullable(),
          isMultipleBubbles: z.boolean().default(false),
        }),
      ),
    }),
  ),
});

export const batchScoreStudentAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => BatchScoreInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { examId, studentAnswerSets } = data;

    // Fetch exam details (same validation as single scoring)
    const { data: exam, error: examErr } = await context.supabase
      .from("exams")
      .select("id, exam_id, exam_name, organization_id, paper_id")
      .eq("id", examId)
      .maybeSingle();

    if (examErr) throw new Error(examErr.message);
    if (!exam) throw new Error("Exam not found or not accessible.");

    if (exam.organization_id !== context.organizationId) {
      throw new Error("You do not have access to this exam.");
    }

    // Fetch paper and build answer key
    const { data: paper, error: paperErr } = await context.supabase
      .from("generated_papers")
      .select("id, title, organization_id, config, questions")
      .eq("id", exam.paper_id)
      .maybeSingle();

    if (paperErr) throw new Error(paperErr.message);
    if (!paper) throw new Error("Paper not found for this exam.");

    // Import and reuse the buildOmrAnswerKey function
    const { buildOmrAnswerKey } = await import("./answer-key");

    const questions = coerceQuestions(paper.questions);
    const answerKey = buildOmrAnswerKey(questions);

    const cfg = (paper.config ?? {}) as Record<string, unknown>;
    const rawMarks = (cfg.marks ?? {}) as Record<string, unknown>;

    const markingScheme = {
      negativeMarking: Number(cfg.negativeMarking) || 0,
      marksPerQuestionType: {} as Record<string, number>,
    };

    for (const type of ["mcq", "numeric", "short", "long"]) {
      const inType = answerKey.filter((entry) => entry.type === type);
      if (inType.length > 0) {
        markingScheme.marksPerQuestionType[type] =
          Number(rawMarks[type]) ||
          Math.round((inType.reduce((sum, e) => sum + e.marks, 0) / inType.length) * 100) / 100;
      }
    }

    // Score each student's answers
    const results = studentAnswerSets.map(({ studentIdentifier, answers }) => {
      const formattedAnswers: StudentAnswer[] = answers.map((ans) => ({
        questionNumber: ans.questionNumber,
        selectedOption: ans.selectedOption?.toUpperCase() || null,
        isMultipleBubbles: ans.isMultipleBubbles,
      }));

      const scoringResult = scoreAnswers(formattedAnswers, answerKey, markingScheme, {
        examId: exam.exam_id,
        examName: exam.exam_name,
      });

      return {
        studentIdentifier,
        result: scoringResult,
      };
    });

    // Store batch results in the database
    // We'll create a single exam result with aggregated data
    const totalObtainedMarks = results.reduce((sum, r) => sum + r.result.summary.obtainedMarks, 0);
    const maxMarks = results[0]?.result.summary.totalMarks || 0;
    const totalMaxMarks = maxMarks * results.length;

    const { error: resultErr } = await context.supabase.from("exam_results").insert({
      exam_id: examId,
      organization_id: exam.organization_id,
      status: "verified",
      total_marks: totalMaxMarks,
      obtained_marks: totalObtainedMarks,
      student_count: results.length,
      notes: `Batch of ${results.length} students. Average: ${Math.round((totalObtainedMarks / totalMaxMarks) * 100)}%`,
    });

    if (resultErr) {
      console.error("Failed to store batch exam result:", resultErr);
    }

    return results;
  });

/**
 * Retrieve scoring results for an exam.
 */
export const getExamResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ examId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { examId } = data;

    const { data: results, error } = await context.supabase
      .from("exam_results")
      .select("*")
      .eq("exam_id", examId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return results;
  });
