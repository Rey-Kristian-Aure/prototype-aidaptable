import test from "node:test";
import assert from "node:assert/strict";

import { createDemoState } from "../js/data.js";
import {
  countScheduledMinutes,
  getCalendarCell,
  getCellAllocationDetails,
  getScheduledDates,
  normalizeState,
  STATUS
} from "../js/models.js";
import {
  computeTeachingDays,
  generateSchedule,
  getAutomaticReflowDate,
  summarizeGeneration
} from "../js/scheduler.js";
import { getQuizCoverageWarnings } from "../js/quiz-coverage.js";

function makeSemesterState({
  startDate,
  endDate,
  classDays = ["Mon", "Wed", "Fri"],
  classTimes,
  topics,
  quizzes = [],
  threshold = 2
}) {
  return normalizeState({
    semester: { startDate, endDate, classDays, classTimes },
    topics,
    quizzes,
    calendar: [],
    lowPriorityThreshold: threshold,
    history: []
  });
}

function topic(id, hours, priority, dependencies = []) {
  return {
    id,
    title: id.toUpperCase(),
    estimatedHours: hours,
    priority,
    dependencies,
    status: STATUS.PENDING,
    hold: false,
    asyncReason: ""
  };
}

function byId(state) {
  return new Map(state.topics.map((item) => [item.id, item]));
}

test("demo semester has 53 teaching days and 159 hours", () => {
  const state = normalizeState(createDemoState());
  const days = computeTeachingDays(state);
  assert.equal(days.length, 53);
  assert.equal(days[0], "2026-08-05");
  assert.equal(days.at(-1), "2026-12-14");
  assert.ok(!days.includes("2026-08-21"));
  assert.ok(!days.includes("2026-11-30"));
  assert.ok(!days.includes("2026-09-25"));
  assert.ok(!days.includes("2026-11-13"));
  assert.equal(
    state.topics.reduce((sum, item) => sum + countEstimated(item), 0),
    159 * 60
  );
});

function countEstimated(topicItem) {
  return Math.round(topicItem.estimatedHours * 60);
}

test("demo generation schedules all eight topics using every class minute", () => {
  const result = generateSchedule(createDemoState());
  assert.equal(result.ok, true, result.errors?.join(" "));
  const state = result.state;

  assert.equal(state.topics.filter((item) => item.status === STATUS.SCHEDULED).length, 8);
  assert.equal(summarizeGeneration(state).async, 0);
  assert.equal(summarizeGeneration(state).partial, 0);
  assert.equal(summarizeGeneration(state).unscheduled, 0);

  const allocatedMinutes = state.calendar.reduce(
    (sum, cell) =>
      sum + cell.allocations.reduce((cellSum, item) => cellSum + item.minutes, 0),
    0
  );
  assert.equal(allocatedMinutes, 53 * 180);
  assert.equal(
    state.calendar.filter((cell) => cell.allocations.length).length,
    53
  );

  const quizCell = state.calendar.find((cell) => cell.date === "2026-09-25");
  assert.equal(quizCell.type, "quiz");
  assert.deepEqual(quizCell.allocations, []);

  const holidayCell = state.calendar.find((cell) => cell.date === "2026-08-21");
  assert.equal(holidayCell.type, "suspended");
  assert.equal(holidayCell.suspended, true);

  assert.deepEqual(getScheduledDates(state, "t1"), [
    "2026-08-05",
    "2026-08-07",
    "2026-08-10",
    "2026-08-12",
    "2026-08-14",
    "2026-08-17",
    "2026-08-19",
    "2026-08-24"
  ]);
  assert.deepEqual(getScheduledDates(state, "t8"), ["2026-12-14"]);
  assert.equal(countScheduledMinutes(state, "t1"), 24 * 60);
});

test("shortage shares time linearly by priority after one-hour minimums", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-03",
    classDays: ["Mon"],
    topics: [topic("a", 4, 5), topic("b", 4, 4)]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const cell = result.state.calendar.find((item) => item.date === "2026-08-03");
  const topics = byId(result.state);

  assert.deepEqual(cell.allocations, [
    { topicId: "a", minutes: 94 },
    { topicId: "b", minutes: 86 }
  ]);
  assert.equal(topics.get("a").status, STATUS.PARTIAL);
  assert.equal(
    topics.get("a").asyncReason,
    "2.43h still unplaced after priority-weighted sharing"
  );
  assert.equal(topics.get("b").status, STATUS.PARTIAL);
  assert.equal(
    topics.get("b").asyncReason,
    "2.57h still unplaced after priority-weighted sharing"
  );
  assert.equal(countScheduledMinutes(result.state, "a"), 94);
  assert.equal(countScheduledMinutes(result.state, "b"), 86);
  assert.equal(summarizeGeneration(result.state).partial, 2);
  assert.equal(summarizeGeneration(result.state).async, 0);
  assert.equal(summarizeGeneration(result.state).unscheduled, 0);
});

test("one-hour floors give each ready topic a block when capacity is tight", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-03",
    classDays: ["Mon"],
    topics: [topic("a", 1, 5), topic("b", 1, 4), topic("c", 2, 3)]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const cell = result.state.calendar.find((item) => item.date === "2026-08-03");

  assert.deepEqual(cell.allocations, [
    { topicId: "a", minutes: 60 },
    { topicId: "b", minutes: 60 },
    { topicId: "c", minutes: 60 }
  ]);
  assert.equal(byId(result.state).get("a").status, STATUS.SCHEDULED);
  assert.equal(byId(result.state).get("b").status, STATUS.SCHEDULED);
  assert.equal(byId(result.state).get("c").status, STATUS.PARTIAL);
  assert.equal(countScheduledMinutes(result.state, "c"), 60);
});

test("full scheduling remains sequential when all ready work fits", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-03",
    classDays: ["Mon"],
    topics: [topic("a", 1, 5), topic("b", 1, 4), topic("c", 1, 3)]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const cell = result.state.calendar.find((item) => item.date === "2026-08-03");

  assert.deepEqual(cell.allocations, [
    { topicId: "a", minutes: 60 },
    { topicId: "b", minutes: 60 },
    { topicId: "c", minutes: 60 }
  ]);
  assert.equal(result.state.topics.every((item) => item.status === STATUS.SCHEDULED), true);
});

test("a short day is skipped so a topic can continue on the next class day", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-05",
    classDays: ["Mon", "Wed"],
    classTimes: {
      Mon: { start: "09:00", end: "09:30" },
      Wed: { start: "09:00", end: "11:00" }
    },
    topics: [topic("a", 2, 5)]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const monday = result.state.calendar.find((cell) => cell.date === "2026-08-03");
  const wednesday = result.state.calendar.find(
    (cell) => cell.date === "2026-08-05"
  );
  assert.deepEqual(monday.allocations, []);
  assert.deepEqual(wednesday.allocations, [{ topicId: "a", minutes: 120 }]);
  assert.equal(byId(result.state).get("a").status, STATUS.SCHEDULED);
});

test("the final short remainder may use the last available class day", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-05",
    classDays: ["Mon", "Wed"],
    classTimes: {
      Mon: { start: "09:00", end: "10:30" },
      Wed: { start: "09:00", end: "09:30" }
    },
    topics: [topic("a", 2, 5)]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const monday = result.state.calendar.find((cell) => cell.date === "2026-08-03");
  const wednesday = result.state.calendar.find(
    (cell) => cell.date === "2026-08-05"
  );
  assert.deepEqual(monday.allocations, [{ topicId: "a", minutes: 90 }]);
  assert.deepEqual(wednesday.allocations, [{ topicId: "a", minutes: 30 }]);
  assert.equal(byId(result.state).get("a").status, STATUS.SCHEDULED);
});

test("quiz deadlines order topics before flexible work", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-10",
    topics: [topic("high", 5, 5), topic("quiz", 2, 1)],
    quizzes: [
      {
        id: "q1",
        title: "Early quiz",
        date: "2026-08-05",
        coveredTopicIds: ["quiz"]
      }
    ]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const topics = byId(result.state);
  assert.equal(topics.get("quiz").status, STATUS.SCHEDULED);
  assert.equal(topics.get("high").status, STATUS.SCHEDULED);
  assert.deepEqual(getScheduledDates(result.state, "quiz"), ["2026-08-03"]);
  assert.deepEqual(result.state.quizzes[0].date, "2026-08-05");
  assert.deepEqual(result.quizMoves, []);
  assert.deepEqual(getQuizCoverageWarnings(result.state), []);
});

test("a quiz is moved automatically when covered work finishes late", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-14",
    topics: [topic("a", 4, 5)],
    quizzes: [
      {
        id: "q1",
        title: "Quiz",
        date: "2026-08-05",
        coveredTopicIds: ["a"]
      }
    ]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  assert.deepEqual(result.quizMoves, [
    {
      quizId: "q1",
      title: "Quiz",
      from: "2026-08-05",
      to: "2026-08-10"
    }
  ]);
  assert.equal(result.state.quizzes[0].date, "2026-08-10");
  assert.equal(byId(result.state).get("a").status, STATUS.SCHEDULED);
  assert.deepEqual(getQuizCoverageWarnings(result.state), []);
  const quizCell = result.state.calendar.find(
    (cell) => cell.date === "2026-08-10"
  );
  assert.equal(quizCell.type, "quiz");
  assert.deepEqual(quizCell.allocations, []);
});

test("dependencies still gate the deadline-aware sequence", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-07",
    topics: [
      topic("a", 1, 1),
      topic("b", 1, 5, ["a"]),
      topic("c", 1, 5, ["b"]),
      topic("d", 2, 4)
    ]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const a = getScheduledDates(result.state, "a")[0];
  const b = getScheduledDates(result.state, "b")[0];
  const c = getScheduledDates(result.state, "c")[0];
  assert.ok(a < b, `${a} should be before ${b}`);
  assert.ok(b <= c, `${b} should be before or on ${c}`);
  const bSlot = getCellAllocationDetails(
    result.state,
    getCalendarCell(result.state, b)
  ).find((item) => item.topicId === "b");
  const cSlot = getCellAllocationDetails(
    result.state,
    getCalendarCell(result.state, c)
  ).find((item) => item.topicId === "c");
  assert.ok(bSlot.endMinutes <= cSlot.startMinutes);
  assert.deepEqual(getScheduledDates(result.state, "d")[0], "2026-08-03");
});

test("a blocked prerequisite cascades to dependents", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-07",
    topics: [
      topic("a", 20, 5),
      topic("b", 1, 5, ["a"]),
      topic("c", 1, 1, ["a"])
    ]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const topics = byId(result.state);
  assert.equal(topics.get("a").status, STATUS.PARTIAL);
  assert.equal(topics.get("b").status, STATUS.UNSCHEDULED);
  assert.equal(topics.get("c").status, STATUS.ASYNC);
  assert.match(topics.get("b").asyncReason, /Blocked by A/);
});

test("dependency order is preserved when the prerequisite has lower priority", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-07",
    topics: [
      topic("a", 1, 1),
      topic("b", 1, 5, ["a"]),
      topic("c", 1, 5, ["b"]),
      topic("d", 2, 4)
    ]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const a = getScheduledDates(result.state, "a")[0];
  const b = getScheduledDates(result.state, "b")[0];
  const c = getScheduledDates(result.state, "c")[0];
  assert.ok(a < b, `${a} should be before ${b}`);
  assert.ok(b <= c, `${b} should be before or on ${c}`);
  const bSlot = getCellAllocationDetails(
    result.state,
    getCalendarCell(result.state, b)
  ).find((item) => item.topicId === "b");
  const cSlot = getCellAllocationDetails(
    result.state,
    getCalendarCell(result.state, c)
  ).find((item) => item.topicId === "c");
  assert.ok(bSlot.endMinutes <= cSlot.startMinutes);
  assert.deepEqual(getScheduledDates(result.state, "d")[0], "2026-08-03");
});

test("dropped topics are skipped and block their dependents", () => {
  const base = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-07",
    topics: [topic("a", 1, 5), topic("b", 1, 5, ["a"])]
  });
  base.topics[0].status = STATUS.DROPPED;
  const result = generateSchedule(base);
  assert.equal(result.ok, true);
  const topics = byId(result.state);
  assert.equal(topics.get("a").status, STATUS.DROPPED);
  assert.equal(topics.get("b").status, STATUS.UNSCHEDULED);
  assert.match(topics.get("b").asyncReason, /Blocked by A/);
});

test("generation rejects dependency cycles and missing topics", () => {
  const cyclic = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-14",
    topics: [topic("a", 1, 5, ["b"]), topic("b", 1, 5, ["a"])]
  });
  const cycleResult = generateSchedule(cyclic);
  assert.equal(cycleResult.ok, false);
  assert.ok(cycleResult.errors.some((message) => /cycle/i.test(message)));

  const missing = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-14",
    topics: [topic("a", 1, 5, ["nope"])]
  });
  const missingResult = generateSchedule(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.errors.some((message) => /missing topic/i.test(message)));
});

test("per-weekday class windows constrain each day", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-05",
    classDays: ["Mon", "Wed"],
    classTimes: {
      Mon: { start: "09:00", end: "10:30" },
      Wed: { start: "13:00", end: "15:00" }
    },
    topics: [topic("a", 3, 5)]
  });
  const result = generateSchedule(state);
  assert.equal(result.ok, true);
  const first = result.state.calendar.find((cell) => cell.date === "2026-08-03");
  const second = result.state.calendar.find((cell) => cell.date === "2026-08-05");
  assert.deepEqual(first.allocations, [{ topicId: "a", minutes: 90 }]);
  assert.deepEqual(second.allocations, [{ topicId: "a", minutes: 90 }]);
  assert.equal(countScheduledMinutes(result.state, "a"), 180);
});

test("automatic reflow starts at the earliest upcoming allocated class", () => {
  const state = makeSemesterState({
    startDate: "2026-08-03",
    endDate: "2026-08-14",
    topics: [topic("a", 1, 5)]
  });
  state.calendar = [
    {
      date: "2026-08-03",
      type: "class",
      allocations: [{ topicId: "a", minutes: 60 }],
      note: ""
    },
    {
      date: "2026-08-05",
      type: "class",
      allocations: [{ topicId: "a", minutes: 60 }],
      note: ""
    },
    {
      date: "2026-08-10",
      type: "class",
      allocations: [{ topicId: "a", minutes: 60 }],
      note: ""
    }
  ];

  assert.equal(
    getAutomaticReflowDate(state, "2026-08-10", "2026-08-03"),
    "2026-08-03"
  );
  assert.equal(
    getAutomaticReflowDate(state, "2026-08-10", "2026-08-04"),
    "2026-08-05"
  );
  assert.equal(
    getAutomaticReflowDate(state, "2026-08-04", "2026-08-03"),
    "2026-08-03"
  );
  assert.equal(
    getAutomaticReflowDate(state, "2026-08-11", "2026-08-10"),
    "2026-08-10"
  );
});
