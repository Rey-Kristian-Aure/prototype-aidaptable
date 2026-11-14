import { normalizeQuestionType } from "./quiz-csv.js";

export const QUIZ_BIN_STORAGE_KEY = "aidaptable:quizbin";
export const QUIZ_BIN_VERSION = 2;
export const MAX_QUIZ_IMPORTS = 30;

function clean(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim())
    : [];
}

function normalizeQuestion(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const type = normalizeQuestionType(source.type);
  const answerKeySource = source.answerKeySource === "inferred" ? "inferred" : "none";
  return {
    id: clean(source.id, `question-${index + 1}`) || `question-${index + 1}`,
    key: clean(source.key, `question-${index + 1}`) || `question-${index + 1}`,
    prompt:
      clean(source.prompt, `Question ${index + 1}`) || `Question ${index + 1}`,
    type,
    options: stringList(source.options),
    correctAnswers:
      answerKeySource === "inferred" ? stringList(source.correctAnswers) : [],
    correctOptions:
      answerKeySource === "inferred" ? stringList(source.correctOptions) : [],
    answerKeySource,
    keyResponseCount: Math.max(
      0,
      finiteNumber(source.keyResponseCount, 0) ?? 0
    ),
    points: Math.max(0, finiteNumber(source.points, 1) ?? 1),
    pointSource: source.pointSource === "export" ? "export" : "manual",
    hasExportedScore: Boolean(source.hasExportedScore),
    hasFeedback: Boolean(source.hasFeedback),
    graded: Boolean(source.graded),
    sourceIndex: Number.isInteger(source.sourceIndex) ? source.sourceIndex : index,
    scoreIndex: Number.isInteger(source.scoreIndex) ? source.scoreIndex : null,
    feedbackIndex: Number.isInteger(source.feedbackIndex)
      ? source.feedbackIndex
      : null
  };
}

function normalizeAnswer(raw, questionId) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    questionId: clean(source.questionId, questionId) || questionId,
    raw: clean(source.raw),
    rawScore: clean(source.rawScore),
    values: stringList(source.values),
    answered: Boolean(source.answered),
    unanswered: Boolean(source.unanswered),
    correct: typeof source.correct === "boolean" ? source.correct : null,
    partial: Boolean(source.partial),
    graded: Boolean(source.graded),
    pointsEarned: Math.max(0, finiteNumber(source.pointsEarned, 0) ?? 0),
    pointsPossible: Math.max(0, finiteNumber(source.pointsPossible, 0) ?? 0),
    invalidScore: Boolean(source.invalidScore),
    feedback: clean(source.feedback)
  };
}

function normalizeResponse(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const answers = Array.isArray(source.answers)
    ? source.answers
        .filter((answer) => answer && typeof answer === "object")
        .map((answer, answerIndex) =>
          normalizeAnswer(answer, `question-${answerIndex + 1}`)
        )
    : [];
  return {
    id: clean(source.id, `response-${index + 1}`) || `response-${index + 1}`,
    label: `Response ${index + 1}`,
    submittedAtRaw: clean(source.submittedAtRaw),
    submittedAtISO: clean(source.submittedAtISO),
    exportedScoreRaw: clean(source.exportedScoreRaw),
    exportedScore: finiteNumber(source.exportedScore),
    exportedMax: finiteNumber(source.exportedMax),
    computedTotal: Math.max(0, finiteNumber(source.computedTotal, 0) ?? 0),
    possibleTotal: Math.max(0, finiteNumber(source.possibleTotal, 0) ?? 0),
    unparsableScoreCells: Math.max(
      0,
      finiteNumber(source.unparsableScoreCells, 0) ?? 0
    ),
    answers
  };
}

function normalizeScoringSource(source) {
  if (source === "score-only") {
    return "score-only";
  }
  if (source === "exported-scores" || source === "mixed" || source === "answer-key") {
    return "exported-scores";
  }
  return "score-only";
}

function normalizeImport(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const questions = Array.isArray(source.questions)
    ? source.questions.map(normalizeQuestion)
    : [];
  const questionIds = new Set(questions.map((question) => question.id));
  const rawResponses = Array.isArray(source.responses)
    ? source.responses
    : Array.isArray(source.students)
      ? source.students
      : [];
  const responses = rawResponses
    .filter((response) => response && typeof response === "object")
    .map(normalizeResponse)
    .map((response) => ({
      ...response,
      answers: response.answers.filter((answer) =>
        questionIds.has(answer.questionId)
      )
    }));
  const inferredKeyCount = questions.filter(
    (question) => question.answerKeySource === "inferred"
  ).length;
  const missingKeyCount = questions.filter(
    (question) => question.graded && question.answerKeySource === "none"
  ).length;

  return {
    id: clean(source.id, `import-${index + 1}`) || `import-${index + 1}`,
    quizId: clean(source.quizId, "") || null,
    quizTitle: clean(source.quizTitle, "Untitled Quiz") || "Untitled Quiz",
    quizDate: clean(source.quizDate),
    sourceFileName: clean(source.sourceFileName),
    sourceFileSize: Math.max(0, finiteNumber(source.sourceFileSize, 0) ?? 0),
    sourceRowCount: Math.max(
      0,
      finiteNumber(source.sourceRowCount, responses.length) ?? 0
    ),
    importedAt: clean(source.importedAt, new Date().toISOString()),
    passingPercent: Math.min(
      100,
      Math.max(0, finiteNumber(source.passingPercent, 75) ?? 75)
    ),
    unlinked: Boolean(source.unlinked),
    scoringSource: normalizeScoringSource(source.scoringSource),
    questions,
    responses,
    grading: {
      possibleTotal: Math.max(
        0,
        finiteNumber(source.grading?.possibleTotal, 0) ?? 0
      ),
      scoreMismatches: Math.max(
        0,
        finiteNumber(source.grading?.scoreMismatches, 0) ?? 0
      ),
      unparsableScoreCells: Math.max(
        0,
        finiteNumber(source.grading?.unparsableScoreCells, 0) ?? 0
      ),
      duplicateRows: Math.max(
        0,
        finiteNumber(source.grading?.duplicateRows, 0) ?? 0
      ),
      inferredKeyCount,
      missingKeyCount
    },
    warnings: stringList(source.warnings)
  };
}

export function createEmptyQuizBinState() {
  return { version: QUIZ_BIN_VERSION, imports: [] };
}

export function normalizeQuizBinState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const imports = Array.isArray(source.imports)
    ? source.imports
        .filter((entry) => entry && typeof entry === "object")
        .map(normalizeImport)
        .filter((entry) => entry.questions.length > 0)
    : [];
  imports.sort((left, right) =>
    String(right.importedAt).localeCompare(String(left.importedAt))
  );
  return {
    version: QUIZ_BIN_VERSION,
    imports: imports.slice(0, MAX_QUIZ_IMPORTS)
  };
}

export function loadQuizBin() {
  try {
    const raw = localStorage.getItem(QUIZ_BIN_STORAGE_KEY);
    if (!raw) {
      return createEmptyQuizBinState();
    }
    return normalizeQuizBinState(JSON.parse(raw));
  } catch {
    return createEmptyQuizBinState();
  }
}

export function saveQuizBin(state) {
  try {
    localStorage.setItem(
      QUIZ_BIN_STORAGE_KEY,
      JSON.stringify(normalizeQuizBinState(state))
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not save quiz results in this browser."
    };
  }
}

export function clearQuizBin() {
  try {
    localStorage.removeItem(QUIZ_BIN_STORAGE_KEY);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not clear quiz results."
    };
  }
}
