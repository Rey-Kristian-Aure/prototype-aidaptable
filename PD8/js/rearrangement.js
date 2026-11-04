import { addDays, compareISO } from "./dates.js";
import {
  clearOutOfSemesterAllocations,
  clearTopicAssignmentsFrom,
  cloneState,
  countScheduledMinutes,
  DAY_TYPES,
  ensureCalendarCell,
  getEstimatedMinutes,
  getRemainingMinutes,
  getScheduledDates,
  getTopic,
  isClassWeekday,
  isDateSuspended,
  isInSemester,
  removeCellAllocation,
  STATUS,
  syncTopicStatusFromCalendar,
  validateState
} from "./models.js";
import {
  applyQuizMovePlan,
  getQuizMovePlan
} from "./quiz-coverage.js";
import { allocateQueued } from "./scheduler.js";

function collectAssignments(state) {
  const map = new Map();
  for (const topic of state.topics) {
    map.set(topic.id, { dates: [], minutes: 0 });
  }
  for (const cell of state.calendar) {
    for (const allocation of cell.allocations || []) {
      if (!allocation || allocation.minutes <= 0) {
        continue;
      }
      if (!map.has(allocation.topicId)) {
        map.set(allocation.topicId, { dates: [], minutes: 0 });
      }
      const entry = map.get(allocation.topicId);
      if (!entry.dates.includes(cell.date)) {
        entry.dates.push(cell.date);
      }
      entry.minutes += allocation.minutes;
    }
  }
  for (const entry of map.values()) {
    entry.dates.sort(compareISO);
  }
  return map;
}

function assignmentRange(entry) {
  if (!entry || !entry.dates.length) {
    return { start: "", end: "", count: 0, minutes: 0 };
  }
  return {
    start: entry.dates[0],
    end: entry.dates[entry.dates.length - 1],
    count: entry.dates.length,
    minutes: entry.minutes
  };
}

function sameRange(left, right) {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.count === right.count &&
    left.minutes === right.minutes
  );
}

function clampFromDate(state, fromISO) {
  if (compareISO(fromISO, state.semester.startDate) < 0) {
    return state.semester.startDate;
  }
  if (compareISO(fromISO, state.semester.endDate) > 0) {
    return state.semester.endDate;
  }
  return fromISO;
}

function findFreeClassDay(state, startISO, endISO, usedDates, fromEnd) {
  let candidate = "";
  for (
    let iso = startISO;
    compareISO(iso, endISO) <= 0;
    iso = addDays(iso, 1)
  ) {
    if (
      !isClassWeekday(state, iso) ||
      isDateSuspended(state, iso) ||
      usedDates.has(iso)
    ) {
      continue;
    }
    if (!fromEnd) {
      return iso;
    }
    candidate = iso;
  }
  return candidate;
}

function relocateOutOfRangeQuizzes(state) {
  const startDate = state.semester.startDate;
  const endDate = state.semester.endDate;
  const usedDates = new Set(
    state.quizzes
      .filter((quiz) => isInSemester(state, quiz.date))
      .map((quiz) => quiz.date)
  );
  const moves = [];
  const errors = [];

  const placeQuiz = (quiz, target) => {
    moves.push({
      quizId: quiz.id,
      title: quiz.title,
      from: quiz.date,
      to: target
    });
    quiz.date = target;
    const cell = ensureCalendarCell(state, target);
    cell.type = DAY_TYPES.QUIZ;
    cell.note = quiz.title;
    cell.suspended = false;
    cell.allocations = [];
    usedDates.add(target);
  };

  const afterEnd = state.quizzes
    .filter((quiz) => compareISO(quiz.date, endDate) > 0)
    .sort((left, right) => compareISO(right.date, left.date));
  for (const quiz of afterEnd) {
    const target = findFreeClassDay(
      state,
      startDate,
      endDate,
      usedDates,
      true
    );
    if (!target) {
      errors.push(
        `Quiz "${quiz.title}" cannot be moved inside the semester. Move or cancel it first.`
      );
      continue;
    }
    placeQuiz(quiz, target);
  }

  const beforeStart = state.quizzes
    .filter((quiz) => compareISO(quiz.date, startDate) < 0)
    .sort((left, right) => compareISO(left.date, right.date));
  for (const quiz of beforeStart) {
    const target = findFreeClassDay(
      state,
      startDate,
      endDate,
      usedDates,
      false
    );
    if (!target) {
      errors.push(
        `Quiz "${quiz.title}" cannot be moved inside the semester. Move or cancel it first.`
      );
      continue;
    }
    placeQuiz(quiz, target);
  }

  state.quizzes.sort((left, right) => compareISO(left.date, right.date));
  return { errors, moves };
}

export function reconcileSemesterDates(input, startDate, endDate, options = {}) {
  let state = cloneState(input);
  const hadAllocationsBefore = state.calendar.some(
    (cell) =>
      cell.allocations?.length &&
      compareISO(cell.date, startDate) < 0
  );
  const hadAllocationsAfter = state.calendar.some(
    (cell) =>
      cell.allocations?.length &&
      compareISO(cell.date, endDate) > 0
  );

  state.semester.startDate = startDate;
  state.semester.endDate = endDate;

  const relocation = relocateOutOfRangeQuizzes(state);
  if (relocation.errors.length) {
    return {
      ok: false,
      errors: relocation.errors,
      warnings: [],
      state
    };
  }

  state.calendar = state.calendar.filter((cell) =>
    isInSemester(state, cell.date)
  );

  const impactedDates = relocation.moves.map((move) => move.to);
  if (hadAllocationsBefore) {
    impactedDates.push(startDate);
  }
  if (hadAllocationsAfter) {
    impactedDates.push(endDate);
  }
  impactedDates.sort(compareISO);
  const reflowStart = impactedDates[0] || "";

  let result = null;
  if (reflowStart && hasSchedule(state)) {
    result = rearrange(state, reflowStart, {
      label: options.label || "Adjusted schedule to semester dates"
    });
    if (!result.ok) {
      return result;
    }
    state = result.state;
  } else if (!hasSchedule(state)) {
    for (const topic of state.topics) {
      syncTopicStatusFromCalendar(state, topic.id);
    }
  }

  const relocatedIds = new Set(
    relocation.moves.map((move) => move.quizId)
  );
  const originalQuizDates = new Map(
    relocation.moves.map((move) => [
      move.quizId,
      { title: move.title, from: move.from }
    ])
  );
  const quizMoves = [];
  for (const [quizId, original] of originalQuizDates) {
    const quiz = state.quizzes.find((item) => item.id === quizId);
    if (quiz && quiz.date !== original.from) {
      quizMoves.push({
        quizId,
        title: quiz.title || original.title,
        from: original.from,
        to: quiz.date
      });
    }
  }
  if (result) {
    quizMoves.push(
      ...result.quizMoves.filter((move) => !relocatedIds.has(move.quizId))
    );
    result.summary.quizMoves = quizMoves;
    result.summary.counts.quizMoves = quizMoves.length;
  }

  const validation = validateState(state);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
      state
    };
  }

  return {
    ok: true,
    state,
    summary: result?.summary || null,
    quizMoves,
    warnings: validation.warnings,
    reflowed: Boolean(result)
  };
}

export function rearrange(input, fromISO, options = {}) {
  const state = cloneState(input);
  clearOutOfSemesterAllocations(state);
  const fromDate = clampFromDate(state, fromISO);
  const validationState = cloneState(state);
  clearTopicAssignmentsFrom(validationState, fromDate);
  const validation = validateState(validationState);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
      state
    };
  }

  const oldAssignments = collectAssignments(state);
  const oldStatuses = new Map(
    state.topics.map((topic) => [topic.id, topic.status])
  );
  const completedMinutes = new Map();
  for (const topic of state.topics) {
    completedMinutes.set(
      topic.id,
      countScheduledMinutes(state, topic.id, fromDate)
    );
  }

  const originalStatuses = new Map(
    state.topics.map((topic) => [topic.id, topic.status])
  );
  const originalAsyncReasons = new Map(
    state.topics.map((topic) => [topic.id, topic.asyncReason || ""])
  );

  const rebuildFromDate = () => {
    clearTopicAssignmentsFrom(state, fromDate);
    const queued = new Map();
    const statusMap = new Map();
    for (const topic of state.topics) {
      const originalStatus = originalStatuses.get(topic.id);
      if (originalStatus === STATUS.DROPPED) {
        topic.status = STATUS.DROPPED;
        topic.asyncReason = originalAsyncReasons.get(topic.id) || "";
        statusMap.set(topic.id, STATUS.DROPPED);
        continue;
      }
      if (originalStatus === STATUS.ASYNC) {
        topic.status = STATUS.ASYNC;
        topic.asyncReason = originalAsyncReasons.get(topic.id) || "";
        statusMap.set(topic.id, STATUS.ASYNC);
        continue;
      }
      if (topic.hold) {
        topic.status = STATUS.UNSCHEDULED;
        topic.asyncReason =
          originalAsyncReasons.get(topic.id) || "Removed by teacher";
        statusMap.set(topic.id, STATUS.UNSCHEDULED);
        continue;
      }
      const completed = completedMinutes.get(topic.id) || 0;
      const remaining = Math.max(0, getEstimatedMinutes(topic) - completed);
      if (remaining <= 0) {
        topic.status = STATUS.COMPLETED;
        topic.asyncReason = "";
        statusMap.set(topic.id, STATUS.COMPLETED);
        continue;
      }
      topic.status = STATUS.PENDING;
      topic.asyncReason = "";
      queued.set(topic.id, remaining);
      statusMap.set(topic.id, STATUS.PENDING);
    }
    allocateQueued(state, fromDate, queued, statusMap);
  };

  const quizMoves = [];
  const seen = new Set();
  let needsFinalPass = false;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    rebuildFromDate();
    const moves = getQuizMovePlan(state);
    if (!moves.length) {
      needsFinalPass = false;
      break;
    }
    const signature = `${state.quizzes
      .map((quiz) => `${quiz.id}:${quiz.date}`)
      .join("|")}=>${moves.map((move) => `${move.quizId}:${move.to}`).join("|")}`;
    if (seen.has(signature)) {
      needsFinalPass = false;
      break;
    }
    seen.add(signature);
    applyQuizMovePlan(state, moves);
    quizMoves.push(...moves);
    needsFinalPass = true;
  }

  if (needsFinalPass) {
    rebuildFromDate();
  }

  const finalValidation = validateState(state);
  if (!finalValidation.ok) {
    return {
      ok: false,
      errors: finalValidation.errors,
      warnings: finalValidation.warnings,
      state
    };
  }

  const newAssignments = collectAssignments(state);
  const summary = buildSummary({
    state,
    fromDate,
    oldAssignments,
    newAssignments,
    oldStatuses,
    options
  });
  summary.quizMoves = quizMoves;
  summary.counts.quizMoves = quizMoves.length;

  return {
    ok: true,
    state,
    summary,
    warnings: finalValidation.warnings,
    quizMoves
  };
}

function buildSummary({
  state,
  fromDate,
  oldAssignments,
  newAssignments,
  oldStatuses,
  options
}) {
  const moved = [];
  const async = [];
  const partial = [];
  const unscheduled = [];
  const completed = [];
  const removed = [];

  for (const topic of state.topics) {
    const oldRange = assignmentRange(oldAssignments.get(topic.id));
    const newRange = assignmentRange(newAssignments.get(topic.id));
    const previousStatus = oldStatuses.get(topic.id);

    if (newRange.count && !sameRange(oldRange, newRange)) {
      moved.push({
        id: topic.id,
        title: topic.title,
        priority: topic.priority,
        oldStart: oldRange.start,
        oldEnd: oldRange.end,
        oldCount: oldRange.count,
        oldMinutes: oldRange.minutes,
        newStart: newRange.start,
        newEnd: newRange.end,
        newCount: newRange.count,
        newMinutes: newRange.minutes
      });
    }

    if (topic.status === STATUS.ASYNC && previousStatus !== STATUS.ASYNC) {
      async.push({
        id: topic.id,
        title: topic.title,
        priority: topic.priority,
        reason: topic.asyncReason || "Converted to asynchronous work"
      });
    }

    if (topic.status === STATUS.PARTIAL) {
      partial.push({
        id: topic.id,
        title: topic.title,
        priority: topic.priority,
        remainingMinutes: getRemainingMinutes(state, topic),
        reason: topic.asyncReason || "Partially scheduled"
      });
    }

    if (
      topic.status === STATUS.UNSCHEDULED &&
      (previousStatus !== STATUS.UNSCHEDULED ||
        topic.hold ||
        topic.priority > state.lowPriorityThreshold)
    ) {
      unscheduled.push({
        id: topic.id,
        title: topic.title,
        priority: topic.priority,
        reason:
          topic.asyncReason ||
          (topic.hold ? "Removed by teacher" : "Needs teacher action"),
        hold: Boolean(topic.hold)
      });
    }

    if (
      topic.status === STATUS.COMPLETED &&
      previousStatus !== STATUS.COMPLETED
    ) {
      completed.push({
        id: topic.id,
        title: topic.title
      });
    }
  }

  if (options.removedTopicId) {
    const topic = getTopic(state, options.removedTopicId);
    if (topic) {
      removed.push({
        id: topic.id,
        title: topic.title,
        removedMinutes: Number(options.removedMinutes) || 0,
        removedCount: Number(options.removedCount) || 0
      });
    }
  }

  return {
    fromDate,
    label: options.label || "Schedule rearranged",
    moved,
    async,
    partial,
    unscheduled,
    completed,
    removed,
    counts: {
      moved: moved.length,
      async: async.length,
      partial: partial.length,
      unscheduled: unscheduled.length,
      completed: completed.length,
      removed: removed.length
    }
  };
}

export function convertTopicToAsync(input, topicId) {
  const state = cloneState(input);
  const topic = getTopic(state, topicId);
  if (!topic) {
    return state;
  }
  for (const cell of state.calendar) {
    removeCellAllocation(cell, topicId);
  }
  topic.status = STATUS.ASYNC;
  topic.hold = false;
  topic.asyncReason = "Converted by teacher";
  return state;
}

export function dropTopic(input, topicId) {
  const state = cloneState(input);
  const topic = getTopic(state, topicId);
  if (!topic) {
    return state;
  }
  for (const cell of state.calendar) {
    removeCellAllocation(cell, topicId);
  }
  topic.status = STATUS.DROPPED;
  topic.hold = false;
  topic.asyncReason = "";
  return state;
}

export function restoreTopic(input, topicId) {
  const state = cloneState(input);
  const topic = getTopic(state, topicId);
  if (!topic) {
    return state;
  }
  topic.status = STATUS.PENDING;
  topic.hold = false;
  topic.asyncReason = "";
  return state;
}

export function removeTopicSessionsFrom(input, topicId, fromISO, options = {}) {
  const state = cloneState(input);
  const topic = getTopic(state, topicId);
  if (!topic) {
    return { state, removedCount: 0, removedMinutes: 0 };
  }
  const before = getScheduledDates(state, topicId);
  const removedDates = before.filter(
    (date) => compareISO(date, fromISO) >= 0
  );
  let removedMinutes = 0;
  for (const cell of state.calendar) {
    if (compareISO(cell.date, fromISO) >= 0) {
      removedMinutes += removeCellAllocation(cell, topicId);
    }
  }
  topic.status = STATUS.UNSCHEDULED;
  topic.hold = true;
  topic.asyncReason = options.reason || "Removed by teacher";
  return {
    state,
    removedCount: removedDates.length,
    removedMinutes
  };
}

export function getAssignmentRanges(state) {
  const grouped = collectAssignments(state);
  const ranges = new Map();
  for (const [topicId, entry] of grouped.entries()) {
    ranges.set(topicId, assignmentRange(entry));
  }
  return ranges;
}

export function hasSchedule(state) {
  return state.calendar.some(
    (cell) => cell.allocations && cell.allocations.length > 0
  );
}
