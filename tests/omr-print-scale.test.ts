/**
 * Canvas painting scale.
 *
 * The sheet is a printed master: the scanner is calibrated against exact pixel
 * coordinates, so the painter has to fill its canvas at the requested scale and
 * nothing else. These tests pin the transform the painter applies, which is
 * where a sheet silently ends up drawn into a corner of an oversized bitmap
 * instead of filling it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildOmrLayout, drawOmrLayout, type OmrSheetProps } from "../src/lib/omr-sheet.ts";

const BASE: OmrSheetProps = {
  title: "Print Scale",
  collegeName: "E2E Institute",
  questionCount: 20,
  optionCount: 4,
};

type Rect = { x: number; y: number; w: number; h: number; t: number[] };
type Arc = { cx: number; cy: number; r: number; t: number[] };
type Text = { text: string; x: number; y: number; t: number[] };

/**
 * A 2D context that records the device-space extent of what was drawn, which
 * is the only thing that matters here: whether the ink covers the bitmap it is
 * painted onto, where each bubble actually lands, and what text is printed on
 * top of it.
 */
function recordingContext() {
  const rects: Rect[] = [];
  const arcs: Arc[] = [];
  const texts: Text[] = [];
  let m = [1, 0, 0, 1, 0, 0];

  const base: Record<string, unknown> = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    rect() {},
    roundRect() {},
    stroke() {},
    fill() {},
    clip() {},
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, t: [...m] });
    },
    strokeText() {},
    measureText: () => ({ width: 0 }),
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      m = [a, b, c, d, e, f];
    },
    scale(sx: number, sy: number) {
      m = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]];
    },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, t: [...m] });
    },
    strokeRect() {},
    arc(cx: number, cy: number, r: number) {
      arcs.push({ cx, cy, r, t: [...m] });
    },
  };

  const ctx = new Proxy(base, {
    get: (target, prop: string) => (prop in target ? target[prop] : () => {}),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;

  return { ctx, rects, arcs, texts };
}

/** Device-space bounding box of everything drawn. */
function inkExtent(rects: Rect[]) {
  const right = Math.max(...rects.map((r) => r.t[0] * (r.x + r.w) + r.t[4]));
  const bottom = Math.max(...rects.map((r) => r.t[3] * (r.y + r.h) + r.t[5]));
  const left = Math.min(...rects.map((r) => r.t[0] * r.x + r.t[4]));
  const top = Math.min(...rects.map((r) => r.t[3] * r.y + r.t[5]));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

const SCALES = [1, 2, 3, 300 / 96];

describe("painter scale", () => {
  for (const scale of SCALES) {
    test(`the sheet fills the whole canvas at scale ${scale}`, () => {
      const layout = buildOmrLayout(BASE);
      const { ctx, rects } = recordingContext();
      drawOmrLayout(ctx, layout, { scale });

      const canvasWidth = Math.round(layout.page.width * scale);
      const canvasHeight = Math.round(layout.page.height * scale);
      const extent = inkExtent(rects);

      assert.ok(
        Math.abs(extent.width - canvasWidth) <= 1,
        `ink is ${extent.width}px wide but the canvas is ${canvasWidth}px`,
      );
      assert.ok(
        Math.abs(extent.height - canvasHeight) <= 1,
        `ink is ${extent.height}px tall but the canvas is ${canvasHeight}px`,
      );
    });

    test(`the page background is painted at the full canvas size at scale ${scale}`, () => {
      const layout = buildOmrLayout(BASE);
      const { ctx, rects } = recordingContext();
      drawOmrLayout(ctx, layout, { scale });

      // The first fillRect is the opaque page background.
      const background = rects[0];
      const painted = background.t[0] * background.w;
      assert.ok(
        Math.abs(painted - layout.page.width * scale) < 1e-9,
        `the page background spans ${painted}px, expected ${layout.page.width * scale}px`,
      );
    });
  }

  test("an omitted scale paints in page units", () => {
    const layout = buildOmrLayout(BASE);
    const { ctx, rects } = recordingContext();
    drawOmrLayout(ctx, layout);
    const extent = inkExtent(rects);
    assert.ok(Math.abs(extent.width - layout.page.width) <= 1);
    assert.ok(Math.abs(extent.height - layout.page.height) <= 1);
  });

  test("a pre-scaled context is not shrunk back to page units", () => {
    // This is the regression: the painter used to reset the transform to
    // identity, discarding the caller's scale and leaving the sheet drawn 1:1
    // in the top-left corner of an oversized canvas.
    const layout = buildOmrLayout(BASE);
    const { ctx, rects } = recordingContext();
    ctx.save();
    ctx.scale(2, 2);
    drawOmrLayout(ctx, layout, { scale: 2 });
    ctx.restore();

    const extent = inkExtent(rects);
    assert.ok(
      Math.abs(extent.width - Math.round(layout.page.width * 2)) <= 1,
      `pre-scaled context drew only ${extent.width}px of a ${Math.round(layout.page.width * 2)}px canvas`,
    );
  });
});

describe("calibration is scale-invariant", () => {
  test("every bubble lands at its layout coordinate times the scale", () => {
    for (const scale of SCALES) {
      const layout = buildOmrLayout(BASE);
      const { ctx, arcs } = recordingContext();
      drawOmrLayout(ctx, layout, { scale });

      const expected = layout.columns.flatMap((c) => c.bubbles);
      assert.equal(arcs.length, expected.length, `arc count drifted at scale ${scale}`);

      for (let i = 0; i < expected.length; i++) {
        const bubble = expected[i];
        const arc = arcs[i];
        // Geometry is always passed in page units; the transform is what turns
        // it into device pixels, and that it is non-identity is the whole point.
        assert.equal(arc.t[0], scale, `x scale is not ${scale}`);
        assert.equal(arc.t[3], scale, `y scale is not ${scale}`);
        assert.equal(arc.cx, bubble.cx, `bubble ${bubble.letter} x drifted at scale ${scale}`);
        assert.equal(arc.cy, bubble.cy, `bubble ${bubble.letter} y drifted at scale ${scale}`);
        assert.equal(arc.r, bubble.radius, `bubble ${bubble.letter} radius drifted`);
        // Equal x and y scale is what keeps the bubbles and the corner marks
        // circular rather than elliptical at print resolution.
        assert.ok(
          Math.abs(arc.r * arc.t[0] - bubble.radius * scale) < 1e-9,
          `bubble ${bubble.letter} is not round at scale ${scale}`,
        );
      }
    }
  });

  test("the sheet keeps its aspect ratio at every scale", () => {
    const reference = buildOmrLayout(BASE);
    const expected = reference.page.width / reference.page.height;
    for (const scale of SCALES) {
      const { ctx, rects } = recordingContext();
      drawOmrLayout(ctx, reference, { scale });
      const extent = inkExtent(rects);
      const actual = extent.width / extent.height;
      assert.ok(
        Math.abs(actual - expected) < 0.001,
        `aspect ratio warped to ${actual} at scale ${scale}, expected ${expected}`,
      );
    }
  });

  test("the corner fiducials stay square", () => {
    for (const scale of SCALES) {
      const layout = buildOmrLayout(BASE);
      const { ctx, rects } = recordingContext();
      drawOmrLayout(ctx, layout, { scale });
      // The four corner marks are the first fills after the page background.
      const marks = rects.slice(1, 5);
      assert.equal(marks.length, 4, `expected 4 corner marks at scale ${scale}`);
      for (const mark of marks) {
        const deviceWidth = mark.t[0] * mark.w;
        const deviceHeight = mark.t[3] * mark.h;
        assert.equal(mark.t[0], mark.t[3], `corner mark is scaled unevenly at scale ${scale}`);
        assert.ok(
          Math.abs(deviceWidth - deviceHeight) < 1e-9,
          `corner mark is not square at scale ${scale}`,
        );
      }
    }
  });
});

describe("question numbering", () => {
  /** Every text run in the sheet, in page units. */
  function drawTexts(props: Partial<OmrSheetProps> = {}) {
    const layout = buildOmrLayout({ ...BASE, ...props });
    const { ctx, texts } = recordingContext();
    drawOmrLayout(ctx, layout);
    return { layout, texts };
  }

  /**
   * Text runs that sit on a grid row. Scoping by row baseline matters: the
   * institute name is painted one character at a time, so a sheet named
   * "E2E Institute" emits a bare "2" as its own text run.
   */
  function numbersOnRows(layout: ReturnType<typeof buildOmrLayout>, texts: Text[]) {
    const rowYs = new Set(layout.columns.flatMap((c) => c.rows.map((r) => Math.round(r.y * 1000))));
    return texts.filter((t) => rowYs.has(Math.round(t.y * 1000)));
  }

  for (const count of [1, 4, 20, 30, 60, 100, 160]) {
    test(`each of the ${count} question numbers is drawn exactly once`, () => {
      const { layout, texts } = drawTexts({ questionCount: count });
      const numbers = numbersOnRows(layout, texts);

      assert.equal(
        numbers.length,
        count,
        `expected ${count} question numbers but drew ${numbers.length}: ${
          numbers.map((n) => n.text).join(",") || "none"
        }`,
      );

      // Exactly the sheet's questions, in order, with no repeats.
      assert.deepEqual(
        numbers.map((n) => Number(n.text)),
        Array.from({ length: count }, (_, i) => i + 1),
        "the drawn question numbers are not 1..count in ascending order",
      );

      // One number per cell: columns sit side by side and share row baselines,
      // so a cell is identified by both x and y. Two numbers in one cell is the
      // duplicated label this guards against.
      const cells = new Map<string, string[]>();
      for (const number of numbers) {
        const key = `${Math.round(number.x * 1000)}:${Math.round(number.y * 1000)}`;
        cells.set(key, [...(cells.get(key) ?? []), number.text]);
      }
      assert.equal(cells.size, count, "two question numbers share a cell");
      for (const [key, drawn] of cells) {
        assert.equal(drawn.length, 1, `cell ${key} drew ${drawn.length} numbers: ${drawn}`);
      }

      // Each number sits in its own column's Q.No. gutter.
      const columnXs = new Set(layout.columns.map((c) => Math.round(c.x * 1000)));
      for (const number of numbers) {
        const owner = layout.columns.find(
          (c) => Math.round(c.x * 1000) <= Math.round(number.x * 1000),
        );
        assert.ok(owner, "a question number was drawn outside every column");
        assert.ok(
          columnXs.has(Math.round(owner.x * 1000)),
          "a question number was not aligned to a column",
        );
      }
    });
  }

  test("a tall grid no longer adds a faint second number", () => {
    // rowHeight is at or above the old 19px threshold for every sheet size, so
    // the duplicate was never actually conditional - it was always drawn.
    for (const count of [1, 20, 100, 160]) {
      const { layout, texts } = drawTexts({ questionCount: count });
      assert.ok(layout.grid.rowHeight >= 19, `row height unexpectedly dropped at ${count}`);
      assert.equal(
        numbersOnRows(layout, texts).length,
        count,
        `duplicated numbers at ${count} questions`,
      );
    }
  });

  test("the unresolved marker is still drawn beside its number", () => {
    const { layout, texts } = drawTexts({
      questionCount: 3,
      mode: "key",
      answerKey: [
        { questionNumber: 1, correctOption: "A" },
        { questionNumber: 2, correctOption: "" },
        { questionNumber: 3, correctOption: "A" },
      ],
    });
    const marks = texts.filter((t) => t.text === "?");
    assert.equal(marks.length, 1, "expected exactly one unresolved marker");
    const unresolvedRow = layout.columns.flatMap((c) => c.rows).find((r) => r.unresolved);
    assert.ok(unresolvedRow, "layout did not flag the unresolved row");
    assert.equal(marks[0].y, unresolvedRow.y, "the marker is not on the unresolved row");
  });

  test("the Q.No. header is still drawn once per column", () => {
    const { layout, texts } = drawTexts({ questionCount: 100 });
    const headers = texts.filter((t) => t.text === "Q.No.");
    assert.equal(headers.length, layout.columns.length);
  });
});
