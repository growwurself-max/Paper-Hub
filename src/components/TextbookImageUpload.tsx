import { useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Loader2, Upload, X } from "lucide-react";
import {
  MAX_TEXTBOOK_IMAGES,
  compressTextbookImage,
  formatMegabytes,
  textbookRequestTooLarge,
  validateTextbookImageFile,
  type TextbookPage,
} from "@/lib/textbook-images";

const FILE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

type TextbookImageUploadProps = {
  pages: TextbookPage[];
  onPagesChange: (pages: TextbookPage[]) => void;
  /** True while the parent is busy (analysing the pages). */
  busy?: boolean;
};

/**
 * Textbook page photos: pick from the gallery or open the phone camera, then
 * review and order the pages before they are read.
 *
 * Each page is downscaled and re-encoded here in the browser, so what the model
 * receives is a compact JPEG that still resolves body text. The compressed
 * payload is held in component state and handed upward; nothing is uploaded
 * until the teacher asks for it, and no page is persisted anywhere.
 */
export function TextbookImageUpload({
  pages,
  onPagesChange,
  busy = false,
}: TextbookImageUploadProps) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const full = pages.length >= MAX_TEXTBOOK_IMAGES;

  async function addFiles(incoming: FileList | File[] | null) {
    if (!incoming || incoming.length === 0) return;
    const files = Array.from(incoming);
    const rejected: string[] = [];
    const usable: File[] = [];

    for (const file of files) {
      const problem = validateTextbookImageFile(file);
      if (problem) rejected.push(problem);
      else if (pages.length + usable.length >= MAX_TEXTBOOK_IMAGES) {
        rejected.push(
          `You can add up to ${MAX_TEXTBOOK_IMAGES} pages at a time. The rest can go into a second paper.`,
        );
        break;
      } else usable.push(file);
    }
    setProblems(rejected);
    if (usable.length === 0) return;

    setPreparing(`Preparing page${usable.length === 1 ? "" : "s"} ${pages.length + 1}…`);
    const added: TextbookPage[] = [];
    try {
      for (const file of usable) {
        added.push(await compressTextbookImage(file));
      }
    } catch (error) {
      setProblems([
        ...rejected,
        error instanceof Error ? error.message : "That photo could not be prepared for reading.",
      ]);
      // Keep whatever was prepared before the failure: a batch of good pages
      // should not be lost because the last one was unreadable.
      if (added.length > 0) onPagesChange([...pages, ...added]);
      return;
    } finally {
      setPreparing(null);
    }

    const next = [...pages, ...added];
    const tooLarge = textbookRequestTooLarge(next);
    if (tooLarge) {
      setProblems([...rejected, tooLarge]);
      onPagesChange(next.slice(0, MAX_TEXTBOOK_IMAGES));
      return;
    }
    setProblems(rejected);
    onPagesChange(next);
    if (galleryRef.current) galleryRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  function removePage(id: string) {
    onPagesChange(pages.filter((page) => page.id !== id));
  }

  function movePage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const reordered = [...pages];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    onPagesChange(reordered);
  }

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Textbook pages</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {pages.length} of {MAX_TEXTBOOK_IMAGES} pages added. Numbered in the order shown.
          </p>
        </div>
        {pages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onPagesChange([]);
              setProblems([]);
            }}
            disabled={busy}
            className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-60"
          >
            Remove all
          </button>
        )}
      </div>

      {pages.length === 0 ? (
        <div
          onDragEnter={() => setDragging(true)}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(event.dataTransfer.files);
          }}
          className={`mt-3 rounded-lg border-2 border-dashed p-6 text-center transition ${
            dragging ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Drop textbook page photos here</p>
          <p className="mt-1 text-xs text-muted-foreground">
            JPG, PNG or WebP · each photo under {formatMegabytes(15 * 1024 * 1024)}
          </p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {pages.map((page, index) => (
            <li
              key={page.id}
              className="overflow-hidden rounded-lg border border-border bg-background"
            >
              <div className="relative">
                <img
                  src={page.dataUrl}
                  alt={`Textbook page ${index + 1}`}
                  className="aspect-3/4 w-full object-cover"
                />
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  Page {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removePage(page.id)}
                  disabled={busy}
                  aria-label={`Remove page ${index + 1}`}
                  className="absolute right-1.5 top-1.5 rounded-md bg-black/70 p-1 text-white hover:bg-destructive disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                <button
                  type="button"
                  onClick={() => movePage(index, -1)}
                  disabled={busy || index === 0}
                  aria-label={`Move page ${index + 1} earlier`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="truncate text-[10px] text-muted-foreground">
                  {(page.bytes / 1024).toFixed(0)} KB
                </span>
                <button
                  type="button"
                  onClick={() => movePage(index, 1)}
                  disabled={busy || index === pages.length - 1}
                  aria-label={`Move page ${index + 1} later`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={busy || preparing !== null || full}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Camera className="h-4 w-4" />
          Take photo
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          disabled={busy || preparing !== null || full}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-card disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {pages.length === 0 ? "Upload images" : "Add another page"}
        </button>
        {preparing && (
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {preparing}
          </span>
        )}
      </div>

      {/* `capture` opens the rear camera on a phone and the file picker on a desktop. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        className="sr-only"
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {full && pages.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {MAX_TEXTBOOK_IMAGES} pages is the most one paper can read. Remove a page to swap it for
          another.
        </p>
      )}

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
