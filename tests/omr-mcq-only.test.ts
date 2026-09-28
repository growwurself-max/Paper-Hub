import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAnswerKey, buildOmrAnswerKey, type KeyableQuestion } from "../src/lib/answer-key.ts";
import { buildOmrLayout, type OmrSheetProps } from "../src/lib/omr-sheet.ts";
import type { SubjectSection } from "../src/lib/paper-sections.ts";

const OPTIONS = ["A. alpha", "B. beta", "C. gamma", "D. delta"];

/** The stored answer for a letter, in the form the generator actually produces. */
const ANSWER_TEXT: Record<string, string> = {
  A: "A. alpha",
  B: "B. beta",
  C: "C. gamma",
  D: "D. delta",
};

function q(
  id: number,
  type: KeyableQuestion["type"],
  letter: string,
  subject: string,
): KeyableQuestion {
  return {
    id,
    type,
    marks: type === "mcq" ? 1 : 5,
    question: `Q${id}`,
    options: type === "mcq" ? OPTIONS : undefined,
    answer: type === "mcq" ? ANSWER_TEXT[letter]! : letter,
    subject,
  };
}

/** The letters actually filled in, one per grid row, in row order. */
function filledByRow(props: OmrSheetProps): (string | null)[] {
  const layout = buildOmrLayout(props);
  const rows = layout.columns.flatMap((column) => column.rows);
  const bubbles = layout.columns.flatMap((column) => column.bubbles);
  // Bubbles carry no question number, but they are emitted in row order with one
  // full set of option letters per row, so a row's bubbles are a fixed slice.
  const perRow = bubbles.length / Math.max(1, rows.length);
  return rows.map((row) => {
    const start = (row.questionNumber - 1) * perRow;
    const hit = bubbles.slice(start, start + perRow).find((bubble) => bubble.filled);
    return hit ? hit.letter : null;
  });
}

function omrProps(questions: KeyableQuestion[], sections: SubjectSection[]): OmrSheetProps {
  const mcqs = questions.filter((item) => item.type === "mcq");
  return {
    mode: "key",
    title: "T",
    collegeName: "C",
    subject: "S",
    className: "K",
    board: "B",
    duration: "D",
    maxMarks: mcqs.reduce((sum, item) => sum + item.marks, 0),
    questionCount: mcqs.length,
    optionCount: 4,
    answerKey: buildOmrAnswerKey(questions, sections),
  };
}

describe("OMR is generated for multiple-choice questions only", () => {
  test("descriptive, numeric and short questions never reach the OMR key", () => {
    const questions = [
      q(1, "mcq", "A", "Physics"),
      q(2, "numeric", "12", "Physics"),
      q(3, "short", "essay", "Physics"),
      q(4, "long", "essay", "Chemistry"),
      q(5, "mcq", "B", "Chemistry"),
    ];
    const key = buildOmrAnswerKey(questions);

    assert.equal(key.length, 2, "only the two MCQs belong on the OMR key");
    for (const entry of key) {
      assert.equal(entry.type, "mcq");
      assert.ok(["A", "B", "C", "D"].includes(entry.correctOption), "every OMR row needs a letter");
    }
  });

  test("the OMR key is renumbered 1..N so it lines up with the grid rows", () => {
    // A descriptive question sits at printed position 2, so the full key numbers
    // the MCQs 1, 3, 4. Bubbling those numbers unshifted would leave grid row 2
    // empty and move the last answer onto the wrong row.
    const questions = [
      q(1, "mcq", "A", "Physics"),
      q(2, "short", "essay", "Physics"),
      q(3, "mcq", "B", "Physics"),
      q(4, "mcq", "C", "Chemistry"),
    ];
    const sections: SubjectSection[] = [
      { subject: "Physics", questionCount: 3 },
      { subject: "Chemistry", questionCount: 1 },
    ];

    // The full key keeps the paper's own numbering for auditing.
    assert.deepEqual(
      buildAnswerKey(questions, sections).map((e) => [e.questionNumber, e.type]),
      [
        [1, "mcq"],
        [2, "short"],
        [3, "mcq"],
        [4, "mcq"],
      ],
    );

    // The OMR key is a flat run of MCQ rows.
    assert.deepEqual(
      buildOmrAnswerKey(questions, sections).map((e) => [e.questionNumber, e.correctOption]),
      [
        [1, "A"],
        [2, "B"],
        [3, "C"],
      ],
    );
  });

  test("the painted bubbled key matches the MCQ answers row for row", () => {
    const questions = [
      q(1, "mcq", "A", "Physics"),
      q(2, "short", "essay", "Physics"),
      q(3, "mcq", "B", "Physics"),
      q(4, "mcq", "C", "Chemistry"),
    ];
    const sections: SubjectSection[] = [
      { subject: "Physics", questionCount: 3 },
      { subject: "Chemistry", questionCount: 1 },
    ];

    assert.deepEqual(filledByRow(omrProps(questions, sections)), ["A", "B", "C"]);
  });

  test("a banded descriptive paper keeps the right answer on every row", () => {
    // Interleaving non-MCQ questions in every band is the shape that used to
    // shift the whole key.
    const questions: KeyableQuestion[] = [
      q(1, "mcq", "A", "Physics"),
      q(2, "short", "essay", "Physics"),
      q(3, "mcq", "B", "Physics"),
      q(4, "long", "essay", "Chemistry"),
      q(5, "mcq", "C", "Chemistry"),
      q(6, "numeric", "7", "Mathematics"),
      q(7, "mcq", "D", "Mathematics"),
    ];
    const sections: SubjectSection[] = [
      { subject: "Physics", questionCount: 3 },
      { subject: "Chemistry", questionCount: 2 },
      { subject: "Mathematics", questionCount: 2 },
    ];

    assert.deepEqual(filledByRow(omrProps(questions, sections)), ["A", "B", "C", "D"]);
  });

  test("the grid row count is exactly the number of MCQs", () => {
    const questions = [q(1, "short", "essay", "Physics"), q(2, "mcq", "A", "Physics")];
    const layout = buildOmrLayout(omrProps(questions, []));
    const rows = layout.columns.flatMap((column) => column.rows);

    assert.equal(rows.length, 1, "the descriptive question must not claim a bubble row");
    assert.equal(rows[0]!.questionNumber, 1);
  });

  test("a paper with no MCQs lays out no rows at all", () => {
    const questions = [q(1, "short", "essay", "Physics"), q(2, "long", "essay", "Physics")];
    const layout = buildOmrLayout(omrProps(questions, []));

    assert.equal(layout.columns.flatMap((column) => column.rows).length, 0);
    assert.equal(layout.summary, null);
  });
});
