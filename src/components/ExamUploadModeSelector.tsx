import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/GlassCard";

export type UploadMode = "subject-wise" | "all-in-one";

interface ExamUploadModeSelectorProps {
  mode: UploadMode;
  onModeChange: (mode: UploadMode) => void;
}

export function ExamUploadModeSelector({ mode, onModeChange }: ExamUploadModeSelectorProps) {
  return (
    <GlassCard>
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        1 · Upload Mode
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose how you want to provide exam content
      </p>
      <RadioGroup value={mode} onValueChange={(value) => onModeChange(value as UploadMode)} className="mt-4">
        <div className="space-y-3">
          <div
            className={`flex items-start space-x-3 rounded-lg border p-4 transition ${
              mode === "subject-wise"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-card/50"
            }`}
          >
            <RadioGroupItem value="subject-wise" id="subject-wise" className="mt-1" />
            <div className="flex-1">
              <Label htmlFor="subject-wise" className="cursor-pointer font-medium">
                Subject-Wise Upload
              </Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Add multiple subjects separately (e.g., Mathematics, Physics, Chemistry). Upload individual
                PDFs or enter questions for each subject with custom question counts and marks.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                  Multi-subject exams
                </span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                  Per-subject configuration
                </span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                  EAMCET, NEET, JEE style
                </span>
              </div>
            </div>
          </div>

          <div
            className={`flex items-start space-x-3 rounded-lg border p-4 transition ${
              mode === "all-in-one"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-card/50"
            }`}
          >
            <RadioGroupItem value="all-in-one" id="all-in-one" className="mt-1" />
            <div className="flex-1">
              <Label htmlFor="all-in-one" className="cursor-pointer font-medium">
                All-in-One Upload
              </Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a single combined document (PDF, spreadsheet, or text). The system will
                automatically extract and categorize questions by subject.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                  Single document
                </span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                  Auto-categorization
                </span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                  Quick setup
                </span>
              </div>
            </div>
          </div>
        </div>
      </RadioGroup>
    </GlassCard>
  );
}
