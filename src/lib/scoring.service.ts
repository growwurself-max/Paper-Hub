/**
 * Scoring Service for OMR Answer Sheets
 *
 * This module handles the evaluation of student answers against official answer keys,
 * applying marking schemes, and computing detailed score breakdowns.
 *
 * Pure module — safe to import from both client and server contexts.
 */

import type { AnswerKeyEntry, QuestionType } from "./answer-key";

/**
 * Student answer as extracted by the OMR scanner.
 * - questionNumber: The printed question number (1-based)
 * - selectedOption: The option letter bubbled by the student (e.g., "A", "B", etc.)
 * - isMultipleBubbles: Set to true if the scanner detected more than one bubble for this question
 */
export type StudentAnswer = {
  questionNumber: number;
  selectedOption: string | null; // null means unattempted/blank
  isMultipleBubbles: boolean;
};

/**
 * Result of evaluating a single question.
 */
export type QuestionEvaluation = {
  questionNumber: number;
  type: QuestionType;
  correctOption: string;
  studentOption: string | null;
  isMultipleBubbles: boolean;
  status: "correct" | "incorrect" | "blank" | "multiple_bubbles";
  marksObtained: number;
  marksPossible: number;
};

/**
 * Section-wise score breakdown.
 */
export type SectionScore = {
  type: QuestionType;
  totalQuestions: number;
  correct: number;
  incorrect: number;
  blank: number;
  multipleBubbles: number;
  totalMarks: number;
  obtainedMarks: number;
};

/**
 * Complete scoring result for a student's OMR sheet.
 */
export type ScoringResult = {
  examId: string;
  examName: string;
  studentAnswers: StudentAnswer[];
  questionEvaluations: QuestionEvaluation[];
  sectionScores: SectionScore[];
  summary: {
    totalQuestions: number;
    totalMarks: number;
    obtainedMarks: number;
    correctCount: number;
    incorrectCount: number;
    blankCount: number;
    multipleBubblesCount: number;
    percentage: number;
  };
  scoredAt: string;
};

/**
 * Configuration for the marking scheme.
 */
export type MarkingScheme = {
  negativeMarking: number;
  marksPerQuestionType: Record<string, number>;
};

/**
 * Core scoring function that evaluates student answers against the official answer key.
 *
 * @param studentAnswers - Answers extracted from the OMR scanner
 * @param answerKey - Official answer key (typically from omrAnswerKey in the exam package)
 * @param markingScheme - Marking scheme configuration
 * @param examMetadata - Exam identification details
 * @returns Complete scoring result
 */
export function scoreAnswers(
  studentAnswers: StudentAnswer[],
  answerKey: AnswerKeyEntry[],
  markingScheme: MarkingScheme,
  examMetadata: { examId: string; examName: string },
): ScoringResult {
  // Create a map for quick lookup of answer key entries
  const answerKeyMap = new Map<number, AnswerKeyEntry>();
  for (const entry of answerKey) {
    answerKeyMap.set(entry.questionNumber, entry);
  }

  // Evaluate each question
  const questionEvaluations: QuestionEvaluation[] = [];
  const sectionMap = new Map<QuestionType, SectionScore>();

  for (const studentAnswer of studentAnswers) {
    const keyEntry = answerKeyMap.get(studentAnswer.questionNumber);

    if (!keyEntry) {
      // Question not found in answer key - skip or handle as needed
      continue;
    }

    const evaluation = evaluateQuestion(studentAnswer, keyEntry, markingScheme);
    questionEvaluations.push(evaluation);

    // Update section totals
    const section = sectionMap.get(keyEntry.type) || {
      type: keyEntry.type,
      totalQuestions: 0,
      correct: 0,
      incorrect: 0,
      blank: 0,
      multipleBubbles: 0,
      totalMarks: 0,
      obtainedMarks: 0,
    };

    section.totalQuestions++;
    section.totalMarks += keyEntry.marks;
    section.obtainedMarks += evaluation.marksObtained;

    switch (evaluation.status) {
      case "correct":
        section.correct++;
        break;
      case "incorrect":
        section.incorrect++;
        break;
      case "blank":
        section.blank++;
        break;
      case "multiple_bubbles":
        section.multipleBubbles++;
        break;
    }

    sectionMap.set(keyEntry.type, section);
  }

  // Convert section map to array
  const sectionScores = Array.from(sectionMap.values());

  // Calculate summary
  const summary = {
    totalQuestions: questionEvaluations.length,
    totalMarks: questionEvaluations.reduce((sum, e) => sum + e.marksPossible, 0),
    obtainedMarks: questionEvaluations.reduce((sum, e) => sum + e.marksObtained, 0),
    correctCount: questionEvaluations.filter((e) => e.status === "correct").length,
    incorrectCount: questionEvaluations.filter((e) => e.status === "incorrect").length,
    blankCount: questionEvaluations.filter((e) => e.status === "blank").length,
    multipleBubblesCount: questionEvaluations.filter((e) => e.status === "multiple_bubbles").length,
    percentage: 0,
  };

  summary.percentage =
    summary.totalMarks > 0
      ? Math.round((summary.obtainedMarks / summary.totalMarks) * 100 * 100) / 100
      : 0;

  return {
    examId: examMetadata.examId,
    examName: examMetadata.examName,
    studentAnswers,
    questionEvaluations,
    sectionScores,
    summary,
    scoredAt: new Date().toISOString(),
  };
}

/**
 * Evaluate a single question against the answer key.
 */
function evaluateQuestion(
  studentAnswer: StudentAnswer,
  keyEntry: AnswerKeyEntry,
  markingScheme: MarkingScheme,
): QuestionEvaluation {
  const marks = keyEntry.marks;
  const negativeMarking = markingScheme.negativeMarking;

  // Multiple bubbles detected - treat as invalid/zero marks
  if (studentAnswer.isMultipleBubbles) {
    return {
      questionNumber: studentAnswer.questionNumber,
      type: keyEntry.type,
      correctOption: keyEntry.correctOption,
      studentOption: studentAnswer.selectedOption,
      isMultipleBubbles: true,
      status: "multiple_bubbles",
      marksObtained: 0,
      marksPossible: marks,
    };
  }

  // Blank/unattempted - zero marks, no negative penalty
  if (studentAnswer.selectedOption === null || studentAnswer.selectedOption === "") {
    return {
      questionNumber: studentAnswer.questionNumber,
      type: keyEntry.type,
      correctOption: keyEntry.correctOption,
      studentOption: null,
      isMultipleBubbles: false,
      status: "blank",
      marksObtained: 0,
      marksPossible: marks,
    };
  }

  // Compare student's answer with correct answer
  const isCorrect =
    studentAnswer.selectedOption.toUpperCase() === keyEntry.correctOption.toUpperCase();

  if (isCorrect) {
    return {
      questionNumber: studentAnswer.questionNumber,
      type: keyEntry.type,
      correctOption: keyEntry.correctOption,
      studentOption: studentAnswer.selectedOption,
      isMultipleBubbles: false,
      status: "correct",
      marksObtained: marks,
      marksPossible: marks,
    };
  } else {
    // Incorrect - apply negative marking if configured
    const negativeMarks = negativeMarking > 0 ? -negativeMarking : 0;
    return {
      questionNumber: studentAnswer.questionNumber,
      type: keyEntry.type,
      correctOption: keyEntry.correctOption,
      studentOption: studentAnswer.selectedOption,
      isMultipleBubbles: false,
      status: "incorrect",
      marksObtained: negativeMarks,
      marksPossible: marks,
    };
  }
}

/**
 * Create a student answer object from raw scanner data.
 * Helper function to normalize scanner output into the expected format.
 */
export function createStudentAnswer(
  questionNumber: number,
  selectedOption: string | null,
  isMultipleBubbles: boolean = false,
): StudentAnswer {
  return {
    questionNumber,
    selectedOption: selectedOption?.toUpperCase() || null,
    isMultipleBubbles,
  };
}

/**
 * Batch score multiple student answer sheets against the same exam.
 * Useful for processing multiple OMR sheets in a single batch.
 */
export function batchScoreAnswers(
  studentAnswerSets: Array<{ studentId: string; answers: StudentAnswer[] }>,
  answerKey: AnswerKeyEntry[],
  markingScheme: MarkingScheme,
  examMetadata: { examId: string; examName: string },
): Array<{ studentId: string; result: ScoringResult }> {
  return studentAnswerSets.map(({ studentId, answers }) => ({
    studentId,
    result: scoreAnswers(answers, answerKey, markingScheme, examMetadata),
  }));
}
