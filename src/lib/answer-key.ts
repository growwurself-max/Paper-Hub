/**
 * Shared answer-key logic.
 *
 * Deliberately dependency-free and free of server imports: both the printed
 * paper view and the OMR package server function resolve answer letters through
 * this module, so the key in a downloaded package can never drift from the key
 * printed on the sheet.
 *
 * Pure module — safe to import from client components.
 */

/** Structural subset of `GeneratedQuestion` needed to build a key. */
export type KeyableQuestion = {
  id: number;
  type: "mcq" | "numeric" | "short" | "long";
  marks: number;
  question: string;
  options?: string[];
  answer: string;
};

/** Print order of the question sections, matching the rendered paper layout. */
export const TYPE_ORDER = ["mcq", "numeric", "short", "long"] as const;

export type QuestionType = (typeof TYPE_ORDER)[number];

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
 * The paper view renders section by section (A mcq, B numeric, C short, D long)
 * and numbers continuously across sections, so a question's printed number is
 * *not* necessarily its index in the stored array. Anything that references
 * "Q12" has to use this ordering or it will point at the wrong question.
 */
export function inPrintedOrder(questions: KeyableQuestion[]): {
  question: KeyableQuestion;
  number: number;
}[] {
  const ordered: { question: KeyableQuestion; number: number }[] = [];
  for (const type of TYPE_ORDER) {
    for (const question of questions) {
      if (question.type === type) ordered.push({ question, number: ordered.length + 1 });
    }
  }
  return ordered;
}

export type AnswerKeyEntry = {
  questionNumber: number;
  type: QuestionType;
  /** "A".."F", or "" when the stored answer could not be matched to an option. */
  correctOption: string;
  /** The raw stored answer, kept so a human can audit an unresolved entry. */
  answer: string;
  marks: number;
};

/** The official key for every question, in printed order. */
export function buildAnswerKey(questions: KeyableQuestion[]): AnswerKeyEntry[] {
  return inPrintedOrder(questions).map(({ question, number }) => ({
    questionNumber: number,
    type: question.type,
    correctOption: question.type === "mcq" ? resolveAnswerLetter(question) : "",
    answer: question.answer,
    marks: Number(question.marks) || 0,
  }));
}

/**
 * The OMR-readable subset of the key.
 *
 * Only multiple-choice questions are bubbled on an OMR sheet, so numeric,
 * short and long questions are excluded: including them would produce entries
 * with no option letter that an OMR reader could never match.
 */
export function buildOmrAnswerKey(questions: KeyableQuestion[]): AnswerKeyEntry[] {
  return buildAnswerKey(questions).filter((entry) => entry.type === "mcq");
}
