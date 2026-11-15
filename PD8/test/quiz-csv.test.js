import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  detectColumns,
  detectDelimiter,
  detectQuestionType,
  isIgnoredQuestionHeader,
  normalizeTimestamp,
  parseCSV,
  parsePoints,
  parseTotalScore,
  questionKey
} from "../js/quiz-csv.js";

const sampleText = readFileSync(
  new URL("./fixtures/philippines-quiz.csv", import.meta.url),
  "utf8"
);
const nameQuestionText = readFileSync(
  new URL("./fixtures/albay-quiz.csv", import.meta.url),
  "utf8"
);
const allTypesText = readFileSync(
  new URL("./fixtures/gform-all-types.csv", import.meta.url),
  "utf8"
);

test("parseCSV handles quoted fields, escaped quotes, and embedded newlines", () => {
  const text =
    'Name,Answer\r\n"Doe, Jane","She said ""hello"""\r\nBob,"Line one\nLine two"\r\n';
  const parsed = parseCSV(text);
  assert.deepEqual(parsed.headers, ["Name", "Answer"]);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], ["Doe, Jane", 'She said "hello"']);
  assert.deepEqual(parsed.rows[1], ["Bob", "Line one\nLine two"]);
});

test("parseCSV removes a UTF-8 BOM and keeps empty trailing fields", () => {
  const parsed = parseCSV("\uFEFFName,Score,\r\nAna,4,\r\n");
  assert.deepEqual(parsed.headers, ["Name", "Score", "Column 3"]);
  assert.deepEqual(parsed.rows, [["Ana", "4", ""]]);
});

test("parseCSV warns when the file ends inside a quote", () => {
  const parsed = parseCSV('Name,Answer\nAna,"unfinished');
  assert.equal(parsed.rows.length, 1);
  assert.match(parsed.warnings.join(" "), /missing closing quote/i);
});

test("parseCSV auto-detects semicolon and tab delimiters", () => {
  assert.equal(detectDelimiter("Name;Score;Answer\nAna;4;Yes"), ";");
  assert.equal(detectDelimiter("Name\tScore\tAnswer\nAna\t4\tYes"), "\t");
  const parsed = parseCSV("Name;Score\nAna;4\n");
  assert.deepEqual(parsed.rows, [["Ana", "4"]]);
  assert.equal(parsed.delimiter, ";");
});

test("parseCSV preserves non-ASCII text", () => {
  const parsed = parseCSV("Name,Answer\nJose,Isla ng Luzon\n");
  assert.deepEqual(parsed.rows, [["Jose", "Isla ng Luzon"]]);
});

test("detectColumns groups a question with its score and feedback companions", () => {
  const columns = detectColumns([
    "Timestamp",
    "Total score",
    "Question 1",
    "Question 1 [Score]",
    "Question 1 [Feedback]",
    "Question 2",
    "Question 2 [Score]",
    "Question 2 [Feedback]"
  ]);
  assert.equal(columns.timestampIndex, 0);
  assert.equal(columns.totalScoreIndex, 1);
  assert.equal(columns.questionColumns.length, 2);
  assert.equal(columns.questionColumns[0].scoreIndex, 3);
  assert.equal(columns.questionColumns[0].feedbackIndex, 4);
  assert.equal(columns.questionColumns[1].scoreIndex, 6);
  assert.equal(columns.questionColumns[1].feedbackIndex, 7);
});

test("detectColumns identifies name, email, and student ID metadata", () => {
  const columns = detectColumns([
    "Timestamp",
    "Student Name",
    "Email Address",
    "Student ID",
    "Score",
    "What is 2 + 2?"
  ]);
  assert.equal(columns.nameIndex, 1);
  assert.equal(columns.emailIndex, 2);
  assert.equal(columns.studentIdIndex, 3);
  assert.equal(columns.totalScoreIndex, 4);
  assert.deepEqual(
    columns.identityCandidates.map((candidate) => candidate.kind),
    ["name", "email", "studentId"]
  );
});

test("detectColumns recognizes a name question and keeps it out of the quiz", () => {
  const parsed = parseCSV(nameQuestionText);
  const columns = detectColumns(parsed.headers);
  assert.equal(columns.timestampIndex, 0);
  assert.equal(columns.totalScoreIndex, 1);
  assert.equal(columns.nameIndex, 2);
  assert.equal(columns.questionColumns.length, 9);
  assert.equal(columns.identityCandidates[0].kind, "name");
  assert.equal(columns.identityCandidates[0].header, "Please enter your full name");
  assert.ok(
    !columns.questionColumns.some((question) =>
      /full name/i.test(question.header)
    )
  );
  assert.deepEqual(columns.warnings, []);
});

test("detectQuestionType recognizes select-all and multi-value answers", () => {
  assert.equal(
    detectQuestionType("Select all the municipalities or cities located within the province of Albay.", [], -1),
    "multiple"
  );
  assert.equal(
    detectQuestionType("Choose all that apply", [], -1),
    "multiple"
  );
  assert.equal(
    detectQuestionType("What is the capital city?", [["Legazpi City"]], 0),
    "single"
  );
  assert.equal(
    detectQuestionType("Pick every correct answer", [], -1),
    "multiple"
  );
  assert.equal(
    detectQuestionType("Favourite colours", [["Red;Blue"], ["Green"]], 0),
    "multiple"
  );
  assert.equal(
    detectQuestionType(
      "Which of the following subjects do you enjoy?",
      [["Math, Science"], ["English, Math"]],
      0
    ),
    "multiple"
  );
  assert.equal(
    detectQuestionType(
      "What is the capital city of the province?",
      [["Legazpi City, Albay"], ["Tabaco City, Albay"]],
      0
    ),
    "single"
  );
});

test("detectQuestionType recognizes fill-in-the-blank and short answers", () => {
  assert.equal(
    detectQuestionType("Fill in the blank: The capital of Albay is ___.", [], -1),
    "short"
  );
  assert.equal(
    detectQuestionType("Complete the sentence: The capital is ____.", [], -1),
    "short"
  );
  assert.equal(
    detectQuestionType("Short answer: Name one active volcano.", [], -1),
    "short"
  );
  assert.equal(
    detectQuestionType("Type your answer", [], -1),
    "short"
  );
  assert.equal(
    detectQuestionType("Which city is the capital?", [["Legazpi City"]], 0),
    "single"
  );
  assert.equal(
    detectQuestionType("Select all that apply: ___", [], -1),
    "multiple"
  );
});

test("detectQuestionType keeps paragraph text with semicolons as paragraph", () => {
  assert.equal(
    detectQuestionType(
      "Describe your experience with the festival.",
      [
        ["I enjoyed it; the street dancing was great."],
        ["It was crowded; I would go again."]
      ],
      0
    ),
    "paragraph"
  );
});

test("detectQuestionType keeps comma-separated single answers as single", () => {
  assert.equal(
    detectQuestionType(
      "Choose the best description of the capital.",
      [["Legazpi City, Albay"], ["Tabaco City, Albay"]],
      0
    ),
    "single"
  );
  assert.equal(
    detectQuestionType(
      "What is the capital city of the province?",
      [["Legazpi City, Albay"], ["Tabaco City, Albay"]],
      0
    ),
    "single"
  );
});

test("detectQuestionType recognizes paragraph, grid, date, and time questions", () => {
  const parsed = parseCSV(allTypesText);
  const columns = detectColumns(parsed.headers);
  assert.deepEqual(
    columns.questionColumns.map((column) =>
      detectQuestionType(column.header, parsed.rows, column.index)
    ),
    [
      "single",
      "paragraph",
      "single",
      "multiple",
      "single",
      "grid-single",
      "grid-single",
      "grid-multiple",
      "grid-multiple",
      "date",
      "time"
    ]
  );
  assert.equal(
    detectQuestionType(
      "Select all municipalities in Albay. [Legazpi]",
      [["Camalig;Malilipot"]],
      0
    ),
    "grid-multiple"
  );
  assert.equal(
    detectQuestionType(
      "Match the item to its category [Mayon]",
      [["Volcano"]],
      0
    ),
    "grid-single"
  );
});

test("detectColumns skips rating and file-upload questions with their score columns", () => {
  const parsed = parseCSV(allTypesText);
  const columns = detectColumns(parsed.headers);
  assert.equal(columns.questionColumns.length, 11);
  assert.deepEqual(
    columns.ignoredColumns.map((column) => column.header),
    [
      "Rate your familiarity with Albay (1-5).",
      "Rate the quiz difficulty.",
      "Upload a photo of Mayon."
    ]
  );
  assert.deepEqual(columns.warnings, []);
  assert.equal(isIgnoredQuestionHeader("Rate of reaction"), false);
  assert.equal(isIgnoredQuestionHeader("Which file format is this?"), false);
});

test("isIgnoredQuestionHeader recognizes scale, satisfaction, and file prompts", () => {
  assert.equal(
    isIgnoredQuestionHeader("On a scale of 1 to 5, how was the lesson?"),
    true
  );
  assert.equal(
    isIgnoredQuestionHeader("How satisfied are you with the lesson?"),
    true
  );
  assert.equal(
    isIgnoredQuestionHeader("How likely are you to recommend this quiz?"),
    true
  );
  assert.equal(isIgnoredQuestionHeader("Add a file to your response"), true);
  assert.equal(isIgnoredQuestionHeader("Rate of reaction"), false);
  assert.equal(isIgnoredQuestionHeader("Which file format is this?"), false);
});

test("detectColumns ignores rating and file columns by their values", () => {
  const headers = [
    "Timestamp",
    "How difficult was the quiz?",
    "Mayon photo",
    "What is the capital?"
  ];
  const rows = [
    [
      "2026/11/13 10:00:00 AM GMT+8",
      "1",
      "https://drive.google.com/file/d/abc123/view",
      "Legazpi City"
    ],
    [
      "2026/11/13 10:01:00 AM GMT+8",
      "3",
      "https://drive.google.com/file/d/def456/view",
      "Tabaco City"
    ]
  ];
  const columns = detectColumns(headers, rows);
  assert.deepEqual(
    columns.ignoredColumns.map((column) => column.header),
    ["How difficult was the quiz?", "Mayon photo"]
  );
  assert.deepEqual(
    columns.questionColumns.map((column) => column.header),
    ["What is the capital?"]
  );
});

test("value-based ignoring leaves rated questions alone when a score is present", () => {
  const headers = [
    "Timestamp",
    "How difficult was the quiz?",
    "How difficult was the quiz? [Score]",
    "What is the capital?"
  ];
  const graded = detectColumns(headers, [
    [
      "2026/11/13 10:00:00 AM GMT+8",
      "1",
      "1.00 / 1",
      "Legazpi City"
    ]
  ]);
  assert.deepEqual(
    graded.questionColumns.map((column) => column.header),
    ["How difficult was the quiz?", "What is the capital?"]
  );
  assert.equal(graded.questionColumns[0].scoreIndex, 2);

  const ungraded = detectColumns(headers, [
    [
      "2026/11/13 10:00:00 AM GMT+8",
      "1",
      "-- / 0",
      "Legazpi City"
    ]
  ]);
  assert.deepEqual(
    ungraded.ignoredColumns.map((column) => column.header),
    ["How difficult was the quiz?"]
  );
  assert.deepEqual(
    ungraded.questionColumns.map((column) => column.header),
    ["What is the capital?"]
  );
});

test("detectColumns does not mistake [Score] companions for the total score", () => {
  const columns = detectColumns([
    "Timestamp",
    "Total score",
    "Question 1",
    "Question 1 [Score]"
  ]);
  assert.equal(columns.totalScoreIndex, 1);
  assert.equal(columns.questionColumns.length, 1);
  assert.equal(columns.questionColumns[0].scoreIndex, 3);
});

test("the sample CSV detects 10 questions and 10 paired score columns", () => {
  const parsed = parseCSV(sampleText);
  const columns = detectColumns(parsed.headers);
  assert.equal(parsed.headers.length, 32);
  assert.equal(parsed.rows.length, 2);
  assert.equal(columns.timestampIndex, 0);
  assert.equal(columns.totalScoreIndex, 1);
  assert.equal(columns.questionColumns.length, 10);
  assert.equal(
    columns.questionColumns.filter((question) => question.scoreIndex !== null)
      .length,
    10
  );
  assert.equal(
    columns.questionColumns.filter((question) => question.feedbackIndex !== null)
      .length,
    10
  );
  assert.equal(columns.identityCandidates.length, 0);
});

test("parsePoints handles full, zero, partial, skipped, percent, and blank", () => {
  assert.deepEqual(parsePoints("1.00 / 1"), {
    raw: "1.00 / 1",
    earned: 1,
    max: 1,
    unanswered: false,
    valid: true,
    kind: "points"
  });
  assert.equal(parsePoints("0.00 / 1").earned, 0);
  assert.equal(parsePoints("0.00 / 1").max, 1);
  assert.equal(parsePoints("0.50 / 1").earned, 0.5);
  assert.equal(parsePoints("-- / 1").unanswered, true);
  assert.equal(parsePoints("-- / 1").max, 1);
  assert.equal(parsePoints("80%").earned, 80);
  assert.equal(parsePoints("80%").max, 100);
  assert.equal(parsePoints("8/10").earned, 8);
  assert.equal(parsePoints("8/10").max, 10);
  assert.equal(parsePoints("").valid, false);
  assert.equal(parsePoints("n/a").valid, false);
  assert.equal(parseTotalScore("4.00 / 10").earned, 4);
  assert.equal(parseTotalScore("4.00 / 10").max, 10);
});

test("normalizeTimestamp parses the Google Forms locale timestamp", () => {
  const parsed = normalizeTimestamp("2026/11/13 11:32:52 AM GMT+8");
  assert.equal(parsed.raw, "2026/11/13 11:32:52 AM GMT+8");
  assert.equal(parsed.iso, "2026-11-13T11:32:52+08:00");
});

test("questionKey is stable and unique by position", () => {
  assert.equal(questionKey("What is 2 + 2?", 0), "what-is-2-2-1");
  assert.equal(questionKey("What is 2 + 2?", 1), "what-is-2-2-2");
  assert.equal(questionKey("", 0), "question-1");
});
