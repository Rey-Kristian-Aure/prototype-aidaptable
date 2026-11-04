import {
  formatHours,
  formatMinutes,
  formatShort,
  formatWithYear,
  monthGrid,
  monthLabel,
  parseISO,
  startOfMonth,
  todayISO,
  weekDates,
  weekLabel
} from "./dates.js";
import {
  getCalendarCell,
  getCellAllocatedMinutes,
  getCellAllocationDetails,
  getMeetingTimeRange,
  getQuizForDate,
  getTopic,
  isClassWeekday,
  isInSemester,
  isSuspendedCell,
  STATUS
} from "./models.js";
import { getQuizCoverage } from "./quiz-coverage.js";

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function classToken(value) {
  return value ? "active" : "";
}

function calendarClasses(state, iso, view, monthISO) {
  const classes = [];
  const cell = getCalendarCell(state, iso);
  const quiz = getQuizForDate(state, iso);
  const suspended = isSuspendedCell(cell);
  const classDay = isClassWeekday(state, iso);
  const inSemester = isInSemester(state, iso);

  if (view === "month" && iso.slice(0, 7) !== monthISO.slice(0, 7)) {
    classes.push("other-month");
  }
  if (!inSemester) {
    classes.push("outside-semester");
  }
  if (!classDay && !quiz) {
    classes.push("no-class");
  }
  if (quiz) {
    classes.push("quiz");
  }
  if (suspended) {
    classes.push("suspended");
  }
  if (iso === todayISO()) {
    classes.push("today");
  }
  return classes;
}

function topicPills(state, cell) {
  if (!cell || !cell.allocations.length) {
    return "";
  }
  return getCellAllocationDetails(state, cell)
    .map((allocation) => {
      const topic = getTopic(state, allocation.topicId);
      if (!topic) {
        return "";
      }
      const hours = formatMinutes(allocation.minutes);
      const time = allocation.timeRange ? `, ${allocation.timeRange}` : "";
      return `<span class="topic-pill priority-${topic.priority}" title="${escapeHTML(`${topic.title}, ${hours}${time}`)}"><span class="topic-pill-title">${escapeHTML(topic.title)}</span><span class="topic-pill-hours">${escapeHTML(hours)}</span></span>`;
    })
    .join("");
}

function attentionState(state, cell) {
  if (!cell || !cell.allocations.length) {
    return false;
  }
  return cell.allocations.some((allocation) => {
    const topic = getTopic(state, allocation.topicId);
    return (
      topic &&
      topic.status !== STATUS.SCHEDULED &&
      topic.status !== STATUS.COMPLETED
    );
  });
}

function dayAriaLabel(state, iso, cell, quiz, suspended, quizCoverage) {
  const parts = [formatWithYear(iso)];
  if (!isInSemester(state, iso)) {
    parts.push("outside the semester");
  } else if (suspended) {
    parts.push("suspended");
  } else if (quiz) {
    parts.push(quiz.title);
  } else if (isClassWeekday(state, iso)) {
    parts.push("class day");
  } else {
    parts.push("no class");
  }
  if (quizCoverage?.warnings.length) {
    parts.push(
      `${quizCoverage.warnings.length} selected quiz topic${quizCoverage.warnings.length === 1 ? "" : "s"} unfinished before the quiz`
    );
  }
  if (cell && cell.allocations.length) {
    const details = getCellAllocationDetails(state, cell)
      .map((allocation) => {
        const topic = getTopic(state, allocation.topicId);
        if (!topic) {
          return "";
        }
        return `${topic.title} ${formatMinutes(allocation.minutes)}${allocation.timeRange ? ` ${allocation.timeRange}` : ""}`;
      })
      .filter(Boolean);
    if (details.length) {
      parts.push(details.join("; "));
    }
  }
  return parts.join(". ");
}

export function renderCalendarToolbar(container, options) {
  const { state, view, cursorISO } = options;
  const label = view === "month" ? monthLabel(cursorISO) : weekLabel(cursorISO);
  container.innerHTML = `
    <div class="calendar-nav">
      <button class="icon-button" type="button" data-cal-action="prev" aria-label="Previous ${view}">‹</button>
      <button class="icon-button" type="button" data-cal-action="next" aria-label="Next ${view}">›</button>
    </div>
    <div class="calendar-title" aria-live="polite">${escapeHTML(label)}</div>
    <button class="btn small subtle" type="button" data-cal-action="today">Today</button>
    <label class="sr-only" for="calendar-jump">Jump to date</label>
    <input id="calendar-jump" class="calendar-jump" type="date" value="${escapeHTML(cursorISO)}" data-cal-action="jump" />
    <div class="segmented" role="group" aria-label="Calendar view">
      <button type="button" data-cal-action="view-month" class="${classToken(view === "month")}">Month</button>
      <button type="button" data-cal-action="view-week" class="${classToken(view === "week")}">Week</button>
    </div>
    <div class="spacer"></div>
    <button class="btn small" type="button" data-cal-action="suspend-range">Suspend Range…</button>
    <button class="btn small primary" type="button" data-cal-action="reschedule">Reschedule Remaining…</button>
  `;

  container.querySelector('[data-cal-action="prev"]').addEventListener("click", options.onPrev);
  container.querySelector('[data-cal-action="next"]').addEventListener("click", options.onNext);
  container.querySelector('[data-cal-action="today"]').addEventListener("click", options.onToday);
  container.querySelector('[data-cal-action="view-month"]').addEventListener("click", () => options.onViewChange("month"));
  container.querySelector('[data-cal-action="view-week"]').addEventListener("click", () => options.onViewChange("week"));
  container.querySelector('[data-cal-action="suspend-range"]').addEventListener("click", options.onSuspendRange);
  container.querySelector('[data-cal-action="reschedule"]').addEventListener("click", options.onReschedule);
  container.querySelector('[data-cal-action="jump"]').addEventListener("change", (event) => {
    const value = event.target.value;
    if (value) {
      options.onJumpDate(value);
    }
  });
}

export function renderCalendarLegend(container) {
  container.innerHTML = `
    <span class="legend-item"><span class="legend-swatch class"></span>Class day</span>
    <span class="legend-item"><span class="legend-swatch quiz"></span>Quiz</span>
    <span class="legend-item"><span class="legend-swatch suspended"></span>Suspended</span>
    <span class="legend-item"><span class="legend-swatch async"></span>Async topic</span>
    <span class="legend-item"><span class="legend-swatch warning"></span>Needs attention</span>
  `;
}

export function renderCalendarGrid(container, options) {
  const { state, view, cursorISO, onDayClick } = options;
  const dates = view === "month" ? monthGrid(cursorISO) : weekDates(cursorISO);
  const monthISO = startOfMonth(cursorISO);
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const cells = dates
    .map((iso) => {
      const cell = getCalendarCell(state, iso);
      const quiz = getQuizForDate(state, iso);
      const quizCoverage = quiz ? getQuizCoverage(state, quiz) : null;
      const quizWarning = Boolean(quizCoverage?.warnings.length);
      const suspended = isSuspendedCell(cell);
      const inSemester = isInSemester(state, iso);
      const otherMonth =
        view === "month" && parseISO(iso)?.getMonth() !== parseISO(monthISO)?.getMonth();
      const dateNumber = parseISO(iso)?.getDate() ?? "";
      const flags = [];
      if (quiz) {
        flags.push(`<span class="cell-flag quiz">Quiz</span>`);
      }
      if (quizWarning) {
        flags.push(`<span class="cell-flag warning">Coverage</span>`);
      }
      if (suspended) {
        flags.push(`<span class="cell-flag suspended">Suspended</span>`);
      }
      const attention = attentionState(state, cell);
      const classes = calendarClasses(state, iso, view, monthISO);
      const topicMarkup = !suspended ? topicPills(state, cell) : "";
      const quizMarkup =
        quiz && !suspended
          ? `<span class="quiz-pill${quizWarning ? " coverage-warning" : ""}" title="${escapeHTML(quizWarning ? `${quiz.title} · ${quizCoverage.warnings.length} selected topic${quizCoverage.warnings.length === 1 ? "" : "s"} unfinished before quiz` : quiz.title)}">${escapeHTML(quiz.title)}</span>`
          : "";
      const suspendedMarkup = suspended
        ? `<span class="suspended-ribbon">Suspended</span>`
        : "";
      const meetingRange =
        inSemester && isClassWeekday(state, iso) && !suspended
          ? getMeetingTimeRange(state, iso)
          : "";
      const allocatedMinutes = getCellAllocatedMinutes(cell);
      const totalLabel =
        allocatedMinutes > 0 && !suspended
          ? `<span class="cell-total">${escapeHTML(formatMinutes(allocatedMinutes))}</span>`
          : "";
      const openLabel =
        inSemester &&
        isClassWeekday(state, iso) &&
        !quiz &&
        !suspended &&
        !allocatedMinutes
          ? `<span class="empty-cell-label">Open${meetingRange ? ` · ${escapeHTML(meetingRange)}` : ""}</span>`
          : "";
      const monthMarkup = otherMonth
        ? `<span class="date-month">${escapeHTML(formatShort(iso).split(" ")[0])}</span>`
        : "";
      const dotMarkup = attention
        ? `<span class="attention-dot" title="Topic needs attention"></span>`
        : "";
      const inner = `
        <span class="date-line">
          <span class="date-number">${dateNumber}</span>
          <span class="cell-flags">${flags.join("")}${monthMarkup}${dotMarkup}${totalLabel}</span>
        </span>
        ${meetingRange ? `<span class="cell-time">${escapeHTML(meetingRange)}</span>` : ""}
        ${suspendedMarkup}
        <span class="topic-list">${quizMarkup}${topicMarkup}</span>
        ${openLabel}
      `;
      if (!inSemester) {
        return `<div class="calendar-day ${classes.join(" ")}" aria-label="${escapeHTML(dayAriaLabel(state, iso, cell, quiz, suspended, quizCoverage))}">${inner}</div>`;
      }
      return `<button type="button" class="calendar-day ${classes.join(" ")}" data-date="${iso}" aria-label="${escapeHTML(dayAriaLabel(state, iso, cell, quiz, suspended, quizCoverage))}">${inner}</button>`;
    })
    .join("");

  container.innerHTML = `
    <div class="calendar-weekdays">
      ${weekdays.map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="calendar-days ${view}">
      ${cells}
    </div>
  `;

  container.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("click", () => onDayClick(button.dataset.date, button));
  });
}

export function renderAsyncSidebar(container, options) {
  const { state, onRestore, onDrop } = options;
  const asyncTopics = state.topics.filter((topic) => topic.status === STATUS.ASYNC);
  const cards = asyncTopics
    .map(
      (topic) => `
        <article class="async-card" data-async-topic="${topic.id}">
          <div class="async-card-top">
            <div>
              <h3>${escapeHTML(topic.title)}</h3>
              <p>Priority ${topic.priority} · ${formatHours(topic.estimatedHours)} estimated</p>
            </div>
            <span class="status-badge async">Async</span>
          </div>
          <p>${escapeHTML(topic.asyncReason || "Converted to asynchronous work")}</p>
          <div class="row">
            <button class="btn small primary" type="button" data-async-action="restore" data-topic-id="${topic.id}">Restore &amp; readjust</button>
            <button class="btn small ghost" type="button" data-async-action="drop" data-topic-id="${topic.id}">Drop</button>
          </div>
        </article>
      `
    )
    .join("");

  container.innerHTML = `
    <div class="sidebar-title">
      <div>
        <h2>Asynchronous work</h2>
        <p class="small muted">Sticky until restored</p>
      </div>
      <span class="count-badge">${asyncTopics.length}</span>
    </div>
    <p class="async-intro">These topics no longer consume class time. Restore one when you want the scheduler to try placing it again.</p>
    ${
      cards
        ? cards
        : `<div class="async-empty">No asynchronous topics. Everything has room on the calendar.</div>`
    }
  `;

  container.querySelectorAll("[data-async-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const topicId = button.dataset.topicId;
      if (button.dataset.asyncAction === "restore") {
        onRestore(topicId);
      } else {
        onDrop(topicId);
      }
    });
  });
}
