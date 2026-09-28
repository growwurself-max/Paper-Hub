/**
 * Question and answer typesetting.
 *
 * The generated paper is printed and scanned, so a LaTeX expression left as raw
 * source is a visible defect on the sheet, not a cosmetic one. These tests pin
 * that the maths a model actually emits - bare, with no delimiters - is
 * compiled, and that the surrounding English is left alone.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatExamText } from "../src/lib/exam-text.ts";

/**
 * The text a reader actually sees.
 *
 * KaTeX embeds the original LaTeX in an <annotation> and a MathML mirror, so
 * those are removed first; otherwise every expression would still look like raw
 * source and the assertions below could not tell a compiled glyph from a
 * leftover backslash.
 */
function visible(html: string): string {
  return html
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<span class="katex-mathml">[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const isTypeset = (html: string) => html.includes('class="katex"');

/** The cases reported as printing raw LaTeX. */
const REPORTED = [
  String.raw`\tan(\theta) = \sqrt{3}`,
  String.raw`\hat{i}`,
  String.raw`\sum_{i=1}^{n} a_i`,
  String.raw`\begin{cases} x + y = 2 \\ x - y = 0 \end{cases}`,
  String.raw`\vec{v} \times \vec{B}`,
  String.raw`\frac{dy}{dx} = 2x`,
  String.raw`\alpha + \beta = \gamma`,
  String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
];

describe("bare LaTeX is compiled", () => {
  for (const source of REPORTED) {
    test(`compiles ${source}`, () => {
      const html = formatExamText(source);
      assert.ok(isTypeset(html), "nothing was typeset");
      assert.ok(
        !visible(html).includes("\\"),
        `raw LaTeX survived into the printed text: ${visible(html)}`,
      );
      assert.ok(!html.includes("katex-error"), "KaTeX reported a parse error");
    });
  }

  test("a command is never given a second backslash", () => {
    // The old plain-text Greek rewrite matched the "theta" inside "\theta" and
    // doubled the slash, so the sheet printed a literal backslash beside the
    // letter.
    for (const source of REPORTED) {
      assert.ok(!formatExamText(source).includes("\\\\theta"), `doubled backslash in ${source}`);
    }
    assert.equal(visible(formatExamText(String.raw`\theta`)), "θ");
  });

  test("fractions, roots and powers survive", () => {
    assert.ok(isTypeset(formatExamText(String.raw`\frac{a}{b}`)));
    assert.ok(isTypeset(formatExamText(String.raw`\sqrt[3]{x}`)));
    assert.ok(isTypeset(formatExamText(String.raw`x^2 + y^2`)));
  });

  test("an environment ends at its \\end, not at the next sentence", () => {
    const html = formatExamText(
      String.raw`Given \begin{cases} x = 1 \\ y = 2 \end{cases} find the sum.`,
    );
    assert.ok(isTypeset(html));
    const text = visible(html);
    assert.ok(text.includes("find the sum"), "the trailing sentence was swallowed");
    assert.ok(!text.includes("\\"), `raw LaTeX survived: ${text}`);
  });
});

describe("prose is left alone", () => {
  test("a sentence keeps its words around the maths", () => {
    const html = formatExamText("The value of \\theta is 45 degrees.");
    const text = visible(html);
    assert.ok(isTypeset(html), "the symbol was not typeset");
    assert.ok(text.startsWith("The value of"), `prose was lost: ${text}`);
    assert.ok(text.includes("is 45 degrees"), `prose was swallowed: ${text}`);
    assert.ok(!text.includes("\\"), `a stray backslash remains: ${text}`);
  });

  test("a run stops before the next English word", () => {
    const text = visible(formatExamText(String.raw`\alpha and \beta`));
    assert.ok(text.includes("and"), `the word "and" was typeset as a variable: ${text}`);
  });

  test("an ordinary sentence is not typeset at all", () => {
    const html = formatExamText("Which of the following is a noble gas?");
    assert.ok(!isTypeset(html), "prose was mistaken for maths");
    assert.equal(visible(html), "Which of the following is a noble gas?");
  });

  test("a currency amount is not mistaken for inline maths", () => {
    const html = formatExamText("The fee is $5 and $10 per term.");
    assert.ok(!isTypeset(html), "a price was typeset as maths");
    assert.equal(visible(html), "The fee is $5 and $10 per term.");
  });

  test("currency beside real maths still compiles the maths", () => {
    const html = formatExamText("It costs $5, and \\alpha = 2 is given.");
    assert.ok(isTypeset(html));
    assert.ok(visible(html).includes("It costs $5"), "the price was lost");
  });
});

describe("delimiters still work", () => {
  for (const [source, display] of [
    [String.raw`$\frac{a}{b}$`, false],
    [String.raw`\(\frac{a}{b}\)`, false],
    [String.raw`\[\frac{a}{b}\]`, true],
    [String.raw`$$\frac{a}{b}$$`, true],
  ] as const) {
    test(`compiles ${source}`, () => {
      const html = formatExamText(source);
      assert.ok(isTypeset(html));
      assert.ok(!visible(html).includes("\\"));
      assert.ok(
        display ? html.includes("katex-display") : !html.includes("katex-display"),
        `displayMode was wrong for ${source}`,
      );
    });
  }
});

describe("plain-text maths still promotes", () => {
  test("bare Greek words and sqrt() and simple fractions", () => {
    assert.ok(isTypeset(formatExamText("theta is an angle")));
    assert.ok(isTypeset(formatExamText("sqrt(3) is irrational")));
    assert.ok(isTypeset(formatExamText("1/2 of the class")));
    assert.equal(visible(formatExamText("thotal")), "θ");
  });
});

describe("hostile and malformed input", () => {
  test("markup in prose is escaped, not rendered", () => {
    const html = formatExamText('<script>alert("xss")</script>');
    assert.ok(!html.includes("<script"), "script tag was not escaped");
    assert.ok(html.includes("&lt;script"), "script tag was not escaped");
  });

  test("markup inside a maths run cannot escape the span", () => {
    const html = formatExamText(String.raw`\alpha <img src=x onerror=alert(1)>`);
    assert.ok(!html.includes("<img"), "an image tag was emitted");
  });

  test("\\href cannot inject a URL", () => {
    // KaTeX is run with trust disabled, so \href is rejected and the
    // expression falls back to escaped text. The string may still be visible
    // to the reader, but it must never become a live link.
    const html = formatExamText(String.raw`\href{javascript:alert(1)}{click}`);
    assert.ok(!/href\s*=\s*["']?\s*javascript:/i.test(html), "a javascript href was emitted");
    assert.ok(!/<a\s/i.test(html), "an anchor was emitted");
  });

  test("an unparseable expression falls back to readable text", () => {
    // KaTeX throws on this; the sheet must show the source rather than a red
    // error blob, and must not lose the text entirely.
    const html = formatExamText(String.raw`\frac{`);
    assert.ok(!html.includes("katex-error"), "a KaTeX error was rendered");
    assert.ok(visible(html).length > 0, "the expression vanished");
  });

  test("an unterminated environment falls back instead of hanging", () => {
    const html = formatExamText(String.raw`\begin{cases} x = 1 \\ y = 2`);
    assert.ok(visible(html).length > 0);
  });

  test("empty and whitespace input are handled", () => {
    assert.equal(formatExamText(""), "");
    assert.equal(formatExamText("   "), "   ");
  });

  test("a lone backslash does not throw", () => {
    assert.doesNotThrow(() => formatExamText("50 \\ 60"));
  });
});
