import { extractPdfText } from "@/lib/pdf-extract";

export interface ParsedSubjectSection {
  subject: string;
  questions: Array<{
    question: string;
    options?: string[];
    answer: string;
    type: "mcq" | "numeric" | "short" | "long";
  }>;
}

/**
 * Parse a combined document and categorize questions by subject.
 * This uses AI to detect subject sections and extract questions.
 */
export async function parseCombinedDocument(
  file: File,
  apiKey: string,
  onProgress?: (status: string) => void,
): Promise<ParsedSubjectSection[]> {
  onProgress?.("Reading document...");
  let text = "";

  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (extension === "pdf") {
    text = await extractPdfText(file, (page, total) =>
      onProgress?.(`Extracting text — page ${page} of ${total}...`),
    );
  } else if (extension === "doc" || extension === "docx") {
    const { default: WordExtractor } = await import("word-extractor");
    const document = await new WordExtractor().extract(Buffer.from(await file.arrayBuffer()));
    text = document.getBody().trim();
  } else {
    text = await file.text();
  }

  if (text.replace(/\s/g, "").length < 40) {
    throw new Error("The uploaded document does not contain enough readable text.");
  }

  onProgress?.("Analyzing document structure and categorizing questions...");

  // Use AI to parse and categorize the document
  const sections = await categorizeQuestionsWithAI(text, apiKey);

  return sections;
}

/**
 * Use AI to categorize questions by subject from a combined document.
 */
async function categorizeQuestionsWithAI(
  text: string,
  apiKey: string,
): Promise<ParsedSubjectSection[]> {
  const systemPrompt = `You are an expert academic content analyzer. Your task is to parse a combined exam paper document and categorize questions by subject.

Analyze the document and:
1. Identify distinct subject sections (e.g., Physics, Chemistry, Mathematics, Biology)
2. Extract all questions within each section
3. Determine the question type (MCQ, numeric, short answer, long answer)
4. Extract options for MCQs
5. Identify the correct answer for each question

Return ONLY valid JSON with this exact structure:
{
  "sections": [
    {
      "subject": "Physics",
      "questions": [
        {
          "question": "The question text",
          "options": ["A. option1", "B. option2", "C. option3", "D. option4"],
          "answer": "A. option1",
          "type": "mcq"
        }
      ]
    }
  ]
}

Rules:
- Subject names should be standard academic subjects (Physics, Chemistry, Mathematics, Biology, etc.)
- MCQs must have exactly 4 options labelled A, B, C, D
- Numeric questions have no options and require a numerical answer
- Short/long answers have no options
- If the document has no clear subject divisions, treat it as a single section with the most appropriate subject name
- Preserve the original question numbering if present`;

  const userPrompt = `Parse this exam paper document and categorize all questions by subject:\n\n"""\n${text.slice(0, 50000)}\n"""`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI parsing failed: ${error}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  if (!content.trim()) {
    throw new Error("AI returned an empty response");
  }

  const cleaned = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed = JSON.parse(cleaned) as { sections?: ParsedSubjectSection[] };

  if (!parsed.sections || parsed.sections.length === 0) {
    throw new Error("AI could not identify any subject sections in the document");
  }

  return parsed.sections;
}

/**
 * Parse subject-wise uploads - each subject has its own file or text.
 */
export async function parseSubjectWiseUploads(
  subjects: Array<{
    subject: string;
    file: File | null;
    manualText: string;
    questionCount: number;
    marksPerQuestion: number;
    negativeMarking: number;
  }>,
  apiKey: string,
  onProgress?: (status: string) => void,
): Promise<ParsedSubjectSection[]> {
  const sections: ParsedSubjectSection[] = [];

  for (let i = 0; i < subjects.length; i++) {
    const subjectData = subjects[i]!;
    onProgress?.(`Processing ${subjectData.subject} (${i + 1}/${subjects.length})...`);

    let text = subjectData.manualText;
    if (subjectData.file) {
      const extension = subjectData.file.name.toLowerCase().split(".").pop() ?? "";
      if (extension === "pdf") {
        text = await extractPdfText(subjectData.file);
      } else if (extension === "doc" || extension === "docx") {
        const { default: WordExtractor } = await import("word-extractor");
        const document = await new WordExtractor().extract(
          Buffer.from(await subjectData.file.arrayBuffer()),
        );
        text = document.getBody().trim();
      } else {
        text = await subjectData.file.text();
      }
    }

    if (!text || text.replace(/\s/g, "").length < 40) {
      throw new Error(`Subject "${subjectData.subject}" does not contain enough readable text.`);
    }

    // Parse questions from the subject's content
    const questions = await extractQuestionsFromSubjectText(text, apiKey, subjectData.subject);

    sections.push({
      subject: subjectData.subject,
      questions,
    });
  }

  return sections;
}

/**
 * Extract questions from a single subject's text content.
 */
async function extractQuestionsFromSubjectText(
  text: string,
  apiKey: string,
  subjectName: string,
): Promise<Array<{
  question: string;
  options?: string[];
  answer: string;
  type: "mcq" | "numeric" | "short" | "long";
}>> {
  const systemPrompt = `You are an expert question extractor for ${subjectName}. Extract all questions from the provided text.

Return ONLY valid JSON with this exact structure:
{
  "questions": [
    {
      "question": "The question text",
      "options": ["A. option1", "B. option2", "C. option3", "D. option4"],
      "answer": "A. option1",
      "type": "mcq"
    }
  ]
}

Rules:
- MCQs must have exactly 4 options labelled A, B, C, D
- Numeric questions have no options
- Short/long answers have no options
- Preserve the original question numbering if present
- If the text contains fewer questions than expected, extract all available questions`;

  const userPrompt = `Extract all questions from this ${subjectName} content:\n\n"""\n${text.slice(0, 50000)}\n"""`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI extraction failed: ${error}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  if (!content.trim()) {
    throw new Error("AI returned an empty response");
  }

  const cleaned = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed = JSON.parse(cleaned) as { questions?: Array<any> };

  if (!parsed.questions || parsed.questions.length === 0) {
    throw new Error(`No questions found in ${subjectName} content`);
  }

  return parsed.questions;
}
