import test from "node:test";
import assert from "node:assert/strict";
import { TUTORIAL_STEPS } from "../js/tutorial.js";

test("guided demo steps keep the interactive task sequence in order", () => {
  assert.deepEqual(
    TUTORIAL_STEPS.map((step) => step.id),
    [
      "welcome",
      "workspaces",
      "semester",
      "topics-edit",
      "quizzes",
      "generate",
      "calendar-toolbar",
      "calendar-day",
      "calendar-summary",
      "async-sidebar",
      "header-actions",
      "quiz-bin-import",
      "quiz-bin-wizard",
      "quiz-bin-report",
      "quiz-bin-tabs",
      "finish"
    ]
  );
  assert.equal(new Set(TUTORIAL_STEPS.map((step) => step.id)).size, 16);
});

test("every interactive step provides a task that can be checked", () => {
  const interactive = TUTORIAL_STEPS.filter((step) => step.interactive);

  assert.equal(interactive.length, 8);
  for (const step of interactive) {
    assert.ok(step.task, `${step.id} needs a task`);
    assert.equal(typeof step.task.instruction, "string");
    assert.ok(step.task.instruction.length > 0);
    assert.equal(typeof step.task.hint, "string");
    assert.equal(typeof step.task.isComplete, "function");
  }
});

test("interactive tasks recognize the expected temporary state", () => {
  const byId = Object.fromEntries(TUTORIAL_STEPS.map((step) => [step.id, step]));

  assert.equal(
    byId["topics-edit"].task.isComplete({
      state: { topics: [{ id: "t2", estimatedHours: 21 }] }
    }),
    true
  );
  assert.equal(
    byId["calendar-day"].task.isComplete({
      state: {
        calendar: [{ date: "2026-11-30", suspended: false }]
      }
    }),
    true
  );
  assert.equal(
    byId["calendar-day"].task.isComplete({
      state: {
        calendar: [{ date: "2026-11-30", suspended: true }]
      }
    }),
    false
  );
});

test("topic editing keeps the save control reachable from the tour card", () => {
  const step = TUTORIAL_STEPS.find((entry) => entry.id === "topics-edit");

  assert.equal(step.placement, "right");
  assert.equal(step.cardWidth, 360);
  assert.deepEqual(step.action, {
    id: "save-topics",
    label: "Save Topic Changes"
  });
  assert.match(step.task.instruction, /Save Topic Changes on this card/);
  assert.match(step.task.hint, /bottom of this card/);
});

test("Quiz Bin import steps expose the sample CSV and completion actions", () => {
  const importStep = TUTORIAL_STEPS.find(
    (step) => step.id === "quiz-bin-import"
  );
  const wizardStep = TUTORIAL_STEPS.find(
    (step) => step.id === "quiz-bin-wizard"
  );

  assert.deepEqual(importStep.action, {
    id: "use-sample-csv",
    label: "Use sample CSV"
  });
  assert.deepEqual(importStep.download, {
    href: "examples/checkpoint-1-responses.csv",
    label: "Download sample CSV"
  });
  assert.equal(importStep.task.autoAdvance, true);
  assert.equal(wizardStep.task.autoAdvance, true);
});
