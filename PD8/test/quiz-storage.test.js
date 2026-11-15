import test from "node:test";
import assert from "node:assert/strict";

import {
  clearQuizBin,
  createEmptyQuizBinState,
  loadQuizBin,
  normalizeQuizBinState,
  QUIZ_BIN_STORAGE_KEY,
  QUIZ_BIN_VERSION,
  saveQuizBin
} from "../js/quiz-storage.js";

function makeImport(id, importedAt, overrides = {}) {
  return {
    id,
    quizId: null,
    quizTitle: "Sample Quiz",
    quizDate: "2026-11-13",
    sourceFileName: "sample.csv",
    sourceRowCount: 1,
    importedAt,
    passingPercent: 75,
    scoringSource: "exported-scores",
    questions: [
      {
        id: `${id}-q1`,
        prompt: "Question 1",
        type: "single",
        points: 1,
        graded: true
      }
    ],
    responses: [
      {
        id: "r1",
        label: "Response 1",
        answers: [
          { questionId: `${id}-q1`, raw: "A", pointsEarned: 1, correct: true }
        ]
      }
    ],
    ...overrides
  };
}

function makeImports(count) {
  return Array.from({ length: count }, (_, index) =>
    makeImport(
      `qb${index + 1}`,
      new Date(Date.UTC(2026, 0, 1, index)).toISOString()
    )
  );
}

test("normalizeQuizBinState rejects malformed input", () => {
  assert.deepEqual(normalizeQuizBinState(null), createEmptyQuizBinState());
  assert.deepEqual(normalizeQuizBinState("bad"), createEmptyQuizBinState());
  assert.deepEqual(
    normalizeQuizBinState({ imports: "bad" }),
    createEmptyQuizBinState()
  );
  assert.equal(normalizeQuizBinState({ imports: [] }).version, QUIZ_BIN_VERSION);
});

test("normalizeQuizBinState fills defaults and drops imports without questions", () => {
  const normalized = normalizeQuizBinState({
    version: 99,
    imports: [
      makeImport("qb2", "2026-01-02T00:00:00.000Z"),
      { id: "bad", questions: [] }
    ]
  });
  assert.equal(normalized.version, QUIZ_BIN_VERSION);
  assert.equal(normalized.imports.length, 1);
  assert.equal(normalized.imports[0].id, "qb2");
  assert.equal(normalized.imports[0].responses[0].label, "Response 1");
});

test("normalizeQuizBinState preserves null exported scores", () => {
  const normalized = normalizeQuizBinState({
    imports: [
      makeImport("qb1", "2026-01-01T00:00:00.000Z", {
        responses: [
          {
            id: "r1",
            label: "Response 1",
            exportedScore: null,
            exportedMax: null,
            answers: []
          }
        ]
      })
    ]
  });
  assert.equal(normalized.imports[0].responses[0].exportedScore, null);
  assert.equal(normalized.imports[0].responses[0].exportedMax, null);
});

test("normalizeQuizBinState drops answers whose question is missing", () => {
  const normalized = normalizeQuizBinState({
    imports: [
      makeImport("qb1", "2026-01-01T00:00:00.000Z", {
        responses: [
          {
            id: "r1",
            label: "Response 1",
            answers: [
              { questionId: "qb1-q1", raw: "A" },
              { questionId: "missing-q", raw: "B" }
            ]
          }
        ]
      })
    ]
  });
  assert.deepEqual(
    normalized.imports[0].responses[0].answers.map(
      (answer) => answer.questionId
    ),
    ["qb1-q1"]
  );
});

test("normalizeQuizBinState migrates legacy students to anonymous responses", () => {
  const normalized = normalizeQuizBinState({
    imports: [
      makeImport("qb1", "2026-01-01T00:00:00.000Z", {
        identityIndex: 2,
        identityHeader: "Student Name",
        students: [
          {
            id: "s1",
            name: "Maria Santos",
            originalName: "Ana Cruz",
            labelSource: "teacher",
            email: "maria@example.com",
            studentId: "S-001",
            answers: []
          }
        ],
        responses: undefined
      })
    ]
  });
  const response = normalized.imports[0].responses[0];
  assert.equal(response.label, "Response 1");
  assert.equal("name" in response, false);
  assert.equal("email" in response, false);
  assert.equal("studentId" in response, false);
  assert.equal("identityIndex" in normalized.imports[0], false);
  assert.equal("identityHeader" in normalized.imports[0], false);
});

test("normalizeQuizBinState drops manual answer keys and topics", () => {
  const normalized = normalizeQuizBinState({
    imports: [
      makeImport("qb1", "2026-01-01T00:00:00.000Z", {
        questions: [
          {
            id: "qb1-q1",
            prompt: "Question 1",
            type: "single",
            points: 1,
            graded: true,
            topic: "Functions",
            correctAnswers: ["A"],
            pointSource: "key"
          },
          {
            id: "qb1-q2",
            prompt: "Question 2",
            type: "multiple",
            points: 2,
            graded: true,
            correctAnswers: ["A; B"],
            correctOptions: ["A", "B"],
            answerKeySource: "inferred",
            keyResponseCount: 2
          }
        ]
      })
    ]
  });
  const [manual, inferred] = normalized.imports[0].questions;
  assert.equal("topic" in manual, false);
  assert.deepEqual(manual.correctAnswers, []);
  assert.equal(manual.answerKeySource, "none");
  assert.deepEqual(inferred.correctAnswers, ["A; B"]);
  assert.deepEqual(inferred.correctOptions, ["A", "B"]);
  assert.equal(inferred.answerKeySource, "inferred");
  assert.equal(normalized.imports[0].grading.inferredKeyCount, 1);
});

test("normalizeQuizBinState preserves exported possible totals", () => {
  const normalized = normalizeQuizBinState({
    imports: [
      makeImport("qb1", "2026-01-01T00:00:00.000Z", {
        grading: {
          possibleTotal: 0,
          exportedPossibleTotal: 8,
          scoreMismatches: 0
        }
      })
    ]
  });
  assert.equal(normalized.imports[0].grading.possibleTotal, 0);
  assert.equal(normalized.imports[0].grading.exportedPossibleTotal, 8);
});

test("normalizeQuizBinState preserves all supported question types", () => {
  const types = [
    "single",
    "short",
    "paragraph",
    "multiple",
    "grid-single",
    "grid-multiple",
    "date",
    "time"
  ];
  const normalized = normalizeQuizBinState({
    imports: [
      makeImport("qb1", "2026-01-01T00:00:00.000Z", {
        questions: [
          ...types.map((type, index) => ({
            id: `qb1-q${index + 1}`,
            prompt: `Question ${index + 1}`,
            type,
            points: 1,
            graded: true
          })),
          {
            id: "qb1-q99",
            prompt: "Unknown type",
            type: "essay",
            points: 1,
            graded: true
          }
        ]
      })
    ]
  });
  assert.deepEqual(
    normalized.imports[0].questions.map((question) => question.type),
    [...types, "single"]
  );
});

test("normalizeQuizBinState preserves the unlinked marker", () => {
  const normalized = normalizeQuizBinState({
    imports: [
      makeImport("qb1", "2026-01-01T00:00:00.000Z", {
        quizId: "q1",
        unlinked: true
      })
    ]
  });
  assert.equal(normalized.imports[0].quizId, "q1");
  assert.equal(normalized.imports[0].unlinked, true);
});

test("normalizeQuizBinState caps stored imports and keeps the newest", () => {
  const normalized = normalizeQuizBinState({ imports: makeImports(35) });
  assert.equal(normalized.imports.length, 30);
  assert.equal(normalized.imports[0].id, "qb35");
  assert.equal(normalized.imports.at(-1).id, "qb6");
});

test("normalizeQuizBinState handles malformed stored JSON through loadQuizBin", () => {
  const previous = globalThis.localStorage;
  const backing = new Map();
  globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key)
  };
  try {
    backing.set(QUIZ_BIN_STORAGE_KEY, "{not json");
    assert.deepEqual(loadQuizBin(), createEmptyQuizBinState());
  } finally {
    if (previous === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previous;
    }
  }
});

test("saveQuizBin persists, caps, and reloads imports", () => {
  const previous = globalThis.localStorage;
  const backing = new Map();
  globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key)
  };
  try {
    const result = saveQuizBin({ imports: makeImports(32) });
    assert.equal(result.ok, true);
    const loaded = loadQuizBin();
    assert.equal(loaded.imports.length, 30);
    assert.equal(loaded.imports[0].id, "qb32");

    const cleared = clearQuizBin();
    assert.equal(cleared.ok, true);
    assert.deepEqual(loadQuizBin(), createEmptyQuizBinState());
  } finally {
    if (previous === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previous;
    }
  }
});
