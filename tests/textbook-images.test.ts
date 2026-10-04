/**
 * Textbook-page photo source.
 *
 * The photographs themselves are only read once, by a model, so the logic worth
 * pinning here is everything that decides what reaches that model: which files
 * are accepted, whether a page set fits in one request, which subject band a
 * photographed chapter may ground, and what the generation prompt is told. The
 * band rule is the load-bearing one — an EAMCET paper pins Physics, Chemistry
 * and Mathematics to their own runs of question numbers, so a chapter leaking
 * into the wrong band would misprint the sheet.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TEXTBOOK_IMAGES,
  MAX_TEXTBOOK_IMAGE_ENCODED_BYTES,
  dataUrlToBase64,
  formatMegabytes,
  selectTextbookBandSubject,
  textbookImageMimeType,
  textbookRequestTooLarge,
  textbookSourcePrompt,
  validateTextbookImageFile,
  type TextbookPage,
  type TextbookSource,
} from "../src/lib/textbook-images.ts";

const EAMCET_BANDS = [{ subject: "Physics" }, { subject: "Chemistry" }, { subject: "Mathematics" }];

function source(overrides: Partial<TextbookSource> = {}): TextbookSource {
  return {
    chapter: "Quadratic Equations",
    subject: "Mathematics",
    topics: ["Roots of quadratic equations", "Discriminant"],
    keyPoints: ["D = b² − 4ac decides whether roots are real."],
    contentDigest: "For ax² + bx + c = 0 the roots are (−b ± √D) / 2a.",
    pageCount: 3,
    ...overrides,
  };
}

function page(name: string, bytes: number): TextbookPage {
  return {
    id: name,
    name,
    dataUrl: "data:image/jpeg;base64,AAAA",
    mimeType: "image/jpeg",
    bytes,
  };
}

describe("accepted page uploads", () => {
  test("JPG, PNG and WebP are accepted", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      assert.equal(textbookImageMimeType({ name: "page", type }), type);
      assert.equal(validateTextbookImageFile({ name: "page.jpg", type, size: 2_000_000 }), null);
    }
  });

  test("an unsupported image is refused with a reason a teacher can act on", () => {
    const problem = validateTextbookImageFile({
      name: "notes.heic",
      type: "image/heic",
      size: 1_000,
    });
    assert.match(problem ?? "", /not a supported image/);
    assert.match(problem ?? "", /notes\.heic/);
  });

  test("a document is not accepted as a textbook page", () => {
    assert.equal(textbookImageMimeType({ name: "chapter.pdf", type: "application/pdf" }), null);
    assert.equal(textbookImageMimeType({ name: "scan.tiff", type: "image/tiff" }), null);
  });

  test("a photo with no declared type is accepted on a known extension", () => {
    // Some Android pickers and desktop file managers hand over an image with an
    // empty File.type; rejecting those would look like a broken feature.
    assert.equal(textbookImageMimeType({ name: "IMG_0042.JPG", type: "" }), "image/jpeg");
    assert.equal(textbookImageMimeType({ name: "page.webp", type: "" }), "image/webp");
  });

  test("empty and oversized files are refused", () => {
    assert.match(
      validateTextbookImageFile({ name: "page.jpg", type: "image/jpeg", size: 0 }) ?? "",
      /empty/,
    );
    assert.match(
      validateTextbookImageFile({
        name: "page.jpg",
        type: "image/jpeg",
        size: 64 * 1024 * 1024,
      }) ?? "",
      /must be under/,
    );
  });
});

describe("one request's page budget", () => {
  test("ten compressed pages are the most one paper can read", () => {
    assert.equal(MAX_TEXTBOOK_IMAGES, 10);
    const tenPages = Array.from({ length: MAX_TEXTBOOK_IMAGES }, (_, index) =>
      page(`page-${index}.jpg`, MAX_TEXTBOOK_IMAGE_ENCODED_BYTES),
    );
    assert.equal(textbookRequestTooLarge(tenPages), null, "a full set of in-budget pages is fine");
    assert.match(
      textbookRequestTooLarge([...tenPages, page("page-11.jpg", 1000)]) ?? "",
      /up to 10 pages/,
    );
  });

  test("a set of pages too large together is refused rather than truncated", () => {
    const heavy = Array.from({ length: 10 }, (_, index) => page(`p${index}.jpg`, 900 * 1024));
    assert.match(textbookRequestTooLarge(heavy) ?? "", /more than one request can carry/);
  });

  test("byte sizes read back in megabytes", () => {
    assert.equal(formatMegabytes(15 * 1024 * 1024), "15.0 MB");
  });
});

describe("which subject band the pages may ground", () => {
  test("a single-band paper always takes the pages", () => {
    assert.equal(
      selectTextbookBandSubject(source({ subject: "Mathematics" }), [{ subject: "Physics" }], ""),
      "Physics",
    );
  });

  test("no pages means no band", () => {
    assert.equal(selectTextbookBandSubject(null, EAMCET_BANDS, "Physics"), null);
    assert.equal(selectTextbookBandSubject(source(), [], "Physics"), null);
  });

  test("a banded paper grounds the pages in the band they are about", () => {
    assert.equal(
      selectTextbookBandSubject(source({ subject: "Chemistry" }), EAMCET_BANDS, "Mathematics"),
      "Chemistry",
    );
  });

  test("subject matching ignores case, spacing and a trailing qualifier", () => {
    assert.equal(
      selectTextbookBandSubject(source({ subject: "chemistry" }), EAMCET_BANDS, "Mathematics"),
      "Chemistry",
    );
    assert.equal(
      selectTextbookBandSubject(source({ subject: "Physics (1st Year)" }), EAMCET_BANDS, ""),
      "Physics",
    );
  });

  test("an unrecognised chapter falls back to the subject the paper selected", () => {
    // A banded paper must still be generated; the pages then ground the band
    // the teacher actually chose rather than none of them.
    assert.equal(
      selectTextbookBandSubject(source({ subject: "" }), EAMCET_BANDS, "Mathematics"),
      "Mathematics",
    );
  });

  test("a chapter matching no band and no selection grounds nothing", () => {
    // Smearing one chapter across three bands would put off-subject questions
    // into a pinned blueprint, so it is dropped instead.
    assert.equal(
      selectTextbookBandSubject(source({ subject: "History" }), EAMCET_BANDS, "Economics"),
      null,
    );
  });
});

describe("grounded generation prompt", () => {
  test("no pages leaves the prompt untouched", () => {
    assert.equal(textbookSourcePrompt(null), "");
  });

  test("the prompt states the strict source restriction verbatim", () => {
    const prompt = textbookSourcePrompt(source());
    assert.match(
      prompt,
      /Generate questions primarily from the educational content visible in the provided textbook images\. Do not introduce unrelated concepts or advanced material that is not present in or reasonably derived from the provided content\./,
    );
  });

  test("the prompt forbids copying the textbook into the paper", () => {
    assert.match(textbookSourcePrompt(source()), /Never reproduce textbook passages/);
  });

  test("the extracted content travels with the prompt", () => {
    const prompt = textbookSourcePrompt(source());
    assert.match(prompt, /D = b² − 4ac decides whether roots are real\./);
    assert.match(prompt, /For ax² \+ bx \+ c = 0/);
    assert.match(prompt, /Roots of quadratic equations/);
    assert.match(prompt, /3 textbook pages/);
  });

  test("a single page is not described in the plural", () => {
    assert.match(
      textbookSourcePrompt(source({ pageCount: 1 })),
      /1 textbook page the teacher photographed from "Quadratic Equations"/,
    );
  });

  test("a chapter with no stated title still names the source", () => {
    const prompt = textbookSourcePrompt(source({ chapter: "", pageCount: 1 }));
    assert.match(prompt, /1 textbook page the teacher photographed\./);
  });
});

describe("base64 payloads", () => {
  test("the data-URL prefix is stripped for the JSON body", () => {
    assert.equal(dataUrlToBase64("data:image/jpeg;base64,QUJD"), "QUJD");
  });
});
