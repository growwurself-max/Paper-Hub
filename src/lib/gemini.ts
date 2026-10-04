/**
 * Shared Google Gemini transport.
 *
 * Question generation and textbook-page analysis both talk to the same
 * `generateContent` endpoint with the same model ladder, so the endpoint, the
 * model order, the retry policy and the error wording live here instead of
 * being restated per call site.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const FALLBACK_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const MAX_GEMINI_ATTEMPTS = 3;

const RETRYABLE_GEMINI_STATUSES = new Set([429, 500, 502, 503, 504]);

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** One request part: plain text, or an inlined base64 image. */
export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * A Gemini call that failed, tagged with the HTTP status when the failure came
 * from a response. A retry loop needs that status to tell "try again" (429, 5xx)
 * from "this model will never work for this key" (404, 400).
 */
export class GeminiRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "GeminiRequestError";
    this.status = status;
  }
}

export function isRetryableGeminiStatus(status: number): boolean {
  return RETRYABLE_GEMINI_STATUSES.has(status);
}

export function geminiRetryDelay(attempt: number): number {
  return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}

/**
 * The models to try, in order.
 *
 * `GEMINI_MODEL` overrides the primary model but never the fallback: a key that
 * cannot reach one model can usually still reach the other, and a generation
 * request has to have somewhere left to go.
 */
export function geminiModels(): string[] {
  const configured = process.env.GEMINI_MODEL?.trim();
  const primary =
    configured && configured !== "gemini-flash-latest" ? configured : DEFAULT_GEMINI_MODEL;
  return [...new Set([primary, FALLBACK_GEMINI_MODEL])];
}

/** The configured key, or a message an operator can act on. */
export function geminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "AI is unavailable because GEMINI_API_KEY is not configured. Add a valid Gemini API key and restart the server.",
    );
  }
  return key;
}

type RequestOptions = {
  apiKey: string;
  model: string;
  systemInstruction: string;
  parts: GeminiPart[];
  temperature?: number;
  maxOutputTokens?: number;
};

/**
 * One `generateContent` call, returning the concatenated text parts.
 *
 * Transport failures, quota errors, an invalid key and an empty answer all come
 * back as a `GeminiRequestError`; the status is null only when the request never
 * reached Google.
 */
export async function requestGeminiText(options: RequestOptions): Promise<string> {
  const { apiKey, model, systemInstruction, parts, temperature = 0.65, maxOutputTokens } = options;

  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: parts.map(toRestPart) }],
        generationConfig: {
          temperature,
          topP: 0.85,
          topK: 40,
          responseMimeType: "application/json",
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
        },
      }),
    });
  } catch (error) {
    throw new GeminiRequestError(
      `Gemini network request failed for model "${model}": ${error instanceof Error ? error.message : String(error)}`,
      null,
    );
  }

  if (!res.ok) {
    const body = await res.text();
    let apiMessage = body.slice(0, 400);
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
      if (parsed.error?.message) {
        apiMessage = `${parsed.error.status ?? res.status}: ${parsed.error.message}`;
      }
    } catch {
      /* keep the raw body */
    }
    throw new GeminiRequestError(
      `Google Gemini API error (HTTP ${res.status}) for model "${model}" — ${apiMessage}`,
      res.status,
    );
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
}

/** The REST wire names differ from the SDK's; keep the translation in one place. */
function toRestPart(part: GeminiPart): Record<string, unknown> {
  return "text" in part
    ? { text: part.text }
    : {
        inline_data: {
          mime_type: part.inlineData.mimeType,
          data: part.inlineData.data,
        },
      };
}
