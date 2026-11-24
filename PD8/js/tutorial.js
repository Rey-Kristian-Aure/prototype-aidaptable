const CARD_GAP = 16;
const VIEWPORT_MARGIN = 12;
const TASK_POLL_MS = 250;
const AUTO_ADVANCE_MS = 900;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function calendarDay(iso) {
  return document.querySelector(`#calendar-grid [data-date="${iso}"]`);
}

function calendarGridMode() {
  const grid = document.querySelector("#calendar-grid .calendar-days");
  if (!grid) {
    return "";
  }
  if (grid.classList.contains("week")) {
    return "week";
  }
  if (grid.classList.contains("month")) {
    return "month";
  }
  return "";
}

function hasChangeSummary() {
  return Boolean(document.querySelector("#change-summary-root .change-summary"));
}

function quizBinWizardOpen() {
  return Boolean(document.querySelector("#quiz-bin-view [data-qb-wizard]"));
}

function quizBinReportVisible() {
  return (
    Boolean(document.querySelector("#quiz-bin-view .qb-detail-head")) &&
    !quizBinWizardOpen()
  );
}

function activeQuizBinTab() {
  const tab = document.querySelector("#quiz-bin-view .qb-tab.active");
  return tab ? tab.textContent.trim() : "";
}

export const TUTORIAL_STEPS = Object.freeze([
  {
    id: "welcome",
    title: "Welcome to the guided demo",
    body: "This tour is hands-on. You will edit the setup, generate a schedule, act on a calendar day, and import a sample CSV into Quiz Bin. It all runs on a temporary copy of a semester, so your real workspace and saved data stay untouched. The card tells you what to do and marks each task done when it detects the change. Use Next, Back, Skip tour, or Exit at any time.",
    placement: "center",
    nextLabel: "Start tour"
  },
  {
    id: "workspaces",
    title: "Three connected workspaces",
    body: "Setup is where you define the semester, topics, and quizzes. Calendar turns those rules into a teaching plan. Quiz Bin turns Google Forms CSV exports into class insights. The tabs at the top switch between them; the tour switches for you as it moves.",
    view: "setup",
    target: ".view-tabs",
    shape: "pill",
    padding: 7,
    placement: "below"
  },
  {
    id: "semester",
    title: "Set the rules for the semester",
    body: "Start and end dates are hard boundaries. Class days and their time windows decide how much teaching time exists. The low-priority threshold controls when a topic with no room becomes asynchronous instead of unscheduled. This demo uses Mon/Wed/Fri, 9:00–12:00, with one suspended day.",
    view: "setup",
    target: '#setup-view [data-tutorial="semester"] .card-header',
    shape: "rect",
    padding: 10,
    placement: "below"
  },
  {
    id: "topics-edit",
    title: "Edit a topic, then save the batch",
    body: "Topic rows are edited together. Change the Fractions estimate from 24 hours to 21 hours and save the batch. The setup auto-saves in normal use; in this tour it only changes the temporary copy. Saving also marks the generated schedule stale, so the next step regenerates it.",
    view: "setup",
    target: () =>
      document.querySelector(
        '[data-topic-row][data-topic-id="t2"] [data-topic-field="hours"]'
      ),
    shape: "rect",
    padding: 8,
    placement: "left",
    interactive: true,
    task: {
      instruction: "Set Fractions to 21 hours, then click Save Topic Changes.",
      hint: "Find the Fractions row under Topics, change its Hours field to 21, then click Save Topic Changes in that card's header.",
      isComplete: ({ state }) =>
        state?.topics?.find((topic) => topic.id === "t2")?.estimatedHours === 21
    }
  },
  {
    id: "quizzes",
    title: "Reserve quiz days and track coverage",
    body: "A quiz reserves a class day and records which topics it covers. If those topics are not fully scheduled before the quiz date, the app warns you and can move the quiz automatically. This demo has Checkpoint 1 on October 2 and Checkpoint 2 on November 6.",
    view: "setup",
    target: '#setup-view [data-tutorial="quizzes"] .card-header',
    shape: "rect",
    padding: 10,
    placement: "below"
  },
  {
    id: "generate",
    title: "Generate the schedule",
    body: "Generate Schedule uses dependency order, quiz deadlines, priority, and 30-minute floors to place every topic. It also saves the setup and opens Calendar. Here the result stays temporary. Click the button and the tour will continue on the calendar.",
    view: "setup",
    target: '#setup-view [data-tutorial="generate"]',
    shape: "pill",
    padding: 8,
    placement: "above",
    interactive: true,
    task: {
      instruction: "Click Generate Schedule.",
      hint: "The button is in the Schedule card at the bottom of Setup.",
      isComplete: () =>
        !document.getElementById("calendar-view")?.classList.contains("hidden"),
      autoAdvance: true
    }
  },
  {
    id: "calendar-toolbar",
    title: "Navigate the calendar",
    body: "The toolbar moves between months and weeks, jumps to a date, and switches views. Try it now: click Week, then click Month. Suspend Range blocks out lost class time and reflows the affected work. Reschedule Remaining retries unfinished topics from a date you choose.",
    view: "calendar",
    target: "#calendar-toolbar .segmented",
    shape: "pill",
    padding: 6,
    placement: "below",
    interactive: true,
    task: {
      instruction: "Switch to Week view, then back to Month view.",
      hint: "Use the Month and Week buttons in the calendar toolbar.",
      onEvent: ({ event, context }) => {
        const action = event.target
          ?.closest?.("[data-cal-action]")
          ?.getAttribute("data-cal-action");
        if (action === "view-week") {
          context.sawWeek = true;
        }
      },
      isComplete: ({ context }) => {
        const mode = calendarGridMode();
        if (mode === "week") {
          context.sawWeek = true;
        }
        return context.sawWeek === true && mode === "month";
      }
    }
  },
  {
    id: "calendar-day",
    title: "Act on a calendar day",
    body: "November 30 is suspended for Bonifacio Day. Open that day and choose Remove suspension. The scheduler will reflow the remaining work immediately. This is a real calendar change, but it only touches the temporary tour copy.",
    view: "calendar",
    target: () =>
      document.querySelector("#popover-root .day-popover") ||
      calendarDay("2026-11-30"),
    shape: "rect",
    padding: 6,
    placement: "auto",
    interactive: true,
    task: {
      instruction: "Open November 30, then choose Remove suspension.",
      hint: "Click the highlighted November 30 cell, then use the Remove suspension button in the day panel.",
      isComplete: ({ state }) => {
        const cell = state?.calendar?.find(
          (entry) => entry.date === "2026-11-30"
        );
        return Boolean(cell) && !cell.suspended;
      }
    }
  },
  {
    id: "calendar-summary",
    title: "Review the change summary",
    body: "Calendar edits stay pending until you accept them. This panel lists what the reflow moved, completed, or adjusted. Click Accept & Save to keep the change for the rest of the tour, or Undo Changes to roll it back. Either choice closes the panel so the tour can continue.",
    view: "calendar",
    target: "#change-summary-root .change-summary",
    shape: "rect",
    padding: 8,
    placement: "left",
    interactive: true,
    task: {
      instruction: "Click Accept & Save or Undo Changes.",
      hint: "Use the buttons at the bottom of the change summary panel.",
      isComplete: () => !hasChangeSummary()
    }
  },
  {
    id: "async-sidebar",
    title: "Keep an eye on asynchronous work",
    body: "When class time runs out, low-priority topics can become asynchronous instead of silently disappearing. They stay here until you restore them and readjust, or drop them. This demo fits every topic, so the panel is empty on purpose.",
    view: "calendar",
    target: "#async-sidebar .async-intro",
    shape: "rect",
    padding: 10,
    placement: "left"
  },
  {
    id: "header-actions",
    title: "Save, undo, and start over",
    body: "Undo restores the previous change, Discard returns to the last accepted state, and Accept & Save commits pending calendar edits. The header is paused during the tour so the tour can restore your workspace. Load Demo still loads the built-in demo semester; Guided Demo is this separate tour.",
    view: "calendar",
    target: ".header-actions",
    shape: "rect",
    padding: 8,
    placement: "below"
  },
  {
    id: "quiz-bin-import",
    title: "Import a real CSV into Quiz Bin",
    body: "Quiz Bin reads the CSV from a Google Forms response sheet. Click Import CSV to choose a file, or use the sample on this card. The sample matches Checkpoint 1: six anonymous responses, three questions, and a known answer key. The import runs through the real wizard; only persistence is disabled.",
    view: "quiz-bin",
    target: '#quiz-bin-view [data-qb-action="upload"]',
    shape: "pill",
    padding: 7,
    placement: "below",
    interactive: true,
    action: {
      id: "use-sample-csv",
      label: "Use sample CSV"
    },
    download: {
      href: "examples/checkpoint-1-responses.csv",
      label: "Download sample CSV"
    },
    task: {
      instruction: "Open the import wizard with your CSV or the sample.",
      hint: "Click Import CSV in the Quiz Bin header, or use the Use sample CSV button on this card.",
      isComplete: () => quizBinWizardOpen() || quizBinReportVisible(),
      autoAdvance: true
    }
  },
  {
    id: "quiz-bin-wizard",
    title: "Check what was detected",
    body: "The wizard pairs each question with its score column, infers the answer key from full-credit responses, ignores names and emails, and links the import to Checkpoint 1. Review the chips and warnings, then import the responses.",
    view: "quiz-bin",
    target:
      '#quiz-bin-view .qb-wizard-actions [data-qb-action="wizard-import"]',
    shape: "pill",
    padding: 7,
    placement: "above",
    interactive: true,
    task: {
      instruction: "Review the detected questions, then click the import button.",
      hint: "The import button is at the bottom of the import check.",
      isComplete: () => quizBinReportVisible(),
      autoAdvance: true
    }
  },
  {
    id: "quiz-bin-report",
    title: "Read the class report",
    body: "The temporary report shows the class average, pass rate, score distribution, frequently missed questions, and the responses that need attention. Correct answers were inferred from full-credit responses, and names and emails were dropped. Everything stays in this browser.",
    view: "quiz-bin",
    target: "#quiz-bin-view .qb-detail-head .card-header",
    shape: "rect",
    padding: 10,
    placement: "below"
  },
  {
    id: "quiz-bin-tabs",
    title: "Explore the report",
    body: "Overview summarizes the class. Questions shows answer distributions and the inferred key. Responses lists anonymous scores with a detail drawer. Import notes explains warnings and grading mode, and Export downloads the report data. Open Questions to see the question-level view.",
    view: "quiz-bin",
    target: "#quiz-bin-view .qb-tabs",
    shape: "pill",
    padding: 6,
    placement: "below",
    interactive: true,
    task: {
      instruction: "Open the Questions tab.",
      hint: "Click Questions in the report tabs.",
      isComplete: () => activeQuizBinTab() === "Questions"
    }
  },
  {
    id: "finish",
    title: "You have seen the whole loop",
    body: "You edited setup, regenerated the schedule, changed a calendar day, reviewed the reflow, and imported a CSV into Quiz Bin. Finish the tour to return to your own workspace exactly as you left it. Nothing from this tour was saved.",
    placement: "center",
    nextLabel: "Finish tour"
  }
]);

function resolveTarget(step) {
  if (!step.target) {
    return null;
  }
  if (typeof step.target === "function") {
    try {
      return step.target();
    } catch {
      return null;
    }
  }
  return document.querySelector(step.target);
}

function buildMarkup(steps) {
  return `
    <div class="tutorial-scrim" data-tutorial-scrim></div>
    <div class="tutorial-spotlight hidden" data-tutorial-spotlight></div>
    <section
      class="tutorial-card"
      data-tutorial-card
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      tabindex="-1"
    >
      <div class="tutorial-topline">
        <span class="tutorial-kicker">Guided demo</span>
        <span class="tutorial-temp">Temporary</span>
        <span class="tutorial-counter" data-tutorial-counter></span>
        <button
          class="tutorial-exit"
          type="button"
          data-tutorial-action="exit"
          aria-label="Exit guided demo"
        >Exit</button>
      </div>
      <h2 id="tutorial-title" data-tutorial-title></h2>
      <p class="tutorial-body" data-tutorial-body></p>
      <div class="tutorial-task" data-tutorial-task hidden>
        <div class="tutorial-task-head">
          <span class="tutorial-task-kicker">Your turn</span>
          <span
            class="tutorial-task-state"
            data-tutorial-task-state
            aria-live="polite"
          >Waiting</span>
        </div>
        <p class="tutorial-task-text" data-tutorial-task-text></p>
        <p class="tutorial-task-hint" data-tutorial-task-hint hidden></p>
        <div class="tutorial-task-actions" data-tutorial-task-actions hidden>
          <button
            class="btn small subtle"
            type="button"
            data-tutorial-task-button
          ></button>
          <a class="tutorial-task-download" data-tutorial-download download hidden></a>
        </div>
      </div>
      <div class="tutorial-progress" data-tutorial-progress aria-hidden="true">
        ${steps.map(() => `<span class="tutorial-dot"></span>`).join("")}
      </div>
      <div class="tutorial-footer">
        <button class="btn small ghost" type="button" data-tutorial-action="skip">Skip tour</button>
        <div class="tutorial-nav">
          <button class="btn small" type="button" data-tutorial-action="back">Back</button>
          <button class="btn small primary" type="button" data-tutorial-action="next">Next</button>
        </div>
      </div>
      <span class="tutorial-pointer hidden" data-tutorial-pointer aria-hidden="true"></span>
    </section>
  `;
}

export function createTutorialController({
  steps = TUTORIAL_STEPS,
  onViewChange = () => {},
  onFinish = () => {},
  onAction = () => {},
  getState = () => null
} = {}) {
  let active = false;
  let index = 0;
  let skipped = false;
  let root = null;
  let card = null;
  let scrim = null;
  let spotlight = null;
  let pointer = null;
  let title = null;
  let body = null;
  let counter = null;
  let progress = null;
  let backButton = null;
  let nextButton = null;
  let skipButton = null;
  let exitButton = null;
  let taskPanel = null;
  let taskState = null;
  let taskText = null;
  let taskHint = null;
  let taskActions = null;
  let taskButton = null;
  let taskDownload = null;
  let previousFocus = null;
  let repositionFrame = 0;
  let taskTimer = 0;
  let advanceTimer = 0;
  let nudgeTimer = 0;
  let taskContext = {};
  let taskDone = false;
  let lastTaskTarget = null;

  function setAppInert(enabled) {
    const header = document.querySelector(".app-header");
    const main = document.getElementById("app-main");
    if (enabled) {
      header?.setAttribute("inert", "");
      main?.setAttribute("inert", "");
    } else {
      header?.removeAttribute("inert");
      main?.removeAttribute("inert");
    }
  }

  function applyInteractionMode(step) {
    const interactive = Boolean(step.interactive);
    document.body.classList.toggle("tutorial-interactive", interactive);
    const header = document.querySelector(".app-header");
    const main = document.getElementById("app-main");
    header?.setAttribute("inert", "");
    if (interactive) {
      main?.removeAttribute("inert");
      card.removeAttribute("aria-modal");
    } else {
      main?.setAttribute("inert", "");
      card.setAttribute("aria-modal", "true");
    }
  }

  function ensureDom() {
    if (root) {
      return;
    }
    root = document.createElement("div");
    root.className = "tutorial-root";
    root.dataset.tutorialRoot = "";
    root.innerHTML = buildMarkup(steps);
    document.body.appendChild(root);
    card = root.querySelector("[data-tutorial-card]");
    scrim = root.querySelector("[data-tutorial-scrim]");
    spotlight = root.querySelector("[data-tutorial-spotlight]");
    pointer = root.querySelector("[data-tutorial-pointer]");
    title = root.querySelector("[data-tutorial-title]");
    body = root.querySelector("[data-tutorial-body]");
    counter = root.querySelector("[data-tutorial-counter]");
    progress = root.querySelector("[data-tutorial-progress]");
    backButton = root.querySelector('[data-tutorial-action="back"]');
    nextButton = root.querySelector('[data-tutorial-action="next"]');
    skipButton = root.querySelector('[data-tutorial-action="skip"]');
    exitButton = root.querySelector('[data-tutorial-action="exit"]');
    taskPanel = root.querySelector("[data-tutorial-task]");
    taskState = root.querySelector("[data-tutorial-task-state]");
    taskText = root.querySelector("[data-tutorial-task-text]");
    taskHint = root.querySelector("[data-tutorial-task-hint]");
    taskActions = root.querySelector("[data-tutorial-task-actions]");
    taskButton = root.querySelector("[data-tutorial-task-button]");
    taskDownload = root.querySelector("[data-tutorial-download]");

    backButton.addEventListener("click", goBack);
    nextButton.addEventListener("click", requestNext);
    skipButton.addEventListener("click", skipToEnd);
    exitButton.addEventListener("click", () => finish("exit"));
    taskButton.addEventListener("click", () => {
      const step = steps[index];
      if (active && step?.action?.id) {
        onAction(step.action.id, step);
      }
    });
  }

  function updateNextLabel(step) {
    const isLast = index === steps.length - 1;
    if (step.task && !taskDone) {
      nextButton.textContent = "Check task";
    } else {
      nextButton.textContent = isLast ? "Finish tour" : step.nextLabel || "Next";
    }
  }

  function updateCard(step) {
    title.textContent = step.title;
    body.textContent = step.body;
    counter.textContent = `Step ${index + 1} of ${steps.length}`;
    backButton.disabled = index === 0;
    skipButton.hidden = index === steps.length - 1;
    progress.querySelectorAll(".tutorial-dot").forEach((dot, dotIndex) => {
      dot.classList.toggle("active", dotIndex === index);
      dot.classList.toggle("complete", dotIndex < index);
    });
    card.classList.toggle("is-interactive", Boolean(step.interactive));

    if (step.task) {
      taskPanel.hidden = false;
      taskPanel.classList.remove("is-complete", "is-nudged");
      taskState.textContent = "Waiting";
      taskText.textContent = step.task.instruction || "";
      taskHint.textContent =
        step.task.hint || "Finish the task above, then try again.";
      taskHint.hidden = true;
      const hasAction = Boolean(step.action || step.download);
      taskActions.hidden = !hasAction;
      if (step.action) {
        taskButton.hidden = false;
        taskButton.textContent = step.action.label || "Open";
      } else {
        taskButton.hidden = true;
      }
      if (step.download) {
        taskDownload.hidden = false;
        taskDownload.href = step.download.href;
        taskDownload.textContent = step.download.label || "Download sample";
      } else {
        taskDownload.hidden = true;
        taskDownload.removeAttribute("href");
      }
    } else {
      taskPanel.hidden = true;
      taskActions.hidden = true;
    }
    updateNextLabel(step);
  }

  function markTaskComplete(step) {
    taskDone = true;
    taskHint.hidden = true;
    taskPanel.classList.add("is-complete");
    taskState.textContent = "Done";
    updateNextLabel(step);
  }

  function showTaskHint(step) {
    if (!step.task) {
      return;
    }
    taskHint.hidden = false;
    taskPanel.classList.remove("is-nudged");
    void taskPanel.offsetWidth;
    taskPanel.classList.add("is-nudged");
    window.clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(() => {
      taskPanel?.classList.remove("is-nudged");
    }, 700);
    scheduleReposition();
  }

  function checkTask(step) {
    if (!step.task) {
      return true;
    }
    try {
      return Boolean(
        step.task.isComplete({
          state: getState(),
          context: taskContext,
          step
        })
      );
    } catch {
      return false;
    }
  }

  function stopTaskTimers() {
    window.clearInterval(taskTimer);
    window.clearTimeout(advanceTimer);
    window.clearTimeout(nudgeTimer);
    taskTimer = 0;
    advanceTimer = 0;
    nudgeTimer = 0;
  }

  function startTaskPolling(step) {
    stopTaskTimers();
    if (!step.task) {
      return;
    }
    lastTaskTarget = resolveTarget(step);
    taskTimer = window.setInterval(() => {
      if (!active || steps[index] !== step) {
        return;
      }
      const target = resolveTarget(step);
      if (target && target !== lastTaskTarget) {
        lastTaskTarget = target;
        positionStep(step, target);
      }
      if (!taskDone && checkTask(step)) {
        markTaskComplete(step);
        if (step.task.autoAdvance) {
          advanceTimer = window.setTimeout(() => {
            if (active && steps[index] === step) {
              goTo(index + 1);
            }
          }, AUTO_ADVANCE_MS);
        }
      }
    }, TASK_POLL_MS);
  }

  function spotlightRect(target, step) {
    if (!target) {
      return null;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      return null;
    }
    const padding = Number.isFinite(step.padding) ? step.padding : 8;
    const left = clamp(rect.left - padding, 4, window.innerWidth - 4);
    const top = clamp(rect.top - padding, 4, window.innerHeight - 4);
    const right = clamp(rect.right + padding, 4, window.innerWidth - 4);
    const bottom = clamp(rect.bottom + padding, 4, window.innerHeight - 4);
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  function choosePlacement(step, targetRect) {
    if (!targetRect) {
      return "center";
    }
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const space = {
      below: window.innerHeight - targetRect.bottom,
      above: targetRect.top,
      right: window.innerWidth - targetRect.right,
      left: targetRect.left
    };
    const fits = (placement) =>
      space[placement] >=
      (placement === "below" || placement === "above" ? cardHeight : cardWidth) +
        CARD_GAP +
        VIEWPORT_MARGIN;
    const preferred =
      step.placement && step.placement !== "auto" ? step.placement : null;
    if (preferred && fits(preferred)) {
      return preferred;
    }
    for (const placement of ["below", "above", "right", "left"]) {
      if (fits(placement)) {
        return placement;
      }
    }
    if (preferred) {
      return preferred;
    }
    return Object.entries(space).sort(
      (left, right) => right[1] - left[1]
    )[0][0];
  }

  function placeCard(step, targetRect) {
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const placement = choosePlacement(step, targetRect);
    let left = (window.innerWidth - cardWidth) / 2;
    let top = (window.innerHeight - cardHeight) / 2;
    const targetCenterX = targetRect
      ? targetRect.left + targetRect.width / 2
      : 0;
    const targetCenterY = targetRect
      ? targetRect.top + targetRect.height / 2
      : 0;

    if (targetRect && placement === "below") {
      left = targetCenterX - cardWidth / 2;
      top = targetRect.bottom + CARD_GAP;
    } else if (targetRect && placement === "above") {
      left = targetCenterX - cardWidth / 2;
      top = targetRect.top - cardHeight - CARD_GAP;
    } else if (targetRect && placement === "right") {
      left = targetRect.right + CARD_GAP;
      top = targetCenterY - cardHeight / 2;
    } else if (targetRect && placement === "left") {
      left = targetRect.left - cardWidth - CARD_GAP;
      top = targetCenterY - cardHeight / 2;
    }

    left = clamp(
      left,
      VIEWPORT_MARGIN,
      window.innerWidth - cardWidth - VIEWPORT_MARGIN
    );
    top = clamp(
      top,
      VIEWPORT_MARGIN,
      window.innerHeight - cardHeight - VIEWPORT_MARGIN
    );
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    card.dataset.placement = placement;

    pointer.classList.remove(
      "hidden",
      "pointer-top",
      "pointer-bottom",
      "pointer-left",
      "pointer-right"
    );
    if (!targetRect || placement === "center") {
      pointer.classList.add("hidden");
      return;
    }
    if (placement === "below") {
      pointer.classList.add("pointer-top");
      const pointerX = clamp(targetCenterX - left, 26, cardWidth - 26);
      card.style.setProperty("--pointer-x", `${Math.round(pointerX)}px`);
    } else if (placement === "above") {
      pointer.classList.add("pointer-bottom");
      const pointerX = clamp(targetCenterX - left, 26, cardWidth - 26);
      card.style.setProperty("--pointer-x", `${Math.round(pointerX)}px`);
    } else if (placement === "right") {
      pointer.classList.add("pointer-left");
      const pointerY = clamp(targetCenterY - top, 26, cardHeight - 26);
      card.style.setProperty("--pointer-y", `${Math.round(pointerY)}px`);
    } else {
      pointer.classList.add("pointer-right");
      const pointerY = clamp(targetCenterY - top, 26, cardHeight - 26);
      card.style.setProperty("--pointer-y", `${Math.round(pointerY)}px`);
    }
  }

  function positionStep(step, target) {
    const targetRect = spotlightRect(target, step);
    if (targetRect) {
      spotlight.style.left = `${Math.round(targetRect.left)}px`;
      spotlight.style.top = `${Math.round(targetRect.top)}px`;
      spotlight.style.width = `${Math.round(targetRect.width)}px`;
      spotlight.style.height = `${Math.round(targetRect.height)}px`;
      spotlight.style.borderRadius =
        step.shape === "circle"
          ? "50%"
          : step.shape === "pill"
            ? "999px"
            : "16px";
      spotlight.classList.remove("hidden");
      scrim.classList.add("hidden");
    } else {
      spotlight.classList.add("hidden");
      scrim.classList.remove("hidden");
    }
    placeCard(step, targetRect);
  }

  function renderStep({ scroll = true } = {}) {
    if (!active) {
      return;
    }
    const step = steps[index];
    if (step.view) {
      onViewChange(step.view);
    }
    stopTaskTimers();
    taskContext = {};
    taskDone = false;
    lastTaskTarget = null;
    updateCard(step);
    applyInteractionMode(step);
    const target = resolveTarget(step);
    lastTaskTarget = target;
    if (target && scroll) {
      const rect = target.getBoundingClientRect();
      if (rect.top < 72 || rect.bottom > window.innerHeight - 72) {
        target.scrollIntoView({ block: "center", inline: "nearest" });
      }
    }
    positionStep(step, target);
    if (step.task) {
      taskDone = checkTask(step);
      if (taskDone) {
        markTaskComplete(step);
      }
      startTaskPolling(step);
    }
    card.classList.add("is-visible");
    card.focus({ preventScroll: true });
  }

  function goTo(nextIndex) {
    if (!active) {
      return;
    }
    const bounded = clamp(nextIndex, 0, steps.length - 1);
    if (bounded === index) {
      return;
    }
    stopTaskTimers();
    index = bounded;
    renderStep({ scroll: true });
  }

  function requestNext() {
    if (!active) {
      return;
    }
    const step = steps[index];
    if (step.task && !taskDone) {
      if (checkTask(step)) {
        markTaskComplete(step);
      } else {
        showTaskHint(step);
        return;
      }
    }
    if (index === steps.length - 1) {
      finish(skipped ? "skipped" : "complete");
      return;
    }
    goTo(index + 1);
  }

  function goBack() {
    if (index === 0) {
      return;
    }
    goTo(index - 1);
  }

  function skipToEnd() {
    if (index === steps.length - 1) {
      finish("skipped");
      return;
    }
    stopTaskTimers();
    skipped = true;
    index = steps.length - 1;
    renderStep({ scroll: false });
  }

  function scheduleReposition() {
    if (!active) {
      return;
    }
    window.cancelAnimationFrame(repositionFrame);
    repositionFrame = window.requestAnimationFrame(() => {
      if (!active) {
        return;
      }
      const step = steps[index];
      positionStep(step, resolveTarget(step));
    });
  }

  function isEditableTarget(target) {
    return (
      target instanceof HTMLElement &&
      Boolean(
        target.closest("input, select, textarea, [contenteditable='true']")
      )
    );
  }

  function handleDocumentClick(event) {
    if (!active) {
      return;
    }
    const step = steps[index];
    if (!step?.task?.onEvent) {
      return;
    }
    try {
      step.task.onEvent({
        event,
        context: taskContext,
        state: getState(),
        step
      });
    } catch {
      // Ignore tracking failures; the polling check remains authoritative.
    }
  }

  function handleKeydown(event) {
    if (!active) {
      return;
    }
    if (event.key === "Escape") {
      if (
        document.getElementById("app-modal")?.open ||
        document.querySelector("#popover-root .day-popover") ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      finish("exit");
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      if (!card.contains(document.activeElement) || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      if (event.key === "ArrowRight") {
        requestNext();
      } else {
        goBack();
      }
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const step = steps[index];
    if (step.interactive) {
      return;
    }
    const focusable = [
      ...card.querySelectorAll(
        "button:not([disabled]):not([hidden]), a[href]:not([hidden])"
      )
    ].filter((element) => element.offsetParent !== null);
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!card.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === card)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function cleanup() {
    window.removeEventListener("resize", scheduleReposition);
    window.removeEventListener("scroll", scheduleReposition, true);
    document.removeEventListener("keydown", handleKeydown, true);
    document.removeEventListener("click", handleDocumentClick);
    window.cancelAnimationFrame(repositionFrame);
    stopTaskTimers();
    document.body.classList.remove("tutorial-active", "tutorial-interactive");
    setAppInert(false);
    root?.remove();
    root = null;
    card = null;
    scrim = null;
    spotlight = null;
    pointer = null;
    title = null;
    body = null;
    counter = null;
    progress = null;
    backButton = null;
    nextButton = null;
    skipButton = null;
    exitButton = null;
    taskPanel = null;
    taskState = null;
    taskText = null;
    taskHint = null;
    taskActions = null;
    taskButton = null;
    taskDownload = null;
    taskContext = {};
    taskDone = false;
    lastTaskTarget = null;
  }

  function finish(reason) {
    if (!active) {
      return;
    }
    active = false;
    const focusTarget = previousFocus;
    cleanup();
    onFinish(reason);
    window.requestAnimationFrame(() => {
      if (focusTarget && document.contains(focusTarget)) {
        focusTarget.focus({ preventScroll: true });
      } else {
        document.getElementById("btn-tutorial")?.focus({ preventScroll: true });
      }
    });
  }

  function start() {
    if (active) {
      return;
    }
    active = true;
    skipped = false;
    index = 0;
    previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    ensureDom();
    document.body.classList.add("tutorial-active");
    window.addEventListener("resize", scheduleReposition);
    window.addEventListener("scroll", scheduleReposition, true);
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("click", handleDocumentClick);
    renderStep({ scroll: true });
  }

  return {
    start,
    stop: (reason = "external") => finish(reason),
    isActive: () => active
  };
}
