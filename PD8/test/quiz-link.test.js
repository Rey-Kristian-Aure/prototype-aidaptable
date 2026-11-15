import test from "node:test";
import assert from "node:assert/strict";

import { suggestQuizLink } from "../js/quiz-link.js";

const quizzes = [
  {
    id: "q1",
    title: "Albay Province Knowledge Quiz",
    date: "2026-11-13"
  },
  {
    id: "q2",
    title: "Math Review Quiz",
    date: "2026-11-20"
  }
];

test("a unique title and date match is high confidence", () => {
  const result = suggestQuizLink({
    quizzes,
    title: "Albay Province Knowledge Quiz",
    fileName: "Albay Province Knowledge Quiz.csv",
    date: "2026-11-14"
  });
  assert.equal(result.confidence, "high");
  assert.equal(result.quiz.id, "q1");
  assert.equal(result.candidates.length, 1);
});

test("two similar scheduled quizzes make the match ambiguous", () => {
  const result = suggestQuizLink({
    quizzes: [
      { id: "q1", title: "Albay Quiz", date: "2026-11-13" },
      { id: "q2", title: "Albay Quiz", date: "2026-11-14" }
    ],
    title: "Albay Quiz",
    fileName: "Albay Quiz.csv",
    date: "2026-11-13"
  });
  assert.equal(result.confidence, "ambiguous");
  assert.equal(result.quiz, null);
  assert.equal(result.candidates.length, 2);
});

test("a title match with a distant date stays a possible match", () => {
  const result = suggestQuizLink({
    quizzes: [quizzes[1]],
    title: "Math Review Quiz",
    fileName: "Math Review Quiz.csv",
    date: "2026-11-13"
  });
  assert.equal(result.confidence, "possible");
  assert.equal(result.quiz, null);
  assert.equal(result.candidates.length, 1);
});

test("the file name can provide the title match", () => {
  const result = suggestQuizLink({
    quizzes,
    title: "Response spreadsheet",
    fileName: "Albay Province Knowledge Quiz.csv",
    date: "2026-11-13"
  });
  assert.equal(result.confidence, "high");
  assert.equal(result.quiz.id, "q1");
});

test("a date within three days still matches", () => {
  const result = suggestQuizLink({
    quizzes,
    title: "Albay Province Knowledge Quiz",
    fileName: "Albay Province Knowledge Quiz.csv",
    date: "2026-11-16"
  });
  assert.equal(result.confidence, "high");
  assert.equal(result.quiz.id, "q1");
});

test("unrelated titles do not produce a match", () => {
  const result = suggestQuizLink({
    quizzes,
    title: "Science Quiz",
    fileName: "Science Quiz.csv",
    date: "2026-11-13"
  });
  assert.equal(result.confidence, "none");
  assert.equal(result.quiz, null);
  assert.deepEqual(result.candidates, []);
});
