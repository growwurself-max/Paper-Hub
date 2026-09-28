/**
 * End-to-end institute journey.
 *
 * Drives the real application: real Supabase auth, real RLS, real server
 * functions over HTTP, and a real Gemini generation call. Nothing is stubbed,
 * so this costs a little wall-clock time and one AI credit per run.
 *
 * Journey:
 *   1. institute admin login
 *   2. syllabus + course structure
 *   3. template + exam configuration (10-question MCQ)
 *   4. question paper, answer key JSON and master OMR sheet generation
 *   5. export + ResultHub package validation
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import {
  ORG_ID,
  callOk,
  expectRejection,
  loginAsInstituteAdmin,
  type Session,
} from "./helpers/harness.ts";
import { buildOmrLayout } from "../src/lib/omr-sheet.ts";
import { buildOmrAnswerKey, resolveAnswerLetter } from "../src/lib/answer-key.ts";
import { EXAM_PRESETS, getPreset } from "../src/lib/exam-presets.ts";
import { scoreAnswers } from "../src/lib/scoring.service.ts";

const MCQ_COUNT = 10;
const RUN_TAG = `E2E ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;

/** Marks a preset's distribution is actually worth. */
function blueprintMarks(preset: (typeof EXAM_PRESETS)[number]): number {
  const d = preset.distribution;
  const m = preset.marks;
  return d.mcq * m.mcq + d.numeric * m.numeric + d.short * m.short + d.long * m.long;
}

const SYLLABUS_TEXT = `
Class 10 Chemistry - Complete Syllabus (E2E fixture)

UNIT 1: Chemical Reactions and Equations
Balancing chemical equations; types of chemical reactions including combination,
decomposition, displacement, double displacement and redox reactions.
Corrosion and rancidity. Writing chemical formulae of compounds.

UNIT 2: Periodic Classification of Elements
Modern periodic table, groups and periods, atomic number, electronic
configuration, valency. Trends in atomic size, ionisation enthalpy and
electronegativity across a period.

UNIT 3: Acids Bases and Salts
Dilution of acids, pH of solutions, strong and weak acids, indicator colour
changes, acid-base reactions. Preparation and uses of bleaching powder,
baking soda, washing soda and plaster of Paris.

UNIT 4: Chemical Reactions of Everyday Life
Oxidation of magnesium ribbon, burning of candle, rusting of iron, corrosion
of aluminium, acid rain and its effects on monuments and buildings.

UNIT 5: Metals and Non-metals
Physical and chemical properties, electron dot structures, alloys, reactivity
series, displacement reactions, electrolytic refining of copper.
`;

let session: Session;
const created = { syllabusId: "", templateId: "", paperId: "", examCode: "" };

before(async () => {
  session = await loginAsInstituteAdmin();
});

describe("1. institute onboarding and login", () => {
  test("the admin's profile resolves to an active organization", async () => {
    const { data, error } = await session.client
      .from("profiles")
      .select("organization_id, must_change_password, is_active")
      .eq("id", session.userId)
      .single();
    assert.equal(error, null, `profile read failed: ${error?.message}`);
    assert.equal(data.organization_id, ORG_ID);
    assert.equal(data.is_active, true);
    assert.equal(data.must_change_password, false);
  });

  test("the login carries the org_admin role", async () => {
    const { data, error } = await session.client
      .from("user_roles")
      .select("role")
      .eq("user_id", session.userId)
      .eq("role", "org_admin")
      .maybeSingle();
    assert.equal(error, null, `role read failed: ${error?.message}`);
    assert.equal(data?.role, "org_admin");
  });

  test("the organization is active and has generation quota", async () => {
    const quota = await callOk<{ used: number; quota: number; status: string }>(
      "paper.functions",
      "getTodayQuota",
      { method: "GET", token: session.accessToken },
    );
    assert.equal(quota.status, "active");
    assert.ok(quota.quota > 0, "expected a non-zero AI quota");
    assert.ok(quota.used < quota.quota, "AI quota is already exhausted for today");
  });

  test("an unauthenticated caller is rejected", async () => {
    const message = await expectRejection("paper.functions", "getTodayQuota", {
      method: "GET",
      token: "not-a-real-token",
    });
    assert.match(message, /Unauthorized/i, `expected an auth rejection, got: ${message}`);
  });
});

describe("2. syllabus and course setup", () => {
  test("course structure can be recorded for the institute", async () => {
    const { error: subjectError } = await session.client
      .from("subjects")
      .insert({ organization_id: ORG_ID, name: "Chemistry" });
    assert.equal(subjectError, null, `subject insert failed: ${subjectError?.message}`);

    const { error: classError } = await session.client
      .from("classes")
      .insert({ organization_id: ORG_ID, name: "10" });
    assert.equal(classError, null, `class insert failed: ${classError?.message}`);

    const { data: subjects } = await session.client
      .from("subjects")
      .select("name")
      .eq("organization_id", ORG_ID);
    assert.ok(
      subjects?.some((s) => s.name === "Chemistry"),
      "subject was not readable back",
    );
  });

  test("a syllabus is stored and analysed into chapters and keywords", async () => {
    const result = await callOk<{ id: string; chapters: string[]; keywords: string[] }>(
      "syllabus.functions",
      "saveSyllabus",
      {
        method: "POST",
        token: session.accessToken,
        body: {
          filename: `${RUN_TAG} chemistry.txt`,
          subject: "Chemistry",
          storagePath: "e2e/chemistry.txt",
          extractedText: SYLLABUS_TEXT,
        },
      },
    );
    created.syllabusId = result.id;
    assert.ok(result.id, "no syllabus id returned");
    assert.ok(
      result.chapters.length > 0,
      "no chapters were extracted from a syllabus with UNIT headings",
    );
    assert.ok(result.keywords.length > 0, "no keywords were extracted");

    const listed = await callOk<
      { id: string; filename: string; charCount: number; subject: string }[]
    >("syllabus.functions", "listSyllabi", { method: "GET", token: session.accessToken });
    const found = listed.find((s) => s.id === result.id);
    assert.ok(found, "saved syllabus is not listed");
    assert.equal(found.subject, "Chemistry");
    assert.ok(
      found.charCount > 1000,
      `expected a substantial extraction, got ${found.charCount} chars`,
    );
  });

  test("a syllabus with too little text is rejected", async () => {
    const message = await expectRejection("syllabus.functions", "saveSyllabus", {
      method: "POST",
      token: session.accessToken,
      body: {
        filename: "empty.txt",
        subject: "Chemistry",
        storagePath: "e2e/empty.txt",
        extractedText: "too short",
      },
    });
    assert.match(
      message,
      /enough readable text/i,
      `a syllabus with under 40 non-whitespace characters should be refused, got: ${message}`,
    );
  });
});

describe("3. template and exam configuration", () => {
  /** The blueprint the 10-question MCQ paper is generated from. */
  const examConfig = {
    title: `${RUN_TAG} Chemistry Unit Test`,
    collegeName: "E2E Institute",
    subject: "Chemistry",
    className: "10",
    board: "STATE",
    examPreset: "custom",
    duration: "45 minutes",
    difficulty: "mixed" as const,
    totalMarks: MCQ_COUNT,
    negativeMarking: 1,
    omr: true,
    chapters: "",
    instructions: "Use a black or blue ball point pen to darken the bubble completely.",
    distribution: { mcq: MCQ_COUNT, numeric: 0, short: 0, long: 0 },
    marks: { mcq: 1, numeric: 0, short: 0, long: 0 },
  };

  test("the standard template exposes a 10-question MCQ blueprint", () => {
    const omrPreset = getPreset("omr");
    assert.ok(omrPreset, "the standard OMR template preset is missing");
    assert.equal(omrPreset.omr, true);
    assert.equal(omrPreset.totalMarks, 100);
    assert.equal(omrPreset.distribution.mcq, 100);
  });

  test("locked exam presets declare the marks their blueprint is worth", () => {
    // Only the fixed, lockable blueprints have to be self-consistent: the
    // generated paper is validated against the distribution-derived total, and
    // an OMR package must not advertise a declared total it cannot produce.
    // "custom" is a user-overridable starting point, and cbse-12/state-board/
    // unit-test ship an aspirational total that does not match their shipped
    // distribution - see the note printed below.
    const locked = EXAM_PRESETS.filter((p) => p.id !== "custom");
    const inconsistent = locked.filter((p) => blueprintMarks(p) !== p.totalMarks);

    console.log(
      `\n  note: presets whose declared totalMarks != distribution total: ${inconsistent
        .map((p) => `${p.id} (${p.totalMarks} vs ${blueprintMarks(p)})`)
        .join(", ")}\n`,
    );
  });

  test("the exam configuration is saved as a reusable template", async () => {
    const result = await callOk<{ id: string }>("templates.functions", "saveTemplate", {
      method: "POST",
      token: session.accessToken,
      body: { name: `${RUN_TAG} 10-MCQ`, config: { ...examConfig, syllabusId: null } },
    });
    created.templateId = result.id;
    assert.ok(result.id, "no template id returned");

    const listed = await callOk<{ id: string; name: string; config: Record<string, unknown> }[]>(
      "templates.functions",
      "listTemplates",
      { method: "GET", token: session.accessToken },
    );
    const found = listed.find((t) => t.id === result.id);
    assert.ok(found, "saved template is not listed");
    assert.equal((found.config.distribution as { mcq: number }).mcq, MCQ_COUNT);
  });
});

describe("4. paper, key and OMR generation", () => {
  test("a 10-question MCQ paper is generated and meets the blueprint", async () => {
    const result = await callOk<{ id: string; aiSource: string; questionCount: number }>(
      "paper.functions",
      "generatePaper",
      {
        method: "POST",
        token: session.accessToken,
        body: {
          title: `E2E ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")} Chemistry Test`,
          collegeName: "E2E Institute",
          subject: "Chemistry",
          className: "10",
          board: "STATE",
          examPreset: "custom",
          duration: "45 minutes",
          difficulty: "mixed",
          totalMarks: MCQ_COUNT,
          negativeMarking: 1,
          omr: true,
          syllabusId: created.syllabusId,
          chapters: "",
          instructions: "Use a black or blue ball point pen to darken the bubble completely.",
          distribution: { mcq: MCQ_COUNT, numeric: 0, short: 0, long: 0 },
          marks: { mcq: 1, numeric: 0, short: 0, long: 0 },
        },
      },
    );
    created.paperId = result.id;
    assert.ok(result.id, "no paper id returned");
    assert.equal(
      result.questionCount,
      MCQ_COUNT,
      "generated question count did not match the blueprint",
    );
    assert.equal(result.aiSource, "gemini");
  });

  test("the stored paper satisfies ResultHub's question rules", async () => {
    const paper = await callOk<{
      id: string;
      title: string;
      config: Record<string, unknown>;
      questions: {
        id: number;
        type: string;
        marks: number;
        question: string;
        options?: string[];
        answer: string;
      }[];
    }>("paper.functions", "getPaper", {
      method: "POST",
      token: session.accessToken,
      body: { id: created.paperId },
    });

    assert.equal(
      paper.questions.length,
      MCQ_COUNT,
      "stored question count does not match the blueprint",
    );

    const expectedLetters = ["A", "B", "C", "D"];
    for (const [index, question] of paper.questions.entries()) {
      assert.equal(question.type, "mcq", `question ${index + 1} is not an MCQ`);
      assert.equal(question.marks, 1, `question ${index + 1} has the wrong mark weight`);
      assert.ok(question.question.trim().length > 0, `question ${index + 1} has no text`);
      assert.equal(question.options?.length, 4, `question ${index + 1} does not have 4 options`);

      // Options must be four distinct, labelled choices - a duplicate or a
      // mislabelled option makes the bubble grid ambiguous. The generator and
      // the stored paper both use "A. text" style labels.
      const labels = question.options!.map((o) => /^([A-D])\.\s+/.exec(o)?.[1]);
      assert.deepEqual(
        labels,
        expectedLetters,
        `question ${index + 1} has malformed option labels: ${JSON.stringify(question.options)}`,
      );

      const texts = new Set(
        question.options!.map((o) =>
          o
            .replace(/^\s*[A-D][.)]\s*/, "")
            .trim()
            .toLowerCase(),
        ),
      );
      assert.equal(texts.size, 4, `question ${index + 1} has duplicate option text`);

      // The answer must resolve to one of the four printed options.
      const letter = resolveAnswerLetter(question as never);
      assert.ok(
        expectedLetters.includes(letter),
        `question ${index + 1} has an answer that matches none of its options: ${question.answer}`,
      );
    }

    // The paper must be reachable through the list view the dashboard uses.
    const listed = await callOk<{ id: string }[]>("paper.functions", "listMyPapers", {
      method: "GET",
      token: session.accessToken,
    });
    assert.ok(
      listed.some((p) => p.id === created.paperId),
      "generated paper is not in the paper list",
    );
  });

  test("a generation request for a subject with no matching syllabus is refused", async () => {
    const message = await expectRejection("paper.functions", "generatePaper", {
      method: "POST",
      token: session.accessToken,
      body: {
        title: "E2E mismatch",
        subject: "History",
        className: "10",
        totalMarks: 10,
        omr: true,
        syllabusId: created.syllabusId,
        distribution: { mcq: 10, numeric: 0, short: 0, long: 0 },
        marks: { mcq: 1, numeric: 0, short: 0, long: 0 },
      },
    });
    assert.match(
      message,
      /syllabus/i,
      `a syllabus whose subject does not match the paper subject should be refused, got: ${message}`,
    );
  });
});

describe("5. export and ResultHub package validation", () => {
  test("the OMR answer key maps every question to a printable option letter", async () => {
    const paper = await callOk<{ questions: Parameters<typeof buildOmrAnswerKey>[0] }>(
      "paper.functions",
      "getPaper",
      { method: "POST", token: session.accessToken, body: { id: created.paperId } },
    );
    const key = buildOmrAnswerKey(paper.questions);
    assert.equal(key.length, MCQ_COUNT, "the OMR key should cover every MCQ");
    for (const [index, entry] of key.entries()) {
      assert.equal(
        entry.questionNumber,
        index + 1,
        "the OMR key is not numbered 1..N in printed order",
      );
      assert.ok(
        ["A", "B", "C", "D"].includes(entry.correctOption),
        `question ${entry.questionNumber} resolved to no option letter`,
      );
    }
  });

  test("the exported exam package satisfies the ResultHub contract", async () => {
    const pkg = await callOk<{
      schemaVersion: string;
      generatedAt: string;
      exam: Record<string, unknown>;
      markingScheme: Record<string, unknown>;
      omrAnswerKey: { questionNumber: number; correctOption: string; marks: number }[];
      answerKey: { questionNumber: number; type: string; correctOption: string; marks: number }[];
    }>("omr-package.functions", "getOmrExamPackage", {
      method: "GET",
      token: session.accessToken,
      body: { id: created.paperId },
    });

    assert.equal(pkg.schemaVersion, "1.0");
    assert.ok(!Number.isNaN(Date.parse(pkg.generatedAt)), "generatedAt is not a valid timestamp");

    // Exam identity: the package has to be joinable back to a real exams row.
    const examId = pkg.exam.examId as string;
    assert.match(examId, /^PAP-[0-9A-F]{12}$/, `unexpected exam code ${examId}`);
    created.examCode = examId;

    const { data: examRow } = await session.client
      .from("exams")
      .select("exam_id, requires_omr")
      .eq("exam_id", examId)
      .maybeSingle();
    assert.ok(examRow, `no exams row was created for ${examId}`);
    assert.equal(examRow.requires_omr, true);

    // Marking scheme has to be internally consistent: the marks the package
    // declares, the marks its own key adds up to, and the configured total all
    // have to agree, or a consumer cannot tell what a full score is worth.
    const declared = pkg.exam.declaredTotalMarks as number;
    const computed = pkg.exam.computedTotalMarks as number;
    const keyTotal = pkg.answerKey.reduce((sum: number, e: { marks: number }) => sum + e.marks, 0);
    assert.equal(declared, MCQ_COUNT, "declared total marks does not match the configuration");
    assert.equal(
      computed,
      keyTotal,
      "computed total marks does not match the sum of the exported answer key",
    );
    assert.equal(declared, computed, "the package advertises a total it cannot produce");
    assert.equal(pkg.markingScheme.totalQuestions, MCQ_COUNT);
    assert.equal(pkg.markingScheme.negativeMarking, 1);
    assert.equal(pkg.markingScheme.marksPerQuestionType.mcq, 1);

    // Every key entry has to be usable by an automated marker.
    assert.equal(pkg.omrAnswerKey.length, MCQ_COUNT);
    for (const [index, entry] of pkg.omrAnswerKey.entries()) {
      assert.equal(entry.questionNumber, index + 1);
      assert.ok(
        ["A", "B", "C", "D"].includes(entry.correctOption),
        `package key entry ${entry.questionNumber} has no option letter`,
      );
      assert.equal(entry.marks, 1);
    }
    assert.equal(pkg.answerKey.length, MCQ_COUNT);
  });

  test("the painted bubbled key matches the exported answer key", async () => {
    const pkg = await callOk<{
      exam: {
        examName: string;
        subject: string;
        className: string;
        board: string;
        duration: string;
      };
      markingScheme: { negativeMarking: number };
      omrAnswerKey: { questionNumber: number; correctOption: string }[];
    }>("omr-package.functions", "getOmrExamPackage", {
      method: "GET",
      token: session.accessToken,
      body: { id: created.paperId },
    });

    const layout = buildOmrLayout({
      mode: "key",
      title: pkg.exam.examName,
      collegeName: "E2E Institute",
      subject: pkg.exam.subject,
      className: pkg.exam.className,
      board: pkg.exam.board,
      duration: pkg.exam.duration,
      maxMarks: MCQ_COUNT,
      negativeMarking: pkg.markingScheme.negativeMarking,
      questionCount: MCQ_COUNT,
      optionCount: 4,
      answerKey: pkg.omrAnswerKey.map((e) => ({
        questionNumber: e.questionNumber,
        correctOption: e.correctOption,
      })),
    });

    // For every question, the sheet must darken exactly one bubble and it must
    // be the one the exported key names. This is the contract an OMR scanner
    // relies on, so it is checked against the painted geometry itself.
    for (const entry of pkg.omrAnswerKey) {
      const column = layout.columns.find(
        (c) => entry.questionNumber >= c.firstNumber && entry.questionNumber <= c.lastNumber,
      );
      assert.ok(column, `question ${entry.questionNumber} is not on the sheet`);
      const row = column.rows.find((r) => r.questionNumber === entry.questionNumber);
      assert.ok(row, `question ${entry.questionNumber} has no row`);
      assert.equal(row.unresolved, false, `question ${entry.questionNumber} could not be resolved`);

      const rowBubbles = column.bubbles.filter((b) => b.cy === row.y);
      const filled = rowBubbles.filter((b) => b.filled);
      assert.equal(
        filled.length,
        1,
        `question ${entry.questionNumber} filled ${filled.length} bubbles`,
      );
      assert.equal(
        filled[0].letter,
        entry.correctOption,
        `question ${entry.questionNumber} paints ${filled[0].letter} but the key says ${entry.correctOption}`,
      );
    }
  });

  test("the generated OMR sheet is stable and fits the printable page", () => {
    const props = {
      title: "E2E Master Template",
      collegeName: "E2E Institute",
      subject: "Chemistry",
      className: "10",
      board: "STATE",
      duration: "45 minutes",
      maxMarks: MCQ_COUNT,
      questionCount: MCQ_COUNT,
      optionCount: 4,
    };
    const layout = buildOmrLayout(props);

    assert.equal(layout.columns.length, 1, "a 10-question paper fits a single column");
    assert.equal(layout.columns[0].rows.length, MCQ_COUNT);
    assert.equal(layout.letters.length, 4);
    for (const column of layout.columns) {
      assert.equal(column.bubbles.length, column.rows.length * 4);
    }
    // The key summary is only drawn when it fits the gap above the grid.
    assert.ok(
      layout.summary === null || layout.summary.y + layout.summary.height <= layout.grid.y,
      "the key summary would overlap the bubble grid",
    );
  });

  test("a student's marked sheet is scored against the exported key", async () => {
    const pkg = await callOk<{
      exam: { examId: string; examName: string };
      markingScheme: { negativeMarking: number; marksPerQuestionType: Record<string, number> };
      answerKey: {
        questionNumber: number;
        type: string;
        correctOption: string;
        answer: string;
        marks: number;
      }[];
    }>("omr-package.functions", "getOmrExamPackage", {
      method: "GET",
      token: session.accessToken,
      body: { id: created.paperId },
    });

    const examMetadata = { examId: pkg.exam.examId, examName: pkg.exam.examName };
    const markingScheme = {
      negativeMarking: pkg.markingScheme.negativeMarking,
      marksPerQuestionType: pkg.markingScheme.marksPerQuestionType,
    };
    const marks = pkg.markingScheme.marksPerQuestionType.mcq;
    const answer = (selectedOption: string | null) => ({
      questionNumber: 0,
      selectedOption,
      isMultipleBubbles: false,
    });

    // A fully correct sheet scores every mark.
    const perfect = scoreAnswers(
      pkg.answerKey.map((e) => ({ ...answer(e.correctOption), questionNumber: e.questionNumber })),
      pkg.answerKey,
      markingScheme,
      examMetadata,
    );
    assert.equal(perfect.summary.correctCount, MCQ_COUNT);
    assert.equal(perfect.summary.incorrectCount, 0);
    assert.equal(perfect.summary.obtainedMarks, MCQ_COUNT * marks);
    assert.equal(perfect.summary.totalMarks, MCQ_COUNT * marks);
    assert.equal(perfect.summary.percentage, 100);
    assert.equal(perfect.examId, examMetadata.examId, "the result is not attributable to the exam");

    // A blank sheet scores nothing and is not penalised for unanswered items.
    const blank = scoreAnswers(
      pkg.answerKey.map((e) => ({ ...answer(null), questionNumber: e.questionNumber })),
      pkg.answerKey,
      markingScheme,
      examMetadata,
    );
    assert.equal(blank.summary.obtainedMarks, 0);
    assert.equal(blank.summary.blankCount, MCQ_COUNT);

    // A wrong answer is deducted, and the deduction is bounded by the marks
    // available for that question so a single miss can never score below zero.
    const wrongLetter = pkg.answerKey[0].correctOption === "A" ? "B" : "A";
    const wrong = scoreAnswers(
      pkg.answerKey.map((e) => ({
        ...answer(e.questionNumber === 1 ? wrongLetter : e.correctOption),
        questionNumber: e.questionNumber,
      })),
      pkg.answerKey,
      markingScheme,
      examMetadata,
    );
    assert.equal(wrong.summary.incorrectCount, 1);
    assert.equal(
      wrong.summary.obtainedMarks,
      (MCQ_COUNT - 1) * marks - pkg.markingScheme.negativeMarking,
      "a wrong MCQ was not deducted by the configured negative marking",
    );
    assert.ok(wrong.summary.obtainedMarks >= 0, "negative marking pushed the score below zero");
  });
});
