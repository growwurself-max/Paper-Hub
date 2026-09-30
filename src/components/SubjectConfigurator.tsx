import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/GlassCard";
import { Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

export interface SubjectConfig {
  id: string;
  subject: string;
  questionCount: number;
  marksPerQuestion: number;
  negativeMarking: number;
  file: File | null;
  manualText: string;
}

interface SubjectConfiguratorProps {
  subjects: SubjectConfig[];
  onSubjectsChange: (subjects: SubjectConfig[]) => void;
  totalQuestions?: number;
}

export function SubjectConfigurator({ subjects, onSubjectsChange, totalQuestions }: SubjectConfiguratorProps) {
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  const setFileRef = (index: number, el: HTMLInputElement | null) => {
    fileRefs.current[index] = el;
  };

  const addSubject = () => {
    const newSubject: SubjectConfig = {
      id: crypto.randomUUID(),
      subject: "",
      questionCount: 10,
      marksPerQuestion: 1,
      negativeMarking: 0,
      file: null,
      manualText: "",
    };
    onSubjectsChange([...subjects, newSubject]);
  };

  const removeSubject = (id: string) => {
    onSubjectsChange(subjects.filter((s) => s.id !== id));
  };

  const updateSubject = (id: string, updates: Partial<SubjectConfig>) => {
    onSubjectsChange(subjects.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  const handleFileUpload = (id: string, file: File | null) => {
    updateSubject(id, { file, manualText: "" });
  };

  const currentTotal = subjects.reduce((sum, s) => sum + s.questionCount, 0);

  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          2 · Subject Configuration
        </h2>
        <Button
          type="button"
          onClick={addSubject}
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={subjects.length >= 10}
        >
          <Plus className="h-4 w-4" />
          Add Subject
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Configure each subject with question count, marks, and content source
      </p>

      <div className="mt-4 space-y-4">
        {subjects.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No subjects added yet. Click "Add Subject" to begin.
            </p>
          </div>
        )}

        {subjects.map((subject, index) => (
          <div
            key={subject.id}
            className="rounded-lg border border-border bg-card/50 p-4 space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`subject-${subject.id}`}>Subject Name *</Label>
                    <Input
                      id={`subject-${subject.id}`}
                      value={subject.subject}
                      onChange={(e) => updateSubject(subject.id, { subject: e.target.value })}
                      placeholder="e.g., Physics, Mathematics"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`count-${subject.id}`}>Number of Questions *</Label>
                    <Input
                      id={`count-${subject.id}`}
                      type="number"
                      min={1}
                      max={300}
                      value={subject.questionCount}
                      onChange={(e) =>
                        updateSubject(subject.id, {
                          questionCount: Math.max(1, parseInt(e.target.value) || 1),
                        })
                      }
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`marks-${subject.id}`}>Marks per Question</Label>
                    <Input
                      id={`marks-${subject.id}`}
                      type="number"
                      min={0}
                      max={20}
                      step={0.5}
                      value={subject.marksPerQuestion}
                      onChange={(e) =>
                        updateSubject(subject.id, {
                          marksPerQuestion: Math.max(0, parseFloat(e.target.value) || 0),
                        })
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`negative-${subject.id}`}>Negative Marking</Label>
                    <Input
                      id={`negative-${subject.id}`}
                      type="number"
                      min={0}
                      max={5}
                      step={0.25}
                      value={subject.negativeMarking}
                      onChange={(e) =>
                        updateSubject(subject.id, {
                          negativeMarking: Math.max(0, parseFloat(e.target.value) || 0),
                        })
                      }
                      className="mt-1"
                    />
                  </div>
                </div>

                <div>
                  <Label>Content Source *</Label>
                  <div className="mt-2 space-y-3">
                    <div>
                      <Label htmlFor={`file-${subject.id}`} className="text-sm text-muted-foreground">
                        Upload PDF/Document
                      </Label>
                      <input
                        ref={(el) => setFileRef(index, el)}
                        id={`file-${subject.id}`}
                        type="file"
                        accept=".pdf,.doc,.docx,.txt,.md,.csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          handleFileUpload(subject.id, file);
                        }}
                        className="mt-1 block w-full cursor-pointer rounded-lg border border-border bg-input px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
                      />
                    </div>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">Or</span>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor={`manual-${subject.id}`} className="text-sm text-muted-foreground">
                        Manual Question Entry
                      </Label>
                      <textarea
                        id={`manual-${subject.id}`}
                        rows={4}
                        value={subject.manualText}
                        onChange={(e) => updateSubject(subject.id, { manualText: e.target.value, file: null })}
                        placeholder="Enter questions manually (one per line or in a structured format)"
                        className="input mt-1"
                        disabled={!!subject.file}
                      />
                    </div>
                  </div>
                </div>

                {subject.file && (
                  <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm">
                    <Upload className="h-4 w-4 text-primary" />
                    <span className="flex-1 truncate">{subject.file.name}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        updateSubject(subject.id, { file: null });
                        if (fileRefs.current[index]) {
                          fileRefs.current[index].value = "";
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => removeSubject(subject.id)}
                className="mt-1 shrink-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {subjects.length > 0 && (
        <div className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span className="font-medium">Total Questions:</span> {currentTotal}
          {totalQuestions && currentTotal !== totalQuestions && (
            <span className="ml-2 text-destructive">
              (Target: {totalQuestions})
            </span>
          )}
        </div>
      )}
    </GlassCard>
  );
}
