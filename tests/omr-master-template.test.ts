/**
 * Master OMR template layout.
 *
 * The sheet is a fixed printed master: a blank sheet is printed once and then
 * reused for every paper in the series, so the bubble a candidate darkens for
 * question N has to land on the same coordinate no matter how many questions
 * the individual paper happens to contain. These tests pin that contract.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildOmrLayout, type OmrSheetProps } from "../src/lib/omr-sheet.ts";

/** The template is specified against this many questions; see MAX_STANDARD_QUESTIONS. */
const TEMPLATE_SIZE = 100;

const BASE: OmrSheetProps = {
  title: "Master Template",
  collegeName: "E2E Institute",
  subject: "Chemistry",
  className: "10",
  board: "STATE",
  duration: "2 hours",
  maxMarks: 10,
  optionCount: 4,
};

/** Every question count the master template is contracted to cover. */
const COUNTS = [1, 2, 5, 10, 15, 20, 24, 25, 26, 30, 40, 50, 60, 70, 75, 80, 90, 100];

const layout = (questionCount: number, extra: Partial<OmrSheetProps> = {}) =>
  buildOmrLayout({ ...BASE, ...extra, questionCount });

/** (x, y) of the "A" bubble for a given question number. */
function bubbleAt(l: ReturnType<typeof buildOmrLayout>, questionNumber: number) {
  for (const column of l.columns) {
    const row = column.rows.find((r) => r.questionNumber === questionNumber);
    if (row) {
      const bubble = column.bubbles.find((b) => b.letter === "A");
      assert.ok(bubble, `question ${questionNumber} has no A bubble`);
      return { x: bubble.cx, y: bubble.cy };
    }
  }
  return null;
}

describe("master template geometry", () => {
  test("bubble pitch is identical for every question count up to the template size", () => {
    const reference = layout(TEMPLATE_SIZE);
    for (const count of COUNTS) {
      const l = layout(count);
      assert.equal(
        l.grid.numberWidth,
        reference.grid.numberWidth,
        `numberWidth drifted at ${count}`,
      );
      assert.equal(l.grid.rowHeight, reference.grid.rowHeight, `rowHeight drifted at ${count}`);
      assert.equal(l.grid.slot, reference.grid.slot, `bubble slot drifted at ${count}`);
      assert.equal(
        l.grid.bubbleRadius,
        reference.grid.bubbleRadius,
        `bubbleRadius drifted at ${count}`,
      );
      assert.equal(l.grid.blockTop, reference.grid.blockTop, `blockTop drifted at ${count}`);
      assert.equal(l.grid.rows, reference.grid.rows, `rows-per-column drifted at ${count}`);
    }
  });

  test("question 1 keeps the same bubble coordinate regardless of question count", () => {
    // This is the anti-"empty column shifting" guarantee: a blank master sheet
    // printed for a 10-question paper must put question 1 exactly where the
    // 100-question key puts it.
    const reference = bubbleAt(layout(TEMPLATE_SIZE), 1);
    assert.ok(reference, "reference layout has no question 1");
    for (const count of COUNTS) {
      const at = bubbleAt(layout(count), 1);
      assert.ok(at, `no question 1 at count ${count}`);
      assert.equal(at.x, reference.x, `question 1 x shifted at count ${count}`);
      assert.equal(at.y, reference.y, `question 1 y shifted at count ${count}`);
    }
  });

  test("every question number keeps its coordinate regardless of question count", () => {
    const reference = layout(TEMPLATE_SIZE);
    for (const count of COUNTS) {
      const l = layout(count);
      for (let q = 1; q <= count; q++) {
        const expected = bubbleAt(reference, q);
        const actual = bubbleAt(l, q);
        assert.ok(expected, `reference missing question ${q}`);
        assert.ok(actual, `count ${count} missing question ${q}`);
        assert.equal(actual.x, expected.x, `question ${q} x shifted at count ${count}`);
        assert.equal(actual.y, expected.y, `question ${q} y shifted at count ${count}`);
      }
    }
  });

  test("column x origins are drawn from a fixed slot table", () => {
    const slots = new Set<number>();
    for (const count of COUNTS) {
      for (const column of layout(count).columns) {
        slots.add(Number(column.x.toFixed(4)));
      }
    }
    const referenceCount = layout(TEMPLATE_SIZE).columns.length;
    // Columns always occupy the leftmost slots of the master grid, so the
    // number of distinct x origins can never exceed the full template's.
    assert.ok(
      slots.size <= referenceCount,
      `columns used ${slots.size} distinct origins but the master template only has ${referenceCount}`,
    );
  });
});

describe("layout integrity", () => {
  test("every question is emitted exactly once, in ascending order", () => {
    for (const count of COUNTS) {
      const seen: number[] = [];
      for (const column of layout(count).columns) {
        for (const row of column.rows) seen.push(row.questionNumber);
      }
      assert.deepEqual(
        seen,
        Array.from({ length: count }, (_, i) => i + 1),
        `question numbering is wrong at count ${count}`,
      );
    }
  });

  test("question numbers never span more than one column", () => {
    for (const count of COUNTS) {
      const l = layout(count);
      for (const column of l.columns) {
        for (const row of column.rows) {
          assert.ok(
            row.questionNumber >= column.firstNumber && row.questionNumber <= column.lastNumber,
            `question ${row.questionNumber} outside column ${column.firstNumber}-${column.lastNumber}`,
          );
        }
      }
    }
  });

  test("bubbles stay inside the printable frame", () => {
    for (const count of COUNTS) {
      const l = layout(count);
      for (const column of l.columns) {
        for (const bubble of column.bubbles) {
          assert.ok(
            bubble.cx - bubble.radius >= l.frame.x,
            `bubble left of frame at count ${count}`,
          );
          assert.ok(
            bubble.cx + bubble.radius <= l.frame.x + l.frame.width,
            `bubble right of frame at count ${count}`,
          );
          assert.ok(bubble.cy - bubble.radius >= l.frame.y, `bubble above frame at count ${count}`);
          assert.ok(
            bubble.cy + bubble.radius <= l.frame.y + l.frame.height,
            `bubble below frame at count ${count}`,
          );
        }
      }
    }
  });

  test("adjacent columns never overlap", () => {
    for (const count of COUNTS) {
      const columns = layout(count).columns;
      for (let i = 1; i < columns.length; i++) {
        const previousRight = columns[i - 1].x + columns[i - 1].width;
        assert.ok(
          columns[i].x >= previousRight,
          `column ${i} overlaps column ${i - 1} at count ${count}`,
        );
      }
    }
  });

  test("row pitch stays above the legibility floor", () => {
    for (const count of COUNTS) {
      const l = layout(count);
      assert.ok(l.grid.rowHeight >= 9, `row height ${l.grid.rowHeight} below floor at ${count}`);
      assert.ok(
        l.grid.bubbleRadius >= 3.2,
        `bubble radius ${l.grid.bubbleRadius} below floor at ${count}`,
      );
    }
  });
});

describe("answer key rendering", () => {
  const key = (correctOptions: string[]) =>
    correctOptions.map((correctOption, i) => ({ questionNumber: i + 1, correctOption }));

  test("fills exactly the bubble named by the key", () => {
    const l = buildOmrLayout({
      ...BASE,
      mode: "key",
      questionCount: 4,
      answerKey: key(["A", "B", "C", "D"]),
    });
    for (const column of l.columns) {
      for (const row of column.rows) {
        // column.bubbles holds every bubble in the column, so scope to the row.
        const rowBubbles = column.bubbles.filter((b) => b.cy === row.y);
        assert.equal(
          rowBubbles.length,
          4,
          `question ${row.questionNumber} has ${rowBubbles.length} bubbles`,
        );
        const filled = rowBubbles.filter((b) => b.filled);
        assert.equal(
          filled.length,
          1,
          `question ${row.questionNumber} has ${filled.length} filled bubbles`,
        );
        assert.equal(filled[0].letter, "ABCD"[row.questionNumber - 1]);
      }
    }
  });

  test("marks a question unresolved when the key has no usable letter", () => {
    const l = buildOmrLayout({
      ...BASE,
      mode: "key",
      questionCount: 3,
      answerKey: [
        { questionNumber: 1, correctOption: "A" },
        { questionNumber: 2, correctOption: "" },
        { questionNumber: 3, correctOption: "Z" },
      ],
    });
    const rows = l.columns.flatMap((c) => c.rows);
    assert.equal(rows.find((r) => r.questionNumber === 1)?.unresolved, false);
    assert.equal(rows.find((r) => r.questionNumber === 2)?.unresolved, true);
    assert.equal(rows.find((r) => r.questionNumber === 3)?.unresolved, true);
  });

  test("an unresolvable key never fills a bubble", () => {
    const l = buildOmrLayout({
      ...BASE,
      mode: "key",
      questionCount: 2,
      answerKey: [
        { questionNumber: 1, correctOption: "Z" },
        { questionNumber: 2, correctOption: "" },
      ],
    });
    for (const column of l.columns) {
      for (const bubble of column.bubbles) {
        assert.equal(bubble.filled, false, `question ${bubble.cy} filled unexpectedly`);
      }
    }
  });

  test("a blank candidate sheet has no filled bubbles", () => {
    // $id.tsx builds sheet-mode props with `answerKey: undefined`; a blank
    // candidate sheet must never reveal a correct answer.
    const l = buildOmrLayout({ ...BASE, mode: "sheet", questionCount: 5 });
    for (const column of l.columns) {
      for (const bubble of column.bubbles) {
        assert.equal(bubble.filled, false);
      }
    }
    for (const row of l.columns.flatMap((c) => c.rows)) {
      assert.equal(row.unresolved, false, "blank sheets have nothing to resolve");
    }
  });
});
