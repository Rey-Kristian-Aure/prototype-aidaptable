import {
  addDays,
  compareISO,
  formatRange,
  formatTimeRange,
  hoursToMinutes,
  isValidISO,
  isValidTime,
  isWithin,
  minutesToTime,
  timeToMinutes,
  todayISO,
  WEEKDAY_ORDER,
  weekdayShort
} from "./dates.js";

export const STATE_VERSION = 2;

export const STATUS = Object.freeze({
  PENDING: "pending",
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
  ASYNC: "async",
  PARTIAL: "partial",
  UNSCHEDULED: "unscheduled",
  DROPPED: "dropped"
});

export const DAY_TYPES = Object.freeze({
  CLASS: "class",
  QUIZ: "quiz",
  SUSPENDED: "suspended",
  EMPTY: "empty"
});

export const DEFAULT_CLASS_DAYS = ["Mon", "Wed", "Fri"];
export const DEFAULT_MEETING_START = "09:00";
export const DEFAULT_MEETING_END = "12:00";
export const DEFAULT_MEETING_MINUTES = 180;
export const DEFAULT_TOPIC_HOURS = 3;
export const MIN_MEETING_MINUTES = 15;
export const MAX_MEETING_MINUTES = 12 * 60;
export const MAX_TOPIC_HOURS = 1000;

const VALID_STATUSES = new Set(Object.values(STATUS));
const VALID_DAY_TYPES = new Set(Object.values(DAY_TYPES));
const VALID_DAY_NAMES = new Set(WEEKDAY_ORDER);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function cloneState(state) {
  return clone(state);
}

export function defaultClassTime() {
  return { start: DEFAULT_MEETING_START, end: DEFAULT_MEETING_END };
}

export function createEmptyState() {
  const startDate = todayISO();
  const endDate = addDays(startDate, 112);
  const classDays = [...DEFAULT_CLASS_DAYS];
  const classTimes = Object.fromEntries(
    classDays.map((day) => [day, defaultClassTime()])
  );
  return normalizeState({
    version: STATE_VERSION,
    semester: { startDate, endDate, classDays, classTimes },
    topics: [],
    quizzes: [],
    calendar: [],
    lowPriorityThreshold: 2,
    history: []
  });
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeEstimatedHours(source) {
  const hours = normalizeNumber(source.estimatedHours, null);
  if (hours !== null && hours > 0) {
    return Math.min(MAX_TOPIC_HOURS, Math.round(hours * 100) / 100);
  }
  const legacyDuration = normalizeInteger(source.duration, null);
  if (legacyDuration !== null && legacyDuration > 0) {
    return Math.min(MAX_TOPIC_HOURS, legacyDuration * (DEFAULT_MEETING_MINUTES / 60));
  }
  return DEFAULT_TOPIC_HOURS;
}

function normalizeTopic(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const status = VALID_STATUSES.has(source.status) ? source.status : STATUS.PENDING;
  const id = normalizeString(source.id, `t${index + 1}`) || `t${index + 1}`;
  const dependencies = Array.isArray(source.dependencies)
    ? [
        ...new Set(
          source.dependencies.filter(
            (item) => typeof item === "string" && item && item !== id
          )
        )
      ]
    : [];
  return {
    id,
    title: normalizeString(source.title, `Topic ${index + 1}`),
    estimatedHours: normalizeEstimatedHours(source),
    priority: Math.min(5, Math.max(1, normalizeInteger(source.priority, 3))),
    status,
    dependencies,
    hold: Boolean(source.hold),
    asyncReason: normalizeString(source.asyncReason, "")
  };
}

function normalizeQuiz(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const coveredTopicIds = Array.isArray(source.coveredTopicIds)
    ? [
        ...new Set(
          source.coveredTopicIds.filter(
            (topicId) => typeof topicId === "string" && topicId
          )
        )
      ]
    : [];
  return {
    id: normalizeString(source.id, `q${index + 1}`) || `q${index + 1}`,
    date: isValidISO(source.date) ? source.date : "",
    title: normalizeString(source.title, `Quiz ${index + 1}`),
    coveredTopicIds
  };
}

function normalizeClassTimes(raw, classDays) {
  const source = raw && typeof raw === "object" ? raw : {};
  const times = {};
  for (const day of classDays) {
    const candidate = source[day];
    const start = candidate && isValidTime(candidate.start)
      ? candidate.start
      : DEFAULT_MEETING_START;
    const end = candidate && isValidTime(candidate.end)
      ? candidate.end
      : DEFAULT_MEETING_END;
    times[day] = timeToMinutes(end) > timeToMinutes(start)
      ? { start, end }
      : defaultClassTime();
  }
  return times;
}

function splitLegacyMinutes(topicIds, totalMinutes) {
  const unique = [...new Set(topicIds.filter((item) => typeof item === "string" && item))];
  if (!unique.length) {
    return [];
  }
  const base = Math.floor(totalMinutes / unique.length);
  let remainder = totalMinutes - base * unique.length;
  return unique.map((topicId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { topicId, minutes: Math.max(1, base + extra) };
  });
}

function normalizeAllocations(source) {
  const merged = new Map();
  if (Array.isArray(source.allocations)) {
    for (const raw of source.allocations) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const topicId = typeof raw.topicId === "string" ? raw.topicId : "";
      const minutes = Math.round(Number(raw.minutes));
      if (!topicId || !Number.isFinite(minutes) || minutes <= 0) {
        continue;
      }
      merged.set(topicId, (merged.get(topicId) || 0) + minutes);
    }
  } else if (Array.isArray(source.topicIds)) {
    for (const allocation of splitLegacyMinutes(source.topicIds, DEFAULT_MEETING_MINUTES)) {
      merged.set(allocation.topicId, allocation.minutes);
    }
  }
  return [...merged.entries()].map(([topicId, minutes]) => ({ topicId, minutes }));
}

function normalizeCell(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const type = VALID_DAY_TYPES.has(source.type) ? source.type : DAY_TYPES.EMPTY;
  return {
    date: isValidISO(source.date) ? source.date : "",
    type,
    allocations: normalizeAllocations(source),
    note: normalizeString(source.note, ""),
    suspended: Boolean(source.suspended) || type === DAY_TYPES.SUSPENDED
  };
}

function normalizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) {
    return [];
  }
  return rawHistory
    .filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        entry.state &&
        typeof entry.state === "object"
    )
    .slice(-20)
    .map((entry) => ({
      at: normalizeString(entry.at, ""),
      label: normalizeString(entry.label, "Change"),
      state: clone(entry.state)
    }));
}

export function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sourceVersion = normalizeInteger(source.version, 1);
  const semesterSource =
    source.semester && typeof source.semester === "object" ? source.semester : {};
  const fallbackStart = todayISO();
  const startDate = isValidISO(semesterSource.startDate)
    ? semesterSource.startDate
    : fallbackStart;
  const endDate =
    isValidISO(semesterSource.endDate) &&
    compareISO(semesterSource.endDate, startDate) >= 0
      ? semesterSource.endDate
      : addDays(startDate, 112);
  const requestedDays = Array.isArray(semesterSource.classDays)
    ? [...new Set(semesterSource.classDays.filter((day) => VALID_DAY_NAMES.has(day)))]
    : [...DEFAULT_CLASS_DAYS];
  const classDays = requestedDays.length ? requestedDays : [...DEFAULT_CLASS_DAYS];
  const classTimes = normalizeClassTimes(semesterSource.classTimes, classDays);

  const topics = Array.isArray(source.topics) ? source.topics.map(normalizeTopic) : [];
  const quizzes = Array.isArray(source.quizzes)
    ? source.quizzes
        .map(normalizeQuiz)
        .filter((quiz) => quiz.date)
        .sort((left, right) => compareISO(left.date, right.date))
    : [];
  const calendar = Array.isArray(source.calendar)
    ? source.calendar
        .map(normalizeCell)
        .filter((cell) => cell.date)
        .sort((left, right) => compareISO(left.date, right.date))
    : [];

  return {
    version: STATE_VERSION,
    semester: {
      startDate,
      endDate,
      classDays,
      classTimes
    },
    topics,
    quizzes,
    calendar,
    lowPriorityThreshold: Math.min(
      5,
      Math.max(1, normalizeInteger(source.lowPriorityThreshold, 2))
    ),
    history: sourceVersion >= STATE_VERSION ? normalizeHistory(source.history) : []
  };
}

export function snapshotForHistory(state) {
  const snapshot = clone(state);
  snapshot.history = [];
  return snapshot;
}

export function makeHistoryEntry(state, label) {
  return {
    at: new Date().toISOString(),
    label: normalizeString(label, "Change"),
    state: snapshotForHistory(state)
  };
}

export function getTopic(state, topicId) {
  return state.topics.find((topic) => topic.id === topicId) || null;
}

export function getTopicTitle(state, topicId) {
  const topic = getTopic(state, topicId);
  return topic ? topic.title : "Unknown topic";
}

export function getQuizForDate(state, iso) {
  return state.quizzes.find((quiz) => quiz.date === iso) || null;
}

export function getCalendarCell(state, iso) {
  return state.calendar.find((cell) => cell.date === iso) || null;
}

export function getMeetingConfig(state, iso) {
  const day = weekdayShort(iso);
  if (!state.semester.classDays.includes(day)) {
    return null;
  }
  const time = state.semester.classTimes[day];
  if (!time || !isValidTime(time.start) || !isValidTime(time.end)) {
    return null;
  }
  const startMinutes = timeToMinutes(time.start);
  const endMinutes = timeToMinutes(time.end);
  if (endMinutes <= startMinutes) {
    return null;
  }
  return {
    day,
    start: time.start,
    end: time.end,
    startMinutes,
    endMinutes,
    minutes: endMinutes - startMinutes
  };
}

export function getMeetingMinutes(state, iso) {
  return getMeetingConfig(state, iso)?.minutes || 0;
}

export function getMeetingTimeRange(state, iso) {
  const meeting = getMeetingConfig(state, iso);
  return meeting ? formatTimeRange(meeting.start, meeting.end) : "";
}

export function ensureCalendarCell(state, iso) {
  let cell = getCalendarCell(state, iso);
  if (cell) {
    return cell;
  }
  const type = isClassWeekday(state, iso) ? DAY_TYPES.CLASS : DAY_TYPES.EMPTY;
  cell = { date: iso, type, allocations: [], note: "", suspended: false };
  state.calendar.push(cell);
  state.calendar.sort((left, right) => compareISO(left.date, right.date));
  return cell;
}

export function isClassWeekday(state, iso) {
  return state.semester.classDays.includes(weekdayShort(iso));
}

export function isInSemester(state, iso) {
  return isWithin(iso, state.semester.startDate, state.semester.endDate);
}

export function isSuspendedCell(cell) {
  return Boolean(cell) && (cell.suspended || cell.type === DAY_TYPES.SUSPENDED);
}

export function isDateSuspended(state, iso) {
  const cell = getCalendarCell(state, iso);
  return isSuspendedCell(cell);
}

export function getSuspendedDates(state) {
  return state.calendar.filter(isSuspendedCell).map((cell) => cell.date);
}

export function getQuizDates(state) {
  return state.quizzes.map((quiz) => quiz.date);
}

export function getCellType(state, iso) {
  const cell = getCalendarCell(state, iso);
  if (cell) {
    return cell.type;
  }
  return isClassWeekday(state, iso) ? DAY_TYPES.CLASS : DAY_TYPES.EMPTY;
}

export function getCellTopicIds(cell) {
  return cell ? cell.allocations.map((allocation) => allocation.topicId) : [];
}

export function getCellAllocation(cell, topicId) {
  return cell?.allocations.find((allocation) => allocation.topicId === topicId) || null;
}

export function getCellAllocatedMinutes(cell, topicId = null) {
  if (!cell) {
    return 0;
  }
  if (topicId === null) {
    return cell.allocations.reduce((sum, allocation) => sum + allocation.minutes, 0);
  }
  return getCellAllocation(cell, topicId)?.minutes || 0;
}

export function addCellAllocation(cell, topicId, minutes) {
  const amount = Math.max(0, Math.round(Number(minutes) || 0));
  if (!cell || !topicId || amount <= 0) {
    return;
  }
  const existing = getCellAllocation(cell, topicId);
  if (existing) {
    existing.minutes += amount;
  } else {
    cell.allocations.push({ topicId, minutes: amount });
  }
}

export function removeCellAllocation(cell, topicId) {
  if (!cell) {
    return 0;
  }
  const existing = getCellAllocation(cell, topicId);
  cell.allocations = cell.allocations.filter(
    (allocation) => allocation.topicId !== topicId
  );
  return existing?.minutes || 0;
}

export function getCellAllocationDetails(state, cell) {
  if (!cell) {
    return [];
  }
  const meeting = getMeetingConfig(state, cell.date);
  let cursor = meeting?.startMinutes ?? 0;
  return cell.allocations.map((allocation) => {
    const startMinutes = cursor;
    const endMinutes = startMinutes + allocation.minutes;
    cursor = endMinutes;
    return {
      ...allocation,
      startMinutes,
      endMinutes,
      startTime: meeting ? minutesToTime(startMinutes) : "",
      endTime: meeting ? minutesToTime(endMinutes) : "",
      timeRange: meeting
        ? formatTimeRange(minutesToTime(startMinutes), minutesToTime(endMinutes))
        : ""
    };
  });
}

export function getScheduledDates(state, topicId, beforeISO = null) {
  const dates = [];
  for (const cell of state.calendar) {
    if (beforeISO && compareISO(cell.date, beforeISO) >= 0) {
      continue;
    }
    if (getCellAllocation(cell, topicId)) {
      dates.push(cell.date);
    }
  }
  return dates.sort(compareISO);
}

export function getScheduledDatesFrom(state, topicId, fromISO) {
  return getScheduledDates(state, topicId).filter(
    (date) => compareISO(date, fromISO) >= 0
  );
}

export function countScheduledMinutes(state, topicId, beforeISO = null) {
  let total = 0;
  for (const cell of state.calendar) {
    if (beforeISO && compareISO(cell.date, beforeISO) >= 0) {
      continue;
    }
    total += getCellAllocatedMinutes(cell, topicId);
  }
  return total;
}

export function getEstimatedMinutes(topic) {
  return hoursToMinutes(topic.estimatedHours);
}

export function getRemainingMinutes(state, topic) {
  return Math.max(0, getEstimatedMinutes(topic) - countScheduledMinutes(state, topic.id));
}

export function getRemainingHours(state, topic) {
  return getRemainingMinutes(state, topic) / 60;
}

export function getTopicDateRange(state, topicId) {
  const dates = getScheduledDates(state, topicId);
  if (!dates.length) {
    return { start: "", end: "", count: 0, minutes: 0, text: "—" };
  }
  const minutes = countScheduledMinutes(state, topicId);
  return {
    start: dates[0],
    end: dates[dates.length - 1],
    count: dates.length,
    minutes,
    text: formatRange(dates[0], dates[dates.length - 1])
  };
}

export function removeTopicFromCalendar(state, topicId, fromISO = null) {
  for (const cell of state.calendar) {
    if (fromISO && compareISO(cell.date, fromISO) < 0) {
      continue;
    }
    removeCellAllocation(cell, topicId);
  }
}

export function removeTopicEverywhere(state, topicId) {
  removeTopicFromCalendar(state, topicId);
}

export function clearTopicAssignmentsFrom(state, fromISO) {
  for (const cell of state.calendar) {
    if (compareISO(cell.date, fromISO) >= 0) {
      cell.allocations = [];
    }
  }
}

export function clearOutOfSemesterAllocations(state) {
  for (const cell of state.calendar) {
    if (!isInSemester(state, cell.date)) {
      cell.allocations = [];
    }
  }
}

export function syncTopicStatusFromCalendar(state, topicId) {
  const topic = getTopic(state, topicId);
  if (!topic || topic.status === STATUS.ASYNC || topic.status === STATUS.DROPPED) {
    return;
  }
  if (topic.hold) {
    topic.status = STATUS.UNSCHEDULED;
    return;
  }
  const allocated = countScheduledMinutes(state, topicId);
  const estimated = getEstimatedMinutes(topic);
  if (allocated >= estimated) {
    topic.status = STATUS.SCHEDULED;
    topic.asyncReason = "";
  } else if (allocated > 0) {
    topic.status = STATUS.PARTIAL;
    topic.asyncReason = "Partially scheduled";
  } else {
    topic.status = STATUS.PENDING;
    topic.asyncReason = "";
  }
}

export function statusForFailure(topic, threshold) {
  return topic.priority <= threshold ? STATUS.ASYNC : STATUS.UNSCHEDULED;
}

export function topoOrderTopics(topics) {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const indexById = new Map(topics.map((topic, index) => [topic.id, index]));
  const indegree = new Map();
  const children = new Map();

  for (const topic of topics) {
    indegree.set(topic.id, 0);
    children.set(topic.id, []);
  }

  for (const topic of topics) {
    const dependencies = topic.dependencies.filter(
      (depId) => byId.has(depId) && depId !== topic.id
    );
    indegree.set(topic.id, dependencies.length);
    for (const depId of dependencies) {
      children.get(depId).push(topic.id);
    }
  }

  const compareAvailable = (leftId, rightId) => {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    const leftIndex = indexById.get(leftId) ?? 0;
    const rightIndex = indexById.get(rightId) ?? 0;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return leftId.localeCompare(rightId);
  };

  const available = topics
    .filter((topic) => indegree.get(topic.id) === 0)
    .map((topic) => topic.id)
    .sort(compareAvailable);
  const order = [];

  while (available.length) {
    const current = available.shift();
    order.push(current);
    for (const childId of children.get(current) || []) {
      indegree.set(childId, indegree.get(childId) - 1);
      if (indegree.get(childId) === 0) {
        available.push(childId);
        available.sort(compareAvailable);
      }
    }
  }

  const cycle = topics.map((topic) => topic.id).filter((id) => !order.includes(id));
  return { order, cycle };
}

export function hasDependencyCycle(topics) {
  return topoOrderTopics(topics).cycle.length > 0;
}

function validateTopicFields(entry) {
  const errors = [];
  if (!entry.title || !entry.title.trim()) {
    errors.push("Topic title is required.");
  }
  if (
    !Number.isFinite(entry.estimatedHours) ||
    entry.estimatedHours <= 0 ||
    entry.estimatedHours > MAX_TOPIC_HOURS
  ) {
    errors.push(`Estimated hours must be between 0 and ${MAX_TOPIC_HOURS}.`);
  }
  if (
    !Number.isInteger(entry.priority) ||
    entry.priority < 1 ||
    entry.priority > 5
  ) {
    errors.push("Priority must be between 1 and 5.");
  }
  return errors;
}

export function validateTopicBatch(entries) {
  const errors = [];
  const rowErrors = new Map();
  const addRowError = (key, message) => {
    errors.push(message);
    if (key) {
      rowErrors.set(key, message);
    }
  };

  if (!Array.isArray(entries) || !entries.length) {
    return { ok: true, errors, rowErrors };
  }

  const ids = new Set();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) {
      addRowError(entry.key, `Duplicate or missing topic id "${entry.id}".`);
    }
    ids.add(entry.id);
  }

  for (const entry of entries) {
    for (const message of validateTopicFields(entry)) {
      addRowError(entry.key, `${entry.title || "Topic"}: ${message}`);
    }
    if (entry.dependencies.includes(entry.id)) {
      addRowError(entry.key, `${entry.title || "Topic"} cannot depend on itself.`);
    }
    for (const depId of entry.dependencies) {
      if (!ids.has(depId)) {
        addRowError(
          entry.key,
          `${entry.title || "Topic"} depends on a topic that is being removed.`
        );
        break;
      }
    }
  }

  if (hasDependencyCycle(entries)) {
    errors.push("Topic dependencies contain a cycle.");
    for (const entry of entries) {
      if (!rowErrors.has(entry.key)) {
        rowErrors.set(entry.key, "Topic dependencies contain a cycle.");
      }
    }
  }

  return { ok: errors.length === 0, errors, rowErrors };
}

export function validateTopicInput(state, candidate, editingId = null) {
  const errors = validateTopicFields(candidate);
  if (candidate.dependencies.includes(editingId)) {
    errors.push("A topic cannot depend on itself.");
  }
  const existingIds = new Set(state.topics.map((topic) => topic.id));
  for (const depId of candidate.dependencies) {
    if (!existingIds.has(depId) && depId !== editingId) {
      errors.push("One or more dependencies no longer exist.");
      break;
    }
  }
  const prospective = state.topics
    .filter((topic) => topic.id !== editingId)
    .concat({
      ...candidate,
      id: editingId || "__new_topic__",
      status: STATUS.PENDING,
      hold: false,
      asyncReason: ""
    });
  if (hasDependencyCycle(prospective)) {
    errors.push("The dependency chain contains a cycle.");
  }
  return errors;
}

export function validateState(state) {
  const errors = [];
  const warnings = [];

  if (!isValidISO(state.semester.startDate)) {
    errors.push("Semester start date is invalid.");
  }
  if (!isValidISO(state.semester.endDate)) {
    errors.push("Semester end date is invalid.");
  }
  if (
    isValidISO(state.semester.startDate) &&
    isValidISO(state.semester.endDate) &&
    compareISO(state.semester.startDate, state.semester.endDate) > 0
  ) {
    errors.push("Semester start date must be on or before the end date.");
  }
  if (!state.semester.classDays.length) {
    errors.push("Choose at least one class day.");
  } else {
    for (const day of state.semester.classDays) {
      const time = state.semester.classTimes?.[day];
      if (!time || !isValidTime(time.start) || !isValidTime(time.end)) {
        errors.push(`Class time for ${day} is invalid.`);
        continue;
      }
      const duration = timeToMinutes(time.end) - timeToMinutes(time.start);
      if (duration <= 0) {
        errors.push(`Class end time on ${day} must be after the start time.`);
      } else if (
        duration < MIN_MEETING_MINUTES ||
        duration > MAX_MEETING_MINUTES
      ) {
        errors.push(
          `Class time on ${day} must be between ${MIN_MEETING_MINUTES} minutes and 12 hours.`
        );
      }
    }
  }
  if (state.lowPriorityThreshold < 1 || state.lowPriorityThreshold > 5) {
    errors.push("Low-priority threshold must be between 1 and 5.");
  }

  const ids = new Set();
  for (const topic of state.topics) {
    if (!topic.id || ids.has(topic.id)) {
      errors.push(`Duplicate or missing topic id "${topic.id}".`);
    }
    ids.add(topic.id);
  }

  for (const topic of state.topics) {
    for (const message of validateTopicFields(topic)) {
      errors.push(`Topic "${topic.title}" has an invalid value: ${message}`);
    }
    if (topic.dependencies.includes(topic.id)) {
      errors.push(`Topic "${topic.title}" cannot depend on itself.`);
    }
    for (const depId of topic.dependencies) {
      if (!ids.has(depId)) {
        errors.push(`Topic "${topic.title}" depends on a missing topic.`);
      }
    }
  }

  const cycle = topoOrderTopics(state.topics).cycle;
  if (cycle.length) {
    errors.push("Topic dependencies contain a cycle.");
  }

  const quizIds = new Set();
  const quizDates = new Set();
  for (const quiz of state.quizzes) {
    if (!quiz.id || quizIds.has(quiz.id)) {
      errors.push(`Duplicate or missing quiz id "${quiz.id}".`);
    }
    quizIds.add(quiz.id);
    if (!quiz.title || !quiz.title.trim()) {
      errors.push("Every quiz needs a title.");
    }
    for (const topicId of quiz.coveredTopicIds || []) {
      if (!ids.has(topicId)) {
        warnings.push(
          `Quiz "${quiz.title}" covers a topic that no longer exists (${topicId}).`
        );
      }
    }
    if (!isValidISO(quiz.date)) {
      errors.push(`Quiz "${quiz.title}" has an invalid date.`);
    } else {
      if (quizDates.has(quiz.date)) {
        errors.push(`Two quizzes are scheduled on ${quiz.date}.`);
      }
      quizDates.add(quiz.date);
      if (!isInSemester(state, quiz.date)) {
        errors.push(`Quiz "${quiz.title}" falls outside the semester.`);
      }
    }
  }

  for (const cell of state.calendar) {
    if (!isValidISO(cell.date)) {
      errors.push("A calendar cell has an invalid date.");
      continue;
    }
    const allocations = Array.isArray(cell.allocations) ? cell.allocations : [];
    for (const allocation of allocations) {
      if (!ids.has(allocation.topicId)) {
        warnings.push(
          `Calendar cell ${cell.date} references a topic that no longer exists.`
        );
      }
      if (!Number.isInteger(allocation.minutes) || allocation.minutes <= 0) {
        errors.push(`Calendar cell ${cell.date} has an invalid allocation.`);
      }
    }
    if (allocations.length && !isInSemester(state, cell.date)) {
      errors.push(`Calendar cell ${cell.date} falls outside the semester.`);
    }
    if (cell.type === DAY_TYPES.QUIZ || isSuspendedCell(cell)) {
      if (allocations.length) {
        errors.push(`Calendar cell ${cell.date} cannot hold class allocations.`);
      }
    } else if (isClassWeekday(state, cell.date)) {
      const capacity = getMeetingMinutes(state, cell.date);
      const used = getCellAllocatedMinutes(cell);
      if (capacity && used > capacity) {
        errors.push(`Calendar cell ${cell.date} exceeds its class time.`);
      }
      if (!capacity) {
        errors.push(`Calendar cell ${cell.date} has no valid class time.`);
      }
    }
    if (!isInSemester(state, cell.date) && isSuspendedCell(cell)) {
      warnings.push(`Suspension on ${cell.date} is outside the semester.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function computeDependencyWarnings(state) {
  const warnings = [];
  for (const topic of state.topics) {
    if (topic.status !== STATUS.SCHEDULED && topic.status !== STATUS.COMPLETED) {
      continue;
    }
    for (const depId of topic.dependencies) {
      const dependency = getTopic(state, depId);
      if (!dependency) {
        warnings.push({
          topicId: topic.id,
          dependencyId: depId,
          message: `${topic.title} depends on a missing topic.`
        });
        continue;
      }
      if (
        dependency.status !== STATUS.SCHEDULED &&
        dependency.status !== STATUS.COMPLETED
      ) {
        warnings.push({
          topicId: topic.id,
          dependencyId: depId,
          message: `${topic.title} is scheduled before its prerequisite ${dependency.title} is completed.`
        });
      }
    }
  }
  return warnings;
}

export function nextClassDayOnOrAfter(state, iso) {
  const start = isValidISO(iso) ? iso : state.semester.startDate;
  if (compareISO(start, state.semester.endDate) > 0) {
    return "";
  }
  let current =
    compareISO(start, state.semester.startDate) < 0
      ? state.semester.startDate
      : start;
  while (compareISO(current, state.semester.endDate) <= 0) {
    if (
      isClassWeekday(state, current) &&
      !isDateSuspended(state, current) &&
      !getQuizForDate(state, current)
    ) {
      return current;
    }
    current = addDays(current, 1);
  }
  return "";
}

export function defaultRescheduleDate(state) {
  const today = todayISO();
  if (isInSemester(state, today)) {
    return nextClassDayOnOrAfter(state, today) || state.semester.startDate;
  }
  return (
    nextClassDayOnOrAfter(state, state.semester.startDate) ||
    state.semester.startDate
  );
}

export function makeId(prefix, existingIds) {
  let index = 1;
  while (existingIds.has(`${prefix}${index}`)) {
    index += 1;
  }
  return `${prefix}${index}`;
}
