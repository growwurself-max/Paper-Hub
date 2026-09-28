/**
 * Subject-banded paper structure.
 *
 * A banded exam pins a subject to an exact run of question numbers (EAMCET:
 * 1-40 Physics, 41-80 Chemistry, 81-160 Mathematics). The printed sheet, the
 * answer key and the downloaded OMR package each rebuild that order from the
 * stored paper, so these tests pin the band arithmetic and the numbering every
 * one of those three views depends on.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  allocateSectionDistributions,
  chunkQuestionCounts,
  distributionMarks,
  distributionTotal,
  resolveSectionRanges,
  sectionTotal,
  type SubjectSection,
} from "../src/lib/paper-sections.ts";
import { buildAnswerKey, inPrintedOrder, keyColumnRows } from "../src/lib/answer-key.ts";
import { EXAM_PRESETS, getPreset } from "../src/lib/exam-presets.ts";

const EAMCET: SubjectSection[] = [
  { subject: "Physics", questionCount: 40 },
  { subject: "Chemistry", questionCount: 40 },
  { subject: "Mathematics", questionCount: 80 },
];

/** An EAMCET-shaped paper: 160 MCQs already numbered and stamped in band order. */
function eamcetPaper() {
  return Array.from({ length: 160 }, (_, index) => {
    const band = resolveSectionRanges(EAMCET).find(
      (s) => index + 1 >= s.firstQuestion && index + 1 <= s.lastQuestion,
    )!;
    return {
      id: index + 1,
      type: "mcq" as const,
      marks: 1,
      question: `Question ${index + 1}`,
      options: ["A. one", "B. two", "C. three", "D. four"],
      answer: "B. two",
      subject: band.subject,
    };
  });
}

describe("preset band declaration", () => {
  test("EAMCET declares 1-40 Physics, 41-80 Chemistry, 81-160 Mathematics", () => {
    const preset = getPreset("eamcet");
    const ranges = resolveSectionRanges(preset.subjectSections ?? []);
    assert.deepEqual(
      ranges.map((band) => [band.subject, band.firstQuestion, band.lastQuestion]),
      [
        ["Physics", 1, 40],
        ["Chemistry", 41, 80],
        ["Mathematics", 81, 160],
      ],
    );
  });

  test("band sizes always add up to the exam blueprint", () => {
    for (const preset of EXAM_PRESETS) {
      const bands = preset.subjectSections ?? [];
      if (bands.length === 0) continue;
      const blueprint =
        preset.distribution.mcq +
        preset.distribution.numeric +
        preset.distribution.short +
        preset.distribution.long;
      assert.equal(
        sectionTotal(bands),
        blueprint,
        `${preset.id} bands cover ${sectionTotal(bands)} of ${blueprint} questions`,
      );
    }
  });

  test("bands cover question 1 through the last question with no gap or overlap", () => {
    const ranges = resolveSectionRanges(EAMCET);
    assert.equal(ranges[0]!.firstQuestion, 1);
    for (let i = 1; i < ranges.length; i++) {
      assert.equal(ranges[i]!.firstQuestion, ranges[i - 1]!.lastQuestion + 1);
    }
    assert.equal(ranges.at(-1)!.lastQuestion, sectionTotal(EAMCET));
  });
});

describe("type distribution across bands", () => {
  test("an all-MCQ blueprint splits into the band sizes", () => {
    const allocated = allocateSectionDistributions(
      { mcq: 160, numeric: 0, short: 0, long: 0 },
      EAMCET.map((band) => band.questionCount),
    );
    assert.deepEqual(allocated, [
      { mcq: 40, numeric: 0, short: 0, long: 0 },
      { mcq: 40, numeric: 0, short: 0, long: 0 },
      { mcq: 80, numeric: 0, short: 0, long: 0 },
    ]);
  });

  test("every band's blueprint fills its own size and the whole paper keeps its mix", () => {
    const total = { mcq: 30, numeric: 10, short: 8, long: 2 };
    const counts = [17, 13, 20];
    const allocated = allocateSectionDistributions(total, counts);
    assert.deepEqual(
      allocated.map(distributionTotal),
      counts,
      "a band blueprint must contain exactly its own question count",
    );
    for (const type of ["mcq", "numeric", "short", "long"] as const) {
      assert.equal(
        allocated.reduce((sum, distribution) => sum + distribution[type], 0),
        total[type],
        `${type} drifted when split across bands`,
      );
    }
  });

  test("marks are unchanged by splitting a blueprint across bands", () => {
    const marks = { mcq: 1, numeric: 4, short: 3, long: 5 };
    const total = { mcq: 30, numeric: 10, short: 8, long: 2 };
    const allocated = allocateSectionDistributions(total, [17, 13, 20]);
    assert.equal(
      allocated.reduce((sum, distribution) => sum + distributionMarks(distribution, marks), 0),
      distributionMarks(total, marks),
    );
  });

  test("a blueprint that does not match the bands is rejected", () => {
    assert.throws(
      () => allocateSectionDistributions({ mcq: 10, numeric: 0, short: 0, long: 0 }, [4, 4]),
      /cover 8 questions but the blueprint defines 10/,
    );
  });
});

describe("generation batches", () => {
  test("a band is split into batches that respect the per-call ceiling", () => {
    assert.deepEqual(chunkQuestionCounts(80, 20), [20, 20, 20, 20]);
    assert.deepEqual(chunkQuestionCounts(40, 20), [20, 20]);
  });

  test("batches never lose or invent a question and stay within one of each other", () => {
    for (const count of [1, 7, 20, 21, 40, 79, 160]) {
      const batches = chunkQuestionCounts(count, 20);
      assert.equal(
        batches.reduce((a, b) => a + b, 0),
        count,
        `${count} questions were not all batched`,
      );
      assert.ok(
        batches.every((size) => size <= 20),
        `${count} produced an oversized batch`,
      );
      assert.ok(
        Math.max(...batches) - Math.min(...batches) <= 1,
        `${count} produced lopsided batches: ${batches.join(",")}`,
      );
    }
  });

  test("splitting a band into batches preserves the band type mix", () => {
    const band = { mcq: 12, numeric: 4, short: 0, long: 0 };
    const batches = chunkQuestionCounts(16, 20);
    const allocated = allocateSectionDistributions(band, batches);
    for (const type of ["mcq", "numeric", "short", "long"] as const) {
      assert.equal(
        allocated.reduce((sum, distribution) => sum + distribution[type], 0),
        band[type],
        `${type} drifted across batches`,
      );
    }
  });
});

describe("printed order of a banded paper", () => {
  const questions = eamcetPaper();

  test("questions are numbered 1-160 in ascending order", () => {
    const order = inPrintedOrder(questions, EAMCET);
    assert.deepEqual(
      order.map((entry) => entry.number),
      Array.from({ length: 160 }, (_, index) => index + 1),
    );
  });

  test("each number falls inside its declared subject band", () => {
    const order = inPrintedOrder(questions, EAMCET);
    for (const { question, number } of order) {
      const band = resolveSectionRanges(EAMCET).find(
        (s) => number >= s.firstQuestion && number <= s.lastQuestion,
      )!;
      assert.equal(question.subject, band.subject, `Q${number} is not ${band.subject}`);
    }
  });

  test("the answer key uses the same numbering as the printed paper", () => {
    const key = buildAnswerKey(questions, EAMCET);
    assert.equal(key.length, 160);
    for (const entry of key) {
      assert.equal(entry.correctOption, "B", `Q${entry.questionNumber} lost its answer letter`);
    }
    assert.deepEqual(
      key.map((entry) => entry.questionNumber),
      inPrintedOrder(questions, EAMCET).map((entry) => entry.number),
    );
  });

  test("a paper stored out of order still prints in band order", () => {
    // Generation stamps and numbers a band contiguously, but an edited or
    // hand-ordered paper must print the bands, not its array order.
    const shuffled = [...questions].reverse();
    const order = inPrintedOrder(shuffled, EAMCET);
    assert.equal(order[0]!.question.subject, "Physics");
    assert.equal(order[40]!.question.subject, "Chemistry");
    assert.equal(order[80]!.question.subject, "Mathematics");
  });

  test("a question outside every band is still keyed, at the end", () => {
    const stray = { ...questions[0]!, id: 161, subject: "Astronomy" };
    const key = buildAnswerKey([...questions, stray], EAMCET);
    assert.equal(key.length, 161);
    assert.equal(key.at(-1)!.questionNumber, 161);
  });

  test("an unbanded paper keeps its type-major order", () => {
    const unbanded = questions.map((question) => ({ ...question, subject: undefined }));
    const order = inPrintedOrder(unbanded);
    assert.deepEqual(
      order.map((entry) => entry.number),
      Array.from({ length: 160 }, (_, index) => index + 1),
    );
  });
});

describe("answer key grid order", () => {
  test("a column holds its full share before the next column starts", () => {
    // 160 entries over 4 columns is 40 rows: Q1-Q40 down the first column, and
    // Q41 at the top of the second. This is the top-to-bottom reading order.
    const rows = keyColumnRows(160, 4);
    assert.equal(rows, 40);
    const columnOf = (number: number) => Math.floor((number - 1) / rows);
    assert.equal(columnOf(1), 0);
    assert.equal(columnOf(40), 0);
    assert.equal(columnOf(41), 1);
    assert.equal(columnOf(160), 3);
  });

  test("a partial last column never leaves an empty row", () => {
    assert.equal(keyColumnRows(10, 4), 3);
    assert.equal(keyColumnRows(3, 4), 1);
    assert.equal(keyColumnRows(0, 4), 0);
  });
});
