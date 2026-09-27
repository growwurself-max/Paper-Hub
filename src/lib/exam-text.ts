import katex from "katex";

const MATH_TOKEN =
  /\$[^$]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\\frac\{[^{}]*\}\{[^{}]*\}|sqrt\([^()]*\)|\b(?:thotal|theta|alpha|beta|gamma|delta|lambda|mu|sigma|omega|pi)\b|[A-Za-z0-9]\s*\^\s*(?:\{[^}]+\}|[A-Za-z0-9]+)|\b\d+\s*\/\s*\d+\b/gi;

const GREEK: Record<string, string> = {
  alpha: "\\alpha",
  beta: "\\beta",
  delta: "\\delta",
  gamma: "\\gamma",
  lambda: "\\lambda",
  mu: "\\mu",
  omega: "\\omega",
  pi: "\\pi",
  sigma: "\\sigma",
  theta: "\\theta",
  thotal: "\\theta",
};

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

/** Typeset explicit LaTeX and common plain-text math while escaping prose. */
export function formatExamText(value: string): string {
  const mathToken = new RegExp(MATH_TOKEN);
  let result = "";
  let previousEnd = 0;

  for (const match of value.matchAll(mathToken)) {
    const token = match[0];
    const start = match.index ?? 0;
    result += escapeHtml(value.slice(previousEnd, start));

    let expression = token;
    if (token.startsWith("$") && token.endsWith("$")) {
      expression = token.slice(1, -1);
    } else if (token.startsWith("\\(") && token.endsWith("\\)")) {
      expression = token.slice(2, -2);
    } else if (token.startsWith("\\[") && token.endsWith("\\]")) {
      expression = token.slice(2, -2);
    }

    expression = expression
      .replace(/sqrt\(([^()]*)\)/gi, "\\sqrt{$1}")
      .replace(
        /\b(?:thotal|theta|alpha|beta|gamma|delta|lambda|mu|sigma|omega|pi)\b/gi,
        (name) => GREEK[name.toLowerCase()],
      );
    const fraction = expression.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction) expression = `\\frac{${fraction[1]}}{${fraction[2]}}`;

    result += katex.renderToString(expression, {
      throwOnError: false,
      output: "html",
      strict: "ignore",
    });
    previousEnd = start + token.length;
  }

  return result + escapeHtml(value.slice(previousEnd));
}
