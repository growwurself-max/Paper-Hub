import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const saveInput = z.object({
  filename: z.string().min(1).max(255),
  subject: z.string().max(100).default(""),
  storagePath: z.string().min(1).max(500),
  extractedText: z.string().max(400_000).default(""),
});

export const listSyllabi = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("uploaded_syllabi")
      .select("id, filename, subject, storage_path, chapters, keywords, created_at, extracted_text")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      filename: row.filename,
      subject: row.subject,
      storagePath: row.storage_path,
      chapters: (row.chapters as unknown as string[]) ?? [],
      keywords: (row.keywords as unknown as string[]) ?? [],
      createdAt: row.created_at,
      charCount: (row.extracted_text ?? "").length,
    }));
  });

export const getMyOrgId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .single();
    return { organizationId: data?.organization_id ?? null };
  });

export const saveSyllabus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .single();
    const orgId = profile?.organization_id;
    if (!orgId) throw new Error("No organization assigned to your account.");

    let extractedText = data.extractedText;
    if (/\.(?:doc|docx)$/i.test(data.filename)) {
      const { data: file, error: downloadError } = await context.supabase.storage
        .from("syllabus-pdfs")
        .download(data.storagePath);
      if (downloadError || !file) {
        throw new Error(downloadError?.message ?? "Could not read the uploaded Word document.");
      }
      const { default: WordExtractor } = await import("word-extractor");
      const document = await new WordExtractor().extract(Buffer.from(await file.arrayBuffer()));
      extractedText = document.getBody().trim();
    }
    if (extractedText.replace(/\s/g, "").length < 40) {
      throw new Error("The uploaded document does not contain enough readable text.");
    }

    const { chapters, keywords } = analyseSyllabus(extractedText);

    const { data: row, error } = await context.supabase
      .from("uploaded_syllabi")
      .insert({
        organization_id: orgId,
        uploaded_by: context.userId,
        filename: data.filename,
        subject: data.subject,
        storage_path: data.storagePath,
        extracted_text: extractedText,
        chapters: chapters as never,
        keywords: keywords as never,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, chapters, keywords };
  });

export const deleteSyllabus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("uploaded_syllabi")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const STOPWORDS = new Set(
  "the a an and or of to in for on with is are be as by from that this these those it its at which will can shall may not no all any each their there when what how also than then such using use used into more most other some only very we you your our they he she his her".split(
    " ",
  ),
);

/** Heuristic chapter + keyword extraction from raw syllabus text. */
export function analyseSyllabus(text: string): { chapters: string[]; keywords: string[] } {
  const lines = text
    // PDF text extraction often flattens bullet lists onto one line — split on bullet glyphs.
    .replace(/[\u2022\u25cf\u25aa\u25a0\u00b7\uf0a7\uf0b7\u2023\u2043]/g, "\n")
    .split(/\r?\n/)
    .map((l) =>
      l
        // strip common PDF bullet glyphs at the start of a line
        .replace(/^[\s\u00a0]*[\u2022\u25cf\u25aa\u25a0\u00b7\uf0a7\uf0b7\u2023\u2043\-–—*]+\s*/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  const chapterRe =
    /^(?:chapter|unit|lesson|module|topic|section|part)\s*[-–:.]?\s*(\d+|[ivxlc]+)\s*[-–:.)]?\s*(.{2,90})$/i;
  const numberedRe = /^(\d{1,2})[.)]\s+(.{3,90})$/;

  const chapters: string[] = [];
  for (const line of lines) {
    // "Laws of Motion: Newton's laws, impulse…" → chapter is the part before the colon.
    const colonRe = /^([A-Z][A-Za-z0-9''()&,.\-\s]{2,70}?)\s*:\s*\S/;
    const m = chapterRe.exec(line) ?? numberedRe.exec(line) ?? colonRe.exec(line);
    if (m) {
      const label = (m[2] ?? m[1] ?? "").replace(/[.\s]+$/, "").trim();
      if (label && label.length >= 3 && !chapters.includes(label)) chapters.push(label);
    }
  }
  if (chapters.length === 0) {
    for (const line of lines) {
      const isHeadingCase =
        line.length >= 4 && line.length <= 70 && /^[A-Z0-9][^.!?]*$/.test(line) && !line.endsWith(",");
      if (isHeadingCase && !chapters.includes(line)) chapters.push(line);
      if (chapters.length >= 25) break;
    }
  }

  const freq = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (STOPWORDS.has(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([w]) => w);

  return { chapters: chapters.slice(0, 40), keywords };
}
