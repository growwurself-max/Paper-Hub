/**
 * Shared answer-key logic.
 *
 * Deliberately free of server imports: both the printed paper view and the OMR
 * package server function resolve answer letters through this module, so the key
 * in a downloaded package can never drift from the key printed on the sheet.
 *
 * Pure module — safe to import from client components.
 */

import { resolveSectionRanges, type SubjectSection } from "@/lib/paper-sections";

/** Structural subset of `GeneratedQuestion` needed to build a key. */
export type KeyableQuestion = {
  id: number;
  type: "mcq" | "numeric" | "short" | "long";
  marks: number;
  question: string;
  options?: string[];
  answer: string;
  /** Subject band this question belongs to; empty on single-subject papers. */
  subject?: string;
};

/** Print order of the question sections, matching the rendered paper layout. */
export const TYPE_ORDER = ["mcq", "numeric", "short", "long"] as const;

export type QuestionType = (typeof TYPE_ORDER)[number];

function sameSubject(a: string | undefined, b: string): boolean {
  return (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Resolve the correct option letter for a question.
 *
 * The generator sometimes stores the answer as a letter prefix ("B. glucose")
 * and sometimes as bare option text, so both are handled. Returns an empty
 * string when the answer cannot be tied to an option, which is how an
 * unresolvable key entry is represented rather than guessed at.
 */
export function resolveAnswerLetter(question: KeyableQuestion): string {
  const answer = question.answer
    .trim()
    .match(/^([A-Fa-f])[.)\s]/)?.[1]
    ?.toUpperCase();
  if (answer && question.options?.some((option) => option.trim().startsWith(`${answer}.`))) {
    return answer;
  }

  const answerText = question.answer
    .replace(/^\s*[A-Fa-f][.)]\s*/, "")
    .trim()
    .toLowerCase();
  const optionIndex = question.options?.findIndex(
    (option) =>
      option
        .replace(/^\s*[A-Fa-f][.)]\s*/, "")
        .trim()
        .toLowerCase() === answerText,
  );
  return optionIndex != null && optionIndex >= 0 ? String.fromCharCode(65 + optionIndex) : "";
}

/**
 * Flatten questions into printed order with their printed question numbers.
 *
 * A question's printed number is *not* necessarily its index in the stored
 * array, so anything that references "Q12" has to use this ordering or it will
 * point at the wrong question.
 *
 * When the paper declares subject bands the bands themselves define the print
 * order (Physics 1-40, then Chemistry 41-80, ...), and the order *inside* a
 * band is kept exactly as generated: a band owns a fixed run of question
 * numbers, so regrouping by type would slide a question off the number its own
 * heading promises. Without bands the order stays purely type-major, which is
 * what single-subject papers have always printed.
 *
 * A question whose subject matches no band is still emitted, at the end in
 * stored order, so a mislabelled question can never silently vanish from a key.
 */
export function inPrintedOrder(
  questions: KeyableQuestion[],
  sections: SubjectSection[] = [],
): {
  question: KeyableQuestion;
  number: number;
}[] {
  const ordered: { question: KeyableQuestion; number: number }[] = [];
  const used = new Set<number>();

  if (sections.length > 0) {
    for (const band of resolveSectionRanges(sections)) {
      questions.forEach((question, index) => {
        if (used.has(index) || !sameSubject(question.subject, band.subject)) return;
        used.add(index);
        ordered.push({ question, number: ordered.length + 1 });
      });
    }
  }

  if (sections.length === 0) {
    for (const type of TYPE_ORDER) {
      for (const question of questions) {
        if (question.type === type) ordered.push({ question, number: ordered.length + 1 });
      }
    }
    return ordered;
  }

  questions.forEach((question, index) => {
    if (used.has(index)) return;
    used.add(index);
    ordered.push({ question, number: ordered.length + 1 });
  });
  return ordered;
}

/**
 * Row count needed to lay `count` key entries out as a column-major grid.
 *
 * With an explicit row count and `grid-auto-flow: column`, CSS fills straight
 * down column one (1, 2, 3...) before starting column two, which is the
 * top-to-bottom reading order the key is specified to use. Deriving the row
 * count from the entry count also keeps the last column flush instead of
 * trailing a column of empty rows.
 */
export function keyColumnRows(count: number, columns: number): number {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  const safeColumns = Math.max(1, Math.floor(Number(columns) || 1));
  return Math.ceil(safeCount / safeColumns);
}

export type AnswerKeyEntry = {
  questionNumber: number;
  type: QuestionType;
  /** "A".."F", or "" when the stored answer could not be matched to an option. */
  correctOption: string;
  /** The raw stored answer, kept so a human can audit an unresolved entry. */
  answer: string;
  marks: number;
  /** Subject band, when the paper is banded. Empty otherwise. */
  subject?: string;
};

/** The official key for every question, in printed order. */
export function buildAnswerKey(
  questions: KeyableQuestion[],
  sections: SubjectSection[] = [],
): AnswerKeyEntry[] {
  return inPrintedOrder(questions, sections).map(({ question, number }) => ({
    questionNumber: number,
    type: question.type,
    correctOption: question.type === "mcq" ? resolveAnswerLetter(question) : "",
    answer: question.answer,
    marks: Number(question.marks) || 0,
    subject: question.subject ?? "",
  }));
}

/**
 * The OMR-readable subset of the key, renumbered to OMR row order.
 *
 * Only multiple-choice questions are bubbled on an OMR sheet, so numeric,
 * short and long questions are excluded: including them would produce entries
 * with no option letter that an OMR reader could never match.
 *
 * The surviving questions are then renumbered 1..N. This matters whenever a
 * paper mixes question types. The full key numbers *every* question, so on a
 * banded paper with a descriptive question at printed position 2 the MCQ
 * entries come back as 1, 3, 4 - but the OMR grid lays its rows out as a plain
 * 1..N run and looks the key up by that row number. Bubbling the unrenumbered
 * key would leave row 2 empty and shift every later answer onto the wrong row.
 * Renumbering here keeps the painted key aligned with the row it is read from.
 *
 * Printed order is preserved, so the Nth OMR row is still the Nth MCQ the
 * candidate meets on the paper; only the number changes, from the paper's
 * printed number to the OMR row it is answered in.
 */
export function buildOmrAnswerKey(
  questions: KeyableQuestion[],
  sections: SubjectSection[] = [],
): AnswerKeyEntry[] {
  return buildAnswerKey(questions, sections)
    .filter((entry) => entry.type === "mcq")
    .map((entry, index) => ({ ...entry, questionNumber: index + 1 }));
}
