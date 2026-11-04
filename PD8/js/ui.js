import {
  addDays,
  addMonths,
  compareISO,
  eachDate,
  formatLong,
  formatMinutes,
  formatRange,
  formatShort,
  isValidISO,
  isValidTime,
  startOfMonth,
  timeToMinutes,
  todayISO,
  WEEKDAY_ORDER
} from "./dates.js";
import {
  addCellAllocation,
  cloneState,
  computeDependencyWarnings,
  createEmptyState,
  ensureCalendarCell,
  getCalendarCell,
  getCellAllocatedMinutes,
  getMeetingMinutes,
  getQuizForDate,
  getRemainingMinutes,
  getScheduledDates,
  getTopic,
  getTopicDateRange,
  isClassWeekday,
  isDateSuspended,
  isInSemester,
  makeHistoryEntry,
  makeId,
  nextClassDayOnOrAfter,
  normalizeState,
  removeTopicEverywhere,
  STATUS,
  syncTopicStatusFromCalendar,
  validateTopicBatch
} from "./models.js";
import { createDemoState } from "./data.js";
import { hasLocalStorage, loadState, saveState } from "./storage.js";
import {
  computeTeachingDays,
  generateSchedule,
  getAutomaticReflowDate,
  summarizeGeneration
} from "./scheduler.js";
import {
  convertTopicToAsync,
  dropTopic,
  hasSchedule,
  rearrange,
  reconcileSemesterDates,
  removeTopicSessionsFrom,
  restoreTopic
} from "./rearrangement.js";
import {
  escapeHTML,
  renderAsyncSidebar,
  renderCalendarGrid,
  renderCalendarLegend,
  renderCalendarToolbar
} from "./calendar.js";
import { closeDayPopover, closeModal, openDayPopover, openModal } from "./popover.js";
import {
  getQuizCoverage,
  getQuizCoverageWarnings
} from "./quiz-coverage.js";

const setupView = document.getElementById("setup-view");
const calendarView = document.getElementById("calendar-view");
const calendarToolbar = document.getElementById("calendar-toolbar");
const calendarLegend = document.getElementById("calendar-legend");
const calendarGrid = document.getElementById("calendar-grid");
const asyncSidebar = document.getElementById("async-sidebar");
const warningBanner = document.getElementById("warning-banner");
const summaryRoot = document.getElementById("change-summary-root");
const toastRoot = document.getElementById("toast-root");
const dirtyBadge = document.getElementById("dirty-badge");
const undoButton = document.getElementById("btn-undo");
const discardButton = document.getElementById("btn-discard");
const acceptButton = document.getElementById("btn-accept");
const demoButton = document.getElementById("btn-demo");
const resetButton = document.getElementById("btn-reset");

const STATUS_LABELS = {
  [STATUS.PENDING]: "Pending",
  [STATUS.SCHEDULED]: "Scheduled",
  [STATUS.COMPLETED]: "Completed",
  [STATUS.ASYNC]: "Async",
  [STATUS.PARTIAL]: "Partial",
  [STATUS.UNSCHEDULED]: "Unscheduled",
  [STATUS.DROPPED]: "Dropped"
};

let appState = null;
let savedState = null;
let currentView = "setup";
let calendarMode = "month";
let cursorISO = todayISO();
let scheduleStale = false;
let storageWarningShown = false;

function priorityDot(priority) {
  return `<span class="priority-dot p${priority}" title="Priority ${priority}"></span>`;
}

function statusBadge(topic) {
  return `<span class="status-badge ${topic.status}">${STATUS_LABELS[topic.status] || topic.status}</span>`;
}

function isDirty() {
  return Boolean(savedState) && JSON.stringify(appState) !== JSON.stringify(savedState);
}

function hasOutOfSemesterWork(state) {
  return (
    state.calendar.some(
      (cell) => cell.allocations?.length && !isInSemester(state, cell.date)
    ) || state.quizzes.some((quiz) => !isInSemester(state, quiz.date))
  );
}

function showToast(message, variant = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`.trim();
  toast.textContent = message;
  toastRoot.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function persistBaseline() {
  savedState = cloneState(appState);
  const result = saveState(appState);
  if (!result.ok && !storageWarningShown) {
    storageWarningShown = true;
    showToast(
      "Browser storage is unavailable. Changes will last only until this tab closes.",
      "danger"
    );
  }
}

function hideChangeSummary() {
  summaryRoot.replaceChildren();
}

function setModalError(body, message) {
  const error = body.querySelector("[data-form-error]");
  if (error) {
    error.textContent = message;
    error.classList.remove("hidden");
  }
}

function clearModalError(body) {
  const error = body.querySelector("[data-form-error]");
  if (error) {
    error.textContent = "";
    error.classList.add("hidden");
  }
}

function showErrorsModal(title, errors) {
  const content = document.createElement("div");
  content.className = "notice danger";
  const list = document.createElement("ul");
  list.className = "summary-list";
  for (const error of errors) {
    const item = document.createElement("li");
    item.textContent = error;
    list.appendChild(item);
  }
  content.appendChild(list);
  openModal({
    title,
    content,
    actions: [{ label: "Close", variant: "primary" }]
  });
}

function confirmAction({ title, message, confirmLabel, variant = "primary", onConfirm }) {
  const content = document.createElement("p");
  content.textContent = message;
  openModal({
    title,
    content,
    actions: [
      { label: "Cancel" },
      {
        label: confirmLabel,
        variant,
        onClick: () => onConfirm()
      }
    ]
  });
}

function renderChrome() {
  const dirty = isDirty();
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  setupView.classList.toggle("hidden", currentView !== "setup");
  calendarView.classList.toggle("hidden", currentView !== "calendar");
  dirtyBadge.classList.toggle("hidden", !dirty);
  undoButton.disabled = !appState.history.length;
  discardButton.disabled = !dirty;
  acceptButton.disabled = !dirty;
  const lastEntry = appState.history[appState.history.length - 1];
  undoButton.title = lastEntry ? `Undo: ${lastEntry.label}` : "Nothing to undo";
}

function renderAll() {
  renderChrome();
  if (currentView === "setup") {
    renderSetup();
  } else {
    renderCalendarView();
  }
}

function commitState(nextState, label, options = {}) {
  const base = options.baseState || appState;
  const normalized = normalizeState(nextState);
  const snapshot = makeHistoryEntry(base, label);
  normalized.history = [...(base.history || []), snapshot].slice(-20);
  appState = normalized;
  if (options.save) {
    persistBaseline();
  }
  if (options.staleIfScheduled) {
    scheduleStale = hasSchedule(appState);
  }
  closeDayPopover();
  if (options.closeModal !== false) {
    closeModal();
  }
  hideChangeSummary();
  renderAll();
  if (options.summary) {
    showChangeSummary(options.summary);
  }
  if (options.toast) {
    showToast(options.toast.message, options.toast.variant);
  }
}

function undoLastChange() {
  if (!appState.history.length) {
    return;
  }
  const entry = appState.history[appState.history.length - 1];
  const remaining = appState.history.slice(0, -1);
  const restored = normalizeState(entry.state);
  restored.history = remaining;
  appState = restored;
  hideChangeSummary();
  closeDayPopover();
  closeModal();
  renderAll();
  showToast(`Undid: ${entry.label}`);
}

function acceptChanges() {
  if (!isDirty()) {
    hideChangeSummary();
    renderAll();
    return;
  }
  persistBaseline();
  hideChangeSummary();
  renderAll();
  showToast("Changes accepted and saved.", "success");
}

function discardChanges() {
  if (!savedState) {
    return;
  }
  appState = cloneState(savedState);
  hideChangeSummary();
  closeDayPopover();
  closeModal();
  renderAll();
  showToast("Unsaved changes discarded.");
}

function switchView(view) {
  if (view !== "setup" && view !== "calendar") {
    return;
  }
  if (view !== "setup" && hasUnsavedTopicDrafts()) {
    showToast("Save or revert the topic rows before leaving setup.", "warning");
    return;
  }
  currentView = view;
  closeDayPopover();
  closeModal();
  if (currentView === "calendar" && !isInSemester(appState, cursorISO)) {
    const today = todayISO();
    cursorISO = isInSemester(appState, today)
      ? startOfMonth(today)
      : startOfMonth(appState.semester.startDate);
  }
  renderAll();
}

function getSuggestedRescheduleDate() {
  const today = todayISO();
  if (isInSemester(appState, today)) {
    return nextClassDayOnOrAfter(appState, today) || today;
  }
  if (compareISO(today, appState.semester.startDate) < 0) {
    return topOfSemesterDate();
  }
  return appState.semester.endDate;
}

function topOfSemesterDate() {
  return (
    nextClassDayOnOrAfter(appState, appState.semester.startDate) ||
    appState.semester.startDate
  );
}

function setupEditAllowed() {
  if (isDirty()) {
    showToast("Accept or discard calendar changes before editing setup.", "warning");
    renderAll();
    return false;
  }
  return true;
}

function markSetupStale() {
  if (hasSchedule(appState)) {
    scheduleStale = true;
  }
}

function setupDayCount() {
  return computeTeachingDays(appState).length;
}

function setupAvailableMinutes() {
  return computeTeachingDays(appState).reduce(
    (total, iso) => total + getMeetingMinutes(appState, iso),
    0
  );
}

function classTimeFor(day) {
  return (
    appState.semester.classTimes?.[day] || {
      start: "09:00",
      end: "12:00"
    }
  );
}

function classTimeMinutes(day) {
  const time = classTimeFor(day);
  const minutes = timeToMinutes(time.end) - timeToMinutes(time.start);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function classTimesMarkup() {
  return appState.semester.classDays
    .map((day) => {
      const time = classTimeFor(day);
      const minutes = classTimeMinutes(day);
      return `
        <div class="class-time-row" data-class-time-row="${day}">
          <span class="class-time-day">${day}</span>
          <label class="class-time-field">
            <span>Start</span>
            <input type="time" data-class-time="${day}" data-time-part="start" value="${escapeHTML(time.start)}" />
          </label>
          <label class="class-time-field">
            <span>End</span>
            <input type="time" data-class-time="${day}" data-time-part="end" value="${escapeHTML(time.end)}" />
          </label>
          <span class="class-time-length">${minutes ? escapeHTML(formatMinutes(minutes)) : "Invalid"}</span>
        </div>
      `;
    })
    .join("");
}

function dependencyOptionsMarkup(topic = null) {
  const selected = new Set(topic?.dependencies || []);
  const candidates = appState.topics.filter(
    (candidate) => candidate.id !== topic?.id
  );
  if (!candidates.length) {
    return `<span class="small muted">No other topics</span>`;
  }
  return candidates
    .map(
      (candidate) => `
        <label class="dep-check">
          <input type="checkbox" data-topic-dep value="${candidate.id}" ${selected.has(candidate.id) ? "checked" : ""} />
          <span>${escapeHTML(candidate.title)}</span>
        </label>
      `
    )
    .join("");
}

function topicRowMarkup(topic = null) {
  const range = topic ? getTopicDateRange(appState, topic.id) : null;
  const meta = topic
    ? `${statusBadge(topic)}
       ${topic.hold ? `<span class="chip warning">Held</span>` : ""}
       ${range.start ? `<span class="inline-range">${escapeHTML(range.text)} · ${escapeHTML(formatMinutes(range.minutes))}</span>` : ""}`
    : `<span class="status-badge pending">New</span>`;
  const dependencyCount = topic?.dependencies.length || 0;
  return `
    <div class="inline-topic-row" data-topic-row data-topic-id="${topic?.id || ""}">
      <div class="inline-topic-main">
        <input class="inline-topic-title" data-topic-field="title" type="text" maxlength="90" value="${escapeHTML(topic?.title || "")}" placeholder="Topic title" aria-label="Topic title" />
        <div class="inline-topic-meta">${meta}</div>
      </div>
      <label class="inline-topic-field">
        <span>Hours</span>
        <input data-topic-field="hours" type="number" min="0.25" max="1000" step="0.5" value="${escapeHTML(topic?.estimatedHours ?? 3)}" aria-label="Estimated hours" />
      </label>
      <label class="inline-topic-field">
        <span>Priority</span>
        <select data-topic-field="priority" aria-label="Priority">
          ${[5, 4, 3, 2, 1]
            .map(
              (value) =>
                `<option value="${value}" ${(topic?.priority || 3) === value ? "selected" : ""}>${value}${value === 5 ? " · highest" : value === 1 ? " · lowest" : ""}</option>`
            )
            .join("")}
        </select>
      </label>
      <details class="inline-topic-deps">
        <summary>${dependencyCount ? `${dependencyCount} prerequisite${dependencyCount === 1 ? "" : "s"}` : "No prerequisites"}</summary>
        <div class="inline-deps-list">${dependencyOptionsMarkup(topic)}</div>
      </details>
      <button class="icon-button inline-topic-remove" type="button" data-action="remove-topic-row" aria-label="Remove this topic from the setup">×</button>
      <p class="row-error" data-row-error hidden></p>
    </div>
  `;
}

function quizCoverageChip(quiz) {
  if (!quiz.coveredTopicIds?.length) {
    return `<span class="chip">No covered topics selected</span>`;
  }
  const coverage = getQuizCoverage(appState, quiz);
  if (coverage.pending) {
    return `<span class="chip">Coverage checked after generation</span>`;
  }
  if (!coverage.warnings.length) {
    return `<span class="chip ok">Fully covered</span>`;
  }
  return `<span class="chip warning">${coverage.warnings.length} uncovered</span>`;
}

function quizCoveredTopicsText(quiz) {
  if (!quiz.coveredTopicIds?.length) {
    return "No covered topics selected";
  }
  return `Covers ${quiz.coveredTopicIds
    .map((topicId) => getTopic(appState, topicId)?.title || "missing topic")
    .join(", ")}`;
}

function renderSetup() {
  const topics = appState.topics;
  const counts = {
    scheduled: topics.filter((topic) => topic.status === STATUS.SCHEDULED).length,
    completed: topics.filter((topic) => topic.status === STATUS.COMPLETED).length,
    partial: topics.filter((topic) => topic.status === STATUS.PARTIAL).length,
    async: topics.filter((topic) => topic.status === STATUS.ASYNC).length,
    unscheduled: topics.filter((topic) => topic.status === STATUS.UNSCHEDULED).length,
    dropped: topics.filter((topic) => topic.status === STATUS.DROPPED).length
  };
  const scheduleExists = hasSchedule(appState);
  const welcome = topics.length
    ? ""
    : `
      <section class="welcome-card">
        <div>
          <h2>Build a semester that can absorb disruption</h2>
          <p>Add topics with estimated hours, reserve quiz days, and generate a schedule. When class time is lost, the scheduler keeps topic blocks together and shares the remaining time by deadline and priority.</p>
        </div>
        <div class="welcome-actions">
          <button class="btn primary" type="button" data-action="load-demo">Load Demo Semester</button>
          <button class="btn" type="button" data-action="add-topic-row">Add First Topic</button>
        </div>
      </section>
    `;

  const topicRows = topics.length
    ? topics.map((topic) => topicRowMarkup(topic)).join("")
    : `<div class="empty-row" data-topic-empty>No topics yet. Add a row, enter the estimated hours, and save the batch.</div>`;

  const quizRows = appState.quizzes.length
    ? appState.quizzes
        .map((quiz) => {
          const coverage = getQuizCoverage(appState, quiz);
          return `
            <div class="quiz-row">
              <div class="topic-title"><span class="quiz-pill">${escapeHTML(quiz.title)}</span></div>
              <div class="quiz-meta">
                <div class="topic-meta">${escapeHTML(formatLong(quiz.date))}</div>
                <div class="quiz-covered" title="${escapeHTML(quizCoveredTopicsText(quiz))}">${escapeHTML(quizCoveredTopicsText(quiz))}</div>
              </div>
              <div class="row">
                <span class="chip quiz">Reserved</span>
                ${quizCoverageChip(quiz)}
              </div>
              <div class="row-actions">
                ${
                  coverage.warnings.length
                    ? `<button class="btn small" type="button" data-action="review-quiz-coverage" data-quiz-id="${quiz.id}">Review</button>`
                    : ""
                }
                <button class="btn small" type="button" data-action="edit-quiz" data-quiz-id="${quiz.id}">Edit</button>
                <button class="btn small ghost" type="button" data-action="delete-quiz" data-quiz-id="${quiz.id}">Delete</button>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-row">No quizzes. Generated schedules reserve a class day for each quiz.</div>`;

  const scheduleStats = scheduleExists
    ? `<div class="notice info"><span>${counts.scheduled} scheduled · ${counts.completed} completed${counts.partial ? ` · ${counts.partial} partial` : ""} · ${counts.async} async · ${counts.unscheduled} needing attention${counts.dropped ? ` · ${counts.dropped} dropped` : ""}</span></div>`
    : `<div class="notice"><span>The scheduler places topics in dependency order. When remaining time is sufficient, topics finish one at a time. When time is short, each ready topic reserves up to one hour and shares the rest by priority, so several topics may be left partial.</span></div>`;

  setupView.innerHTML = `
    <div class="setup-shell">
      ${welcome}
      ${
        scheduleStale && scheduleExists
          ? `<div class="notice warning"><span>Setup has changed since this schedule was generated. Regenerate the schedule or use Reschedule Remaining to apply the new rules.</span></div>`
          : ""
      }
      <section class="card">
        <div class="card-header">
          <div>
            <h2>Semester</h2>
            <p>${setupDayCount()} available teaching days · ${escapeHTML(formatMinutes(setupAvailableMinutes()))} of class time after quizzes and suspensions.</p>
          </div>
          <div class="card-actions"><span class="chip">Auto-saved</span></div>
        </div>
        <div class="grid-3">
          <div class="form-field">
            <label for="semester-start">Start date</label>
            <input id="semester-start" type="date" data-field="startDate" value="${escapeHTML(appState.semester.startDate)}" />
          </div>
          <div class="form-field">
            <label for="semester-end">End date</label>
            <input id="semester-end" type="date" data-field="endDate" value="${escapeHTML(appState.semester.endDate)}" />
          </div>
          <div class="form-field">
            <label for="threshold">Low-priority threshold</label>
            <select id="threshold" data-field="threshold">
              ${[1, 2, 3, 4, 5]
                .map(
                  (value) =>
                    `<option value="${value}" ${value === appState.lowPriorityThreshold ? "selected" : ""}>${value} or lower stays async</option>`
                )
                .join("")}
            </select>
            <small>Topics are ordered by quiz deadline, then priority. When time is short, ready topics reserve up to one hour each and share the remainder by priority. Topics at or below this threshold become async only when no class time remains or a dependency blocks them.</small>
          </div>
        </div>
        <div class="form-field class-day-field">
          <span class="field-label">Class days</span>
          <div class="class-day-row">
            ${WEEKDAY_ORDER.map(
              (day) => `
                <label class="day-check">
                  <input type="checkbox" data-class-day="${day}" ${appState.semester.classDays.includes(day) ? "checked" : ""} />
                  <span>${day}</span>
                </label>
              `
            ).join("")}
          </div>
        </div>
        <div class="form-field">
          <span class="field-label">Class times</span>
          <div class="class-time-grid">${classTimesMarkup()}</div>
          <small>Each selected weekday can have its own class window. Hours are scheduled into these exact daily blocks.</small>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2>Topics</h2>
            <p>Set estimated hours, priority, and prerequisites together, then save the whole batch as one change.</p>
          </div>
          <div class="card-actions">
            <button class="btn" type="button" data-action="add-topic-row">Add Row</button>
            <button class="btn subtle" type="button" data-action="revert-topic-rows">Revert Rows</button>
            <button class="btn primary" type="button" data-action="save-topics">Save Topic Changes</button>
          </div>
        </div>
        <div class="inline-topic-head" aria-hidden="true">
          <span>Topic</span><span>Hours</span><span>Priority</span><span>Prerequisites</span><span></span>
        </div>
        <div class="inline-topic-table" data-topic-rows>${topicRows}</div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2>Quizzes</h2>
            <p>Quiz days are reserved teaching days. Record the topics each quiz covers so unfinished coverage can be flagged.</p>
          </div>
          <div class="card-actions">
            <button class="btn" type="button" data-action="add-quiz" ${topics.length ? "" : "disabled"}>Add Quiz</button>
          </div>
        </div>
        <div class="quiz-table">${quizRows}</div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2>Schedule</h2>
            <p>Generation auto-saves the semester setup and opens the calendar. Calendar edits stay pending until you accept them.</p>
          </div>
          <div class="card-actions">
            <button class="btn primary" type="button" data-action="generate" ${topics.length ? "" : "disabled"}>
              ${scheduleExists ? "Regenerate Schedule" : "Generate Schedule"}
            </button>
          </div>
        </div>
        ${scheduleStats}
      </section>
    </div>
  `;
}

function handleSetupChange(event) {
  if (!setupEditAllowed()) {
    return;
  }
  const target = event.target;
  const field = target.dataset.field;
  const classDay = target.dataset.classDay;
  const classTimeDay = target.dataset.classTime;

  if (hasUnsavedTopicDrafts()) {
    revertSetupControl(target);
    showToast("Save or revert the topic rows before changing other setup fields.", "warning");
    return;
  }

  if (classTimeDay) {
    const row = target.closest("[data-class-time-row]");
    const start = row?.querySelector('[data-time-part="start"]')?.value || "";
    const end = row?.querySelector('[data-time-part="end"]')?.value || "";
    if (
      !isValidTime(start) ||
      !isValidTime(end) ||
      timeToMinutes(end) - timeToMinutes(start) < 15
    ) {
      showToast("Class end time must be at least 15 minutes after the start.", "warning");
      renderAll();
      return;
    }
    const next = cloneState(appState);
    next.semester.classTimes[classTimeDay] = { start, end };
    markSetupStale();
    commitState(next, `Updated ${classTimeDay} class time`, {
      save: true,
      toast: { message: "Class time saved." }
    });
    return;
  }

  if (field === "startDate" || field === "endDate") {
    if (!isValidISO(target.value)) {
      showToast("Choose a valid semester date.", "warning");
      renderAll();
      return;
    }
    const next = cloneState(appState);
    next.semester[field] = target.value;
    if (compareISO(next.semester.startDate, next.semester.endDate) > 0) {
      showToast("End date must be on or after the start date.", "warning");
      renderAll();
      return;
    }
    const label = `Updated semester ${field === "startDate" ? "start" : "end"} date`;
    const result = reconcileSemesterDates(
      appState,
      next.semester.startDate,
      next.semester.endDate,
      { label }
    );
    if (!result.ok) {
      revertSetupControl(target);
      showToast(
        result.errors[0] || "The semester dates could not be applied.",
        "warning"
      );
      renderAll();
      return;
    }
    if (result.reflowed) {
      scheduleStale = false;
    } else {
      markSetupStale();
    }
    const movedQuizCount = result.quizMoves.length;
    const message = movedQuizCount
      ? `Semester settings saved. ${movedQuizCount} quiz date${movedQuizCount === 1 ? "" : "s"} moved inside the semester.`
      : result.reflowed
        ? "Semester settings saved and schedule readjusted."
        : "Semester settings saved.";
    commitState(result.state, label, {
      save: true,
      summary: result.summary,
      toast: { message }
    });
    return;
  }

  if (field === "threshold") {
    const next = cloneState(appState);
    next.lowPriorityThreshold = Number(target.value);
    markSetupStale();
    commitState(next, "Updated low-priority threshold", {
      save: true,
      toast: { message: "Threshold saved." }
    });
    return;
  }

  if (classDay) {
    const selected = [...setupView.querySelectorAll("[data-class-day]:checked")].map(
      (input) => input.dataset.classDay
    );
    if (!selected.length) {
      showToast("Choose at least one class day.", "warning");
      renderAll();
      return;
    }
    const next = cloneState(appState);
    next.semester.classDays = WEEKDAY_ORDER.filter((day) => selected.includes(day));
    markSetupStale();
    commitState(next, "Updated class days", {
      save: true,
      toast: { message: "Class days saved." }
    });
  }
}

function renderWarningBanner() {
  const unscheduled = appState.topics.filter((topic) => topic.status === STATUS.UNSCHEDULED);
  const partial = appState.topics.filter((topic) => topic.status === STATUS.PARTIAL);
  const dependencyWarnings = computeDependencyWarnings(appState);
  const quizWarnings = getQuizCoverageWarnings(appState);
  const show =
    unscheduled.length > 0 ||
    partial.length > 0 ||
    dependencyWarnings.length > 0 ||
    quizWarnings.length > 0;
  warningBanner.classList.toggle("hidden", !show);
  if (!show) {
    warningBanner.replaceChildren();
    return;
  }

  const issueCount =
    unscheduled.length +
    partial.length +
    dependencyWarnings.length +
    quizWarnings.length;
  const heading =
    unscheduled.length > 0
      ? `${unscheduled.length} topic${unscheduled.length === 1 ? "" : "s"} need${unscheduled.length === 1 ? "s" : ""} teacher action`
      : quizWarnings.length > 0
        ? "Quiz coverage needs review"
        : partial.length > 0
          ? "Some topics are partially scheduled"
          : "Dependency check needs attention";

  const items = unscheduled
    .map(
      (topic) => `
        <div class="warning-item">
          <div class="warning-item-main">
            <strong>${escapeHTML(topic.title)}</strong>
            <span>Priority ${topic.priority} · ${escapeHTML(topic.asyncReason || "Needs teacher action")}</span>
          </div>
          <div class="warning-actions">
            ${
              topic.hold
                ? `<button class="btn small primary" type="button" data-warning-action="restore" data-topic-id="${topic.id}">Restore</button>`
                : `<button class="btn small" type="button" data-warning-action="retry" data-topic-id="${topic.id}">Retry placement</button>`
            }
            <button class="btn small subtle" type="button" data-warning-action="async" data-topic-id="${topic.id}">Convert to async</button>
            <button class="btn small ghost" type="button" data-warning-action="drop" data-topic-id="${topic.id}">Drop</button>
          </div>
        </div>
      `
    )
    .join("");

  const partialItems = partial
    .map(
      (topic) => `
        <div class="warning-item">
          <div class="warning-item-main">
            <strong>${escapeHTML(topic.title)}</strong>
            <span>Priority ${topic.priority} · ${escapeHTML(formatMinutes(getRemainingMinutes(appState, topic)))} still unplaced after priority-weighted sharing</span>
          </div>
          <div class="warning-actions">
            <button class="btn small subtle" type="button" data-warning-action="async" data-topic-id="${topic.id}">Convert to async</button>
          </div>
        </div>
      `
    )
    .join("");

  const quizItems = quizWarnings
    .map(
      (coverage) => `
        <div class="warning-item">
          <div class="warning-item-main">
            <strong>${escapeHTML(coverage.title)}</strong>
            <span>${escapeHTML(formatLong(coverage.date))} · ${coverage.warnings.length} selected topic${coverage.warnings.length === 1 ? "" : "s"} not finished before the quiz</span>
          </div>
          <div class="warning-actions">
            <button class="btn small" type="button" data-warning-action="quiz-coverage" data-quiz-id="${coverage.quizId}">Review coverage</button>
          </div>
        </div>
      `
    )
    .join("");

  const dependencyItems = dependencyWarnings
    .map(
      (warning) => `
        <div class="warning-item">
          <div class="warning-item-main">
            <strong>Dependency check</strong>
            <span>${escapeHTML(warning.message)}</span>
          </div>
        </div>
      `
    )
    .join("");

  warningBanner.innerHTML = `
    <div class="warning-banner-head">
      <div>
        <h2>${heading}</h2>
        <p>Topics remain visible for review when dependencies, limited class time, or unresolved quiz coverage leave work unplaced.</p>
      </div>
      <span class="count-badge">${issueCount}</span>
    </div>
    ${items}
    ${quizItems}
    ${partialItems}
    ${dependencyItems}
  `;

  warningBanner.querySelectorAll("[data-warning-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const topicId = button.dataset.topicId;
      const quizId = button.dataset.quizId;
      const action = button.dataset.warningAction;
      if (action === "restore") {
        restoreUnscheduledTopic(topicId);
      } else if (action === "retry") {
        retryTopic(topicId);
      } else if (action === "async") {
        convertTopicAsync(topicId);
      } else if (action === "drop") {
        requestDropTopic(topicId);
      } else if (action === "quiz-coverage") {
        const warnings = getQuizCoverageWarnings(appState, [quizId]);
        if (warnings.length) {
          openQuizCoverageReview(warnings);
        }
      }
    });
  });
}

function renderCalendarView() {
  renderCalendarToolbar(calendarToolbar, {
    state: appState,
    view: calendarMode,
    cursorISO,
    onPrev: () => {
      cursorISO = calendarMode === "month" ? addMonths(cursorISO, -1) : addDays(cursorISO, -7);
      renderCalendarView();
    },
    onNext: () => {
      cursorISO = calendarMode === "month" ? addMonths(cursorISO, 1) : addDays(cursorISO, 7);
      renderCalendarView();
    },
    onToday: () => {
      cursorISO = todayISO();
      renderCalendarView();
    },
    onViewChange: (view) => {
      calendarMode = view;
      renderCalendarView();
    },
    onJumpDate: (value) => {
      if (isValidISO(value)) {
        cursorISO = value;
        renderCalendarView();
      }
    },
    onSuspendRange: () => {
      openSuspendRangeModal(
        isInSemester(appState, cursorISO) ? cursorISO : getSuggestedRescheduleDate()
      );
    },
    onReschedule: openRescheduleModal
  });
  renderCalendarLegend(calendarLegend);
  renderCalendarGrid(calendarGrid, {
    state: appState,
    view: calendarMode,
    cursorISO,
    onDayClick: (iso, anchor) => {
      openDayPopover({
        state: appState,
        iso,
        anchor,
        handlers: {
          onAddTopic: addTopicToDay,
          onRemoveTopic: openRemoveTopicModal,
          onSuspendDay: openSuspendDayModal,
          onRemoveSuspension: removeSuspension,
          onMoveQuiz: openMoveQuizModal,
          onReviewQuizCoverage: (quizId) => {
            const warnings = getQuizCoverageWarnings(appState, [quizId]);
            if (warnings.length) {
              openQuizCoverageReview(warnings);
            }
          },
          onCancelQuiz: requestCancelQuiz
        }
      });
    }
  });
  renderAsyncSidebar(asyncSidebar, {
    state: appState,
    onRestore: restoreAsyncTopic,
    onDrop: requestDropTopic
  });
  renderWarningBanner();
}

function showChangeSummary(summary) {
  const counts = summary.counts || {};
  const summaryParts = [];
  if (counts.moved) {
    summaryParts.push(`${counts.moved} moved`);
  }
  if (counts.async) {
    summaryParts.push(`${counts.async} async`);
  }
  if (counts.partial) {
    summaryParts.push(`${counts.partial} partial`);
  }
  if (counts.unscheduled) {
    summaryParts.push(`${counts.unscheduled} unscheduled`);
  }
  if (counts.removed) {
    summaryParts.push(`${counts.removed} removed`);
  }
  if (counts.completed) {
    summaryParts.push(`${counts.completed} completed`);
  }
  if (counts.quizMoves) {
    summaryParts.push(`${counts.quizMoves} quiz date${counts.quizMoves === 1 ? "" : "s"} moved`);
  }

  const sections = [];
  if (summary.removed?.length) {
    sections.push(`
      <div class="summary-section">
        <h3>Removed</h3>
        <ul class="summary-list">
          ${summary.removed
            .map(
              (item) =>
                `<li class="removed"><strong>${escapeHTML(item.title)}</strong> — ${escapeHTML(formatMinutes(item.removedMinutes || 0))} across ${item.removedCount || 0} future class day${item.removedCount === 1 ? "" : "s"} removed.</li>`
            )
            .join("")}
        </ul>
      </div>
    `);
  }
  if (summary.moved?.length) {
    sections.push(`
      <div class="summary-section">
        <h3>Moved</h3>
        <ul class="summary-list">
          ${summary.moved
            .map(
              (item) =>
                `<li class="moved"><strong>${escapeHTML(item.title)}</strong> — ${escapeHTML(formatRange(item.oldStart, item.oldEnd))} → ${escapeHTML(formatRange(item.newStart, item.newEnd))}</li>`
            )
            .join("")}
        </ul>
      </div>
    `);
  }
  if (summary.async?.length) {
    sections.push(`
      <div class="summary-section">
        <h3>Converted to async</h3>
        <ul class="summary-list">
          ${summary.async
            .map(
              (item) =>
                `<li class="async"><strong>${escapeHTML(item.title)}</strong> — ${escapeHTML(item.reason)}</li>`
            )
            .join("")}
        </ul>
      </div>
    `);
  }
  if (summary.partial?.length) {
    sections.push(`
      <div class="summary-section">
        <h3>Partially scheduled</h3>
        <ul class="summary-list">
          ${summary.partial
            .map(
              (item) =>
                `<li class="partial"><strong>${escapeHTML(item.title)}</strong> — ${escapeHTML(formatMinutes(item.remainingMinutes || 0))} unplaced after priority-weighted sharing.</li>`
            )
            .join("")}
        </ul>
      </div>
    `);
  }
  if (summary.unscheduled?.length) {
    sections.push(`
      <div class="summary-section">
        <h3>Needs teacher action</h3>
        <ul class="summary-list">
          ${summary.unscheduled
            .map(
              (item) =>
                `<li class="unscheduled"><strong>${escapeHTML(item.title)}</strong> — ${escapeHTML(item.reason)}</li>`
            )
            .join("")}
        </ul>
      </div>
    `);
  }
  if (summary.completed?.length) {
    sections.push(`
      <div class="summary-section">
        <h3>Completed</h3>
        <ul class="summary-list">
          ${summary.completed
            .map(
              (item) =>
                `<li class="moved"><strong>${escapeHTML(item.title)}</strong> — all remaining class time is in the past.</li>`
            )
            .join("")}
        </ul>
      </div>
    `);
  }
  if (summary.quizMoves?.length) {
    sections.push(`
      <div class="summary-section">
        <h3>Quiz dates adjusted</h3>
        <ul class="summary-list">
          ${summary.quizMoves
            .map(
              (item) =>
                `<li class="moved"><strong>${escapeHTML(item.title)}</strong> — ${escapeHTML(formatLong(item.from))} → ${escapeHTML(formatLong(item.to))}</li>`
            )
            .join("")}
        </ul>
      </div>
    `);
  }

  summaryRoot.innerHTML = `
    <section class="change-summary" role="dialog" aria-label="Change summary">
      <div class="summary-top">
        <div>
          <h2>${escapeHTML(summary.label || "Schedule updated")}</h2>
          <p>${escapeHTML(formatLong(summary.fromDate))}${summaryParts.length ? ` · ${escapeHTML(summaryParts.join(" · "))}` : ""}</p>
        </div>
        <span class="status-badge unscheduled">Review</span>
      </div>
      <div class="summary-body">
        ${sections.length ? sections.join("") : `<p class="summary-empty">The schedule is recalculated. No topic ranges changed.</p>`}
      </div>
      <div class="summary-actions">
        <button class="btn ghost" type="button" data-summary-action="undo">Undo Changes</button>
        <button class="btn primary" type="button" data-summary-action="accept">Accept &amp; Save</button>
      </div>
    </section>
  `;
}

function addTopicRow() {
  if (!setupEditAllowed()) {
    return;
  }
  const rows = setupView.querySelector("[data-topic-rows]");
  if (!rows) {
    return;
  }
  rows.querySelector("[data-topic-empty]")?.remove();
  const wrapper = document.createElement("div");
  wrapper.innerHTML = topicRowMarkup(null).trim();
  const row = wrapper.firstElementChild;
  rows.appendChild(row);
  row.querySelector('[data-topic-field="title"]')?.focus();
}

function readTopicDrafts() {
  const usedIds = new Set(appState.topics.map((topic) => topic.id));
  const drafts = [];
  for (const row of setupView.querySelectorAll("[data-topic-row]")) {
    let id = row.dataset.topicId;
    if (!id) {
      id = makeId("t", usedIds);
      usedIds.add(id);
      row.dataset.topicId = id;
    }
    drafts.push({
      key: id,
      id,
      title: row.querySelector('[data-topic-field="title"]').value.trim(),
      estimatedHours: Number(
        row.querySelector('[data-topic-field="hours"]').value
      ),
      priority: Number(
        row.querySelector('[data-topic-field="priority"]').value
      ),
      dependencies: [
        ...row.querySelectorAll("[data-topic-dep]:checked")
      ].map((input) => input.value)
    });
  }
  return drafts;
}

function clearTopicRowErrors() {
  setupView.querySelectorAll("[data-row-error]").forEach((error) => {
    error.textContent = "";
    error.hidden = true;
  });
}

function saveTopicDrafts() {
  if (!setupEditAllowed()) {
    return;
  }
  clearTopicRowErrors();
  const drafts = readTopicDrafts();
  const validation = validateTopicBatch(drafts);
  if (!validation.ok) {
    for (const [key, message] of validation.rowErrors.entries()) {
      const row = setupView.querySelector(`[data-topic-row][data-topic-id="${key}"]`);
      const error = row?.querySelector("[data-row-error]");
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
    }
    showToast(validation.errors[0] || "Fix the topic rows before saving.", "warning");
    return;
  }

  const existingById = new Map(
    appState.topics.map((topic) => [topic.id, topic])
  );
  const draftIds = new Set(drafts.map((draft) => draft.id));
  const removed = appState.topics.filter((topic) => !draftIds.has(topic.id));

  const next = cloneState(appState);
  for (const topic of removed) {
    removeTopicEverywhere(next, topic.id);
  }
  for (const quiz of next.quizzes) {
    quiz.coveredTopicIds = (quiz.coveredTopicIds || []).filter((topicId) =>
      draftIds.has(topicId)
    );
  }
  next.topics = drafts.map((draft) => {
    const existing = existingById.get(draft.id);
    if (!existing) {
      return {
        id: draft.id,
        title: draft.title,
        estimatedHours: draft.estimatedHours,
        priority: draft.priority,
        dependencies: draft.dependencies,
        status: STATUS.PENDING,
        hold: false,
        asyncReason: ""
      };
    }
    const topic = getTopic(next, draft.id);
    topic.title = draft.title;
    topic.estimatedHours = draft.estimatedHours;
    topic.priority = draft.priority;
    topic.dependencies = draft.dependencies;
    syncTopicStatusFromCalendar(next, topic.id);
    return topic;
  });

  const before = appState.topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    estimatedHours: topic.estimatedHours,
    priority: topic.priority,
    dependencies: topic.dependencies
  }));
  const after = next.topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    estimatedHours: topic.estimatedHours,
    priority: topic.priority,
    dependencies: topic.dependencies
  }));
  if (JSON.stringify(before) === JSON.stringify(after)) {
    renderSetup();
    showToast("No topic changes to save.");
    return;
  }

  commitState(next, "Saved topic setup", {
    save: true,
    staleIfScheduled: hasSchedule(appState),
    toast: {
      message:
        drafts.length === 1
          ? "Topic change saved."
          : "Topic changes saved as one batch."
    }
  });
}

function topicDraftSnapshot(topics) {
  return topics.map((topic) => ({
    id: topic.id,
    title: String(topic.title || "").trim(),
    estimatedHours: Number(topic.estimatedHours),
    priority: Number(topic.priority),
    dependencies: [...topic.dependencies].sort()
  }));
}

function hasUnsavedTopicDrafts() {
  if (currentView !== "setup" || !setupView.querySelector("[data-topic-rows]")) {
    return false;
  }
  const drafts = readTopicDrafts();
  return (
    JSON.stringify(topicDraftSnapshot(drafts)) !==
    JSON.stringify(topicDraftSnapshot(appState.topics))
  );
}

function revertSetupControl(target) {
  if (target.dataset.field === "startDate" || target.dataset.field === "endDate") {
    target.value = appState.semester[target.dataset.field];
  } else if (target.dataset.field === "threshold") {
    target.value = String(appState.lowPriorityThreshold);
  } else if (target.dataset.classDay) {
    target.checked = appState.semester.classDays.includes(target.dataset.classDay);
  } else if (target.dataset.classTime) {
    const row = target.closest("[data-class-time-row]");
    const time = classTimeFor(target.dataset.classTime);
    if (row) {
      row.querySelector('[data-time-part="start"]').value = time.start;
      row.querySelector('[data-time-part="end"]').value = time.end;
    }
  }
}

function setCalendarCellForQuiz(state, date, title) {
  const cell = getCalendarCell(state, date);
  if (!cell) {
    return;
  }
  cell.type = "quiz";
  cell.note = title;
  cell.suspended = false;
  cell.allocations = [];
}

function restoreCellAfterQuiz(state, date) {
  const cell = getCalendarCell(state, date);
  if (!cell) {
    return;
  }
  if (cell.suspended) {
    cell.type = "suspended";
    cell.note = "";
  } else {
    cell.type = isClassWeekday(state, date) ? "class" : "empty";
    cell.note = "";
  }
}

function quizDateError(state, date, quizId = null, options = {}) {
  if (!isValidISO(date)) {
    return "Choose a valid quiz date.";
  }
  if (!isInSemester(state, date)) {
    return "The quiz must fall inside the semester.";
  }
  if (!isClassWeekday(state, date)) {
    return "Choose a class day for the quiz.";
  }
  const existingQuiz = getQuizForDate(state, date);
  if (existingQuiz && existingQuiz.id !== quizId) {
    return "Another quiz is already on that date.";
  }
  if (isDateSuspended(state, date)) {
    return "That date is suspended. Remove the suspension before moving a quiz there.";
  }
  if (options.avoidRange) {
    const { start, end } = options.avoidRange;
    if (compareISO(date, start) >= 0 && compareISO(date, end) <= 0) {
      return "The quiz cannot be moved inside the suspension range.";
    }
  }
  if (options.clearFromISO && compareISO(date, options.clearFromISO) < 0) {
    const cell = getCalendarCell(state, date);
    if (cell?.allocations.length) {
      return "That earlier date already has scheduled topics.";
    }
  }
  if (options.forbidSame && options.originalDate === date) {
    return "Choose a different date.";
  }
  return "";
}

function quizTopicChoicesMarkup(selectedIds) {
  const selected = new Set(selectedIds || []);
  if (!appState.topics.length) {
    return `<p class="subtle-copy">Add topics before recording quiz coverage.</p>`;
  }
  return appState.topics
    .map(
      (topic) => `
        <label class="quiz-topic-option">
          <input type="checkbox" name="covered-topic" value="${topic.id}" ${selected.has(topic.id) ? "checked" : ""} />
          <span>
            <strong>${escapeHTML(topic.title)}</strong>
            <small>Priority ${topic.priority} · ${escapeHTML(formatMinutes(Math.round(topic.estimatedHours * 60)))} estimated</small>
          </span>
        </label>
      `
    )
    .join("");
}

function quizCoveragePreviewMarkup(quiz) {
  if (!quiz.coveredTopicIds?.length) {
    return `<p class="subtle-copy">Select the topics this quiz is meant to cover.</p>`;
  }
  if (!hasSchedule(appState)) {
    return `<div class="notice"><span>Coverage will be checked after the schedule is generated.</span></div>`;
  }
  const coverage = getQuizCoverage(appState, quiz);
  if (!coverage.warnings.length) {
    return `<div class="notice info"><span>All selected topics finish before this quiz date.</span></div>`;
  }
  return `
    <div class="notice warning">
      <div>
        <strong>Quiz coverage warning</strong>
        <ul class="coverage-warning-list">
          ${coverage.warnings
            .map((warning) => {
              const planned = warning.lastScheduledDate
                ? `planned through ${formatShort(warning.lastScheduledDate)}`
                : "not scheduled";
              return `<li><strong>${escapeHTML(warning.title)}</strong>: ${escapeHTML(formatMinutes(warning.scheduledBeforeMinutes))} of ${escapeHTML(formatMinutes(warning.estimatedMinutes))} before quiz · ${escapeHTML(planned)}</li>`;
            })
            .join("")}
        </ul>
      </div>
    </div>
  `;
}

function openQuizModal(quizId = null) {
  if (!setupEditAllowed()) {
    return;
  }
  const original = quizId ? appState.quizzes.find((quiz) => quiz.id === quizId) : null;
  if (quizId && !original) {
    return;
  }
  const form = document.createElement("form");
  form.className = "modal-form";
  form.innerHTML = `
    <div class="form-field">
      <label for="quiz-title">Title</label>
      <input id="quiz-title" name="title" type="text" maxlength="80" value="${escapeHTML(original?.title || "")}" required />
    </div>
    <div class="form-field">
      <label for="quiz-date">Quiz date</label>
      <input id="quiz-date" name="date" type="date" min="${escapeHTML(appState.semester.startDate)}" max="${escapeHTML(appState.semester.endDate)}" value="${escapeHTML(original?.date || getSuggestedRescheduleDate())}" required />
      <small>Quiz days reserve a class day and are never used for topic time.</small>
    </div>
    <fieldset class="form-field quiz-coverage-field">
      <legend>Topics covered by this quiz</legend>
      <div class="quiz-topic-choices">${quizTopicChoicesMarkup(original?.coveredTopicIds || [])}</div>
    </fieldset>
    <div data-coverage-preview></div>
    <div class="form-error hidden" data-form-error></div>
  `;

  const titleInput = form.querySelector('[name="title"]');
  const dateInput = form.querySelector('[name="date"]');
  const coverageInputs = [...form.querySelectorAll('[name="covered-topic"]')];
  const preview = form.querySelector('[data-coverage-preview]');

  const draftQuiz = () => ({
    id: original?.id || "__draft__",
    title: titleInput.value.trim(),
    date: dateInput.value,
    coveredTopicIds: coverageInputs
      .filter((input) => input.checked)
      .map((input) => input.value)
  });

  const updatePreview = () => {
    preview.innerHTML = quizCoveragePreviewMarkup(draftQuiz());
  };
  coverageInputs.forEach((input) => input.addEventListener("change", updatePreview));
  dateInput.addEventListener("change", updatePreview);
  updatePreview();

  const save = () => {
    clearModalError(form);
    const title = titleInput.value.trim();
    const date = dateInput.value;
    const coveredTopicIds = draftQuiz().coveredTopicIds;
    if (!title) {
      setModalError(form, "Quiz title is required.");
      return false;
    }
    if (!coveredTopicIds.length) {
      setModalError(form, "Select at least one topic covered by this quiz.");
      return false;
    }
    const dateError = quizDateError(appState, date, original?.id || null);
    if (dateError) {
      setModalError(form, dateError);
      return false;
    }
    const targetCell = getCalendarCell(appState, date);
    if (hasSchedule(appState) && targetCell?.allocations.length) {
      setModalError(form, "That class day already has scheduled topics. Reschedule those topics first.");
      return false;
    }

    const base = appState;
    const next = cloneState(base);
    const savedId =
      original?.id || makeId("q", new Set(next.quizzes.map((quiz) => quiz.id)));
    if (original) {
      if (original.date !== date) {
        restoreCellAfterQuiz(next, original.date);
      }
      const quiz = next.quizzes.find((item) => item.id === original.id);
      quiz.title = title;
      quiz.date = date;
      quiz.coveredTopicIds = coveredTopicIds;
    } else {
      next.quizzes.push({
        id: savedId,
        title,
        date,
        coveredTopicIds
      });
    }
    next.quizzes.sort((left, right) => compareISO(left.date, right.date));
    setCalendarCellForQuiz(next, date, title);

    const label = original ? `Updated ${title}` : `Added ${title}`;
    if (!hasSchedule(base)) {
      commitState(next, label, {
        save: true,
        toast: { message: "Quiz saved. Generate a schedule when ready." }
      });
      return true;
    }

    const fromISO =
      original && compareISO(original.date, date) < 0 ? original.date : date;
    const result = rearrange(next, fromISO, { label });
    if (!result.ok) {
      setModalError(
        form,
        result.errors[0] || "The schedule could not be readjusted for this quiz."
      );
      return false;
    }
    const movedQuizCount = result.quizMoves.length;
    commitState(result.state, label, {
      baseState: base,
      summary: result.summary,
      save: true,
      toast: {
        message: movedQuizCount
          ? `Quiz saved. ${movedQuizCount} quiz date${movedQuizCount === 1 ? "" : "s"} adjusted with the schedule.`
          : "Quiz saved and the schedule readjusted."
      }
    });
    return true;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save();
  });

  openModal({
    title: original ? "Edit Quiz" : "Add Quiz",
    content: form,
    actions: [
      { label: "Cancel" },
      { label: original ? "Save Quiz" : "Add Quiz", variant: "primary", onClick: save }
    ],
    onMount: () => form.querySelector('[name="title"]').focus()
  });
}

function requestDeleteQuiz(quizId) {
  if (!setupEditAllowed()) {
    return;
  }
  const quiz = appState.quizzes.find((item) => item.id === quizId);
  if (!quiz) {
    return;
  }
  confirmAction({
    title: "Delete quiz?",
    message: `Delete "${quiz.title}" on ${formatLong(quiz.date)}? The reserved day will become available.`,
    confirmLabel: "Delete Quiz",
    variant: "danger",
    onConfirm: () => {
      const next = cloneState(appState);
      next.quizzes = next.quizzes.filter((item) => item.id !== quizId);
      restoreCellAfterQuiz(next, quiz.date);
      commitState(next, `Deleted ${quiz.title}`, {
        save: true,
        staleIfScheduled: hasSchedule(appState),
        toast: { message: "Quiz deleted. Use Reschedule Remaining to use the freed day." }
      });
    }
  });
}

function nextCoverageQuizDate(state, proposed, usedDates) {
  let candidate = proposed;
  while (candidate && compareISO(candidate, state.semester.endDate) <= 0) {
    if (!usedDates.has(candidate) && !isDateSuspended(state, candidate)) {
      return candidate;
    }
    candidate = nextClassDayOnOrAfter(state, addDays(candidate, 1));
  }
  return "";
}

function applyQuizCoverageMoves(coverages) {
  const base = appState;
  const next = cloneState(base);
  const usedDates = new Set(
    next.quizzes
      .filter((quiz) => !coverages.some((coverage) => coverage.quizId === quiz.id))
      .map((quiz) => quiz.date)
  );
  const moves = [];
  let earliest = "";

  for (const coverage of coverages) {
    if (!coverage.canMove || !coverage.suggestedDate) {
      continue;
    }
    const quiz = next.quizzes.find((item) => item.id === coverage.quizId);
    if (!quiz) {
      continue;
    }
    const target = nextCoverageQuizDate(next, coverage.suggestedDate, usedDates);
    if (!target) {
      continue;
    }
    usedDates.add(target);
    moves.push({ quizId: quiz.id, oldDate: quiz.date, target });
    earliest = earliest
      ? compareISO(earliest, quiz.date) <= 0
        ? earliest
        : quiz.date
      : quiz.date;
    earliest = compareISO(earliest, target) <= 0 ? earliest : target;
  }

  if (!moves.length) {
    return false;
  }

  for (const move of moves) {
    restoreCellAfterQuiz(next, move.oldDate);
  }
  for (const move of moves) {
    const quiz = next.quizzes.find((item) => item.id === move.quizId);
    quiz.date = move.target;
  }
  next.quizzes.sort((left, right) => compareISO(left.date, right.date));
  for (const move of moves) {
    const quiz = next.quizzes.find((item) => item.id === move.quizId);
    setCalendarCellForQuiz(next, move.target, quiz.title);
  }

  const label =
    moves.length === 1
      ? `Moved ${next.quizzes.find((quiz) => quiz.id === moves[0].quizId)?.title || "quiz"} for coverage`
      : `Moved ${moves.length} quizzes for coverage`;
  const result = rearrange(next, earliest, { label });
  if (!result.ok) {
    showErrorsModal("Could not move quizzes for coverage", result.errors);
    return false;
  }
  const manualMoves = moves.map((move) => ({
    quizId: move.quizId,
    title:
      next.quizzes.find((quiz) => quiz.id === move.quizId)?.title || "Quiz",
    from: move.oldDate,
    to: move.target
  }));
  const autoMoves = result.quizMoves.filter(
    (move) => !manualMoves.some((manual) => manual.quizId === move.quizId)
  );
  result.summary.quizMoves = [...manualMoves, ...autoMoves];
  result.summary.counts.quizMoves = result.summary.quizMoves.length;
  commitState(result.state, label, {
    baseState: base,
    summary: result.summary,
    toast: {
      message:
        getQuizCoverageWarnings(result.state).length > 0
          ? "Quiz dates moved, but some coverage still needs review."
          : "Quiz dates moved and schedule readjusted.",
      variant: getQuizCoverageWarnings(result.state).length > 0 ? "warning" : "success"
    }
  });
  return true;
}

function openQuizCoverageReview(warnings = getQuizCoverageWarnings(appState)) {
  if (!warnings.length) {
    return;
  }
  const actionable = warnings.filter((coverage) => coverage.canMove);
  const content = document.createElement("div");
  content.className = "stack quiz-coverage-review";
  content.innerHTML = `
    <p>These quizzes still cover topics that do not fully finish before the quiz date. The scheduler moved them automatically when a valid later class day existed. Keep the date and resolve the remaining coverage manually, or choose another date.</p>
    ${warnings
      .map(
        (coverage) => `
          <div class="coverage-review-row">
            <div class="coverage-review-head">
              <strong>${escapeHTML(coverage.title)}</strong>
              <span>${escapeHTML(formatLong(coverage.date))}</span>
            </div>
            <ul class="coverage-warning-list">
              ${coverage.warnings
                .map((warning) => {
                  const planned = warning.lastScheduledDate
                    ? ` · planned through ${formatShort(warning.lastScheduledDate)}`
                    : " · not scheduled";
                  return `<li><strong>${escapeHTML(warning.title)}</strong>: ${escapeHTML(formatMinutes(warning.scheduledBeforeMinutes))} of ${escapeHTML(formatMinutes(warning.estimatedMinutes))} before quiz${escapeHTML(planned)}</li>`;
                })
                .join("")}
            </ul>
            <p class="field-help">${
              coverage.canMove
                ? `Suggested date: ${escapeHTML(formatLong(coverage.suggestedDate))}`
                : "No valid later date is available until the selected topics are fully scheduled."
            }</p>
          </div>
        `
      )
      .join("")}
  `;

  openModal({
    title: "Quiz coverage needs review",
    content,
    actions: [
      { label: "Keep Dates" },
      ...(actionable.length
        ? [
            {
              label:
                actionable.length === 1
                  ? "Move Suggested Quiz"
                  : `Move ${actionable.length} Suggested Quizzes`,
              variant: "primary",
              onClick: () => applyQuizCoverageMoves(actionable)
            }
          ]
        : [])
    ]
  });
}

function addTopicToDay(iso, topicId, requestedMinutes = 0) {
  const topic = getTopic(appState, topicId);
  if (!topic) {
    return;
  }
  if (!isInSemester(appState, iso) || !isClassWeekday(appState, iso)) {
    showToast("Topics can only be added to class days.", "warning");
    return;
  }
  if (isDateSuspended(appState, iso) || getQuizForDate(appState, iso)) {
    showToast("That day is not available for topic time.", "warning");
    return;
  }
  if (topic.status === STATUS.ASYNC || topic.status === STATUS.DROPPED) {
    showToast("Restore that topic before adding class time.", "warning");
    return;
  }
  const remaining = getRemainingMinutes(appState, topic);
  if (remaining <= 0) {
    showToast("That topic has no estimated time remaining.", "warning");
    return;
  }
  const currentCell = getCalendarCell(appState, iso);
  const available = Math.max(
    0,
    getMeetingMinutes(appState, iso) - getCellAllocatedMinutes(currentCell)
  );
  if (available <= 0) {
    showToast("This class day is full.", "warning");
    return;
  }
  const minutes = Math.min(
    requestedMinutes > 0 ? Math.round(requestedMinutes) : 60,
    remaining,
    available
  );
  if (minutes < 15) {
    showToast("There is not enough class time left to add.", "warning");
    return;
  }

  const next = cloneState(appState);
  const cell = ensureCalendarCell(next, iso);
  addCellAllocation(cell, topicId, minutes);
  const nextTopic = getTopic(next, topicId);
  nextTopic.hold = false;
  nextTopic.asyncReason = "";
  syncTopicStatusFromCalendar(next, topicId);
  commitState(next, `Added ${formatMinutes(minutes)} of ${topic.title} on ${formatShort(iso)}`, {
    toast: { message: "Class time added. Accept & Save when you are finished." }
  });
}

function buildRemovalSummary(topic, iso, removal, label) {
  return {
    fromDate: iso,
    label,
    moved: [],
    async: [],
    partial: [],
    unscheduled: [
      {
        id: topic.id,
        title: topic.title,
        priority: topic.priority,
        reason: "Removed by teacher",
        hold: true
      }
    ],
    completed: [],
    removed: [
      {
        id: topic.id,
        title: topic.title,
        removedMinutes: removal.removedMinutes,
        removedCount: removal.removedCount
      }
    ],
    counts: {
      moved: 0,
      async: 0,
      partial: 0,
      unscheduled: 1,
      completed: 0,
      removed: 1
    }
  };
}

function openRemoveTopicModal(iso, topicId) {
  const topic = getTopic(appState, topicId);
  if (!topic) {
    return;
  }
  const futureDates = getScheduledDates(appState, topicId).filter(
    (date) => compareISO(date, iso) >= 0
  );
  const futureMinutes = appState.calendar
    .filter((cell) => compareISO(cell.date, iso) >= 0)
    .reduce(
      (total, cell) => total + getCellAllocatedMinutes(cell, topicId),
      0
    );
  const content = document.createElement("div");
  content.className = "stack";
  content.innerHTML = `
    <p>Remove <strong>${escapeHTML(topic.title)}</strong> from <strong>${escapeHTML(formatLong(iso))}</strong> onward?</p>
    <div class="notice warning"><span>${escapeHTML(formatMinutes(futureMinutes))} across ${futureDates.length} class day${futureDates.length === 1 ? "" : "s"} will be removed. The topic will remain in setup as held and unscheduled, so you can restore it later.</span></div>
    <p class="small muted">Readjust now moves later topics earlier to recover the time. Leave as-is keeps every other topic exactly where it is.</p>
  `;
  openModal({
    title: "Remove topic from this day onward",
    content,
    actions: [
      { label: "Cancel" },
      {
        label: "Remove & Leave As-Is",
        onClick: () => commitTopicRemoval(topic, iso, false)
      },
      {
        label: "Remove & Readjust",
        variant: "primary",
        onClick: () => commitTopicRemoval(topic, iso, true)
      }
    ]
  });
}

function commitTopicRemoval(topic, iso, reflow) {
  const base = appState;
  const removal = removeTopicSessionsFrom(base, topic.id, iso, {
    reason: "Removed by teacher"
  });
  const label = `Removed ${topic.title} from ${formatShort(iso)}`;
  if (!reflow) {
    const summary = buildRemovalSummary(topic, iso, removal, label);
    commitState(removal.state, label, {
      baseState: base,
      summary,
      toast: { message: "Topic held. Later topics were left in place." }
    });
    return;
  }

  const result = rearrange(removal.state, iso, {
    label,
    removedTopicId: topic.id,
    removedMinutes: removal.removedMinutes,
    removedCount: removal.removedCount
  });
  if (!result.ok) {
    showErrorsModal("Could not readjust the schedule", result.errors);
    return;
  }
  commitState(result.state, label, {
    baseState: base,
    summary: result.summary,
    toast: { message: "Topic removed and remaining schedule readjusted." }
  });
}

function openSuspendDayModal(iso) {
  if (!isInSemester(appState, iso) || !isClassWeekday(appState, iso)) {
    showToast("Only class days can be suspended.", "warning");
    return;
  }
  const quiz = getQuizForDate(appState, iso);
  const existingCell = getCalendarCell(appState, iso);
  const defaultNote = existingCell?.note && !quiz ? existingCell.note : "";
  const form = document.createElement("form");
  form.className = "modal-form";
  form.innerHTML = `
    <p>Suspend <strong>${escapeHTML(formatLong(iso))}</strong>? The scheduler will remove its allocated time and readjust remaining work from the earliest remaining scheduled class or the suspension date, whichever is earlier, while keeping past sessions fixed.</p>
    <div class="form-field">
      <label for="suspension-note">Reason or note (optional)</label>
      <input id="suspension-note" type="text" name="note" maxlength="120" value="${escapeHTML(defaultNote)}" placeholder="e.g. Typhoon, campus event" />
    </div>
    ${
      quiz
        ? `
          <div class="form-field">
            <span class="field-label">This day has ${escapeHTML(quiz.title)}</span>
            <div class="choice-list">
              <label class="radio-line">
                <input type="radio" name="quiz-disposition" value="keep" checked />
                <span><strong>Keep the quiz on the suspended day</strong><small>The quiz stays dated, but no class time is consumed.</small></span>
              </label>
              <label class="radio-line">
                <input type="radio" name="quiz-disposition" value="cancel" />
                <span><strong>Cancel the quiz</strong><small>Remove it from the semester.</small></span>
              </label>
              <label class="radio-line">
                <input type="radio" name="quiz-disposition" value="move" />
                <span><strong>Move the quiz</strong><small>Pick another class day for it.</small></span>
              </label>
            </div>
          </div>
          <div class="form-field hidden" data-move-wrap>
            <label for="suspension-quiz-date">New quiz date</label>
            <input id="suspension-quiz-date" type="date" data-quiz-move min="${escapeHTML(appState.semester.startDate)}" max="${escapeHTML(appState.semester.endDate)}" />
          </div>
        `
        : ""
    }
    <div class="form-error hidden" data-form-error></div>
  `;

  if (quiz) {
    const moveWrap = form.querySelector("[data-move-wrap]");
    form.querySelectorAll('[name="quiz-disposition"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const isMove =
          form.querySelector('[name="quiz-disposition"]:checked').value === "move";
        moveWrap.classList.toggle("hidden", !isMove);
      });
    });
  }

  const apply = () => {
    clearModalError(form);
    const note = form.querySelector('[name="note"]').value.trim();
    const disposition = quiz
      ? form.querySelector('[name="quiz-disposition"]:checked').value
      : "none";
    let moveDate = "";
    if (disposition === "move") {
      moveDate = form.querySelector("[data-quiz-move]").value;
      const error = quizDateError(appState, moveDate, quiz.id, {
        forbidSame: true,
        originalDate: quiz.date,
        clearFromISO: iso
      });
      if (error) {
        setModalError(form, error);
        return false;
      }
    }

    const base = appState;
    const next = cloneState(base);
    if (disposition === "cancel") {
      next.quizzes = next.quizzes.filter((item) => item.id !== quiz.id);
    } else if (disposition === "move") {
      const movedQuiz = next.quizzes.find((item) => item.id === quiz.id);
      movedQuiz.date = moveDate;
      next.quizzes.sort((left, right) => compareISO(left.date, right.date));
      setCalendarCellForQuiz(next, moveDate, movedQuiz.title);
    }

    const cell = ensureCalendarCell(next, iso);
    cell.suspended = true;
    cell.type = disposition === "keep" ? "quiz" : "suspended";
    cell.allocations = [];
    cell.note = note || (disposition === "keep" ? quiz.title : "");

    const label = `Suspended ${formatShort(iso)}`;
    if (!hasSchedule(base)) {
      commitState(next, label, {
        baseState: base,
        toast: { message: "Class day suspended. It will be excluded when you generate." }
      });
      return true;
    }
    const result = rearrange(next, getAutomaticReflowDate(next, iso), { label });
    if (!result.ok) {
      setModalError(form, result.errors[0] || "The schedule could not be rearranged.");
      return false;
    }
    commitState(result.state, label, {
      baseState: base,
      summary: result.summary,
      toast: { message: "Class day suspended and remaining schedule readjusted." }
    });
    return true;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply();
  });

  openModal({
    title: "Suspend class day",
    content: form,
    actions: [
      { label: "Cancel" },
      { label: "Suspend & Readjust", variant: "primary", onClick: apply }
    ]
  });
}

function quizConflictRowsMarkup(state, start, end) {
  if (!isValidISO(start) || !isValidISO(end) || compareISO(start, end) > 0) {
    return `<p class="subtle-copy">Choose a valid date range to see quiz conflicts.</p>`;
  }
  const quizzes = state.quizzes.filter(
    (quiz) => compareISO(quiz.date, start) >= 0 && compareISO(quiz.date, end) <= 0
  );
  if (!quizzes.length) {
    return `<p class="subtle-copy">No quizzes fall inside this range.</p>`;
  }
  return quizzes
    .map(
      (quiz) => `
        <div class="suspend-quiz-row" data-quiz-row data-quiz-id="${quiz.id}">
          <div class="suspend-quiz-copy">
            <strong>${escapeHTML(quiz.title)}</strong>
            <span>${escapeHTML(formatLong(quiz.date))}</span>
          </div>
          <select data-quiz-choice aria-label="Disposition for ${escapeHTML(quiz.title)}">
            <option value="keep">Keep on suspended day</option>
            <option value="cancel">Cancel quiz</option>
            <option value="move">Move quiz…</option>
          </select>
          <input class="hidden" type="date" data-quiz-move min="${escapeHTML(state.semester.startDate)}" max="${escapeHTML(state.semester.endDate)}" aria-label="New date for ${escapeHTML(quiz.title)}" />
        </div>
      `
    )
    .join("");
}

function bindQuizConflictRows(container) {
  container.querySelectorAll("[data-quiz-choice]").forEach((select) => {
    select.addEventListener("change", () => {
      const row = select.closest("[data-quiz-row]");
      const input = row.querySelector("[data-quiz-move]");
      const isMove = select.value === "move";
      input.classList.toggle("hidden", !isMove);
      if (isMove) {
        input.focus();
      }
    });
  });
}

function openSuspendRangeModal(startISO) {
  const fallbackStart = isInSemester(appState, startISO)
    ? startISO
    : appState.semester.startDate;
  const form = document.createElement("form");
  form.className = "modal-form";
  form.innerHTML = `
    <p>Suspend a range of dates and readjust remaining work from the earliest remaining scheduled class or the range start, whichever is earlier, while keeping past sessions fixed. Quiz days inside the range need a disposition.</p>
    <div class="grid-2">
      <div class="form-field">
        <label for="range-start">Start date</label>
        <input id="range-start" type="date" name="start" min="${escapeHTML(appState.semester.startDate)}" max="${escapeHTML(appState.semester.endDate)}" value="${escapeHTML(fallbackStart)}" required />
      </div>
      <div class="form-field">
        <label for="range-end">End date</label>
        <input id="range-end" type="date" name="end" min="${escapeHTML(appState.semester.startDate)}" max="${escapeHTML(appState.semester.endDate)}" value="${escapeHTML(fallbackStart)}" required />
      </div>
    </div>
    <div class="form-field">
      <label for="range-note">Reason or note (optional)</label>
      <input id="range-note" type="text" name="note" maxlength="120" placeholder="e.g. Reading break" />
    </div>
    <div class="form-field">
      <span class="field-label">Quiz conflicts</span>
      <div class="quiz-conflict-list" data-quiz-conflicts>
        ${quizConflictRowsMarkup(appState, fallbackStart, fallbackStart)}
      </div>
    </div>
    <div class="form-error hidden" data-form-error></div>
  `;

  const startInput = form.querySelector('[name="start"]');
  const endInput = form.querySelector('[name="end"]');
  const conflictList = form.querySelector("[data-quiz-conflicts]");
  const refreshConflicts = () => {
    conflictList.innerHTML = quizConflictRowsMarkup(appState, startInput.value, endInput.value);
    bindQuizConflictRows(conflictList);
  };
  startInput.addEventListener("change", refreshConflicts);
  endInput.addEventListener("change", refreshConflicts);
  bindQuizConflictRows(conflictList);

  const apply = () => {
    clearModalError(form);
    const start = startInput.value;
    const end = endInput.value;
    const note = form.querySelector('[name="note"]').value.trim();
    if (!isValidISO(start) || !isValidISO(end)) {
      setModalError(form, "Choose valid start and end dates.");
      return false;
    }
    if (compareISO(start, end) > 0) {
      setModalError(form, "End date must be on or after the start date.");
      return false;
    }
    if (!isInSemester(appState, start) || !isInSemester(appState, end)) {
      setModalError(form, "The suspension range must be inside the semester.");
      return false;
    }
    const classDates = eachDate(start, end).filter((date) => isClassWeekday(appState, date));
    if (!classDates.length) {
      setModalError(form, "The range contains no class days.");
      return false;
    }

    const dispositions = [];
    const moveDestinations = new Set();
    for (const row of conflictList.querySelectorAll("[data-quiz-row]")) {
      const quiz = appState.quizzes.find((item) => item.id === row.dataset.quizId);
      if (!quiz) {
        continue;
      }
      const choice = row.querySelector("[data-quiz-choice]").value;
      let moveDate = "";
      if (choice === "move") {
        moveDate = row.querySelector("[data-quiz-move]").value;
        if (moveDestinations.has(moveDate)) {
          setModalError(form, `${quiz.title}: two quizzes cannot move to the same date.`);
          return false;
        }
        const error = quizDateError(appState, moveDate, quiz.id, {
          forbidSame: true,
          originalDate: quiz.date,
          avoidRange: { start, end },
          clearFromISO: start
        });
        if (error) {
          setModalError(form, `${quiz.title}: ${error}`);
          return false;
        }
        moveDestinations.add(moveDate);
      }
      dispositions.push({ quiz, choice, moveDate });
    }

    const base = appState;
    const next = cloneState(base);
    for (const disposition of dispositions) {
      if (disposition.choice === "cancel") {
        next.quizzes = next.quizzes.filter((quiz) => quiz.id !== disposition.quiz.id);
      } else if (disposition.choice === "move") {
        const movedQuiz = next.quizzes.find((quiz) => quiz.id === disposition.quiz.id);
        movedQuiz.date = disposition.moveDate;
        setCalendarCellForQuiz(next, disposition.moveDate, movedQuiz.title);
      }
    }
    next.quizzes.sort((left, right) => compareISO(left.date, right.date));

    for (const date of classDates) {
      const cell = ensureCalendarCell(next, date);
      const keptQuiz = next.quizzes.find((quiz) => quiz.date === date);
      cell.suspended = true;
      cell.type = keptQuiz ? "quiz" : "suspended";
      cell.allocations = [];
      cell.note = note || (keptQuiz ? keptQuiz.title : "");
    }

    const label = `Suspended ${formatShort(start)} – ${formatShort(end)}`;
    if (!hasSchedule(base)) {
      commitState(next, label, {
        baseState: base,
        toast: { message: "Range suspended. It will be excluded when you generate." }
      });
      return true;
    }
    const result = rearrange(next, getAutomaticReflowDate(next, start), { label });
    if (!result.ok) {
      setModalError(form, result.errors[0] || "The schedule could not be rearranged.");
      return false;
    }
    commitState(result.state, label, {
      baseState: base,
      summary: result.summary,
      toast: { message: "Range suspended and remaining schedule readjusted." }
    });
    return true;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply();
  });

  openModal({
    title: "Suspend date range",
    content: form,
    actions: [
      { label: "Cancel" },
      { label: "Suspend & Readjust", variant: "primary", onClick: apply }
    ]
  });
}

function openRescheduleModal() {
  if (!hasSchedule(appState)) {
    showToast("Generate a schedule before rescheduling.", "warning");
    return;
  }
  const form = document.createElement("form");
  form.className = "modal-form";
  form.innerHTML = `
    <p>Rebuild the remaining schedule from a chosen date. Sessions before that date stay completed; everything after is recalculated in dependency order with one-hour topic floors and priority-weighted sharing.</p>
    <div class="form-field">
      <label for="reschedule-date">Readjust from</label>
      <input id="reschedule-date" name="date" type="date" min="${escapeHTML(appState.semester.startDate)}" max="${escapeHTML(appState.semester.endDate)}" value="${escapeHTML(getSuggestedRescheduleDate())}" required />
    </div>
    <div class="form-error hidden" data-form-error></div>
  `;

  const apply = () => {
    clearModalError(form);
    const date = form.querySelector('[name="date"]').value;
    if (!isValidISO(date)) {
      setModalError(form, "Choose a valid date.");
      return false;
    }
    if (!isInSemester(appState, date)) {
      setModalError(form, "Choose a date inside the semester.");
      return false;
    }
    const base = appState;
    const label = `Rescheduled from ${formatShort(date)}`;
    const result = rearrange(base, date, { label });
    if (!result.ok) {
      setModalError(form, result.errors[0] || "The schedule could not be rearranged.");
      return false;
    }
    commitState(result.state, label, {
      baseState: base,
      summary: result.summary,
      toast: { message: "Remaining schedule readjusted." }
    });
    return true;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply();
  });

  openModal({
    title: "Reschedule remaining",
    content: form,
    actions: [
      { label: "Cancel" },
      { label: "Readjust", variant: "primary", onClick: apply }
    ]
  });
}

function removeSuspension(iso) {
  const base = appState;
  const next = cloneState(base);
  const cell = ensureCalendarCell(next, iso);
  const quiz = getQuizForDate(next, iso);
  cell.suspended = false;
  cell.type = quiz ? "quiz" : isClassWeekday(next, iso) ? "class" : "empty";
  cell.note = quiz ? quiz.title : "";

  if (!hasSchedule(base)) {
    commitState(next, `Removed suspension on ${formatShort(iso)}`, {
      toast: { message: "Suspension removed." }
    });
    return;
  }

  const label = `Removed suspension on ${formatShort(iso)}`;
  const result = rearrange(next, iso, { label });
  if (!result.ok) {
    showErrorsModal("Could not remove the suspension", result.errors);
    return;
  }
  commitState(result.state, label, {
    baseState: base,
    summary: result.summary,
    toast: { message: "Suspension removed and schedule readjusted." }
  });
}

function openMoveQuizModal(quizId, currentISO) {
  const quiz = appState.quizzes.find((item) => item.id === quizId);
  if (!quiz) {
    return;
  }
  const moveDefault =
    nextClassDayOnOrAfter(appState, addDays(quiz.date, 1)) ||
    currentISO ||
    quiz.date;
  const form = document.createElement("form");
  form.className = "modal-form";
  form.innerHTML = `
    <p>Move <strong>${escapeHTML(quiz.title)}</strong> from ${escapeHTML(formatLong(quiz.date))} to another class day. The calendar will readjust from the earlier of the two dates.</p>
    <div class="form-field">
      <label for="move-quiz-date">New quiz date</label>
      <input id="move-quiz-date" name="date" type="date" min="${escapeHTML(appState.semester.startDate)}" max="${escapeHTML(appState.semester.endDate)}" value="${escapeHTML(moveDefault)}" required />
    </div>
    <div class="form-error hidden" data-form-error></div>
  `;

  const apply = () => {
    clearModalError(form);
    const date = form.querySelector('[name="date"]').value;
    const error = quizDateError(appState, date, quiz.id, {
      forbidSame: true,
      originalDate: quiz.date
    });
    if (error) {
      setModalError(form, error);
      return false;
    }

    const base = appState;
    const next = cloneState(base);
    const moved = next.quizzes.find((item) => item.id === quiz.id);
    restoreCellAfterQuiz(next, quiz.date);
    moved.date = date;
    next.quizzes.sort((left, right) => compareISO(left.date, right.date));
    setCalendarCellForQuiz(next, date, moved.title);

    const fromISO = compareISO(quiz.date, date) <= 0 ? quiz.date : date;
    const label = `Moved ${quiz.title} to ${formatShort(date)}`;
    if (!hasSchedule(base)) {
      commitState(next, label, {
        toast: { message: "Quiz moved." }
      });
      return true;
    }
    const result = rearrange(next, fromISO, { label });
    if (!result.ok) {
      setModalError(form, result.errors[0] || "The schedule could not be rearranged.");
      return false;
    }
    commitState(result.state, label, {
      baseState: base,
      summary: result.summary,
      toast: { message: "Quiz moved and schedule readjusted." }
    });
    return true;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply();
  });

  openModal({
    title: "Move quiz",
    content: form,
    actions: [
      { label: "Cancel" },
      { label: "Move Quiz", variant: "primary", onClick: apply }
    ]
  });
}

function requestCancelQuiz(quizId, iso) {
  const quiz = appState.quizzes.find((item) => item.id === quizId);
  if (!quiz) {
    return;
  }
  confirmAction({
    title: "Cancel quiz?",
    message: `Cancel ${quiz.title} on ${formatLong(iso)}? The day will be reused for teaching.`,
    confirmLabel: "Cancel Quiz",
    variant: "danger",
    onConfirm: () => {
      const base = appState;
      const next = cloneState(base);
      next.quizzes = next.quizzes.filter((item) => item.id !== quiz.id);
      restoreCellAfterQuiz(next, quiz.date);
      const label = `Canceled ${quiz.title}`;
      if (!hasSchedule(base)) {
        commitState(next, label, {
          toast: { message: "Quiz canceled." }
        });
        return;
      }
      const result = rearrange(next, quiz.date, { label });
      if (!result.ok) {
        showErrorsModal("Could not readjust after canceling the quiz", result.errors);
        return;
      }
      commitState(result.state, label, {
        baseState: base,
        summary: result.summary,
        toast: { message: "Quiz canceled and schedule readjusted." }
      });
    }
  });
}

function restoreAsyncTopic(topicId) {
  const topic = getTopic(appState, topicId);
  if (!topic || topic.status !== STATUS.ASYNC) {
    return;
  }
  const base = appState;
  const restored = restoreTopic(base, topicId);
  if (!hasSchedule(base)) {
    commitState(restored, `Restored ${topic.title}`, {
      toast: { message: "Topic restored to the unscheduled queue." }
    });
    return;
  }
  const fromISO = getSuggestedRescheduleDate();
  const label = `Restored ${topic.title}`;
  const result = rearrange(restored, fromISO, { label });
  if (!result.ok) {
    showErrorsModal("Could not restore the topic", result.errors);
    return;
  }
  commitState(result.state, label, {
    baseState: base,
    summary: result.summary,
    toast: { message: "Topic restored and the remaining schedule readjusted." }
  });
}

function restoreUnscheduledTopic(topicId) {
  const topic = getTopic(appState, topicId);
  if (!topic) {
    return;
  }
  const base = appState;
  const restored = restoreTopic(base, topicId);
  if (!hasSchedule(base)) {
    commitState(restored, `Restored ${topic.title}`, {
      toast: { message: "Topic restored to the unscheduled queue." }
    });
    return;
  }
  const label = `Restored ${topic.title}`;
  const result = rearrange(restored, getSuggestedRescheduleDate(), { label });
  if (!result.ok) {
    showErrorsModal("Could not restore the topic", result.errors);
    return;
  }
  commitState(result.state, label, {
    baseState: base,
    summary: result.summary,
    toast: { message: "Topic restored and the remaining schedule readjusted." }
  });
}

function retryTopic(topicId) {
  const topic = getTopic(appState, topicId);
  if (!topic) {
    return;
  }
  const base = appState;
  const label = `Retried placement for ${topic.title}`;
  const result = rearrange(base, getSuggestedRescheduleDate(), { label });
  if (!result.ok) {
    showErrorsModal("Could not retry placement", result.errors);
    return;
  }
  commitState(result.state, label, {
    baseState: base,
    summary: result.summary,
    toast: { message: "Remaining schedule readjusted." }
  });
}

function convertTopicAsync(topicId) {
  const topic = getTopic(appState, topicId);
  if (!topic) {
    return;
  }
  const next = convertTopicToAsync(appState, topicId);
  commitState(next, `Converted ${topic.title} to async`, {
    toast: { message: "Topic converted to asynchronous work." }
  });
}

function requestDropTopic(topicId) {
  const topic = getTopic(appState, topicId);
  if (!topic) {
    return;
  }
  confirmAction({
    title: "Drop topic?",
    message: `Drop "${topic.title}" from the semester? It will leave the schedule and any dependent topics may need attention.`,
    confirmLabel: "Drop Topic",
    variant: "danger",
    onConfirm: () => {
      const next = dropTopic(appState, topicId);
      commitState(next, `Dropped ${topic.title}`, {
        toast: { message: "Topic dropped. Use Reschedule Remaining to fill gaps." }
      });
    }
  });
}

function generateNow() {
  if (!appState.topics.length) {
    showErrorsModal("Cannot generate schedule", ["Add at least one topic first."]);
    return;
  }
  const result = generateSchedule(appState);
  if (!result.ok) {
    showErrorsModal("Cannot generate schedule", result.errors);
    return;
  }
  appState = result.state;
  appState.history = [];
  scheduleStale = false;
  currentView = "calendar";
  calendarMode = "month";
  const today = todayISO();
  cursorISO = isInSemester(appState, today)
    ? startOfMonth(today)
    : startOfMonth(appState.semester.startDate);
  persistBaseline();
  closeDayPopover();
  closeModal();
  hideChangeSummary();
  renderAll();
  const summary = summarizeGeneration(appState);
  const extras = [];
  if (summary.partial) {
    extras.push(`${summary.partial} partial`);
  }
  if (summary.async) {
    extras.push(`${summary.async} async`);
  }
  if (summary.unscheduled) {
    extras.push(`${summary.unscheduled} needing attention`);
  }
  if (result.quizMoves.length) {
    extras.push(
      `${result.quizMoves.length} quiz date${result.quizMoves.length === 1 ? "" : "s"} adjusted`
    );
  }
  const remainingCoverage = getQuizCoverageWarnings(appState).length;
  if (remainingCoverage) {
    extras.push(`${remainingCoverage} quiz coverage warning${remainingCoverage === 1 ? "" : "s"}`);
  }
  showToast(
    `Schedule generated: ${summary.scheduled} scheduled${extras.length ? `, ${extras.join(", ")}` : ""}.`,
    extras.length ? "warning" : "success"
  );
}

function requestGenerate() {
  if (hasUnsavedTopicDrafts()) {
    showToast("Save or revert the topic rows before generating.", "warning");
    return;
  }
  const run = () => generateNow();
  if (isDirty()) {
    confirmAction({
      title: "Regenerate schedule?",
      message: "Generating a new schedule will replace the current calendar and discard unsaved calendar changes.",
      confirmLabel: "Generate Schedule",
      onConfirm: run
    });
    return;
  }
  run();
}

function loadDemoNow() {
  appState = createDemoState();
  appState.history = [];
  scheduleStale = false;
  currentView = "setup";
  calendarMode = "month";
  cursorISO = startOfMonth(appState.semester.startDate);
  persistBaseline();
  closeDayPopover();
  closeModal();
  hideChangeSummary();
  renderAll();
  showToast("Demo semester loaded. Review the setup and generate the schedule.", "success");
}

function requestLoadDemo() {
  if (hasUnsavedTopicDrafts()) {
    showToast("Save or revert the topic rows before loading the demo.", "warning");
    return;
  }
  if (isDirty()) {
    confirmAction({
      title: "Load demo?",
      message: "Loading the demo semester will discard unsaved calendar changes.",
      confirmLabel: "Load Demo",
      onConfirm: loadDemoNow
    });
    return;
  }
  loadDemoNow();
}

function resetNow() {
  appState = createEmptyState();
  appState.history = [];
  scheduleStale = false;
  currentView = "setup";
  calendarMode = "month";
  cursorISO = startOfMonth(todayISO());
  persistBaseline();
  closeDayPopover();
  closeModal();
  hideChangeSummary();
  renderAll();
  showToast("Workspace reset.", "success");
}

function requestReset() {
  if (hasUnsavedTopicDrafts()) {
    showToast("Save or revert the topic rows before resetting.", "warning");
    return;
  }
  confirmAction({
    title: "Reset workspace?",
    message: "This clears the current setup and schedule from this browser. The demo data is still available from Load Demo.",
    confirmLabel: "Reset",
    variant: "danger",
    onConfirm: resetNow
  });
}

function handleSetupClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }
  const action = button.dataset.action;
  const guardedActions = new Set([
    "load-demo",
    "add-quiz",
    "edit-quiz",
    "delete-quiz",
    "generate"
  ]);
  if (guardedActions.has(action) && hasUnsavedTopicDrafts()) {
    showToast("Save or revert the topic rows before continuing.", "warning");
    return;
  }
  if (action === "revert-topic-rows") {
    renderSetup();
    showToast("Unsaved topic row changes reverted.");
  } else if (action === "load-demo") {
    requestLoadDemo();
  } else if (action === "add-topic-row") {
    addTopicRow();
  } else if (action === "save-topics") {
    saveTopicDrafts();
  } else if (action === "remove-topic-row") {
    const row = button.closest("[data-topic-row]");
    const rows = setupView.querySelector("[data-topic-rows]");
    row?.remove();
    if (rows && !rows.querySelector("[data-topic-row]")) {
      rows.innerHTML = `<div class="empty-row" data-topic-empty>No topics yet. Add a row, enter the estimated hours, and save the batch.</div>`;
    }
  } else if (action === "add-quiz") {
    openQuizModal();
  } else if (action === "edit-quiz") {
    openQuizModal(button.dataset.quizId);
  } else if (action === "review-quiz-coverage") {
    const warnings = getQuizCoverageWarnings(appState, [button.dataset.quizId]);
    if (warnings.length) {
      openQuizCoverageReview(warnings);
    }
  } else if (action === "delete-quiz") {
    requestDeleteQuiz(button.dataset.quizId);
  } else if (action === "generate") {
    requestGenerate();
  }
}

function bindEvents() {
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  setupView.addEventListener("click", handleSetupClick);
  setupView.addEventListener("change", (event) => {
    if (event.target.dataset.topicDep) {
      const details = event.target.closest("details");
      if (details) {
        const count = details.querySelectorAll("[data-topic-dep]:checked").length;
        const summary = details.querySelector("summary");
        if (summary) {
          summary.textContent = count
            ? `${count} prerequisite${count === 1 ? "" : "s"}`
            : "No prerequisites";
        }
      }
      return;
    }
    if (
      event.target.dataset.field ||
      event.target.dataset.classDay ||
      event.target.dataset.classTime
    ) {
      handleSetupChange(event);
    }
  });

  undoButton.addEventListener("click", undoLastChange);
  discardButton.addEventListener("click", discardChanges);
  acceptButton.addEventListener("click", acceptChanges);
  demoButton.addEventListener("click", requestLoadDemo);
  resetButton.addEventListener("click", requestReset);

  summaryRoot.addEventListener("click", (event) => {
    const button = event.target.closest("[data-summary-action]");
    if (!button) {
      return;
    }
    if (button.dataset.summaryAction === "undo") {
      undoLastChange();
    } else if (button.dataset.summaryAction === "accept") {
      acceptChanges();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (isDirty() || hasUnsavedTopicDrafts()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

function init() {
  const loaded = loadState();
  appState = loaded ? normalizeState(loaded) : createEmptyState();
  if (loaded && hasOutOfSemesterWork(appState)) {
    const repaired = reconcileSemesterDates(
      appState,
      appState.semester.startDate,
      appState.semester.endDate,
      { label: "Restored semester boundary" }
    );
    if (repaired.ok) {
      appState = repaired.state;
      saveState(appState);
      showToast("Schedule adjusted to the semester boundary.", "warning");
    } else {
      showToast(
        repaired.errors[0] || "Some work falls outside the semester and needs attention.",
        "danger"
      );
    }
  }
  savedState = cloneState(appState);
  currentView = appState.topics.length && hasSchedule(appState) ? "calendar" : "setup";
  const today = todayISO();
  cursorISO = isInSemester(appState, today)
    ? startOfMonth(today)
    : startOfMonth(appState.semester.startDate);
  bindEvents();
  if (!hasLocalStorage() && !storageWarningShown) {
    storageWarningShown = true;
    showToast("Browser storage is unavailable. Changes will last only until this tab closes.", "danger");
  }
  renderAll();
}

init();
