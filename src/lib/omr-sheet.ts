/**
 * OMR sheet rendering.
 *
 * The sheet is described once as a plain layout model (pure data, no DOM) and
 * then painted onto an HTML5 canvas. Preview, print and the downloaded image
 * all run through the same model and the same painter, so the bubble a reviewer
 * sees is the bubble a scanner reads. Canvas is the renderer on purpose: there
 * is no SVG in the DOM, no rasteriser dependency, and every bubble lands on an
 * exact pixel coordinate that an OMR reader can be calibrated against.
 */

/** One OMR-readable key entry: question number -> correct option letter. */
export type OmrAnswer = { questionNumber: number; correctOption: string };

/** "sheet" is the blank candidate sheet, "key" the master sheet with answers bubbled in. */
export type OmrSheetMode = "sheet" | "key";

export type OmrImageType = "png" | "jpeg";

export type OmrSheetProps = {
  mode?: OmrSheetMode;
  title: string;
  collegeName?: string;
  subject?: string;
  className?: string;
  board?: string;
  duration?: string;
  examDate?: string;
  maxMarks?: number;
  questionCount: number;
  optionCount?: number;
  negativeMarking?: number;
  answerKey?: OmrAnswer[];
};

export type OmrBubble = {
  cx: number;
  cy: number;
  radius: number;
  letter: string;
  filled: boolean;
};

export type OmrRow = {
  questionNumber: number;
  serial: number;
  y: number;
  /** The key has an entry for this number but no resolvable option letter. */
  unresolved: boolean;
};

export type OmrColumn = {
  x: number;
  width: number;
  firstNumber: number;
  lastNumber: number;
  labelY: number;
  bandY: number;
  bandHeight: number;
  rows: OmrRow[];
  bubbles: OmrBubble[];
};

export type OmrField = { x: number; y: number; width: number; height: number; label: string };

export type OmrChip = {
  x: number;
  y: number;
  width: number;
  height: number;
  questionNumber: number;
  letter: string;
};

export type OmrLayout = {
  mode: OmrSheetMode;
  page: { width: number; height: number };
  frame: { x: number; y: number; width: number; height: number };
  content: { x: number; width: number };
  letters: string[];
  institute: string;
  instituteY: number;
  headline: string;
  headlineY: number;
  examTitle: string;
  examTitleY: number;
  details: string[];
  detailsY: number;
  ruleY: number;
  fields: OmrField[];
  instructions: { lines: string[]; x: number; y: number; width: number; height: number };
  grid: {
    x: number;
    y: number;
    width: number;
    height: number;
    blockTop: number;
    blockHeight: number;
    rows: number;
    rowHeight: number;
    numberWidth: number;
    slot: number;
    bubbleRadius: number;
  };
  columns: OmrColumn[];
  columnGap: number;
  summary: {
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    chips: OmrChip[];
  } | null;
  footer: { ruleY: number; textY: number; right: string };
};

/** A4 at 96dpi: the design space every measurement below is expressed in. */
const PAGE = { width: 794, height: 1123 };
const FRAME_INSET = 24;
const FRAME = {
  x: FRAME_INSET,
  y: FRAME_INSET,
  width: PAGE.width - FRAME_INSET * 2,
  height: PAGE.height - FRAME_INSET * 2,
};
const CONTENT = { x: FRAME.x + 20, width: FRAME.width - 40 };
const CORNER_MARK = 26;
const EDGE_MARK = 16;
const COLUMN_GAP = 10;
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const HEADLINES: Record<OmrSheetMode, string> = {
  sheet: "OMR ANSWER SHEET",
  key: "BUBBLED OMR KEY",
};
const FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
const INK = "#111111";
const SUBTLE = "#5a5a5a";
const BAND = "#e8e8e8";
const HAIRLINE = "#9a9a9a";
const TAU = Math.PI * 2;

/** 300dpi print scale, so a downloaded image is print-ready rather than screen-sized. */
export const OMR_PRINT_SCALE = 300 / 96;

/** Fixed maximum question count for master template layout - ensures invariant dimensions regardless of actual question count. */
const MAX_STANDARD_QUESTIONS = 100;

const INSTRUCTIONS: Record<OmrSheetMode, string[]> = {
  sheet: [
    "Use only a black or blue ball point pen. Darken the bubble completely in a single stroke.",
    "Fill exactly one bubble per question. Partial, multiple or crossed bubbles are treated as incorrect.",
    "Do not fold, staple or make stray marks inside the bubble area. Rough work anywhere else is not permitted.",
  ],
  key: [
    "Master answer key for automated evaluation. The filled bubble under each number is the correct option.",
    "Hollow bubbles carry no value. A '?' beside a number means the key held no resolvable option for it.",
    "Do not issue this sheet to candidates. Verify it against the answer key in the exam package JSON.",
  ],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function text(value: string | number | undefined, fallback = ""): string {
  const raw = value == null ? "" : String(value).trim();
  return raw || fallback;
}

function detailsSegments(props: OmrSheetProps, count: number): string[] {
  const segments = [
    text(props.subject) && `Subject: ${text(props.subject)}`,
    text(props.className) && `Class: ${text(props.className)}`,
    text(props.board) && `Board: ${text(props.board)}`,
    text(props.duration) && `Duration: ${text(props.duration)}`,
    text(props.examDate) && `Date: ${text(props.examDate)}`,
    Number(props.maxMarks) > 0 && `Max Marks: ${Number(props.maxMarks)}`,
    count > 0 && `${count} Questions`,
    Number(props.negativeMarking) > 0 && `-${Number(props.negativeMarking)} per wrong answer`,
  ];
  return segments.filter((segment): segment is string => Boolean(segment));
}

/**
 * Build the complete sheet geometry. Pure: no canvas, no DOM, so the same model
 * drives the on-screen preview, the printed page and the downloaded image.
 */
export function buildOmrLayout(props: OmrSheetProps): OmrLayout {
  const mode: OmrSheetMode = props.mode === "key" ? "key" : "sheet";
  const count = Math.max(0, Math.floor(Number(props.questionCount) || 0));
  // Use fixed maximum for layout calculations to ensure invariant master template dimensions
  const layoutCount = Math.max(count, MAX_STANDARD_QUESTIONS);
  const letters = LETTERS.slice(
    0,
    clamp(Math.round(Number(props.optionCount) || 4), 2, LETTERS.length),
  );

  const keyLetters = new Map<number, string>();
  for (const entry of props.answerKey ?? []) {
    const questionNumber = Math.round(Number(entry.questionNumber) || 0);
    if (questionNumber <= 0) continue;
    const letter = String(entry.correctOption ?? "")
      .trim()
      .toUpperCase();
    keyLetters.set(questionNumber, letters.includes(letter) ? letter : "");
  }

  const institute = text(props.collegeName).toUpperCase();
  const instituteY = FRAME.y + 44;
  const headlineY = instituteY + (institute ? 36 : 16);
  const examTitleY = headlineY + 26;
  const detailsY = examTitleY + 20;
  const ruleY = detailsY + 12;

  const fieldY = ruleY + 10;
  const fieldHeight = 44;
  const fieldGap = 8;
  const fieldSpec: { label: string; weight: number }[] = [
    { label: "CANDIDATE NAME", weight: 2.4 },
    { label: "ROLL NUMBER", weight: 1.3 },
    { label: "CLASS / SECTION", weight: 1.3 },
    { label: "DATE", weight: 1.2 },
  ];
  const fieldTotal = fieldSpec.reduce((sum, field) => sum + field.weight, 0);
  const fieldSpan = CONTENT.width - fieldGap * (fieldSpec.length - 1);
  let fieldCursor = CONTENT.x;
  const fields: OmrField[] = fieldSpec.map((field) => {
    const width = (fieldSpan * field.weight) / fieldTotal;
    const cell: OmrField = {
      x: fieldCursor,
      y: fieldY,
      width,
      height: fieldHeight,
      label: field.label,
    };
    fieldCursor += width + fieldGap;
    return cell;
  });

  const instructionLines = INSTRUCTIONS[mode];
  const instructions = {
    lines: instructionLines,
    x: CONTENT.x,
    y: fieldY + fieldHeight + 10,
    width: CONTENT.width,
    height: instructionLines.length * 12 + 20,
  };

  const footerRuleY = FRAME.y + FRAME.height - 34;

  let summary: OmrLayout["summary"] = null;
  if (mode === "key" && count > 0) {
    const chipWidth = 36;
    const chipHeight = 16;
    const chipGap = 6;
    const perRow = Math.max(6, Math.floor((CONTENT.width + chipGap) / (chipWidth + chipGap)));
    const chipRows = Math.ceil(count / perRow);
    const height = 18 + chipRows * (chipHeight + 4);
    if (height <= 150) {
      const top = instructions.y + instructions.height + 16;
      const chips: OmrChip[] = [];
      for (let questionNumber = 1; questionNumber <= count; questionNumber++) {
        const index = questionNumber - 1;
        const row = Math.floor(index / perRow);
        const column = index % perRow;
        const inRow = Math.min(perRow, count - row * perRow);
        const rowWidth = inRow * chipWidth + (inRow - 1) * chipGap;
        chips.push({
          x: CONTENT.x + (CONTENT.width - rowWidth) / 2 + column * (chipWidth + chipGap),
          y: top + 18 + row * (chipHeight + 4),
          width: chipWidth,
          height: chipHeight,
          questionNumber,
          letter: keyLetters.get(questionNumber) ?? "",
        });
      }
      summary = {
        label: "KEY SUMMARY  -  FILLED BUBBLE = CORRECT OPTION",
        x: CONTENT.x,
        y: top,
        width: CONTENT.width,
        height,
        chips,
      };
    }
  }

  const gridTop = instructions.y + instructions.height + (summary ? summary.height + 14 : 18);
  const gridBottom = footerRuleY - 14;
  const gridHeight = Math.max(120, gridBottom - gridTop);

  const numberWidth = Math.min(34, 18 + String(Math.max(layoutCount, 1)).length * 4.5);
  const baseRowHeight = 27;
  /** Row height a well filled paper aims for, and the floor the fit test uses. */
  const minRowHeight = 16;
  /** Absolute floor: the minimum row at which two bubble rows do not merge. */
  const hardRowHeight = 9;
  const headerBlockHeight = 16 + 20 + 8;
  // The per-column caption and option band are taken out of the grid before the
  // row height is divided, otherwise the block grows taller than the space it
  // was measured against and the last rows fall off the page.
  const rowsHeight = Math.max(hardRowHeight, gridHeight - headerBlockHeight);
  const maxRows = Math.max(1, Math.floor(rowsHeight / baseRowHeight));
  const rowsPerColumn = Math.max(1, Math.floor(rowsHeight / minRowHeight));
  // How many columns the content width can carry, at a given option slot floor.
  // The floor is lowered one rung at a time and only while the questions still
  // fit at a comfortable row height, because a slightly tighter bubble is still
  // readable whereas a row that runs off the bottom of the page is not
  // recoverable. The last rung is the point of no return.
  let minColumnWidth = 0;
  let maxColumns = 1;
  for (const slotFloor of [18, 16, 14, 12, 10]) {
    minColumnWidth = numberWidth + 8 + letters.length * slotFloor;
    maxColumns = Math.max(
      1,
      Math.floor((CONTENT.width + COLUMN_GAP) / (minColumnWidth + COLUMN_GAP)),
    );
    if (layoutCount <= maxColumns * rowsPerColumn) break;
  }

  let columnCount = layoutCount > 0 ? clamp(Math.ceil(layoutCount / maxRows), 1, maxColumns) : 1;
  // A paper with no multiple choice questions still lays out one empty column:
  // a zero column grid would leave the option band unpainted, and any consumer
  // reading the first column would have nothing to read.
  let rows =
    layoutCount > 0
      ? Math.max(Math.ceil(layoutCount / columnCount), Math.ceil(layoutCount / maxColumns))
      : 0;
  columnCount = rows > 0 ? Math.ceil(layoutCount / rows) : 1;

  let columnWidth = minColumnWidth;
  let slot = 18;
  for (let attempt = 0; attempt < 3; attempt++) {
    const available = (CONTENT.width - COLUMN_GAP * (columnCount - 1)) / columnCount;
    const fitted = (available - numberWidth - 8) / letters.length;
    slot = clamp(fitted, 8, 46);
    columnWidth = numberWidth + 8 + slot * letters.length;
    // Spend leftover width on another column rather than a narrow block in the
    // middle of the page, but only once a block is genuinely taller than wide.
    const groupWidth = columnWidth * columnCount + COLUMN_GAP * (columnCount - 1);
    if (groupWidth < CONTENT.width * 0.62 && columnCount < maxColumns && layoutCount > 25) {
      columnCount += 1;
      rows = Math.max(1, Math.ceil(layoutCount / columnCount));
      continue;
    }
    // Never let a clamped slot push the block past the printable width.
    if (columnWidth > available) {
      slot = Math.max(6, fitted);
      columnWidth = numberWidth + 8 + slot * letters.length;
    }
    break;
  }

  // minRowHeight is the target, hardRowHeight the last resort for a paper that
  // cannot fit any other way; either way the block never leaves the frame.
  const rowHeight = clamp(rowsHeight / Math.max(rows, 1), hardRowHeight, 32);
  const blockRowsHeight = rowHeight * rows;
  const blockHeight = headerBlockHeight + blockRowsHeight;
  const blockTop = gridTop + Math.max(0, (gridHeight - blockHeight) / 2);
  const bubbleRadius = clamp(Math.min(rowHeight / 2 - 4, slot / 2 - 2.2), 3.2, 8.5);
  const groupWidth = columnWidth * columnCount + COLUMN_GAP * (columnCount - 1);
  const originX = CONTENT.x + Math.max(0, (CONTENT.width - groupWidth) / 2);
  const rowsTop = blockTop + headerBlockHeight;

  const columns: OmrColumn[] = [];
  for (let index = 0; index < columnCount; index++) {
    const first = index * rows + 1;
    // Only generate columns that will have actual questions
    if (first > count) break;
    const last = Math.min(count, first + rows - 1);
    const x = originX + index * (columnWidth + COLUMN_GAP);
    const columnRows: OmrRow[] = [];
    const columnBubbles: OmrBubble[] = [];
    for (let questionNumber = first; questionNumber <= last; questionNumber++) {
      const y = rowsTop + (questionNumber - first) * rowHeight + rowHeight / 2;
      const answer = keyLetters.get(questionNumber);
      columnRows.push({
        questionNumber,
        serial: questionNumber,
        y,
        unresolved: mode === "key" && answer === "",
      });
      letters.forEach((letter, letterIndex) => {
        columnBubbles.push({
          cx: x + numberWidth + 8 + (letterIndex + 0.5) * slot,
          cy: y,
          radius: bubbleRadius,
          letter,
          filled: answer === letter,
        });
      });
    }
    // Only push column if it has actual questions
    if (columnRows.length > 0) {
      columns.push({
        x,
        width: columnWidth,
        firstNumber: first,
        lastNumber: last,
        labelY: blockTop + 10,
        bandY: blockTop + 16,
        bandHeight: 20,
        rows: columnRows,
        bubbles: columnBubbles,
      });
    }
  }

  return {
    mode,
    page: PAGE,
    frame: FRAME,
    content: CONTENT,
    letters,
    institute,
    instituteY,
    headline: HEADLINES[mode],
    headlineY,
    examTitle: text(props.title, "Examination"),
    examTitleY,
    details: detailsSegments(props, count),
    detailsY,
    ruleY,
    fields,
    instructions,
    grid: {
      x: CONTENT.x,
      y: gridTop,
      width: CONTENT.width,
      height: gridHeight,
      blockTop,
      blockHeight,
      rows,
      rowHeight,
      numberWidth,
      slot,
      bubbleRadius,
    },
    columns,
    columnGap: COLUMN_GAP,
    summary,
    footer: {
      ruleY: footerRuleY,
      textY: footerRuleY + 16,
      right: count > 0 ? `Page 1 of 1  |  ${count} questions` : "Page 1 of 1",
    },
  };
}

function setFont(ctx: CanvasRenderingContext2D, size: number, weight: number | string = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

/** Largest size at or below `size` whose rendered text fits `maxWidth`. */
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  size: number,
  weight: number | string,
  min: number,
): number {
  let current = size;
  while (current > min) {
    setFont(ctx, current, weight);
    if (ctx.measureText(value).width <= maxWidth) return current;
    current -= 0.5;
  }
  setFont(ctx, current, weight);
  return current;
}

function drawCentered(ctx: CanvasRenderingContext2D, value: string, x: number, y: number) {
  ctx.textAlign = "center";
  ctx.fillText(value, x, y);
}

/** Letter-spaced text, drawn glyph by glyph because canvas tracking is patchy. */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  value: string,
  centerX: number,
  y: number,
  spacing: number,
): number {
  const glyphs = [...value];
  const total =
    glyphs.reduce((sum, glyph) => sum + ctx.measureText(glyph).width, 0) +
    spacing * Math.max(0, glyphs.length - 1);
  let cursor = centerX - total / 2;
  ctx.textAlign = "left";
  for (const glyph of glyphs) {
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + spacing;
  }
  return total;
}

/** Trim a sentence to a single line, marking it when words had to be dropped. */
function fitLine(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  const words = value.split(/\s+/).filter(Boolean);
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) break;
    line = candidate;
  }
  return `${line.replace(/[,.]$/, "")} ...`;
}

function strokeRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(Math.round(x) + 0.5 * lineWidth, Math.round(y) + 0.5 * lineWidth, width, height);
}

function drawFrame(ctx: CanvasRenderingContext2D, layout: OmrLayout) {
  const { frame } = layout;
  strokeRect(ctx, frame.x, frame.y, frame.width, frame.height, INK, 2);
  strokeRect(ctx, frame.x + 7, frame.y + 7, frame.width - 14, frame.height - 14, HAIRLINE, 0.8);

  ctx.fillStyle = INK;
  const corners: [number, number][] = [
    [frame.x, frame.y],
    [frame.x + frame.width, frame.y],
    [frame.x, frame.y + frame.height],
    [frame.x + frame.width, frame.y + frame.height],
  ];
  for (const [cx, cy] of corners) {
    ctx.fillRect(cx - CORNER_MARK / 2, cy - CORNER_MARK / 2, CORNER_MARK, CORNER_MARK);
  }
  const midY = frame.y + frame.height / 2;
  for (const cx of [frame.x, frame.x + frame.width]) {
    ctx.fillRect(cx - EDGE_MARK / 2, midY - EDGE_MARK / 2, EDGE_MARK, EDGE_MARK);
  }
}

function drawHeader(ctx: CanvasRenderingContext2D, layout: OmrLayout) {
  const { content } = layout;
  const centerX = content.x + content.width / 2;
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  if (layout.institute) {
    const size = fitFontSize(ctx, layout.institute, content.width, 21, 700, 10);
    drawTracked(ctx, layout.institute, centerX, layout.instituteY, size * 0.09);
  }

  const headlineSize = fitFontSize(ctx, layout.headline, content.width * 0.9, 26, 700, 14);
  setFont(ctx, headlineSize, 700);
  const headlineWidth = drawTracked(ctx, layout.headline, centerX, layout.headlineY, 2);
  const flank = (content.width - headlineWidth) / 2;
  if (flank > 40) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(content.x, layout.headlineY - headlineSize * 0.32);
    ctx.lineTo(content.x + flank - 16, layout.headlineY - headlineSize * 0.32);
    ctx.moveTo(centerX + headlineWidth / 2 + 16, layout.headlineY - headlineSize * 0.32);
    ctx.lineTo(content.x + content.width, layout.headlineY - headlineSize * 0.32);
    ctx.stroke();
  }

  const titleSize = fitFontSize(ctx, layout.examTitle, content.width * 0.94, 16, 700, 10);
  drawCentered(ctx, layout.examTitle, centerX, layout.examTitleY);

  // Exam details are dropped from the end rather than shrunk into unreadability.
  let details = layout.details;
  let size = 11.5;
  setFont(ctx, size, 400);
  while (details.length > 1 && ctx.measureText(details.join("  •  ")).width > content.width) {
    details = details.slice(0, -1);
    size = Math.max(8.5, size - 0.5);
    setFont(ctx, size, 400);
  }
  ctx.fillStyle = SUBTLE;
  drawCentered(ctx, details.join("  •  "), centerX, layout.detailsY);
  ctx.fillStyle = INK;

  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(content.x, layout.ruleY);
  ctx.lineTo(content.x + content.width, layout.ruleY);
  ctx.stroke();
}

function drawFields(ctx: CanvasRenderingContext2D, layout: OmrLayout) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const field of layout.fields) {
    strokeRect(ctx, field.x, field.y, field.width, field.height, "#333333", 1);
    setFont(ctx, 8.5, 700);
    ctx.fillStyle = SUBTLE;
    ctx.fillText(field.label, field.x + 7, field.y + 13);
    ctx.fillStyle = INK;
  }
}

function drawInstructions(ctx: CanvasRenderingContext2D, layout: OmrLayout) {
  const { instructions } = layout;
  strokeRect(
    ctx,
    instructions.x,
    instructions.y,
    instructions.width,
    instructions.height,
    HAIRLINE,
    0.9,
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 8.5, 700);
  ctx.fillText("INSTRUCTIONS", instructions.x + 8, instructions.y + 14);
  setFont(ctx, 9.5, 400);
  instructions.lines.forEach((line, index) => {
    ctx.fillText(
      fitLine(ctx, line, instructions.width - 18),
      instructions.x + 8,
      instructions.y + 29 + index * 12,
    );
  });
}

function drawGrid(ctx: CanvasRenderingContext2D, layout: OmrLayout) {
  const { grid, columnGap } = layout;

  layout.columns.forEach((column, index) => {
    if (index > 0) {
      ctx.strokeStyle = HAIRLINE;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      const dividerX = column.x - columnGap / 2;
      ctx.moveTo(dividerX, grid.blockTop);
      ctx.lineTo(dividerX, grid.blockTop + grid.blockHeight);
      ctx.stroke();
    }

    setFont(ctx, 8.5, 700);
    ctx.fillStyle = SUBTLE;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    drawCentered(
      ctx,
      column.rows.length === 0
        ? "NO QUESTIONS"
        : column.firstNumber === column.lastNumber
          ? `QUESTION ${column.firstNumber}`
          : `QUESTIONS ${column.firstNumber} - ${column.lastNumber}`,
      column.x + column.width / 2,
      column.labelY,
    );

    ctx.fillStyle = BAND;
    ctx.fillRect(column.x, column.bandY, column.width, column.bandHeight);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(column.x, column.bandY + column.bandHeight);
    ctx.lineTo(column.x + column.width, column.bandY + column.bandHeight);
    ctx.stroke();

    setFont(ctx, 9, 700);
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("Q.No.", column.x + grid.numberWidth - 2, column.bandY + column.bandHeight / 2);
    ctx.textAlign = "center";
    layout.letters.forEach((letter, letterIndex) => {
      const cx = column.x + grid.numberWidth + 8 + (letterIndex + 0.5) * grid.slot;
      ctx.fillText(letter, cx, column.bandY + column.bandHeight / 2);
    });

    ctx.textBaseline = "middle";
    for (const row of column.rows) {
      if (grid.rowHeight >= 19) {
        setFont(ctx, 7.5, 400);
        ctx.fillStyle = SUBTLE;
        ctx.textAlign = "left";
        ctx.fillText(String(row.serial), column.x + 1, row.y);
      }
      setFont(ctx, 11, 700);
      ctx.fillStyle = INK;
      ctx.textAlign = "right";
      ctx.fillText(String(row.questionNumber), column.x + grid.numberWidth - 2, row.y);
      if (row.unresolved) {
        setFont(ctx, 8, 700);
        ctx.textAlign = "left";
        ctx.fillText("?", column.x + grid.numberWidth + 1, row.y);
      }
    }

    const letterSize = clamp(grid.bubbleRadius * 1.15, 5.5, 10);
    for (const bubble of column.bubbles) {
      ctx.beginPath();
      ctx.arc(bubble.cx, bubble.cy, bubble.radius, 0, TAU);
      if (bubble.filled) {
        ctx.fillStyle = INK;
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.fillStyle = INK;
      }
      setFont(ctx, letterSize, 700);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(bubble.letter, bubble.cx, bubble.cy + letterSize * 0.04);
    }
  });
}

function drawSummary(ctx: CanvasRenderingContext2D, layout: OmrLayout) {
  const summary = layout.summary;
  if (!summary) return;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 9, 700);
  ctx.fillStyle = INK;
  ctx.fillText(summary.label, summary.x, summary.y + 10);

  for (const chip of summary.chips) {
    const unresolved = !chip.letter;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(chip.x, chip.y, chip.width, chip.height);
    ctx.strokeStyle = unresolved ? "#b03030" : "#333333";
    ctx.lineWidth = 0.9;
    if (unresolved) ctx.setLineDash([2.5, 2.5]);
    ctx.strokeRect(chip.x + 0.45, chip.y + 0.45, chip.width - 0.9, chip.height - 0.9);
    ctx.setLineDash([]);
    setFont(ctx, 9, 700);
    ctx.fillStyle = unresolved ? "#b03030" : INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `${chip.questionNumber}-${unresolved ? "?" : chip.letter}`,
      chip.x + chip.width / 2,
      chip.y + chip.height / 2 + 0.5,
    );
  }
  ctx.fillStyle = INK;
}

function drawFooter(ctx: CanvasRenderingContext2D, layout: OmrLayout) {
  const { content, footer } = layout;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(content.x, footer.ruleY);
  ctx.lineTo(content.x + content.width, footer.ruleY);
  ctx.stroke();

  setFont(ctx, 9.5, 400);
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText("Invigilator's signature: ______________________________", content.x, footer.textY);
  ctx.textAlign = "right";
  ctx.fillText(footer.right, content.x + content.width, footer.textY);
}

/**
 * Paint a layout model onto any 2D context, in page coordinates.
 *
 * `scale` is device pixels per layout unit, and the painter applies it itself
 * via `setTransform`. The transform has to be set here rather than by the
 * caller: a caller that pre-scales the context has that scale silently thrown
 * away, which paints the sheet 1:1 into the top-left corner of an
 * already-oversized canvas. Every measurement below stays in page units, so the
 * scanner calibration is identical at every scale.
 */
export function drawOmrLayout(
  ctx: CanvasRenderingContext2D,
  layout: OmrLayout,
  options: { scale?: number } = {},
) {
  const scale = options.scale ?? 1;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, layout.page.width, layout.page.height);
  drawFrame(ctx, layout);
  drawHeader(ctx, layout);
  drawFields(ctx, layout);
  drawInstructions(ctx, layout);
  drawGrid(ctx, layout);
  drawSummary(ctx, layout);
  drawFooter(ctx, layout);
  ctx.restore();
}

/** Render the sheet to a canvas at `scale` device pixels per layout unit. */
export function renderOmrSheetCanvas(
  props: OmrSheetProps,
  options: { scale?: number; canvas?: HTMLCanvasElement } = {},
): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new Error("OMR sheets can only be rendered in the browser.");
  }
  const layout = buildOmrLayout(props);
  // Browsers cap canvas dimensions, so a very large print scale is reduced
  // rather than silently producing a blank image.
  const maxSide = 8192;
  const scale = Math.min(
    options.scale ?? 2,
    maxSide / layout.page.width,
    maxSide / layout.page.height,
  );
  const canvas = options.canvas ?? document.createElement("canvas");
  canvas.width = Math.round(layout.page.width * scale);
  canvas.height = Math.round(layout.page.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("This browser blocked the 2D canvas, so the OMR sheet cannot be drawn.");
  }
  // The painter sets the transform from `scale` itself; pre-scaling here would
  // be redundant and is exactly what used to be silently discarded.
  drawOmrLayout(ctx, layout, { scale });
  return canvas;
}

/** Encode a canvas as an image Blob, for uploads or server-side storage. */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The OMR image could not be encoded."))),
      type,
      quality,
    );
  });
}

/**
 * Download the sheet as a PNG or JPEG image.
 *
 * The data URL is produced synchronously on purpose: an async encode can lose
 * the user gesture that browsers require before they will honour a download.
 */
export function downloadOmrSheetImage(
  props: OmrSheetProps,
  options: {
    type?: OmrImageType;
    quality?: number;
    scale?: number;
    filename?: string;
  } = {},
): void {
  const jpeg = options.type === "jpeg";
  const extension = jpeg ? "jpg" : "png";
  const canvas = renderOmrSheetCanvas(props, { scale: options.scale ?? OMR_PRINT_SCALE });
  const url = canvas.toDataURL(
    jpeg ? "image/jpeg" : "image/png",
    jpeg ? (options.quality ?? 0.95) : undefined,
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = options.filename ?? `omr-sheet.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
