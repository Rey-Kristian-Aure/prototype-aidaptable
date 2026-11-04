import {
  formatHours,
  formatLong,
  formatMinutes,
  formatShort,
  hoursToMinutes
} from "./dates.js";
import {
  getCalendarCell,
  getCellAllocatedMinutes,
  getCellAllocationDetails,
  getMeetingMinutes,
  getMeetingTimeRange,
  getQuizForDate,
  getRemainingMinutes,
  getTopic,
  isClassWeekday,
  isInSemester,
  isSuspendedCell,
  STATUS
} from "./models.js";
import { getQuizCoverage } from "./quiz-coverage.js";
import { escapeHTML } from "./calendar.js";

let popoverCleanup = null;
let modalVersion = 0;

export function closeDayPopover() {
  if (popoverCleanup) {
    popoverCleanup();
    popoverCleanup = null;
  }
}

function topicRow(state, topic, allocation) {
  const time = allocation.timeRange ? ` · ${allocation.timeRange}` : "";
  return `
    <div class="day-topic-row">
      <div class="info">
        <strong>${escapeHTML(topic.title)}</strong>
        <small>Priority ${topic.priority} · ${formatMinutes(allocation.minutes)}${escapeHTML(time)}</small>
      </div>
      <button class="icon-button" type="button" data-remove-topic="${topic.id}" aria-label="Remove ${escapeHTML(topic.title)} from this day onward">×</button>
    </div>
  `;
}

export function openDayPopover({ state, iso, anchor, handlers = {} }) {
  closeDayPopover();
  const root = document.getElementById("popover-root");
  if (!root) {
    return;
  }

  const cell = getCalendarCell(state, iso);
  const quiz = getQuizForDate(state, iso);
  const quizCoverage = quiz ? getQuizCoverage(state, quiz) : null;
  const suspended = isSuspendedCell(cell);
  const inSemester = isInSemester(state, iso);
  const classDay = isClassWeekday(state, iso);
  const allocations = getCellAllocationDetails(state, cell)
    .map((allocation) => ({
      allocation,
      topic: getTopic(state, allocation.topicId)
    }))
    .filter((entry) => entry.topic);
  const meetingMinutes = getMeetingMinutes(state, iso);
  const allocatedMinutes = getCellAllocatedMinutes(cell);
  const availableMinutes = Math.max(0, meetingMinutes - allocatedMinutes);
  const canAdd =
    inSemester && classDay && !quiz && !suspended && availableMinutes > 0;
  const eligibleTopics = canAdd
    ? state.topics.filter(
        (topic) =>
          topic.status !== STATUS.ASYNC &&
          topic.status !== STATUS.DROPPED &&
          getRemainingMinutes(state, topic) > 0
      )
    : [];
  const meetingRange = inSemester && classDay ? getMeetingTimeRange(state, iso) : "";

  const flags = [];
  if (!inSemester) {
    flags.push(`<span class="chip suspended">Outside semester</span>`);
  } else if (!classDay) {
    flags.push(`<span class="chip">No class</span>`);
  } else {
    flags.push(`<span class="chip class">Class day</span>`);
  }
  if (meetingRange && !suspended) {
    flags.push(`<span class="chip">${escapeHTML(meetingRange)}</span>`);
  }
  if (quiz) {
    flags.push(`<span class="chip quiz">Quiz: ${escapeHTML(quiz.title)}</span>`);
  }
  if (suspended) {
    flags.push(`<span class="chip suspended">Suspended</span>`);
  }

  const noteText = cell?.note && !quiz ? cell.note : "";
  const topicMarkup = allocations.length
    ? allocations
        .map(({ topic, allocation }) => topicRow(state, topic, allocation))
        .join("")
    : `<p class="subtle-copy">No topics are assigned to this day.</p>`;

  let addMarkup = "";
  if (inSemester && classDay && !quiz && !suspended) {
    if (!availableMinutes) {
      addMarkup = `<p class="subtle-copy">This day is full. Remove time from a topic before adding more.</p>`;
    } else if (eligibleTopics.length) {
      addMarkup = `
        <div class="add-topic-box">
          <span class="section-label">Add class time</span>
          <div class="add-topic-grid">
            <label class="form-field" for="popover-add-topic">
              <span class="field-label">Topic</span>
              <select id="popover-add-topic" data-add-topic>
                <option value="">Choose a topic…</option>
                ${eligibleTopics
                  .map(
                    (topic) =>
                      `<option value="${topic.id}" data-remaining="${getRemainingMinutes(state, topic)}">${escapeHTML(topic.title)} · ${formatHours(getRemainingMinutes(state, topic) / 60)} left</option>`
                  )
                  .join("")}
              </select>
            </label>
            <label class="form-field" for="popover-add-hours">
              <span class="field-label">Hours</span>
              <input id="popover-add-hours" data-add-hours type="number" min="0.25" step="0.25" value="1" />
            </label>
          </div>
          <p class="field-help">${escapeHTML(formatMinutes(availableMinutes))} available on this day. Adding time is an unsaved calendar change.</p>
          <p class="field-error" data-add-error hidden></p>
          <button class="btn small primary" type="button" data-add-time>Add time</button>
        </div>
      `;
    } else {
      addMarkup = `<p class="subtle-copy">No other topics need class time.</p>`;
    }
  }

  const actions = [];
  if (inSemester) {
    if (suspended) {
      actions.push(
        `<button class="btn small" type="button" data-pop-action="restore-suspension">Remove suspension</button>`
      );
    } else if (classDay) {
      actions.push(
        `<button class="btn small" type="button" data-pop-action="suspend">Suspend this day…</button>`
      );
    }
    if (quiz) {
      if (quizCoverage?.warnings.length) {
        actions.push(
          `<button class="btn small" type="button" data-pop-action="review-quiz-coverage" data-quiz-id="${quiz.id}">Review coverage…</button>`
        );
      }
      actions.push(
        `<button class="btn small subtle" type="button" data-pop-action="move-quiz" data-quiz-id="${quiz.id}">Move quiz…</button>`,
        `<button class="btn small ghost" type="button" data-pop-action="cancel-quiz" data-quiz-id="${quiz.id}">Cancel quiz</button>`
      );
    }
  }

  const rootElement = document.createElement("div");
  rootElement.innerHTML = `
    <div class="popover-backdrop" data-popover-close></div>
    <section class="day-popover" role="dialog" aria-modal="true" aria-label="Day details">
      <header class="popover-header">
        <div>
          <h2>${escapeHTML(formatLong(iso))}</h2>
          <p>${escapeHTML(formatShort(iso))}${allocations.length ? ` · ${formatMinutes(allocatedMinutes)} scheduled across ${allocations.length} topic${allocations.length === 1 ? "" : "s"}` : ""}</p>
        </div>
        <button class="icon-button" type="button" data-popover-close aria-label="Close day details">×</button>
      </header>
      <div class="popover-body">
        <div class="chip-row">${flags.join("")}</div>
        ${noteText ? `<div class="notice"><span>${escapeHTML(noteText)}</span></div>` : ""}
        ${suspended && quiz ? `<div class="notice info">The quiz was intentionally kept on this suspended day. It still has no class-time cost.</div>` : ""}
        ${
          quizCoverage?.warnings.length
            ? `<div class="notice warning">
                <div>
                  <strong>Quiz coverage warning</strong>
                  <ul class="coverage-warning-list">
                    ${quizCoverage.warnings
                      .map(
                        (warning) =>
                          `<li><strong>${escapeHTML(warning.title)}</strong>: ${escapeHTML(formatMinutes(warning.scheduledBeforeMinutes))} of ${escapeHTML(formatMinutes(warning.estimatedMinutes))} before quiz</li>`
                      )
                      .join("")}
                  </ul>
                </div>
              </div>`
            : ""
        }
        <div>
          <span class="section-label">Scheduled topics</span>
          <div class="day-topic-list">${topicMarkup}</div>
        </div>
        ${addMarkup}
      </div>
      ${
        actions.length
          ? `<div class="popover-actions">${actions.join("")}</div>`
          : ""
      }
    </section>
  `;

  const backdrop = rootElement.querySelector(".popover-backdrop");
  const panel = rootElement.querySelector(".day-popover");
  root.replaceChildren(backdrop, panel);

  const panelWidth = panel.offsetWidth || 390;
  const panelHeight = Math.min(panel.offsetHeight || 420, window.innerHeight - 24);
  const rect = anchor.getBoundingClientRect();
  const margin = 12;
  let left = rect.right + 10;
  if (left + panelWidth > window.innerWidth - margin) {
    left = rect.left - panelWidth - 10;
  }
  if (left < margin) {
    left = Math.max(margin, Math.min(rect.left, window.innerWidth - panelWidth - margin));
  }
  let top = rect.top;
  if (top + panelHeight > window.innerHeight - margin) {
    top = window.innerHeight - panelHeight - margin;
  }
  top = Math.max(margin, top);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      closeDayPopover();
    }
  };
  const onViewportChange = () => closeDayPopover();
  const onScroll = (event) => {
    if (event.target === document || event.target === document.documentElement) {
      closeDayPopover();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onScroll, true);

  popoverCleanup = () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onScroll, true);
    root.replaceChildren();
  };

  root.querySelectorAll("[data-popover-close]").forEach((button) => {
    button.addEventListener("click", closeDayPopover);
  });

  root.querySelectorAll("[data-remove-topic]").forEach((button) => {
    button.addEventListener("click", () => {
      const topicId = button.dataset.removeTopic;
      closeDayPopover();
      handlers.onRemoveTopic?.(iso, topicId);
    });
  });

  const addSelect = root.querySelector("[data-add-topic]");
  const addHours = root.querySelector("[data-add-hours]");
  const addButton = root.querySelector("[data-add-time]");
  if (addSelect && addHours && addButton) {
    const error = root.querySelector("[data-add-error]");
    const selectedRemaining = () => {
      const option = addSelect.selectedOptions[0];
      return Number(option?.dataset.remaining) || 0;
    };
    const showError = (message) => {
      error.textContent = message;
      error.hidden = false;
    };
    addSelect.addEventListener("change", () => {
      error.hidden = true;
      const remaining = selectedRemaining();
      if (remaining > 0) {
        addHours.max = String(Math.floor(remaining / 15) / 4);
      }
    });
    addButton.addEventListener("click", () => {
      const topicId = addSelect.value;
      if (!topicId) {
        showError("Choose a topic first.");
        return;
      }
      const requested = hoursToMinutes(Number(addHours.value));
      const remaining = selectedRemaining();
      const minutes = Math.min(requested, remaining, availableMinutes);
      if (!Number.isFinite(requested) || requested < 15) {
        showError("Enter at least 0.25 hours.");
        return;
      }
      if (minutes < 15) {
        showError("There is not enough time or topic work left.");
        return;
      }
      closeDayPopover();
      handlers.onAddTopic?.(iso, topicId, minutes);
    });
  }

  root.querySelectorAll("[data-pop-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.popAction;
      closeDayPopover();
      if (action === "suspend") {
        handlers.onSuspendDay?.(iso);
      } else if (action === "restore-suspension") {
        handlers.onRemoveSuspension?.(iso);
      } else if (action === "move-quiz") {
        handlers.onMoveQuiz?.(button.dataset.quizId, iso);
      } else if (action === "review-quiz-coverage") {
        handlers.onReviewQuizCoverage?.(button.dataset.quizId);
      } else if (action === "cancel-quiz") {
        handlers.onCancelQuiz?.(button.dataset.quizId, iso);
      }
    });
  });
}

export function closeModal() {
  const dialog = document.getElementById("app-modal");
  if (dialog?.open) {
    dialog.close();
  }
}

export function openModal({ title, content, actions = [], onMount }) {
  const dialog = document.getElementById("app-modal");
  const titleElement = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");
  const actionsElement = document.getElementById("modal-actions");
  const closeButton = document.getElementById("modal-close");
  if (!dialog || !titleElement || !body || !actionsElement || !closeButton) {
    return;
  }

  const version = ++modalVersion;
  titleElement.textContent = title;
  body.replaceChildren();
  if (typeof content === "string") {
    body.innerHTML = content;
  } else if (content instanceof Node) {
    body.appendChild(content);
  }

  actionsElement.replaceChildren();
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn ${action.variant || ""}`.trim();
    button.textContent = action.label;
    if (action.disabled) {
      button.disabled = true;
    }
    button.addEventListener("click", (event) => {
      let shouldClose = true;
      if (action.onClick) {
        const result = action.onClick(event, { close: closeModal, body, dialog });
        if (result === false) {
          shouldClose = false;
        }
      }
      if (shouldClose && action.closeOnClick !== false && version === modalVersion) {
        closeModal();
      }
    });
    actionsElement.appendChild(button);
  }

  closeButton.onclick = closeModal;
  dialog.oncancel = null;
  if (!dialog.open) {
    dialog.showModal();
  }
  onMount?.({ body, actions: actionsElement, dialog, close: closeModal });
}
