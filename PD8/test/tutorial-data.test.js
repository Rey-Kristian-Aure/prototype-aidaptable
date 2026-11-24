import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemoState, DEMO_TOPICS } from "../js/data.js";
import { generateSchedule } from "../js/scheduler.js";
import { getQuizCoverageWarnings } from "../js/quiz-coverage.js";
import { computeQuizInsights } from "../js/quiz-insights.js";
import {
  createEmptyTutorialQuizBinState,
  createTutorialDemoState,
  createTutorialQuizBinState,
  TUTORIAL_TOPICS
} from "../js/tutorial-data.js";
import {
  TUTORIAL_QUIZ_CSV_FILE_NAME,
  TUTORIAL_QUIZ_CSV_TEXT
} from "../js/tutorial-csv.js";
import {
  detectColumns,
  detectQuestionType,
  parseCSV
} from "../js/quiz-csv.js";
import { buildQuizImport, inferQuestionPoints } from "../js/quiz-key.js";

test("tutorial demo uses its own semester and topic set", () => {
  const demo = createDemoState();
  const tutorial = createTutorialDemoState();

  assert.notDeepEqual(tutorial.semester, demo.semester);
  assert.notDeepEqual(
    tutorial.topics.map((topic) => topic.title),
    DEMO_TOPICS.map((topic) => topic.title)
  );
  assert.deepEqual(
    tutorial.topics.map((topic) => topic.title),
    TUTORIAL_TOPICS.map((topic) => topic.title)
  );
  assert.equal(tutorial.topics.length, 5);
  assert.equal(tutorial.quizzes.length, 2);
  assert.ok(
    tutorial.calendar.some((cell) => cell.date === "2026-11-30" && cell.suspended)
  );
});

test("tutorial demo generates a complete schedule without coverage warnings", () => {
  const result = generateSchedule(createTutorialDemoState());

  assert.equal(result.ok, true, result.errors?.join("; "));
  assert.equal(result.state.topics.length, 5);
  assert.equal(
    result.state.topics.filter((topic) => topic.status === "scheduled").length,
    5
  );
  assert.equal(
    result.state.calendar.filter((cell) => cell.allocations.length).length,
    39
  );
  assert.deepEqual(getQuizCoverageWarnings(result.state), []);
});

test("tutorial quiz bin report is temporary, anonymous, and readable", () => {
  const bin = createTutorialQuizBinState();
  assert.equal(bin.imports.length, 1);

  const record = bin.imports[0];
  assert.equal(record.quizTitle, "Checkpoint 1");
  assert.equal(record.questions.length, 3);
  assert.equal(record.responses.length, 6);
  assert.ok(record.responses.every((response) => response.label.startsWith("Response ")));
  assert.ok(record.questions.every((question) => question.answerKeySource === "inferred"));

  const insights = computeQuizInsights(record);
  assert.equal(insights.summary.responseCount, 6);
  assert.equal(insights.summary.questionCount, 3);
  assert.equal(insights.summary.gradingMode, "questions");
  assert.equal(insights.summary.inferredKeyCount, 3);
  assert.equal(insights.summary.average, 75);
  assert.equal(insights.summary.passRate, 50);
  assert.equal(insights.summary.pointsLost, 4.5);
});

test("tutorial quiz bin starts empty for the sample import", () => {
  const bin = createEmptyTutorialQuizBinState();

  assert.equal(bin.imports.length, 0);
});

test("tutorial sample CSV matches the download and imports through the real pipeline", () => {
  const example = readFileSync(
    new URL("../examples/checkpoint-1-responses.csv", import.meta.url),
    "utf8"
  );
  assert.equal(example, TUTORIAL_QUIZ_CSV_TEXT);

  const parsed = parseCSV(TUTORIAL_QUIZ_CSV_TEXT);
  assert.equal(parsed.rows.length, 6);
  const columns = detectColumns(parsed.headers, parsed.rows);
  assert.equal(columns.questionColumns.length, 3);

  const quiz = createTutorialDemoState().quizzes.find(
    (entry) => entry.id === "tq1"
  );
  const questions = columns.questionColumns.map((column, index) => ({
    include: true,
    index: column.index,
    header: column.header,
    label: column.header,
    scoreIndex: column.scoreIndex,
    feedbackIndex: column.feedbackIndex,
    type: detectQuestionType(column.header, parsed.rows, column.index),
    points: inferQuestionPoints(parsed.rows, column.scoreIndex) || 1
  }));
  const record = buildQuizImport({
    id: "tutorial-sample",
    sourceFileName: TUTORIAL_QUIZ_CSV_FILE_NAME,
    sourceFileSize: TUTORIAL_QUIZ_CSV_TEXT.length,
    rows: parsed.rows,
    columns,
    targetQuiz: quiz,
    title: quiz.title,
    date: quiz.date,
    passingPercent: 75,
    totalScoreIndex: columns.totalScoreIndex,
    questions
  });

  assert.equal(record.questions.length, 3);
  assert.equal(record.responses.length, 6);
  assert.ok(
    record.responses.every((response) => response.label.startsWith("Response "))
  );
  const insights = computeQuizInsights(record);
  assert.equal(insights.summary.average, 75);
  assert.equal(insights.summary.passRate, 50);
  assert.equal(insights.summary.inferredKeyCount, 3);
});
