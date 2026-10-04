import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { geminiApiKey, geminiModels, requestGeminiText } from "@/lib/gemini";
import {
  MAX_TEXTBOOK_IMAGES,
  MAX_TEXTBOOK_REQUEST_CHARS,
  type TextbookSource,
} from "@/lib/textbook-images";

const UNREADABLE_MESSAGE =
  "We couldn't clearly read this image. Please upload a clearer photo with the textbook text visible.";

/**
 * One photographed page, already compressed in the browser.
 *
 * The length ceilings are the real budget: base64 of a compressed page runs to
 * roughly 350 KB of characters, so this rejects a payload that slipped past the
 * client's own limits before it reaches the model rather than after.
 */
const pageSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data: z
    .string()
    .min(1)
    .max(400_000, "a compressed textbook page must stay under 400 KB")
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "malformed image payload"),
});

const analyzeInput = z
  .object({
    pages: z.array(pageSchema).min(1, "Add at least one textbook page.").max(MAX_TEXTBOOK_IMAGES),
    /** Typed topic from the paper form; narrows the intended focus of the pages. */
    focusTopic: z.string().max(200).default(""),
    /** Subject already chosen in the paper form; only a reading hint. */
    subject: z.string().max(100).default(""),
  })
  .refine(
    (value) =>
      value.pages.reduce((sum, page) => sum + page.data.length, 0) <= MAX_TEXTBOOK_REQUEST_CHARS,
    {
      message: "Those pages are too large to read in one request. Remove a page and try again.",
      path: ["pages"],
    },
  );

const EXTRACTION_SYSTEM_PROMPT = `You are an expert curriculum analyst. You are looking at photographs of textbook pages a teacher has uploaded, and your job is to understand the teaching content on them well enough that another writer could set accurate exam questions from it.

The photographs arrive in reading order and are one continuous chapter. Read them as a single lesson.

Work out, and report in your own words:
- chapter: the chapter, unit or lesson title, or "" when no heading is visible
- subject: the school subject these pages belong to (Physics, Chemistry, Mathematics, Biology, Economics, ...)
- topics: the topics and subtopics covered, most important first
- keyPoints: the instructional content as short precise statements — definitions, concepts, formulas and laws with their conditions, important facts and constants, worked examples with their results, named terminology, and the relationships between concepts. Keep the exact values, symbols, units and notation the pages state.
- contentDigest: a compact study digest of at most 700 words, in your own words, organised by subtopic, detailed enough for an examiner to write accurate questions without seeing the page.

Rules:
- Understand the material; do not perform blind OCR. Transcribe only what has to be exact — values, symbols, formulas and terminology. Everything else is understood and restated.
- Do not reproduce long passages, sentences or worked solutions from the pages. Paraphrase, and never emit a run of consecutive words copied from a page.
- Do not add material that is not on the pages, even when it is standard for the subject. If the pages are a subset of a chapter, describe only that subset.
- Ignore page furniture: page numbers, running heads, "Exercise 4.1" headings, marginal notes, watermarks and any printed answers to exercises.
- Set "readable" to false, with a short reason, when the pages carry no legible educational content — a blank page, a cover or a photograph, text too small or blurred to read, or a language you cannot read. Say so instead of inventing content.

Respond with ONLY valid JSON:
{ "readable": true, "chapter": "", "subject": "", "topics": [], "keyPoints": [], "contentDigest": "" }`;

/**
 * Read photographed textbook pages once and return a compact content digest.
 *
 * This is deliberately a separate, cheaper call from question generation: the
 * images go to the model here and are then discarded, and every generation
 * batch for the paper reuses the text digest instead of re-sending the
 * photographs. Nothing from this call is persisted — the request is transient
 * and the response is the only thing that survives it.
 */
export const analyzeTextbookImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => analyzeInput.parse(d))
  .handler(async ({ data, context }): Promise<TextbookSource> => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .single();
    const orgId = profile?.organization_id;
    if (!orgId) throw new Error("No organization assigned to your account.");

    const { data: org } = await supabase
      .from("organizations")
      .select("ai_daily_quota, status")
      .eq("id", orgId)
      .single();
    if (!org) throw new Error("Organization not found.");
    if (org.status !== "active") throw new Error("Your organization is not active.");

    // Reading the pages is an AI call, so it is gated by the same daily quota
    // as generation — but it reserves no paper credit, because the paper that
    // follows is what the credit pays for.
    const today = new Date().toISOString().slice(0, 10);
    const { data: usageRow } = await supabase
      .from("ai_usage")
      .select("count")
      .eq("organization_id", orgId)
      .eq("usage_date", today)
      .maybeSingle();
    if ((usageRow?.count ?? 0) >= org.ai_daily_quota) {
      throw new Error(
        `Daily AI quota reached (${usageRow?.count ?? 0}/${org.ai_daily_quota}). Try again tomorrow.`,
      );
    }

    const apiKey = geminiApiKey();
    const total = data.pages.length;
    const parts = [
      { text: buildPageRequestText(total, data.focusTopic, data.subject) },
      ...data.pages.flatMap((page, index) => [
        { text: `Textbook page ${index + 1} of ${total}:` },
        { inlineData: { mimeType: page.mimeType, data: page.data } },
      ]),
    ];

    let lastError = "";
    for (const model of geminiModels()) {
      console.info(
        `[AI] textbook analysis → model=${model} pages=${total} chars=${data.pages.reduce(
          (sum, page) => sum + page.data.length,
          0,
        )}`,
      );
      let content: string;
      try {
        content = await requestGeminiText({
          apiKey,
          model,
          systemInstruction: EXTRACTION_SYSTEM_PROMPT,
          parts,
          temperature: 0.2,
          maxOutputTokens: 4096,
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[AI] textbook analysis failed: ${lastError}`);
        continue;
      }

      const source = parseAnalysis(content, total);
      if (source) {
        console.info(
          `[AI] textbook analysis ← ${source.pageCount} page(s), ${source.topics.length} topic(s), ${source.contentDigest.length} digest chars`,
        );
        return source;
      }
      lastError = UNREADABLE_MESSAGE;
    }

    throw new Error(
      lastError === UNREADABLE_MESSAGE
        ? lastError
        : `Textbook analysis failed. No paper was created. ${lastError}`,
    );
  });

function buildPageRequestText(pageCount: number, focusTopic: string, subject: string): string {
  const hints = [
    subject ? `The paper is being generated for ${subject}.` : "",
    focusTopic
      ? `The teacher typed this topic or focus alongside the photos: "${focusTopic}". Use it to choose the intended emphasis, but report only what the pages actually contain.`
      : "",
  ].filter(Boolean);
  return `These are ${pageCount} photographed textbook page${pageCount === 1 ? "" : "s"}.\n${hints.join("\n")}`;
}

/**
 * Read the model's answer into a source digest, or null when it says the pages
 * are not readable. Anything malformed is treated as unreadable rather than as
 * an empty chapter, so a bad response can never become an off-syllabus paper.
 */
function parseAnalysis(content: string, pageCount: number): TextbookSource | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: {
    readable?: unknown;
    chapter?: unknown;
    subject?: unknown;
    topics?: unknown;
    keyPoints?: unknown;
    contentDigest?: unknown;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (parsed.readable === false) return null;

  const topics = stringList(parsed.topics, 40, 200);
  const keyPoints = stringList(parsed.keyPoints, 60, 400);
  const contentDigest = String(parsed.contentDigest ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 8000);

  // No topics and no digest means the model described nothing usable.
  if (topics.length === 0 && contentDigest.replace(/\s/g, "").length < 40) return null;

  return {
    chapter: String(parsed.chapter ?? "")
      .trim()
      .slice(0, 300),
    subject: String(parsed.subject ?? "")
      .trim()
      .slice(0, 100),
    topics,
    keyPoints,
    contentDigest,
    pageCount,
  };
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      String(entry ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength),
    )
    .filter(Boolean)
    .slice(0, maxItems);
}
