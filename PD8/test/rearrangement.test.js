import test from "node:test";
import assert from "node:assert/strict";

import { createDemoState } from "../js/data.js";
import {
  countScheduledMinutes,
  getScheduledDates,
  makeHistoryEntry,
  normalizeState,
  STATUS,
  validateState
} from "../js/models.js";
import {
  computeTeachingDays,
  generateSchedule,
  getAutomaticReflowDate
} from "../js/scheduler.js";
import {
  rearrange,
  reconcileSemesterDates,
  removeTopicSessionsFrom,
  restoreTopic,
  convertTopicToAsync,
  dropTopic
} from "../js/rearrangement.js";

function generatedDemo() {
  const result = generateSchedule(normalizeState(createDemoState()));
  assert.equal(result.ok, true, result.errors?.join(" "));
  return result.state;
}

function suspendDates(state, dates) {
  for (const date of dates) {
    let cell = state.calendar.find((item) => item.date === date);
    if (!cell) {
      cell = {
        date,
        type: "class",
        allocations: [],
        note: "",
        suspended: false
      };
      state.calendar.push(cell);
    }
    cell.type = "suspended";
    cell.suspended = true;
    cell.allocations = [];
  }
  state.calendar.sort((left, right) => (left.date < right.date ? -1 : 1));
}

function byId(state) {
  return new Map(state.topics.map((topic) => [topic.id, topic]));
}

test("suspending Sep 4 shares the shortfall instead of making a topic async", () => {
  const state = generatedDemo();
  suspendDates(state, ["2026-09-04"]);

  const result = rearrange(state, "2026-09-04", { label: "Suspended Sep 4" });
  assert.equal(result.ok, true, result.errors?.join(" "));
  const topics = byId(result.state);

  assert.equal(topics.get("t1").status, STATUS.COMPLETED);
  assert.equal(topics.get("t2").status, STATUS.SCHEDULED);
  assert.equal(countScheduledMinutes(result.state, "t2"), 24 * 60);
  assert.equal(topics.get("t7").status, STATUS.PARTIAL);
  assert.equal(countScheduledMinutes(result.state, "t7"), 18 * 60);
  assert.equal(
    topics.get("t7").asyncReason,
    "3h still unplaced after priority-weighted sharing"
  );
  assert.equal(topics.get("t8").status, STATUS.SCHEDULED);
  assert.equal(countScheduledMinutes(result.state, "t8"), 3 * 60);

  assert.equal(result.summary.counts.async, 0);
  assert.equal(result.summary.counts.partial, 1);
  assert.equal(result.summary.counts.unscheduled, 0);
  assert.deepEqual(result.quizMoves, []);
});

test("a long suspension spreads the shortfall across remaining topics", () => {
  const state = generatedDemo();
  const teachingDays = computeTeachingDays(state);
  const suspended = teachingDays.filter(
    (date) => date >= "2026-10-05" && date <= "2026-10-23"
  );
  assert.equal(suspended.length, 9);
  suspendDates(state, suspended);

  const result = rearrange(state, "2026-10-05", {
    label: "Suspended Oct 5-23"
  });
  assert.equal(result.ok, true, result.errors?.join(" "));
  const topics = byId(result.state);

  assert.equal(topics.get("t1").status, STATUS.COMPLETED);
  assert.equal(topics.get("t2").status, STATUS.COMPLETED);
  assert.equal(topics.get("t3").status, STATUS.COMPLETED);
  assert.equal(topics.get("t4").status, STATUS.SCHEDULED);
  assert.equal(topics.get("t5").status, STATUS.SCHEDULED);
  assert.equal(topics.get("t6").status, STATUS.PARTIAL);
  assert.equal(countScheduledMinutes(result.state, "t6"), 528);
  assert.equal(topics.get("t7").status, STATUS.PARTIAL);
  assert.equal(countScheduledMinutes(result.state, "t7"), 372);
  assert.equal(topics.get("t8").status, STATUS.PARTIAL);
  assert.equal(countScheduledMinutes(result.state, "t8"), 168);

  assert.equal(result.summary.counts.async, 0);
  assert.equal(result.summary.counts.partial, 3);
  assert.equal(result.summary.counts.unscheduled, 0);
  assert.deepEqual(
    result.summary.partial.map((item) => item.id),
    ["t6", "t7", "t8"]
  );
  assert.deepEqual(result.quizMoves, [
    {
      quizId: "q2",
      title: "Quiz 2",
      from: "2026-11-13",
      to: "2026-12-02"
    }
  ]);
  assert.equal(result.summary.counts.quizMoves, 1);
  assert.equal(
    result.state.quizzes.find((quiz) => quiz.id === "q2").date,
    "2026-12-02"
  );
});

test("removing a topic holds it and lets later topics shift earlier", () => {
  const state = generatedDemo();
  const t3First = getScheduledDates(state, "t3")[0];
  assert.equal(t3First, "2026-09-14");
  const beforeT4 = getScheduledDates(state, "t4");
  const beforeMinutes = countScheduledMinutes(state, "t3");

  const removal = removeTopicSessionsFrom(state, "t3", t3First, {
    reason: "Removed by teacher"
  });
  assert.equal(removal.removedCount, 8);
  assert.equal(removal.removedMinutes, beforeMinutes);
  assert.equal(removal.state.topics.find((topic) => topic.id === "t3").status, STATUS.UNSCHEDULED);
  assert.equal(removal.state.topics.find((topic) => topic.id === "t3").hold, true);
  assert.deepEqual(getScheduledDates(removal.state, "t3"), []);

  const result = rearrange(removal.state, t3First, {
    label: "Removed Loops",
    removedTopicId: "t3",
    removedMinutes: removal.removedMinutes,
    removedCount: removal.removedCount
  });
  assert.equal(result.ok, true, result.errors?.join(" "));

  const t3 = byId(result.state).get("t3");
  assert.equal(t3.status, STATUS.UNSCHEDULED);
  assert.equal(t3.hold, true);
  const removed = result.summary.removed.find((item) => item.id === "t3");
  assert.equal(removed.removedMinutes, beforeMinutes);
  assert.equal(removed.removedCount, 8);
  assert.ok(result.summary.moved.some((item) => item.id === "t4"));
  assert.ok(result.summary.unscheduled.some((item) => item.id === "t3"));

  const afterT4 = getScheduledDates(result.state, "t4");
  assert.ok(afterT4[0] < beforeT4[0], `${afterT4[0]} should be before ${beforeT4[0]}`);
});

test("Leave As-Is removal keeps other assignments in place", () => {
  const state = generatedDemo();
  const t3First = getScheduledDates(state, "t3")[0];
  const beforeT4 = getScheduledDates(state, "t4");
  const removal = removeTopicSessionsFrom(state, "t3", t3First);
  assert.deepEqual(getScheduledDates(removal.state, "t4"), beforeT4);
  assert.deepEqual(getScheduledDates(removal.state, "t3"), []);
  assert.equal(removal.state.topics.find((topic) => topic.id === "t3").hold, true);
});

test("async topics are sticky across later rearrangements", () => {
  const state = generatedDemo();
  const asyncState = convertTopicToAsync(state, "t8");
  assert.equal(asyncState.topics.find((topic) => topic.id === "t8").status, STATUS.ASYNC);
  assert.deepEqual(getScheduledDates(asyncState, "t8"), []);

  const first = rearrange(asyncState, "2026-09-07");
  assert.equal(first.ok, true, first.errors?.join(" "));
  assert.equal(first.state.topics.find((topic) => topic.id === "t8").status, STATUS.ASYNC);

  const second = rearrange(first.state, "2026-09-14");
  assert.equal(second.ok, true);
  assert.equal(second.state.topics.find((topic) => topic.id === "t8").status, STATUS.ASYNC);
  assert.equal(second.summary.async.length, 0);
});

test("restoring an async topic clears async state without scheduling it automatically", () => {
  const state = generatedDemo();
  const asyncState = convertTopicToAsync(state, "t8");
  const restored = restoreTopic(asyncState, "t8");
  const t8 = restored.topics.find((topic) => topic.id === "t8");
  assert.equal(t8.status, STATUS.PENDING);
  assert.equal(t8.asyncReason, "");
  assert.deepEqual(getScheduledDates(restored, "t8"), []);
});

test("rearrangement cascades a failed prerequisite to scheduled dependents", () => {
  const state = normalizeState({
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      classDays: ["Mon", "Wed", "Fri"]
    },
    topics: [
      {
        id: "a",
        title: "A",
        estimatedHours: 1,
        priority: 1,
        dependencies: [],
        status: STATUS.ASYNC
      },
      {
        id: "b",
        title: "B",
        estimatedHours: 1,
        priority: 5,
        dependencies: ["a"],
        status: STATUS.SCHEDULED
      }
    ],
    calendar: [
      {
        date: "2026-08-03",
        type: "class",
        allocations: [{ topicId: "b", minutes: 60 }],
        note: ""
      }
    ],
    lowPriorityThreshold: 2,
    history: []
  });

  const result = rearrange(state, "2026-08-03");
  assert.equal(result.ok, true);
  const topics = byId(result.state);
  assert.equal(topics.get("a").status, STATUS.ASYNC);
  assert.equal(topics.get("b").status, STATUS.UNSCHEDULED);
  assert.match(topics.get("b").asyncReason, /Blocked by A/);
});

test("rearrangement works after a class window becomes shorter", () => {
  const state = generatedDemo();
  state.semester.classTimes.Mon = { start: "09:00", end: "10:00" };
  const result = rearrange(state, state.semester.startDate, {
    label: "Shortened Monday class"
  });
  assert.equal(result.ok, true, result.errors?.join(" "));
  const monday = result.state.calendar.find(
    (cell) => cell.date === "2026-08-10"
  );
  assert.equal(
    monday.allocations.reduce((sum, item) => sum + item.minutes, 0),
    60
  );
});

test("teacher conversion and drop actions remove calendar assignments", () => {
  const state = generatedDemo();
  const asyncState = convertTopicToAsync(state, "t4");
  assert.equal(asyncState.topics.find((topic) => topic.id === "t4").status, STATUS.ASYNC);
  assert.deepEqual(getScheduledDates(asyncState, "t4"), []);

  const droppedState = dropTopic(state, "t4");
  assert.equal(droppedState.topics.find((topic) => topic.id === "t4").status, STATUS.DROPPED);
  assert.deepEqual(getScheduledDates(droppedState, "t4"), []);
});

test("history snapshots are independent and exclude the history stack", () => {
  const state = generatedDemo();
  state.history.push(makeHistoryEntry(state, "Existing"));
  const snapshot = makeHistoryEntry(state, "Before change");
  state.topics[0].title = "Changed";
  assert.equal(snapshot.state.topics[0].title, "Variables & Data Types");
  assert.deepEqual(snapshot.state.history, []);
  assert.equal(snapshot.label, "Before change");
});

test("suspending the final week reflows into the earliest remaining week", () => {
  const state = normalizeState({
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-08-14",
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
        estimatedHours: 24,
        priority: 5,
        dependencies: [],
        status: STATUS.PENDING
      },
      {
        id: "t2",
        title: "Topic 2",
        estimatedHours: 24,
        priority: 4,
        dependencies: [],
        status: STATUS.PENDING
      }
    ],
    quizzes: [],
    calendar: [],
    lowPriorityThreshold: 2,
    history: []
  });
  const generated = generateSchedule(state);
  assert.equal(generated.ok, true, generated.errors?.join(" "));
  suspendDates(generated.state, ["2026-08-10", "2026-08-12", "2026-08-14"]);

  const reflowDate = getAutomaticReflowDate(
    generated.state,
    "2026-08-10",
    "2026-08-03"
  );
  assert.equal(reflowDate, "2026-08-03");

  const result = rearrange(generated.state, reflowDate, {
    label: "Suspended final week"
  });
  assert.equal(result.ok, true, result.errors?.join(" "));
  const topics = byId(result.state);
  assert.equal(topics.get("t1").status, STATUS.PARTIAL);
  assert.equal(topics.get("t2").status, STATUS.PARTIAL);
  assert.equal(countScheduledMinutes(result.state, "t1"), 294);
  assert.equal(countScheduledMinutes(result.state, "t2"), 246);

  const monday = result.state.calendar.find(
    (cell) => cell.date === "2026-08-03"
  );
  const wednesday = result.state.calendar.find(
    (cell) => cell.date === "2026-08-05"
  );
  const friday = result.state.calendar.find(
    (cell) => cell.date === "2026-08-07"
  );
  assert.deepEqual(monday.allocations, [{ topicId: "t1", minutes: 180 }]);
  assert.deepEqual(wednesday.allocations, [
    { topicId: "t1", minutes: 114 },
    { topicId: "t2", minutes: 66 }
  ]);
  assert.deepEqual(friday.allocations, [{ topicId: "t2", minutes: 180 }]);
  assert.equal(result.summary.counts.partial, 2);
  assert.equal(result.summary.counts.async, 0);
});

function assertWithinSemester(state) {
  const start = state.semester.startDate;
  const end = state.semester.endDate;
  for (const cell of state.calendar) {
    if (cell.allocations?.length) {
      assert.ok(
        cell.date >= start && cell.date <= end,
        `allocation on ${cell.date} is outside ${start}..${end}`
      );
    }
  }
  for (const quiz of state.quizzes) {
    assert.ok(
      quiz.date >= start && quiz.date <= end,
      `quiz ${quiz.id} on ${quiz.date} is outside ${start}..${end}`
    );
  }
  const validation = validateState(state);
  assert.equal(validation.ok, true, validation.errors.join(" "));
}

test("shortening the semester trims later topic allocations", () => {
  const state = generatedDemo();
  const result = reconcileSemesterDates(
    state,
    state.semester.startDate,
    "2026-11-30",
    { label: "Shortened semester" }
  );

  assert.equal(result.ok, true, result.errors?.join(" "));
  assert.equal(result.reflowed, true);
  assert.deepEqual(result.quizMoves, []);
  assertWithinSemester(result.state);
  assert.ok(
    result.state.calendar.every(
      (cell) => !cell.allocations?.length || cell.date <= "2026-11-30"
    )
  );
});

test("shortening the semester relocates an out-of-range quiz", () => {
  const state = generatedDemo();
  const result = reconcileSemesterDates(
    state,
    state.semester.startDate,
    "2026-10-30",
    { label: "Shortened semester" }
  );

  assert.equal(result.ok, true, result.errors?.join(" "));
  assert.equal(result.reflowed, true);
  assert.deepEqual(result.quizMoves, [
    {
      quizId: "q2",
      title: "Quiz 2",
      from: "2026-11-13",
      to: "2026-10-30"
    }
  ]);
  assert.equal(
    result.state.quizzes.find((quiz) => quiz.id === "q2").date,
    "2026-10-30"
  );
  assertWithinSemester(result.state);
});

test("moving the start date later clears earlier work", () => {
  const state = generatedDemo();
  const result = reconcileSemesterDates(
    state,
    "2026-09-01",
    state.semester.endDate,
    { label: "Shortened semester" }
  );

  assert.equal(result.ok, true, result.errors?.join(" "));
  assert.equal(result.reflowed, true);
  assertWithinSemester(result.state);
  assert.ok(
    result.state.calendar.every(
      (cell) => !cell.allocations?.length || cell.date >= "2026-09-01"
    )
  );
});

test("semester date reconciliation blocks when a quiz has no valid class day", () => {
  const state = normalizeState({
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-08-14",
      classDays: ["Mon"],
      classTimes: { Mon: { start: "09:00", end: "12:00" } }
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
        date: "2026-08-17",
        coveredTopicIds: ["t1"]
      }
    ],
    calendar: [],
    history: []
  });

  const result = reconcileSemesterDates(
    state,
    "2026-08-04",
    "2026-08-05",
    { label: "Shortened semester" }
  );

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((message) =>
      /cannot be moved inside the semester/.test(message)
    )
  );
});
