import test from "node:test";
import assert from "node:assert/strict";

import {
  getCellAllocationDetails,
  getEstimatedMinutes,
  normalizeState,
  STATUS,
  validateState,
  validateTopicBatch
} from "../js/models.js";

test("legacy session state migrates to hours, class times, and allocations", () => {
  const state = normalizeState({
    version: 1,
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-08-14",
      classDays: ["Mon", "Wed", "Fri"]
    },
    topics: [
      {
        id: "a",
        title: "A",
        duration: 3,
        priority: 5,
        dependencies: []
      }
    ],
    quizzes: [],
    calendar: [
      {
        date: "2026-08-03",
        type: "class",
        topicIds: ["a"],
        note: ""
      }
    ],
    history: [{ at: "old", label: "Old", state: {} }]
  });

  assert.equal(state.version, 2);
  assert.deepEqual(state.semester.classTimes.Mon, {
    start: "09:00",
    end: "12:00"
  });
  assert.equal(state.topics[0].estimatedHours, 9);
  assert.equal(getEstimatedMinutes(state.topics[0]), 540);
  assert.deepEqual(state.calendar[0].allocations, [
    { topicId: "a", minutes: 180 }
  ]);
  assert.deepEqual(state.history, []);
});

test("v2 history survives normalization", () => {
  const state = normalizeState({
    version: 2,
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-08-14",
      classDays: ["Mon"],
      classTimes: { Mon: { start: "10:00", end: "11:30" } }
    },
    topics: [],
    quizzes: [],
    calendar: [],
    history: [{ at: "now", label: "Saved", state: { topics: [] } }]
  });
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].label, "Saved");
  assert.deepEqual(state.semester.classTimes.Mon, {
    start: "10:00",
    end: "11:30"
  });
});

test("allocation details expose sequential time ranges", () => {
  const state = normalizeState({
    version: 2,
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      classDays: ["Mon"],
      classTimes: { Mon: { start: "13:00", end: "15:00" } }
    },
    topics: [
      {
        id: "a",
        title: "A",
        estimatedHours: 1,
        priority: 5,
        dependencies: []
      },
      {
        id: "b",
        title: "B",
        estimatedHours: 1,
        priority: 4,
        dependencies: []
      }
    ],
    calendar: [
      {
        date: "2026-08-03",
        type: "class",
        allocations: [
          { topicId: "a", minutes: 60 },
          { topicId: "b", minutes: 60 }
        ]
      }
    ]
  });
  const details = getCellAllocationDetails(state, state.calendar[0]);
  assert.deepEqual(
    details.map((item) => [item.topicId, item.startTime, item.endTime]),
    [
      ["a", "13:00", "14:00"],
      ["b", "14:00", "15:00"]
    ]
  );
  assert.equal(validateState(state).ok, true);
});

test("batch validation catches removed dependencies and cycles", () => {
  const removedDependency = validateTopicBatch([
    {
      key: "a",
      id: "a",
      title: "A",
      estimatedHours: 3,
      priority: 5,
      dependencies: ["gone"]
    }
  ]);
  assert.equal(removedDependency.ok, false);
  assert.match(removedDependency.errors[0], /removed/);

  const cycle = validateTopicBatch([
    {
      key: "a",
      id: "a",
      title: "A",
      estimatedHours: 3,
      priority: 5,
      dependencies: ["b"]
    },
    {
      key: "b",
      id: "b",
      title: "B",
      estimatedHours: 3,
      priority: 5,
      dependencies: ["a"]
    }
  ]);
  assert.equal(cycle.ok, false);
  assert.ok(cycle.errors.some((message) => /cycle/i.test(message)));
});

test("quiz coverage normalizes unique topic ids and warns about removed topics", () => {
  const state = normalizeState({
    version: 2,
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-08-14",
      classDays: ["Mon"],
      classTimes: { Mon: { start: "09:00", end: "12:00" } }
    },
    topics: [
      {
        id: "a",
        title: "A",
        estimatedHours: 3,
        priority: 5,
        dependencies: []
      }
    ],
    quizzes: [
      {
        id: "q1",
        title: "Quiz 1",
        date: "2026-08-10",
        coveredTopicIds: ["a", "a", "", null, "gone"]
      }
    ],
    calendar: [],
    history: []
  });

  assert.deepEqual(state.quizzes[0].coveredTopicIds, ["a", "gone"]);
  const validation = validateState(state);
  assert.equal(validation.ok, true);
  assert.ok(
    validation.warnings.some((message) =>
      /no longer exists \(gone\)/.test(message)
    )
  );
});

test("validation rejects topic allocations outside the semester", () => {
  const state = normalizeState({
    version: 2,
    semester: {
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      classDays: ["Mon"],
      classTimes: { Mon: { start: "09:00", end: "12:00" } }
    },
    topics: [
      {
        id: "a",
        title: "A",
        estimatedHours: 1,
        priority: 5,
        dependencies: [],
        status: STATUS.PENDING
      }
    ],
    quizzes: [],
    calendar: [
      {
        date: "2026-08-10",
        type: "class",
        allocations: [{ topicId: "a", minutes: 60 }]
      }
    ],
    history: []
  });

  const validation = validateState(state);
  assert.equal(validation.ok, false);
  assert.ok(
    validation.errors.some((message) =>
      /2026-08-10 falls outside the semester/.test(message)
    )
  );
});
