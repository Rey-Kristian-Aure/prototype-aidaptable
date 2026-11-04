import test from "node:test";
import assert from "node:assert/strict";

import { createDemoState } from "../js/data.js";
import {
  getEstimatedMinutes,
  getTopic,
  normalizeState,
  STATUS
} from "../js/models.js";
import {
  applyQuizMovePlan,
  getQuizCoverage,
  getQuizCoverageWarnings,
  getQuizMovePlan,
  getTopicQuizDeadlines,
  hasAnySchedule
} from "../js/quiz-coverage.js";
import { generateSchedule } from "../js/scheduler.js";
import { convertTopicToAsync } from "../js/rearrangement.js";

function scheduledDemo() {
  const result = generateSchedule(normalizeState(createDemoState()));
  assert.equal(result.ok, true, result.errors?.join(" "));
  return result.state;
}

function addQuiz(state, id, date, coveredTopicIds, title = "Extra quiz") {
  state.quizzes.push({
    id,
    title,
    date,
    coveredTopicIds,
    priorDate: null,
    cancelled: false
  });
  return state.quizzes.at(-1);
}

function quizById(state, id) {
  return state.quizzes.find((quiz) => quiz.id === id);
}

test("demo quizzes cover all selected topics before their dates", () => {
  const state = scheduledDemo();
  assert.equal(hasAnySchedule(state), true);
  assert.deepEqual(getQuizCoverageWarnings(state), []);

  const quiz1 = getQuizCoverage(state, quizById(state, "q1"));
  assert.deepEqual(quiz1.covered, ["t1", "t2"]);
  assert.deepEqual(quiz1.warnings, []);
  assert.equal(quiz1.pending, false);

  const quiz2 = getQuizCoverage(state, quizById(state, "q2"));
  assert.deepEqual(quiz2.covered, ["t3", "t4", "t5"]);
  assert.deepEqual(quiz2.warnings, []);
});

test("coverage warns when a selected topic finishes after the quiz", () => {
  const state = scheduledDemo();
  const quiz = addQuiz(state, "early", "2026-09-18", ["t3"]);

  const coverage = getQuizCoverage(state, quiz);
  assert.deepEqual(coverage.covered, []);
  assert.equal(coverage.warnings.length, 1);
  const warning = coverage.warnings[0];
  assert.equal(warning.topicId, "t3");
  assert.equal(warning.status, STATUS.SCHEDULED);
  assert.equal(warning.estimatedMinutes, getEstimatedMinutes(getTopic(state, "t3")));
  assert.equal(warning.scheduledBeforeMinutes, 360);
  assert.equal(warning.remainingMinutes, 18 * 60);
  assert.equal(warning.lastScheduledDate, "2026-10-02");
  assert.equal(warning.fullyScheduled, true);
  assert.equal(coverage.canMove, true);
  assert.equal(coverage.suggestedDate, "2026-10-05");
});

test("coverage is measured strictly before the quiz date", () => {
  const state = scheduledDemo();
  const sameDay = addQuiz(state, "same-day", "2026-10-02", ["t3"]);
  const warning = getQuizCoverage(state, sameDay).warnings[0];
  assert.equal(warning.lastScheduledDate, "2026-10-02");
  assert.ok(warning.scheduledBeforeMinutes < warning.estimatedMinutes);
  assert.equal(warning.remainingMinutes, 180);

  const nextClassDay = addQuiz(state, "after", "2026-10-05", ["t3"]);
  assert.deepEqual(getQuizCoverage(state, nextClassDay).warnings, []);
});

test("coverage suggestions skip existing quiz dates", () => {
  const state = scheduledDemo();
  addQuiz(state, "target-blocker", "2026-10-05", [], "Already booked");
  const quiz = addQuiz(state, "early", "2026-09-18", ["t3"]);
  const coverage = getQuizCoverage(state, quiz);
  assert.equal(coverage.suggestedDate, "2026-10-07");
});


test("quiz deadlines propagate to prerequisites and use the earliest date", () => {
  const state = normalizeState({
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-10-30",
      classDays: ["Mon", "Wed", "Fri"]
    },
    topics: [
      {
        id: "a",
        title: "A",
        estimatedHours: 1,
        priority: 5,
        dependencies: [],
        status: STATUS.PENDING
      },
      {
        id: "b",
        title: "B",
        estimatedHours: 1,
        priority: 5,
        dependencies: ["a"],
        status: STATUS.PENDING
      },
      {
        id: "c",
        title: "C",
        estimatedHours: 1,
        priority: 5,
        dependencies: [],
        status: STATUS.PENDING
      }
    ],
    quizzes: [
      {
        id: "q1",
        title: "Quiz 1",
        date: "2026-09-04",
        coveredTopicIds: ["b"]
      },
      {
        id: "q2",
        title: "Quiz 2",
        date: "2026-09-25",
        coveredTopicIds: ["a", "c"]
      }
    ],
    calendar: [],
    lowPriorityThreshold: 2,
    history: []
  });

  const deadlines = getTopicQuizDeadlines(state);
  assert.equal(deadlines.get("a"), "2026-09-04");
  assert.equal(deadlines.get("b"), "2026-09-04");
  assert.equal(deadlines.get("c"), "2026-09-25");
});

test("quiz move plans use a later free class day", () => {
  const state = scheduledDemo();
  addQuiz(state, "early", "2026-09-18", ["t3"]);

  const moves = getQuizMovePlan(state);
  assert.deepEqual(moves, [
    {
      quizId: "early",
      title: "Extra quiz",
      from: "2026-09-18",
      to: "2026-10-05"
    }
  ]);

  applyQuizMovePlan(state, moves);
  assert.equal(quizById(state, "early").date, "2026-10-05");
  assert.equal(
    state.calendar.find((cell) => cell.date === "2026-09-18").type,
    "class"
  );
  const target = state.calendar.find((cell) => cell.date === "2026-10-05");
  assert.equal(target.type, "quiz");
  assert.deepEqual(target.allocations, []);
});

test("quiz move plans leave unfinished coverage in place", () => {
  const state = scheduledDemo();
  const asyncState = convertTopicToAsync(state, "t8");
  addQuiz(asyncState, "early", "2026-09-18", ["t8"]);
  assert.deepEqual(getQuizMovePlan(asyncState), []);
});

test("unfinished topics cannot be auto-moved to a later quiz date", () => {
  const state = scheduledDemo();
  const asyncState = convertTopicToAsync(state, "t8");
  const quiz = addQuiz(asyncState, "early", "2026-09-18", ["t8"]);

  const coverage = getQuizCoverage(asyncState, quiz);
  assert.equal(coverage.warnings.length, 1);
  assert.equal(coverage.warnings[0].status, STATUS.ASYNC);
  assert.equal(coverage.warnings[0].fullyScheduled, false);
  assert.equal(coverage.canMove, false);
  assert.equal(coverage.suggestedDate, "");
});

test("coverage checks are pending before any schedule exists", () => {
  const state = normalizeState(createDemoState());
  assert.equal(hasAnySchedule(state), false);
  assert.deepEqual(getQuizCoverageWarnings(state), []);

  const coverage = getQuizCoverage(state, quizById(state, "q1"));
  assert.equal(coverage.pending, true);
  assert.deepEqual(coverage.warnings, []);
  assert.equal(coverage.canMove, false);
});

test("missing covered topics warn and filter by quiz id", () => {
  const state = scheduledDemo();
  addQuiz(state, "early", "2026-09-18", ["t3"]);
  addQuiz(state, "bad", "2026-10-09", ["missing-topic"]);

  assert.deepEqual(
    getQuizCoverageWarnings(state).map((item) => item.quizId),
    ["early", "bad"]
  );
  assert.deepEqual(
    getQuizCoverageWarnings(state, ["bad"]).map((item) => item.quizId),
    ["bad"]
  );

  const bad = getQuizCoverage(state, quizById(state, "bad"));
  assert.equal(bad.warnings[0].status, "missing");
  assert.equal(bad.warnings[0].title, "Deleted topic");
  assert.equal(bad.canMove, false);
});

test("quiz move application ignores targets outside the semester", () => {
  const state = normalizeState({
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      classDays: ["Mon", "Wed", "Fri"],
      classTimes: {
        Mon: { start: "09:00", end: "12:00" },
        Wed: { start: "09:00", end: "12:00" },
        Fri: { start: "09:00", end: "12:00" }
      }
    },
    topics: [
      {
        id: "t1",
        title: "Topic 1",
        estimatedHours: 3,
        priority: 5,
        dependencies: [],
        status: STATUS.PENDING
      }
    ],
    quizzes: [
      {
        id: "q1",
        title: "Quiz 1",
        date: "2026-08-05",
        coveredTopicIds: ["t1"]
      }
    ],
    calendar: [],
    history: []
  });

  applyQuizMovePlan(state, [
    {
      quizId: "q1",
      title: "Quiz 1",
      from: "2026-08-05",
      to: "2026-08-10"
    }
  ]);

  assert.equal(quizById(state, "q1").date, "2026-08-05");
  assert.equal(
    state.calendar.some((cell) => cell.date === "2026-08-10"),
    false
  );
});
