import { compareISO, eachDate, formatMinutes, todayISO, weekdayShort } from "./dates.js";
import {
  addCellAllocation,
  clearOutOfSemesterAllocations,
  clearTopicAssignmentsFrom,
  cloneState,
  DAY_TYPES,
  ensureCalendarCell,
  getCellAllocatedMinutes,
  getEstimatedMinutes,
  getMeetingMinutes,
  getQuizForDate,
  getTopic,
  isClassWeekday,
  isSuspendedCell,
  STATUS,
  statusForFailure,
  topoOrderTopics,
  validateState
} from "./models.js";
import {
  applyQuizMovePlan,
  getQuizMovePlan,
  getTopicQuizDeadlines
} from "./quiz-coverage.js";

export function getAutomaticReflowDate(
  state,
  triggerISO,
  nowISO = todayISO()
) {
  const semesterStart = state.semester.startDate;
  const semesterEnd = state.semester.endDate;
  const trigger = triggerISO || semesterStart;
  let searchStart =
    compareISO(nowISO, semesterStart) < 0 ? semesterStart : nowISO;
  if (compareISO(searchStart, semesterEnd) > 0) {
    searchStart = semesterEnd;
  }

  const effectiveTrigger =
    compareISO(trigger, searchStart) < 0 ? searchStart : trigger;
  const earliestFutureWork = state.calendar
    .filter(
      (cell) =>
        !cell.suspended &&
        cell.allocations?.length &&
        compareISO(cell.date, searchStart) >= 0 &&
        compareISO(cell.date, semesterEnd) <= 0
    )
    .map((cell) => cell.date)
    .sort(compareISO)[0];

  if (!earliestFutureWork) {
    return effectiveTrigger;
  }
  return compareISO(earliestFutureWork, effectiveTrigger) < 0
    ? earliestFutureWork
    : effectiveTrigger;
}

export function computeTeachingDays(state, fromISO = state.semester.startDate) {
  const start =
    compareISO(fromISO, state.semester.startDate) < 0
      ? state.semester.startDate
      : fromISO;
  if (compareISO(start, state.semester.endDate) > 0) {
    return [];
  }
  const suspended = new Set(
    state.calendar.filter(isSuspendedCell).map((cell) => cell.date)
  );
  const quizDates = new Set(state.quizzes.map((quiz) => quiz.date));
  const classDays = new Set(state.semester.classDays);
  const days = [];
  for (const iso of eachDate(start, state.semester.endDate)) {
    if (!classDays.has(weekdayShort(iso))) {
      continue;
    }
    if (quizDates.has(iso) || suspended.has(iso)) {
      continue;
    }
    if (!getMeetingMinutes(state, iso)) {
      continue;
    }
    days.push(iso);
  }
  return days;
}

export function buildCalendar(state) {
  const previous = new Map(state.calendar.map((cell) => [cell.date, cell]));
  const suspended = new Map();
  for (const cell of state.calendar) {
    if (isSuspendedCell(cell)) {
      suspended.set(cell.date, { note: cell.note || "" });
    }
  }

  const calendar = [];
  for (const iso of eachDate(state.semester.startDate, state.semester.endDate)) {
    const previousCell = previous.get(iso);
    const note = previousCell?.note || "";
    const isSuspended = suspended.has(iso);
    const quiz = getQuizForDate(state, iso);
    let type = isClassWeekday(state, iso) ? DAY_TYPES.CLASS : DAY_TYPES.EMPTY;
    if (quiz) {
      type = DAY_TYPES.QUIZ;
    } else if (isSuspended) {
      type = DAY_TYPES.SUSPENDED;
    }
    calendar.push({
      date: iso,
      type,
      allocations: [],
      note: quiz ? quiz.title : note || suspended.get(iso)?.note || "",
      suspended: isSuspended
    });
  }

  return calendar;
}

export const MIN_TOPIC_BLOCK_MINUTES = 60;

function priorityComparator(state, orderIndex, deadlines) {
  return (leftId, rightId) => {
    const left = getTopic(state, leftId);
    const right = getTopic(state, rightId);
    if (!left || !right) {
      return 0;
    }
    const leftDeadline = deadlines.get(leftId) || "";
    const rightDeadline = deadlines.get(rightId) || "";
    if (leftDeadline || rightDeadline) {
      if (!leftDeadline) {
        return 1;
      }
      if (!rightDeadline) {
        return -1;
      }
      const deadlineOrder = compareISO(leftDeadline, rightDeadline);
      if (deadlineOrder !== 0) {
        return deadlineOrder;
      }
    }
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    return (orderIndex.get(leftId) ?? 0) - (orderIndex.get(rightId) ?? 0);
  };
}

function dependenciesSatisfied(topic, statusMap) {
  return topic.dependencies.every((depId) => {
    const status = statusMap.get(depId);
    return status === STATUS.SCHEDULED || status === STATUS.COMPLETED;
  });
}

function topicWeight(state, topicId) {
  return Math.max(1, Number(getTopic(state, topicId)?.priority) || 1);
}

function computeFairShareTargets(state, readyIds, queued, capacity, compareReady) {
  const targets = new Map();
  const sorted = [...readyIds].sort(compareReady);
  const floorTotal = sorted.reduce(
    (sum, topicId) =>
      sum + Math.min(queued.get(topicId) || 0, MIN_TOPIC_BLOCK_MINUTES),
    0
  );

  if (floorTotal > capacity) {
    let remaining = capacity;
    for (const topicId of sorted) {
      if (remaining <= 0) {
        targets.set(topicId, 0);
        continue;
      }
      const floor = Math.min(
        queued.get(topicId) || 0,
        MIN_TOPIC_BLOCK_MINUTES
      );
      const amount = Math.min(floor, remaining);
      targets.set(topicId, amount);
      remaining -= amount;
    }
    return targets;
  }

  for (const topicId of sorted) {
    targets.set(
      topicId,
      Math.min(queued.get(topicId) || 0, MIN_TOPIC_BLOCK_MINUTES)
    );
  }

  let remaining = capacity - floorTotal;
  let active = sorted.filter(
    (topicId) => (targets.get(topicId) || 0) < (queued.get(topicId) || 0)
  );

  while (remaining > 0 && active.length) {
    const totalWeight = active.reduce(
      (sum, topicId) => sum + topicWeight(state, topicId),
      0
    );
    const budget = remaining;
    let assigned = 0;

    for (const topicId of active) {
      const current = targets.get(topicId) || 0;
      const extraNeed = (queued.get(topicId) || 0) - current;
      if (extraNeed <= 0) {
        continue;
      }
      const share = Math.floor(
        (budget * topicWeight(state, topicId)) / totalWeight
      );
      const amount = Math.min(share, extraNeed);
      if (amount > 0) {
        targets.set(topicId, current + amount);
        assigned += amount;
      }
    }

    remaining -= assigned;

    if (remaining > 0) {
      const eligible = active
        .filter(
          (topicId) =>
            (targets.get(topicId) || 0) < (queued.get(topicId) || 0)
        )
        .sort(compareReady);
      for (const topicId of eligible) {
        if (remaining <= 0) {
          break;
        }
        targets.set(topicId, (targets.get(topicId) || 0) + 1);
        remaining -= 1;
      }
    }

    active = active.filter(
      (topicId) => (targets.get(topicId) || 0) < (queued.get(topicId) || 0)
    );
  }

  return targets;
}

function allocateFairly(state, fromISO, queued, statusMap) {
  const days = computeTeachingDays(state, fromISO);
  const cellByDate = new Map();
  const slots = days.map((date) => {
    const cell = ensureCalendarCell(state, date);
    cellByDate.set(date, cell);
    const capacity = getMeetingMinutes(state, date);
    return {
      date,
      capacity,
      used: Math.max(0, getCellAllocatedMinutes(cell))
    };
  });

  const capacityFrom = (startIndex) => {
    let total = 0;
    for (let index = startIndex; index < slots.length; index += 1) {
      total += Math.max(0, slots[index].capacity - slots[index].used);
    }
    return total;
  };

  let cursorIndex = 0;

  const allocateTopic = (topicId, target) => {
    let left = Math.max(0, Math.round(target));
    let allocated = 0;
    let slotIndex = cursorIndex;
    let lastUsedIndex = cursorIndex;

    while (left > 0 && slotIndex < slots.length) {
      const slot = slots[slotIndex];
      const capacity = Math.max(0, slot.capacity - slot.used);
      if (capacity <= 0) {
        slotIndex += 1;
        continue;
      }

      const finishesTopic = left <= capacity;
      if (
        !finishesTopic &&
        capacity < MIN_TOPIC_BLOCK_MINUTES &&
        capacityFrom(slotIndex + 1) >= left
      ) {
        slotIndex += 1;
        continue;
      }

      const take = Math.min(capacity, left);
      addCellAllocation(cellByDate.get(slot.date), topicId, take);
      slot.used += take;
      left -= take;
      allocated += take;
      lastUsedIndex = slotIndex;

      if (take >= capacity) {
        slotIndex += 1;
      }
    }

    if (allocated > 0) {
      cursorIndex = lastUsedIndex;
    }
    return allocated;
  };

  const { order } = topoOrderTopics(state.topics);
  const orderIndex = new Map(order.map((topicId, index) => [topicId, index]));
  const deadlines = getTopicQuizDeadlines(state);
  const compareReady = priorityComparator(state, orderIndex, deadlines);

  const failTopic = (topicId, reason, status) => {
    const topic = getTopic(state, topicId);
    if (!topic) {
      queued.delete(topicId);
      return;
    }
    topic.status = status;
    topic.asyncReason = reason;
    statusMap.set(topicId, status);
    queued.delete(topicId);
  };

  const finishTopic = (topicId, need, allocated) => {
    const topic = getTopic(state, topicId);
    if (!topic) {
      queued.delete(topicId);
      return;
    }
    if (allocated >= need) {
      topic.status = STATUS.SCHEDULED;
      topic.asyncReason = "";
      statusMap.set(topicId, STATUS.SCHEDULED);
    } else if (allocated > 0) {
      topic.status = STATUS.PARTIAL;
      topic.asyncReason = `${formatMinutes(
        need - allocated
      )} still unplaced after priority-weighted sharing`;
      statusMap.set(topicId, STATUS.PARTIAL);
    } else {
      failTopic(
        topicId,
        "Not enough remaining class time after priority-weighted sharing",
        statusForFailure(topic, state.lowPriorityThreshold)
      );
      return;
    }
    queued.delete(topicId);
  };

  while (queued.size) {
    const readyIds = [...queued.keys()]
      .filter((topicId) => {
        const topic = getTopic(state, topicId);
        return topic && dependenciesSatisfied(topic, statusMap);
      })
      .sort(compareReady);

    if (!readyIds.length) {
      break;
    }

    const available = capacityFrom(cursorIndex);
    const targets = computeFairShareTargets(
      state,
      readyIds,
      queued,
      available,
      compareReady
    );
    const topicId = readyIds[0];
    const need = queued.get(topicId) || 0;
    const target = targets.get(topicId) || 0;
    const allocated = target > 0 ? allocateTopic(topicId, target) : 0;
    finishTopic(topicId, need, allocated);
  }

  if (queued.size) {
    for (const topicId of order) {
      if (!queued.has(topicId)) {
        continue;
      }
      const topic = getTopic(state, topicId);
      if (!topic) {
        queued.delete(topicId);
        continue;
      }
      const blockedBy = topic.dependencies.find((depId) => {
        const status = statusMap.get(depId);
        return status !== STATUS.SCHEDULED && status !== STATUS.COMPLETED;
      });
      if (blockedBy) {
        failTopic(
          topicId,
          `Blocked by ${getTopic(state, blockedBy)?.title || "a prerequisite"}`,
          statusForFailure(topic, state.lowPriorityThreshold)
        );
      } else {
        failTopic(
          topicId,
          "Not enough remaining class time after priority-weighted sharing",
          statusForFailure(topic, state.lowPriorityThreshold)
        );
      }
    }
  }
}

export function allocateQueued(state, fromISO, queued, statusMap) {
  allocateFairly(state, fromISO, queued, statusMap);
  return state;
}

function buildGeneratedSchedule(state) {
  state.calendar = buildCalendar(state);
  state.history = [];

  const statusMap = new Map();
  for (const topic of state.topics) {
    if (topic.status === STATUS.DROPPED) {
      statusMap.set(topic.id, STATUS.DROPPED);
      continue;
    }
    topic.status = STATUS.PENDING;
    topic.hold = false;
    topic.asyncReason = "";
    statusMap.set(topic.id, STATUS.PENDING);
  }

  const queued = new Map();
  for (const topic of state.topics) {
    if (topic.status === STATUS.DROPPED) {
      continue;
    }
    const remaining = getEstimatedMinutes(topic);
    if (remaining > 0) {
      queued.set(topic.id, remaining);
    }
  }

  allocateQueued(state, state.semester.startDate, queued, statusMap);
}

export function generateSchedule(input) {
  const state = cloneState(input);
  clearOutOfSemesterAllocations(state);
  const validationState = cloneState(state);
  clearTopicAssignmentsFrom(validationState, validationState.semester.startDate);
  const validation = validateState(validationState);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
      state
    };
  }
  if (!state.topics.length) {
    return {
      ok: false,
      errors: ["Add at least one topic before generating a schedule."],
      warnings: validation.warnings,
      state
    };
  }

  const quizMoves = [];
  const seen = new Set();
  let needsFinalPass = false;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    buildGeneratedSchedule(state);
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
    buildGeneratedSchedule(state);
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

  return {
    ok: true,
    state,
    teachingDays: computeTeachingDays(state),
    warnings: finalValidation.warnings,
    quizMoves
  };
}

export function summarizeGeneration(state) {
  const asyncTopics = state.topics.filter(
    (topic) => topic.status === STATUS.ASYNC
  );
  const unscheduled = state.topics.filter(
    (topic) => topic.status === STATUS.UNSCHEDULED
  );
  return {
    scheduled: state.topics.filter(
      (topic) => topic.status === STATUS.SCHEDULED
    ).length,
    partial: state.topics.filter(
      (topic) => topic.status === STATUS.PARTIAL
    ).length,
    async: asyncTopics.length,
    unscheduled: unscheduled.length
  };
}
