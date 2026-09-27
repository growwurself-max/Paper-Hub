import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { supabase } from "@/integrations/supabase/client";
import { extractPdfText } from "@/lib/pdf-extract";
import { deleteSyllabus, getMyOrgId, listSyllabi, saveSyllabus } from "@/lib/syllabus.functions";

export const Route = createFileRoute("/_authenticated/syllabi")({
  head: () => ({
    meta: [
      { title: "Syllabus Library — Question Paper Studio" },
      {
        name: "description",
        content: "Upload syllabus or concept PDFs so AI generates questions from your own content.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SyllabiPage,
});

const SUPPORTED_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "md", "csv", "rtf"]);

function SyllabiPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSyllabi);
  const saveFn = useServerFn(saveSyllabus);
  const delFn = useServerFn(deleteSyllabus);
  const orgFn = useServerFn(getMyOrgId);
  const fileRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");

  const list = useQuery({ queryKey: ["syllabi"], queryFn: () => listFn() });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setError(null);
      if (!subject.trim()) throw new Error("Enter the subject before selecting a file.");
      const extension = file.name.toLowerCase().split(".").pop() ?? "";
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error("Supported formats: PDF, DOC, DOCX, TXT, MD, CSV, and RTF.");
      }
      if (file.size > 20 * 1024 * 1024) throw new Error("Document must be under 20 MB.");

      let text = "";
      if (extension === "pdf") {
        setStatus("Reading PDF…");
        text = await extractPdfText(file, (page, total) =>
          setStatus(`Extracting text — page ${page} of ${total}…`),
        );
      } else if (extension === "doc" || extension === "docx") {
        setStatus("Uploading Word document for secure text extraction…");
      } else {
        setStatus("Reading text file…");
        text = await file.text();
      }
      if (extension !== "doc" && extension !== "docx" && text.replace(/\s/g, "").length < 40) {
        throw new Error(
          "No usable text found. Please upload a text-based document rather than a scanned or empty file.",
        );
      }

      setStatus("Uploading file…");
      const { organizationId } = await orgFn();
      if (!organizationId) throw new Error("No organization assigned to your account.");
      const path = `${organizationId}/${crypto.randomUUID()}.${extension}`;
      const { error: upErr } = await supabase.storage
        .from("syllabus-pdfs")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) throw new Error(upErr.message);

      setStatus("Analysing chapters and keywords…");
      return saveFn({
        data: { filename: file.name, subject, storagePath: path, extractedText: text },
      });
    },
    onSuccess: () => {
      setStatus(null);
      setSubject("");
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["syllabi"] });
    },
    onError: (e: Error) => {
      setStatus(null);
      setError(e.message);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["syllabi"] }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-bold gradient-text">Syllabus &amp; concept library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a syllabus, chapter notes or concept PDF. Text is extracted in your browser and
          used as the source material for AI question generation.
        </p>

        <GlassCard className="mt-6">
          <label className="block text-sm font-medium">Upload subject syllabus or concept material</label>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject, e.g. Physics or Mathematics"
            disabled={upload.isPending}
            className="input mt-2"
            required
          />
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt,.md,.csv,.rtf"
            disabled={upload.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
            }}
            className="mt-2 block w-full cursor-pointer rounded-lg border border-border bg-input px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
          />
          {status && <p className="mt-3 text-sm text-muted-foreground">{status}</p>}
          {error && (
            <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </GlassCard>

        <div className="mt-6 space-y-4">
          {list.isLoading && <div className="glass h-24 animate-pulse rounded-2xl" />}
          {list.data?.length === 0 && (
            <GlassCard>
              <p className="text-sm text-muted-foreground">
                No documents yet. Upload your first subject syllabus above.
              </p>
            </GlassCard>
          )}
          {list.data?.map((s) => (
            <GlassCard key={s.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{s.filename}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.subject || "General"} · {new Date(s.createdAt).toLocaleString()} · {s.charCount.toLocaleString()}{" "}
                    characters · {s.chapters.length} chapters detected
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    to="/papers/new"
                    search={{ syllabusId: s.id }}
                    className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    Generate paper
                  </Link>
                  <button
                    onClick={() => remove.mutate(s.id)}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-card"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {s.chapters.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.chapters.slice(0, 12).map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}
