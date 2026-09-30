import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/GlassCard";
import { Upload, FileText, X } from "lucide-react";
import { useRef, useState } from "react";

interface AllInOneUploadProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  onTextChange?: (text: string) => void;
}

export function AllInOneUpload({ file, onFileChange, onTextChange }: AllInOneUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      validateAndSetFile(droppedFile);
    }
  };

  const validateAndSetFile = (newFile: File) => {
    const extension = newFile.name.toLowerCase().split(".").pop() ?? "";
    const supportedExtensions = new Set(["pdf", "doc", "docx", "txt", "md", "csv", "xlsx", "xls"]);
    
    if (!supportedExtensions.has(extension)) {
      alert("Supported formats: PDF, DOC, DOCX, TXT, MD, CSV, XLSX, and XLS.");
      return;
    }
    
    if (newFile.size > 50 * 1024 * 1024) {
      alert("Document must be under 50 MB.");
      return;
    }
    
    onFileChange(newFile);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    if (selectedFile) {
      validateAndSetFile(selectedFile);
    }
  };

  const removeFile = () => {
    onFileChange(null);
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  };

  return (
    <GlassCard>
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        2 · Upload Combined Document
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Upload a single document containing questions for all subjects. The system will
        automatically categorize and organize them.
      </p>

      <div className="mt-4 space-y-4">
        {!file ? (
          <div
            className={`relative rounded-lg border-2 border-dashed p-8 text-center transition ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-card/50"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls"
              onChange={handleFileSelect}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-sm font-medium">
              Drag and drop your document here, or click to browse
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Supports PDF, DOC, DOCX, TXT, MD, CSV, XLSX, XLS (max 50 MB)
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-primary/10 p-2">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{file.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={removeFile}
                className="text-destructive hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="manual-text">Or Paste Questions Directly</Label>
          <textarea
            id="manual-text"
            rows={8}
            placeholder="Paste your combined question paper text here. The system will automatically detect subjects and categorize questions."
            className="input mt-1"
            onChange={(e) => onTextChange?.(e.target.value)}
            disabled={!!file}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Supported formats: Structured text with subject headers, CSV, or plain text with
            clear question numbering.
          </p>
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span className="font-medium">Note:</span> Questions will be automatically categorized
          by subject using AI analysis. For best results, include clear subject headers or section
          markers in your document.
        </div>
      </div>
    </GlassCard>
  );
}
