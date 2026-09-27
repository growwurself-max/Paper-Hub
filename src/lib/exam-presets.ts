export type ExamPreset = {
  id: string;
  name: string;
  tagline: string;
  board: string;
  subjectSuggestions: string[];
  stream?: "MPC" | "BiPC" | "General";
  className: string;
  duration: string;
  totalMarks: number;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  distribution: { mcq: number; numeric: number; short: number; long: number };
  /** Marks awarded per question of each type (official pattern). */
  marks: { mcq: number; numeric: number; short: number; long: number };
  negativeMarking: number;
  omr: boolean;
  instructions: string;
};

export const EXAM_PRESETS: ExamPreset[] = [
  {
    id: "neet",
    name: "NEET (UG)",
    tagline: "180 MCQs · Physics, Chemistry, Biology · OMR",
    board: "NEET",
    subjectSuggestions: ["Physics", "Chemistry", "Botany", "Zoology"],
    stream: "BiPC",
    className: "Class 12 / Repeater",
    duration: "3 hours 20 minutes",
    totalMarks: 720,
    difficulty: "hard",
    distribution: { mcq: 180, numeric: 0, short: 0, long: 0 },
    marks: { mcq: 4, numeric: 0, short: 0, long: 0 },
    negativeMarking: 1,
    omr: true,
    instructions:
      "Section A contains mandatory MCQs. Section B contains choice-based MCQs; follow the required attempt count. Each question carries 4 marks and 1 mark is deducted for every incorrect response. Darken only one bubble per question on the OMR sheet using a black/blue ball point pen.",
  },
  {
    id: "jee-main",
    name: "JEE Main",
    tagline: "75 MCQs · Physics, Chemistry, Maths · OMR",
    board: "JEE Main",
    subjectSuggestions: ["Physics", "Chemistry", "Mathematics"],
    stream: "MPC",
    className: "Class 12",
    duration: "3 hours",
    totalMarks: 120,
    difficulty: "hard",
    distribution: { mcq: 20, numeric: 10, short: 0, long: 0 },
    marks: { mcq: 4, numeric: 4, short: 0, long: 0 },
    negativeMarking: 1,
    omr: true,
    instructions:
      "All questions are multiple-choice with one correct answer. Each question carries 4 marks and 1 mark is deducted for every incorrect response. Use of calculators is not permitted.",
  },
  {
    id: "jee-advanced",
    name: "JEE Advanced",
    tagline: "High-difficulty MCQs · Physics, Chemistry, Maths",
    board: "JEE Advanced",
    subjectSuggestions: ["Physics", "Chemistry", "Mathematics"],
    stream: "MPC",
    className: "Class 12",
    duration: "3 hours",
    totalMarks: 180,
    difficulty: "hard",
    distribution: { mcq: 45, numeric: 0, short: 0, long: 0 },
    marks: { mcq: 4, numeric: 0, short: 0, long: 0 },
    negativeMarking: 2,
    omr: true,
    instructions:
      "All questions are high-difficulty multiple-choice questions with one correct answer. Negative marking of 2 marks applies to incorrect responses.",
  },
  {
    id: "eamcet",
    name: "EAMCET / EAPCET",
    tagline: "AP & TS engineering / agriculture entrance · OMR",
    board: "EAMCET (EAPCET)",
    subjectSuggestions: ["Mathematics", "Physics", "Chemistry", "Biology"],
    stream: "MPC",
    className: "Intermediate 2nd Year",
    duration: "3 hours",
    totalMarks: 160,
    difficulty: "medium",
    distribution: { mcq: 160, numeric: 0, short: 0, long: 0 },
    marks: { mcq: 1, numeric: 0, short: 0, long: 0 },
    negativeMarking: 0,
    omr: true,
    instructions:
      "All questions carry 1 mark each. There is no negative marking. Answer on the OMR sheet by darkening the appropriate bubble completely.",
  },
  {
    id: "cbse-10",
    name: "CBSE Class 10 Board",
    tagline: "Sections A–C · descriptive board pattern",
    board: "CBSE",
    subjectSuggestions: ["Mathematics", "Science", "Social Science", "English"],
    className: "Class 10",
    duration: "3 hours",
    totalMarks: 80,
    difficulty: "medium",
    distribution: { mcq: 20, numeric: 0, short: 10, long: 6 },
    marks: { mcq: 1, numeric: 0, short: 3, long: 5 },
    negativeMarking: 0,
    omr: false,
    instructions:
      "All questions are compulsory. Section A carries 1 mark each, Section B 3 marks each and Section C 5 marks each. Draw neat diagrams wherever necessary.",
  },
  {
    id: "cbse-12",
    name: "CBSE Class 12 Board",
    tagline: "Competency-based board pattern",
    board: "CBSE",
    subjectSuggestions: ["Physics", "Chemistry", "Biology", "Accountancy", "Economics"],
    className: "Class 12",
    duration: "3 hours",
    totalMarks: 70,
    difficulty: "medium",
    distribution: { mcq: 16, numeric: 0, short: 7, long: 3 },
    marks: { mcq: 1, numeric: 0, short: 2, long: 5 },
    negativeMarking: 0,
    omr: false,
    instructions:
      "All questions are compulsory. Internal choice is provided in long answer questions. Use of log tables is permitted where required.",
  },
  {
    id: "state-board",
    name: "State Board / Intermediate",
    tagline: "Balanced descriptive paper",
    board: "State Board",
    subjectSuggestions: ["Physics", "Chemistry", "Mathematics", "Commerce"],
    className: "Intermediate 1st Year",
    duration: "3 hours",
    totalMarks: 100,
    difficulty: "mixed",
    distribution: { mcq: 15, numeric: 0, short: 10, long: 5 },
    marks: { mcq: 1, numeric: 0, short: 4, long: 6 },
    negativeMarking: 0,
    omr: false,
    instructions:
      "Answer all questions. Marks are indicated against each question. Write legibly and label diagrams clearly.",
  },
  {
    id: "unit-test",
    name: "Quick Unit Test",
    tagline: "Short classroom assessment",
    board: "",
    subjectSuggestions: ["Any subject"],
    className: "Class 9",
    duration: "1 hour",
    totalMarks: 25,
    difficulty: "easy",
    distribution: { mcq: 10, numeric: 0, short: 3, long: 1 },
    marks: { mcq: 1, numeric: 0, short: 3, long: 5 },
    negativeMarking: 0,
    omr: true,
    instructions: "Attempt all questions within the given time. Neat handwriting is expected.",
  },
  {
    id: "omr",
    name: "OMR Only",
    tagline: "Pure OMR sheet · Multiple choice only",
    board: "",
    subjectSuggestions: ["Any subject"],
    className: "",
    duration: "3 hours",
    totalMarks: 100,
    difficulty: "mixed",
    distribution: { mcq: 100, numeric: 0, short: 0, long: 0 },
    marks: { mcq: 1, numeric: 0, short: 0, long: 0 },
    negativeMarking: 0.25,
    omr: true,
    instructions: "Use a black or blue ball point pen to darken the bubble completely. Only one bubble per question will be evaluated.",
  },
  {
    id: "custom",
    name: "Custom paper",
    tagline: "Start from scratch, configure everything",
    board: "",
    subjectSuggestions: [],
    className: "",
    duration: "3 hours",
    totalMarks: 100,
    difficulty: "mixed",
    distribution: { mcq: 10, numeric: 0, short: 5, long: 3 },
    marks: { mcq: 1, numeric: 0, short: 3, long: 5 },
    negativeMarking: 0,
    omr: false,
    instructions: "",
  },
];

export function getPreset(id: string): ExamPreset {
  return EXAM_PRESETS.find((p) => p.id === id) ?? EXAM_PRESETS[EXAM_PRESETS.length - 1]!;
}
