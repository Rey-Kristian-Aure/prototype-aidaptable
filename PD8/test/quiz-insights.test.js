import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectColumns, detectQuestionType, parseCSV } from "../js/quiz-csv.js";
import { buildQuizImport } from "../js/quiz-key.js";
import {
  buildQuestionCSV,
  buildResponseCSV,
  computeQuizInsights,
  median,
  percent,
  populationStandardDeviation
} from "../js/quiz-insights.js";

const sampleText = readFileSync(
  new URL("./fixtures/philippines-quiz.csv", import.meta.url),
  "utf8"
);
const nameQuestionText = readFileSync(
  new URL("./fixtures/albay-quiz.csv", import.meta.url),
  "utf8"
);

function buildImportFromText(text, overrides = {}) {
  const parsed = parseCSV(text);
  const columns = detectColumns(parsed.headers);
  return buildQuizImport({
    id: "qb-sample",
    sourceFileName: "quiz.csv",
    sourceFileSize: text.length,
    rows: parsed.rows,
    columns,
    targetQuiz: null,
    title: "Sample Quiz",
    date: "2026-11-13",
    passingPercent: 75,
    totalScoreIndex: columns.totalScoreIndex,
    questions: columns.questionColumns.map((column) => ({
      ...column,
      include: true,
      type: detectQuestionType(column.header, parsed.rows, column.index),
      points: 1
    })),
    ...overrides
  });
}

function sampleImport(overrides = {}) {
  return buildImportFromText(sampleText, {
    sourceFileName: "Philippines and Its Archipelago Quiz.csv",
    title: "Philippines and Its Archipelago Quiz",
    ...overrides
  });
}

test("the sample imports 2 anonymous responses with exported totals 4 and 1", () => {
  const record = sampleImport();
  assert.equal(record.responses.length, 2);
  assert.equal(record.questions.length, 10);
  assert.deepEqual(
    record.responses.map((response) => response.exportedScore),
    [4, 1]
  );
  assert.deepEqual(
    record.responses.map((response) => response.computedTotal),
    [4, 1]
  );
  assert.deepEqual(
    record.responses.map((response) => response.possibleTotal),
    [10, 10]
  );
  assert.equal(record.grading.possibleTotal, 10);
  assert.equal(record.grading.scoreMismatches, 0);
  assert.deepEqual(
    record.responses.map((response) => response.label),
    ["Response 1", "Response 2"]
  );
  assert.equal("name" in record.responses[0], false);
  assert.equal("email" in record.responses[0], false);
});

test("a name question is excluded and names are not stored", () => {
  const record = buildImportFromText(nameQuestionText, {
    id: "qb-albay",
    sourceFileName: "Albay Province Knowledge Quiz.csv",
    title: "Albay Province Knowledge Quiz"
  });
  assert.equal(record.questions.length, 9);
  assert.deepEqual(
    record.responses.map((response) => response.label),
    ["Response 1", "Response 2"]
  );
  assert.equal("name" in record.responses[0], false);
  assert.equal("identityHeader" in record, false);
  assert.deepEqual(
    record.responses.map((response) => response.exportedScore),
    [4, 3]
  );
  assert.equal(record.grading.possibleTotal, 9);
  const selectAll = record.questions.find((question) =>
    /^Select all/i.test(question.prompt)
  );
  assert.equal(selectAll.type, "multiple");
  const selection = record.responses[0].answers.find(
    (answer) => answer.questionId === selectAll.id
  );
  assert.deepEqual(selection.values, ["Camalig", "Malilipot"]);
  assert.equal(selectAll.answerKeySource, "none");
  assert.deepEqual(record.warnings, []);
});

test("correct answers are inferred from full-credit responses", () => {
  const record = sampleImport();
  assert.equal(record.questions[0].answerKeySource, "inferred");
  assert.deepEqual(record.questions[0].correctAnswers, ["Over 7600"]);
  assert.equal(record.questions[0].keyResponseCount, 1);
  assert.equal(record.questions[1].answerKeySource, "none");
  assert.deepEqual(record.questions[1].correctAnswers, []);
  assert.equal(record.questions[9].answerKeySource, "inferred");
  assert.equal(record.questions[9].keyResponseCount, 2);
  assert.equal(record.grading.inferredKeyCount, 4);
  assert.equal(record.grading.missingKeyCount, 6);

  const albay = buildImportFromText(nameQuestionText, {
    id: "qb-albay",
    title: "Albay"
  });
  assert.equal(albay.grading.inferredKeyCount, 4);
  assert.equal(albay.grading.missingKeyCount, 5);
});

test("fill-in-the-blank questions infer keys and group answers like single answers", () => {
  const headers = [
    "Timestamp",
    "Total score",
    "Fill in the blank: The capital of Albay is ___.",
    "Fill in the blank: The capital of Albay is ___. [Score]"
  ];
  const text = [
    headers.join(","),
    "2026/11/13 10:00:00 AM GMT+8,1 / 1,Legazpi City,1 / 1",
    "2026/11/13 10:01:00 AM GMT+8,1 / 1,legazpi city,1 / 1",
    "2026/11/13 10:02:00 AM GMT+8,0 / 1,Tabaco City,0 / 1"
  ].join("\n");
  const record = buildImportFromText(text, {
    id: "qb-short",
    title: "Short answers"
  });
  const question = record.questions[0];
  assert.equal(question.type, "short");
  assert.equal(question.answerKeySource, "inferred");
  assert.deepEqual(question.correctAnswers, ["Legazpi City"]);
  assert.equal(question.keyResponseCount, 2);
  assert.deepEqual(question.correctOptions, ["Legazpi City"]);

  const insights = computeQuizInsights(record);
  const groups = insights.questions[0].answerGroups;
  assert.equal(
    groups.find((group) => group.answer === "Legazpi City").isCorrect,
    true
  );
  assert.equal(
    groups.find((group) => group.answer === "legazpi city").isCorrect,
    true
  );
  assert.equal(
    groups.find((group) => group.answer === "Tabaco City").isCorrect,
    false
  );
  assert.equal(insights.questions[0].optionGroups.length, 0);
});

test("the sample produces the expected class summary", () => {
  const insights = computeQuizInsights(sampleImport());
  assert.equal(insights.summary.responseCount, 2);
  assert.equal(insights.summary.questionCount, 10);
  assert.equal(insights.summary.gradedQuestionCount, 10);
  assert.equal(insights.summary.possibleTotal, 10);
  assert.equal(insights.summary.average, 25);
  assert.equal(insights.summary.median, 25);
  assert.equal(insights.summary.highest, 40);
  assert.equal(insights.summary.lowest, 10);
  assert.equal(insights.summary.standardDeviation, 15);
  assert.equal(insights.summary.passRate, 0);
  assert.equal(insights.summary.atRisk, 2);
  assert.equal(insights.summary.onTrack, 0);
  assert.equal(insights.summary.inferredKeyCount, 4);
});

test("the sample flags Q2, Q5, Q6, Q7, Q8, and Q9 as missed by both", () => {
  const insights = computeQuizInsights(sampleImport());
  const missedByBoth = insights.questions
    .filter((question) => question.missedRate === 100)
    .map((question) => question.index + 1);
  assert.deepEqual(missedByBoth, [2, 5, 6, 7, 8, 9]);
  assert.deepEqual(
    insights.frequentlyMissed.map((question) => question.index + 1),
    [2, 5, 6, 7, 8]
  );
  assert.equal(insights.questions[9].fullCredit, 2);
  assert.equal(insights.questions[9].missedRate, 0);
  assert.equal(insights.questions[7].blank, 2);
  assert.equal(insights.questions[7].incorrect, 0);
  assert.equal(insights.questions[7].mostCommonWrong, "");
});

test("the sample response gaps match the exported scores", () => {
  const insights = computeQuizInsights(sampleImport());
  assert.deepEqual(
    insights.responses[0].missed.map((item) => item.index + 1),
    [2, 5, 6, 7, 8, 9]
  );
  assert.deepEqual(
    insights.responses[1].missed.map((item) => item.index + 1),
    [1, 2, 3, 4, 5, 6, 7, 8, 9]
  );
  assert.deepEqual(
    insights.responses[0].skipped.map((item) => item.index + 1),
    [8]
  );
  assert.equal(insights.responses[0].status, "at-risk");
  assert.equal(insights.responses[0].percent, 40);
  assert.equal(insights.responses[1].percent, 10);
});

test("the score distribution places 40% and 10% in the right buckets", () => {
  const insights = computeQuizInsights(sampleImport());
  assert.equal(insights.distribution[1].count, 1);
  assert.equal(insights.distribution[4].count, 1);
  assert.equal(insights.distribution[9].count, 0);
});

test("partial credit is honored from the exported score", () => {
  const headers = [
    "Timestamp",
    "Total score",
    "Question 1",
    "Question 1 [Score]"
  ];
  const text = `${headers.join(",")}\n2026/11/13 10:00:00 AM GMT+8,0.50 / 1,Answer,0.50 / 1\n`;
  const record = buildImportFromText(text, {
    id: "qb-partial",
    title: "Partial credit",
    questions: [
      {
        index: 2,
        header: "Question 1",
        label: "Question 1",
        scoreIndex: 3,
        feedbackIndex: null,
        include: true,
        type: "single",
        points: 1
      }
    ]
  });
  const insights = computeQuizInsights(record);
  assert.equal(record.responses[0].answers[0].pointsEarned, 0.5);
  assert.equal(record.responses[0].answers[0].partial, true);
  assert.equal(record.responses[0].answers[0].correct, false);
  assert.equal(insights.questions[0].partial, 1);
  assert.equal(insights.questions[0].fullCredit, 0);
  assert.equal(insights.questions[0].missedRate, 100);
});

test("a plain export without per-question scores is shown without grading", () => {
  const headers = ["Timestamp", "Score", "Capital?", "Even numbers?", "Essay"];
  const text = `${headers.join(",")}\n2026/11/13 10:00:00 AM GMT+8,2 / 2,FOUR,"2, 4",Because\n`;
  const record = buildImportFromText(text, {
    id: "qb-plain",
    title: "Plain export",
    questions: [
      {
        index: 2,
        header: "Capital?",
        label: "Capital?",
        scoreIndex: null,
        feedbackIndex: null,
        include: true,
        type: "single",
        points: 1
      },
      {
        index: 3,
        header: "Even numbers?",
        label: "Even numbers?",
        scoreIndex: null,
        feedbackIndex: null,
        include: true,
        type: "multiple",
        points: 2
      },
      {
        index: 4,
        header: "Essay",
        label: "Essay",
        scoreIndex: null,
        feedbackIndex: null,
        include: true,
        type: "single",
        points: 1
      }
    ]
  });
  const insights = computeQuizInsights(record);
  assert.equal(record.responses[0].answers[0].correct, null);
  assert.equal(record.responses[0].answers[0].pointsEarned, 0);
  assert.equal(record.responses[0].answers[0].graded, false);
  assert.equal(insights.summary.gradedQuestionCount, 0);
  assert.equal(insights.summary.possibleTotal, 0);
  assert.equal(insights.questions[0].difficulty, "Not graded");
  assert.equal(insights.questions[0].fullCredit, 0);
  assert.equal(insights.questions[0].missedCount, 0);
  assert.equal(insights.questions[0].answerKeySource, "none");
  assert.equal(insights.questions[0].answerGroups[0].answer, "FOUR");
});

test("duplicate rows are reported but kept as separate anonymous responses", () => {
  const headers = ["Timestamp", "Total score", "Answer", "Answer [Score]"];
  const row = "2026/11/13 10:00:00 AM GMT+8,1 / 1,A,1 / 1";
  const text = `${headers.join(",")}\n${row}\n${row}\n`;
  const record = buildImportFromText(text, {
    id: "qb-duplicate",
    title: "Duplicate"
  });
  assert.equal(record.responses.length, 2);
  assert.equal(record.grading.duplicateRows, 1);
  assert.ok(
    record.warnings.some((warning) => /duplicate response row/i.test(warning))
  );
  assert.deepEqual(
    record.responses.map((response) => response.label),
    ["Response 1", "Response 2"]
  );
});

test("multiple-answer questions get option-level analytics", () => {
  const headers = [
    "Timestamp",
    "Total score",
    "Pick all that apply",
    "Pick all that apply [Score]"
  ];
  const text = `${headers.join(",")}
2026/11/13 10:00:00 AM GMT+8,2 / 2,A; B,2 / 2
2026/11/13 10:01:00 AM GMT+8,1 / 2,A,1 / 2
`;
  const record = buildImportFromText(text, {
    id: "qb-multi",
    title: "Multiple",
    questions: [
      {
        index: 2,
        header: "Pick all that apply",
        label: "Pick all that apply",
        scoreIndex: 3,
        feedbackIndex: null,
        include: true,
        type: "multiple",
        points: 1
      }
    ]
  });
  const insights = computeQuizInsights(record);
  assert.equal(record.questions[0].points, 2);
  assert.equal(record.questions[0].answerKeySource, "inferred");
  assert.deepEqual(record.questions[0].correctOptions, ["A", "B"]);
  assert.equal(insights.questions[0].fullCredit, 1);
  assert.equal(insights.questions[0].partial, 1);
  assert.deepEqual(
    insights.questions[0].optionGroups.map((option) => [
      option.option,
      option.count,
      option.isCorrect
    ]),
    [
      ["A", 2, true],
      ["B", 1, true]
    ]
  );
  assert.equal(
    insights.questions[0].answerGroups.find(
      (group) => group.answer === "A; B"
    ).isCorrect,
    true
  );
});

test("most common wrong answer excludes full-credit and blank answers", () => {
  const insights = computeQuizInsights(sampleImport());
  assert.equal(insights.questions[1].mostCommonWrong, "Cebu City / Quezon City");
  assert.equal(insights.questions[9].mostCommonWrong, "");
});

test("median and population standard deviation are computed correctly", () => {
  assert.equal(median([10, 40, 30]), 30);
  assert.equal(median([10, 40]), 25);
  assert.equal(median([]), 0);
  assert.equal(populationStandardDeviation([40, 10]), 15);
  assert.equal(percent(1, 2), 50);
  assert.equal(percent(1, 0), 0);
});

test("CSV exports contain anonymous responses and inferred keys", () => {
  const record = sampleImport();
  const insights = computeQuizInsights(record);
  const questionCSV = buildQuestionCSV(record, insights);
  const responseCSV = buildResponseCSV(record, insights);
  assert.match(questionCSV, /^number,question,type,points/);
  assert.match(questionCSV, /inferred_answer,answer_key_source/);
  assert.doesNotMatch(questionCSV, /topic/);
  assert.match(questionCSV, /Over 7600,inferred/);
  assert.match(responseCSV, /^response,submitted,score/);
  assert.match(responseCSV, /Response 1/);
  assert.match(responseCSV, /Q2; Q5; Q6; Q7; Q8; Q9/);
  assert.doesNotMatch(responseCSV, /email|student/);
});
