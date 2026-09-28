import katex from "katex";

/**
 * Typesetting for generated question text.
 *
 * Models emit LaTeX with no reliable delimiters - `\hat{i}`, `\sum_{i=1}^{n}`
 * and `\begin{cases}...\end{cases}` all arrive bare - so the text is split
 * into prose and maths runs and each maths run is handed to KaTeX. Anything
 * KaTeX cannot parse falls back to escaped text, which keeps a bad expression
 * readable instead of turning it into a red error blob in a printed paper.
 */

type Segment = { kind: "prose"; raw: string } | { kind: "math"; raw: string; display: boolean };

/** Plain-text spellings of Greek letters, including the common "thotal" typo. */
const GREEK: Record<string, string> = {
  alpha: "\\alpha",
  beta: "\\beta",
  delta: "\\delta",
  epsilon: "\\epsilon",
  eta: "\\eta",
  gamma: "\\gamma",
  kappa: "\\kappa",
  lambda: "\\lambda",
  mu: "\\mu",
  nu: "\\nu",
  omega: "\\omega",
  phi: "\\phi",
  pi: "\\pi",
  psi: "\\psi",
  rho: "\\rho",
  sigma: "\\sigma",
  tau: "\\tau",
  theta: "\\theta",
  thotal: "\\theta",
  xi: "\\xi",
  zeta: "\\zeta",
};

/**
 * Multi-letter words that continue a maths run. A bare LaTeX run stops at the
 * first word that is not in here, which is what keeps surrounding English out
 * of the maths: "The value of \theta is 45 degrees" stops at "is", because
 * "is" is not maths.
 */
const MATH_WORDS = new Set([
  "arcsin",
  "arccos",
  "arctan",
  "arccot",
  "cosh",
  "cot",
  "csc",
  "deg",
  "det",
  "dx",
  "dy",
  "dz",
  "dt",
  "du",
  "dw",
  "ds",
  "exp",
  "gcd",
  "inf",
  "lim",
  "ln",
  "log",
  "max",
  "min",
  "mod",
  "sec",
  "sin",
  "sinh",
  "sup",
  "tan",
  "tanh",
]);

/** Inline maths written without LaTeX, found in the prose between runs. */
const PLAIN_MATH =
  /\bsqrt\([^()]*\)|\b(?:thotal|theta|alpha|beta|gamma|delta|lambda|mu|sigma|omega|pi|epsilon|phi|rho|tau|zeta|eta|xi|psi|nu|kappa)\b|[A-Za-z0-9]\s*\^\s*(?:\{[^}]+\}|[A-Za-z0-9]+)|\b\d+\s*\/\s*\d+\b/gi;

/** Punctuation that can appear inside a maths run. */
const MATH_PUNCTUATION = new Set([
  "=",
  "+",
  "-",
  "*",
  "/",
  "^",
  "_",
  "<",
  ">",
  "|",
  "&",
  "!",
  "'",
  "~",
  ",",
  ".",
  "(",
  ")",
  "[",
  "]",
]);

const isOpenBracket = (character: string) => character === "(" || character === "[";
const isCloseBracket = (character: string) => character === ")" || character === "]";

const isLetter = (character: string) => /[A-Za-z]/.test(character);
const isDigit = (character: string) => /[0-9]/.test(character);
const isSpace = (character: string) => /\s/.test(character);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

/**
 * Rewrite the plain-text maths a model sometimes emits into LaTeX.
 *
 * The lookbehinds matter: without them a command that is already LaTeX gets a
 * second backslash, so `\theta` would become `\\theta` and print a literal
 * backslash beside the letter.
 */
function normaliseMath(expression: string): string {
  let result = expression.replace(/(?<!\\)\bsqrt\(([^()]*)\)/gi, "\\sqrt{$1}");
  result = result.replace(
    /(?<!\\)\b(thotal|theta|alpha|beta|gamma|delta|lambda|mu|sigma|omega|pi|epsilon|phi|rho|tau|zeta|eta|xi|psi|nu|kappa)\b/gi,
    (name) => GREEK[name.toLowerCase()] ?? name,
  );
  const fraction = result.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) result = `\\frac{${fraction[1]}}{${fraction[2]}}`;
  return result;
}

/** Render maths, falling back to the literal expression if KaTeX rejects it. */
function renderMath(expression: string, display: boolean): string {
  const source = normaliseMath(expression);
  try {
    return katex.renderToString(source, {
      displayMode: display,
      // Throwing lets a malformed expression fall back to readable text rather
      // than rendering KaTeX's inline red error marker into a printed sheet.
      throwOnError: true,
      strict: "ignore",
      // No \href or \includegraphics, so the output cannot carry injected URLs.
      trust: false,
    });
  } catch {
    return escapeHtml(source);
  }
}

/** Escape prose, promoting the inline maths written without LaTeX. */
function renderProse(raw: string): string {
  let result = "";
  let previousEnd = 0;
  for (const match of raw.matchAll(PLAIN_MATH)) {
    const token = match[0];
    const start = match.index ?? 0;
    result += escapeHtml(raw.slice(previousEnd, start));
    result += renderMath(token, false);
    previousEnd = start + token.length;
  }
  return result + escapeHtml(raw.slice(previousEnd));
}

/**
 * Index just past a `$$...$$`, `$...$`, `\(...\)` or `\[...\]` block starting at
 * `start`, or null when the text does not open one.
 */
function scanDelimited(text: string, start: number): { end: number; display: boolean } | null {
  const two = text.slice(start, start + 2);
  if (two === "$$") {
    const close = text.indexOf("$$", start + 2);
    return close === -1 ? null : { end: close + 2, display: true };
  }
  if (two === "\\[") {
    const close = text.indexOf("\\]", start + 2);
    return close === -1 ? null : { end: close + 2, display: true };
  }
  if (two === "\\(") {
    const close = text.indexOf("\\)", start + 2);
    return close === -1 ? null : { end: close + 2, display: false };
  }
  if (text[start] === "$") {
    const close = text.indexOf("$", start + 1);
    if (close <= start + 1) return null;
    return { end: close + 1, display: false };
  }
  return null;
}

/**
 * Whether the inside of a `$...$` is really maths. `$5 and $10` is a price,
 * not an expression, and rendering it would italicise the words.
 */
function looksLikeMath(inner: string): boolean {
  if (inner.includes("\\")) return true;
  if (/[\^_=<>+]/.test(inner)) return true;
  if (/^[-+]?[\d.,\s/]+$/.test(inner)) return true;
  return /^[A-Za-z]$/.test(inner.trim());
}

/**
 * End of the bare-LaTeX run starting at `start`, exclusive.
 *
 * The run absorbs commands, groups, numbers, operators and single-letter
 * variables, and stops at the first word that is not maths. `\begin{...}` is
 * tracked so the run ends exactly at the matching `\end{...}` instead of
 * swallowing the sentence that follows the environment.
 */
function scanLatexRun(text: string, start: number): number {
  const environments: string[] = [];
  /** Indices of brackets opened but not yet closed, for the backtrack below. */
  const openBrackets: number[] = [];
  let index = start;

  while (index < text.length) {
    const character = text[index];

    if (character === "\\") {
      const next = text[index + 1];
      if (next && isLetter(next)) {
        let end = index + 1;
        while (end < text.length && isLetter(text[end])) end++;
        const name = text.slice(index + 1, end);

        if ((name === "begin" || name === "end") && text[end] === "{") {
          const close = text.indexOf("}", end);
          if (close === -1) break;
          if (name === "begin") environments.push(text.slice(end + 1, close));
          else environments.pop();
          index = close + 1;
          // The environment is closed, so the run ends here rather than
          // swallowing the sentence that follows it.
          if (name === "end" && environments.length === 0) return index;
          continue;
        }
        index = end;
        continue;
      }
      // \\ is a line break inside an environment; \, \; \! are spacing.
      index += 2;
      continue;
    }

    if (isSpace(character)) {
      index++;
      continue;
    }

    // Braces group an argument, so they are part of the expression.
    if (character === "{" || character === "}") {
      index++;
      continue;
    }

    if (isLetter(character)) {
      let end = index;
      while (end < text.length && isLetter(text[end])) end++;
      const word = text.slice(index, end);
      if (word.length > 1 && !MATH_WORDS.has(word.toLowerCase())) break;
      index = end;
      continue;
    }

    // Brackets group an argument, so they belong to the expression.
    if (isOpenBracket(character)) {
      openBrackets.push(index);
      index++;
      continue;
    }
    if (isCloseBracket(character)) {
      openBrackets.pop();
      index++;
      continue;
    }

    if (isDigit(character) || MATH_PUNCTUATION.has(character)) {
      index++;
      continue;
    }

    break;
  }

  // An unbalanced bracket is prose, not maths: "\theta (see figure)" must not
  // become the expression "\theta (", which KaTeX rejects and which would
  // otherwise push the symbol back to raw source.
  if (openBrackets.length > 0) index = openBrackets[0];

  // Whitespace after the last token is not part of the expression.
  while (index > start && isSpace(text[index - 1])) index--;
  return index;
}

/** Split text into prose and maths segments. */
function splitMathSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let prose = "";
  let index = 0;

  const flush = () => {
    if (prose) segments.push({ kind: "prose", raw: prose });
    prose = "";
  };

  while (index < text.length) {
    const two = text.slice(index, index + 2);
    const delimited = scanDelimited(text, index);
    // Only a bare `$` is one character wide; $$, \( and \[ are two.
    const wrapper = two === "$" ? 1 : 2;
    const unambiguous = two === "\\(" || two === "\\[";

    if (delimited) {
      const inner = text.slice(index + wrapper, delimited.end - wrapper);
      // \( \) and \[ \] are unambiguous; a bare $ may just be a currency symbol.
      if (unambiguous || looksLikeMath(inner)) {
        flush();
        segments.push({ kind: "math", raw: inner, display: delimited.display });
        index = delimited.end;
        continue;
      }
    }

    if (text[index] === "\\" && isLetter(text[index + 1] ?? "")) {
      const end = scanLatexRun(text, index);
      if (end > index) {
        flush();
        // A bare run carries no delimiter to imply display maths, and inline
        // keeps the two-column paper layout tight.
        segments.push({ kind: "math", raw: text.slice(index, end), display: false });
        index = end;
        continue;
      }
    }

    prose += text[index];
    index++;
  }

  flush();
  return segments;
}

/** Typeset a question or answer: LaTeX compiled, prose escaped. */
export function formatExamText(value: string): string {
  return splitMathSegments(value)
    .map((segment) =>
      segment.kind === "math" ? renderMath(segment.raw, segment.display) : renderProse(segment.raw),
    )
    .join("");
}
