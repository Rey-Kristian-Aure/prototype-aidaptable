import { addDays, compareISO } from "./dates.js";
import {
  countScheduledMinutes,
  DAY_TYPES,
  ensureCalendarCell,
  getCalendarCell,
  getEstimatedMinutes,
  getQuizForDate,
  getScheduledDates,
  getTopic,
  isClassWeekday,
  isDateSuspended,
  isInSemester,
  nextClassDayOnOrAfter
} from "./models.js";

export function hasAnySchedule(state) {
  return state.calendar.some(
    (cell) => cell.allocations && cell.allocations.length > 0
  );
}

function emptyCoverage(quiz) {
  return {
    quizId: quiz?.id || "",
    title: quiz?.title || "",
    date: quiz?.date || "",
    covered: [],
    warnings: [],
    pending: false,
    canMove: false,
    suggestedDate: ""
  };
}

export function getQuizCoverage(state, quiz) {
  const coverage = emptyCoverage(quiz);
  if (!quiz || !quiz.coveredTopicIds?.length) {
    return coverage;
  }
  if (!hasAnySchedule(state)) {
    return { ...coverage, pending: true };
  }

  for (const topicId of quiz.coveredTopicIds) {
    const topic = getTopic(state, topicId);
    if (!topic) {
      coverage.warnings.push({
        topicId,
        title: "Deleted topic",
        status: "missing",
        estimatedMinutes: 0,
        scheduledBeforeMinutes: 0,
        remainingMinutes: 0,
        lastScheduledDate: "",
        fullyScheduled: false
      });
      continue;
    }

    const estimatedMinutes = getEstimatedMinutes(topic);
    const scheduledBeforeMinutes = countScheduledMinutes(
      state,
      topic.id,
      quiz.date
    );
    if (scheduledBeforeMinutes >= estimatedMinutes) {
      coverage.covered.push(topic.id);
      continue;
    }

    const dates = getScheduledDates(state, topic.id);
    const totalScheduledMinutes = countScheduledMinutes(state, topic.id);
    coverage.warnings.push({
      topicId: topic.id,
      title: topic.title,
      status: topic.status,
      estimatedMinutes,
      scheduledBeforeMinutes,
      remainingMinutes: Math.max(0, estimatedMinutes - scheduledBeforeMinutes),
      lastScheduledDate: dates.at(-1) || "",
      fullyScheduled: totalScheduledMinutes >= estimatedMinutes
    });
  }

  const movable = coverage.warnings.filter(
    (item) => item.fullyScheduled && item.lastScheduledDate
  );
  const canMove = coverage.warnings.length > 0 && movable.length === coverage.warnings.length;
  if (canMove) {
    const lastDate = movable
      .map((item) => item.lastScheduledDate)
      .sort(compareISO)
      .at(-1);
    const candidate = nextClassDayOnOrAfter(state, addDays(lastDate, 1));
    if (
      candidate &&
      compareISO(candidate, state.semester.endDate) <= 0
    ) {
      coverage.suggestedDate = candidate;
    }
  }
  coverage.canMove = Boolean(coverage.suggestedDate);
  return coverage;
}

export function getQuizCoverageWarnings(state, quizIds = null) {
  if (!hasAnySchedule(state)) {
    return [];
  }
  const allowed = quizIds ? new Set(quizIds) : null;
  return state.quizzes
    .filter((quiz) => !allowed || allowed.has(quiz.id))
    .map((quiz) => getQuizCoverage(state, quiz))
    .filter((coverage) => coverage.warnings.length > 0);
}


export function getTopicQuizDeadlines(state) {
  const deadlines = new Map();
  const byId = new Map(state.topics.map((topic) => [topic.id, topic]));

  for (const quiz of state.quizzes) {
    for (const topicId of quiz.coveredTopicIds || []) {
      if (!byId.has(topicId)) {
        continue;
      }
      const current = deadlines.get(topicId);
      if (!current || compareISO(quiz.date, current) < 0) {
        deadlines.set(topicId, quiz.date);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const topic of state.topics) {
      const deadline = deadlines.get(topic.id);
      if (!deadline) {
        continue;
      }
      for (const dependencyId of topic.dependencies) {
        if (!byId.has(dependencyId)) {
          continue;
        }
        const current = deadlines.get(dependencyId);
        if (!current || compareISO(deadline, current) < 0) {
          deadlines.set(dependencyId, deadline);
          changed = true;
        }
      }
    }
  }

  return deadlines;
}

function nextAvailableQuizDate(state, proposed, usedDates) {
  let candidate = proposed;
  while (candidate && compareISO(candidate, state.semester.endDate) <= 0) {
    if (!usedDates.has(candidate) && !isDateSuspended(state, candidate)) {
      return candidate;
    }
    candidate = nextClassDayOnOrAfter(state, addDays(candidate, 1));
  }
  return "";
}

export function getQuizMovePlan(state, quizIds = null) {
  const allowed = quizIds ? new Set(quizIds) : null;
  const usedDates = new Set(state.quizzes.map((quiz) => quiz.date));
  const moves = [];

  for (const quiz of state.quizzes) {
    if (allowed && !allowed.has(quiz.id)) {
      continue;
    }
    const coverage = getQuizCoverage(state, quiz);
    if (!coverage.canMove || !coverage.suggestedDate) {
      continue;
    }
    usedDates.delete(quiz.date);
    const target = nextAvailableQuizDate(
      state,
      coverage.suggestedDate,
      usedDates
    );
    if (!target) {
      usedDates.add(quiz.date);
      continue;
    }
    usedDates.add(target);
    moves.push({
      quizId: quiz.id,
      title: quiz.title,
      from: quiz.date,
      to: target
    });
  }

  return moves;
}

export function applyQuizMovePlan(state, moves) {
  if (!moves.length) {
    return state;
  }

  const byId = new Map(state.quizzes.map((quiz) => [quiz.id, quiz]));
  const targets = new Set();
  const validMoves = moves.filter((move) => {
    const quiz = byId.get(move.quizId);
    if (!quiz) {
      return false;
    }
    if (
      !isInSemester(state, move.to) ||
      !isClassWeekday(state, move.to) ||
      isDateSuspended(state, move.to) ||
      targets.has(move.to)
    ) {
      return false;
    }
    const existing = getQuizForDate(state, move.to);
    if (existing && existing.id !== quiz.id) {
      return false;
    }
    targets.add(move.to);
    return true;
  });

  if (!validMoves.length) {
    return state;
  }

  for (const move of validMoves) {
    const oldCell = getCalendarCell(state, move.from);
    if (oldCell) {
      if (oldCell.suspended) {
        oldCell.type = DAY_TYPES.SUSPENDED;
        oldCell.note = "";
      } else {
        oldCell.type = isClassWeekday(state, move.from)
          ? DAY_TYPES.CLASS
          : DAY_TYPES.EMPTY;
        oldCell.note = "";
      }
      oldCell.allocations = [];
    }
  }

  for (const move of validMoves) {
    const quiz = byId.get(move.quizId);
    quiz.date = move.to;
    const target = ensureCalendarCell(state, move.to);
    target.type = DAY_TYPES.QUIZ;
    target.note = quiz.title;
    target.suspended = false;
    target.allocations = [];
  }

  state.quizzes.sort((left, right) => compareISO(left.date, right.date));
  return state;
}
