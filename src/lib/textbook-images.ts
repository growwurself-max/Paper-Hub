/**
 * Textbook-page photo support: upload limits, client-side compression and the
 * prompt/band rules that turn an extracted digest into a grounded question
 * source.
 *
 * Photos are never stored. The browser compresses each page and hands the
 * server a base64 payload that is analysed once and then thrown away; only the
 * compact digest it produces reaches the paper-generation call and the stored
 * paper config.
 */

/** Pages accepted in one analysis request. */
export const MAX_TEXTBOOK_IMAGES = 10;

/** Ceiling for the file a teacher picks off their phone or gallery. */
export const MAX_TEXTBOOK_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Ceiling for one page *after* compression.
 *
 * Ten pages of textbook text at the sizes below land around 1.5–2.5 MB in
 * total, which keeps the base64 request inside the ~4.5 MB body limit of a
 * serverless function while leaving the printed text comfortably legible.
 */
export const MAX_TEXTBOOK_IMAGE_ENCODED_BYTES = 260 * 1024;

/** Total compressed budget across all pages of one request. */
export const MAX_TEXTBOOK_TOTAL_ENCODED_BYTES =
  MAX_TEXTBOOK_IMAGE_ENCODED_BYTES * MAX_TEXTBOOK_IMAGES;

/** Base64 characters one request may carry; the server rejects anything larger. */
export const MAX_TEXTBOOK_REQUEST_CHARS = 3_600_000;

export const ACCEPTED_TEXTBOOK_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type TextbookImageMimeType = (typeof ACCEPTED_TEXTBOOK_MIME_TYPES)[number];

export type TextbookImagePayload = {
  /** Bare base64, no data-URL prefix. */
  data: string;
  mimeType: TextbookImageMimeType;
};

/**
 * What one textbook-page analysis produced.
 *
 * This is the whole cost of the feature downstream: a single compact digest
 * reused by every question-generation call for the paper, instead of shipping
 * the photographs again per batch.
 */
export type TextbookSource = {
  chapter: string;
  subject: string;
  topics: string[];
  keyPoints: string[];
  contentDigest: string;
  pageCount: number;
};

/** A page the teacher added, as held in browser state. */
export type TextbookPage = {
  id: string;
  name: string;
  /** Compressed JPEG data URL, used for both the preview and the request. */
  dataUrl: string;
  mimeType: TextbookImageMimeType;
  bytes: number;
};

const MIME_BY_EXTENSION: Record<string, TextbookImageMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * The page's real image type.
 *
 * The declared `File.type` wins, but some Android pickers and desktop file
 * managers hand over an image with no type at all, so a known extension is
 * accepted rather than rejected as "unsupported".
 */
export function textbookImageMimeType(file: {
  name: string;
  type: string;
}): TextbookImageMimeType | null {
  const declared = (file.type ?? "").toLowerCase();
  if ((ACCEPTED_TEXTBOOK_MIME_TYPES as readonly string[]).includes(declared)) {
    return declared as TextbookImageMimeType;
  }
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

/** A teacher-facing reason this file cannot be used, or null when it can. */
export function validateTextbookImageFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!textbookImageMimeType(file)) {
    return `${file.name || "That file"} is not a supported image. Take a photo in JPG or PNG, or choose a JPG, PNG or WebP file.`;
  }
  if (!file.size) {
    return `${file.name || "That file"} is empty.`;
  }
  if (file.size > MAX_TEXTBOOK_IMAGE_BYTES) {
    return `${file.name || "That photo"} is ${formatMegabytes(file.size)}. Each photo must be under ${formatMegabytes(
      MAX_TEXTBOOK_IMAGE_BYTES,
    )} — retake it at a lower resolution or crop it to the page.`;
  }
  return null;
}

/** A teacher-facing reason this set of pages is too big to send, or null. */
export function textbookRequestTooLarge(
  pages: Pick<TextbookPage, "name" | "bytes">[],
): string | null {
  const total = pages.reduce((sum, page) => sum + page.bytes, 0);
  if (pages.length > MAX_TEXTBOOK_IMAGES) {
    return `You can add up to ${MAX_TEXTBOOK_IMAGES} pages at a time. Remove ${
      pages.length - MAX_TEXTBOOK_IMAGES
    } and add the rest in a second paper.`;
  }
  if (total > MAX_TEXTBOOK_TOTAL_ENCODED_BYTES) {
    return `These pages come to ${formatMegabytes(total)} together, which is more than one request can carry. Remove a page, or retake the photo without extra margins around the page.`;
  }
  return null;
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Strip the data-URL prefix so the string can go into a JSON body. */
export function dataUrlToBase64(dataUrl: string): string {
  const separator = dataUrl.indexOf(",");
  return separator >= 0 ? dataUrl.slice(separator + 1) : dataUrl;
}

/**
 * Re-encode a page for the model: rotated upright by its EXIF orientation,
 * downscaled so the longest edge is a readable-but-modest width, and flattened
 * onto white so a dark background cannot bleed into the text.
 */
export async function compressTextbookImage(file: File): Promise<TextbookPage> {
  const decoded = await decodeImage(file);
  try {
    const { width, height } = decoded;
    for (const step of COMPRESSION_STEPS) {
      const scale = Math.min(1, step.maxEdge / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      decoded.draw(context, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg", step.quality);
      const bytes = base64ByteLength(dataUrl);
      const isLastStep = step === COMPRESSION_STEPS[COMPRESSION_STEPS.length - 1];
      if (bytes <= MAX_TEXTBOOK_IMAGE_ENCODED_BYTES || isLastStep) {
        return {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name || "textbook-page.jpg",
          dataUrl,
          mimeType: "image/jpeg",
          bytes,
        };
      }
    }
  } finally {
    decoded.release();
  }
  throw new Error(
    "This photo could not be prepared for reading. Try retaking it with the page filling the frame.",
  );
}

/**
 * Successively smaller re-encodings, tried in order until one fits the
 * per-page budget. Textbook pages are mostly white space, so JPEG at this
 * quality keeps body text readable at a fraction of the original size.
 */
const COMPRESSION_STEPS: Array<{ maxEdge: number; quality: number }> = [
  { maxEdge: 1800, quality: 0.82 },
  { maxEdge: 1500, quality: 0.7 },
  { maxEdge: 1200, quality: 0.6 },
];

type DecodedImage = {
  width: number;
  height: number;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
  release: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  // `from-image` applies the EXIF rotation a phone camera records, so a
  // sideways textbook page reaches the model the right way up.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        release: () => bitmap.close(),
      };
    } catch {
      try {
        const bitmap = await createImageBitmap(file);
        return {
          width: bitmap.width,
          height: bitmap.height,
          draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
          release: () => bitmap.close(),
        };
      } catch {
        /* fall through to the <img> decoder */
      }
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(
      `This photo could not be opened: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
    release: () => URL.revokeObjectURL(url),
  };
}

/** Decoded byte count of a base64 data URL, without decoding it. */
function base64ByteLength(dataUrl: string): number {
  const base64 = dataUrlToBase64(dataUrl).length;
  const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64 * 3) / 4) - padding);
}

/**
 * Which subject band a photographed chapter belongs to.
 *
 * A single-band paper always takes the source. A banded paper (EAMCET pins
 * Physics, Chemistry and Mathematics to their own runs of question numbers)
 * takes it in exactly one band — the one the pages are actually about — so a
 * Physics chapter cannot leak thermodynamics questions into the Mathematics
 * band. A chapter whose subject matches no band, and no selected subject either,
 * is dropped rather than smeared across the whole paper.
 */
export function selectTextbookBandSubject(
  source: TextbookSource | null,
  bands: Array<{ subject: string }>,
  selectedSubject: string,
): string | null {
  if (!source || bands.length === 0) return null;
  if (bands.length === 1) return bands[0]!.subject;
  const detected = bands.find((band) => sameSubject(band.subject, source.subject));
  if (detected) return detected.subject;
  return bands.find((band) => sameSubject(band.subject, selectedSubject))?.subject ?? null;
}

function sameSubject(left: string, right: string): boolean {
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const a = normalise(left);
  const b = normalise(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * The grounded-source block appended to a generation prompt.
 *
 * Returns an empty string when no pages were analysed, so a paper generated
 * from a typed topic or a syllabus PDF keeps exactly the prompt it had before
 * this feature existed.
 */
export function textbookSourcePrompt(source: TextbookSource | null): string {
  if (!source) return "";
  const lines = [
    `- The question source is ${source.pageCount} textbook page${source.pageCount === 1 ? "" : "s"} the teacher photographed${source.chapter ? ` from "${source.chapter}"` : ""}.`,
    "- Generate questions primarily from the educational content visible in the provided textbook images. Do not introduce unrelated concepts or advanced material that is not present in or reasonably derived from the provided content.",
    "- Write original questions. Never reproduce textbook passages, sentences or worked solutions verbatim, and never present textbook text as a quoted extract.",
    "- Every fact, formula, value and example used must be supported by those pages. If a detail a question would need is missing, write the question around what the pages do show.",
  ];
  if (source.topics.length > 0) {
    lines.push(
      `- Topics found on those pages: ${source.topics.join("; ")}. Spread the questions evenly across them instead of over one of them.`,
    );
  }
  if (source.keyPoints.length > 0) {
    lines.push(`- Content extracted from those pages:\n"""\n${source.keyPoints.join("\n")}\n"""`);
  }
  if (source.contentDigest) {
    lines.push(
      `- Study digest of those pages:\n"""\n${source.contentDigest}\n"""\nQuestions must be answerable from this digest alone.`,
    );
  }
  return `\n${lines.join("\n")}\n`;
}
