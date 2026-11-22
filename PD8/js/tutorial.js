const CARD_GAP = 16;
const VIEWPORT_MARGIN = 12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function firstMatchingDay(predicate) {
  const days = document.querySelectorAll(
    "#calendar-grid .calendar-day:not(.other-month)"
  );
  for (const day of days) {
    if (predicate(day)) {
      return day;
    }
  }
  return null;
}

export const TUTORIAL_STEPS = Object.freeze([
  {
    id: "welcome",
    title: "Welcome to the guided demo",
    body: "This is a hands-off tour of AiDaptable. It runs on a temporary copy of a semester, so your real workspace and saved data stay untouched. Use Next and Back to move around, Skip to jump to the end, or Exit to leave at any time.",
    placement: "center",
    nextLabel: "Start tour"
  },
  {
    id: "workspaces",
    title: "Three connected workspaces",
    body: "Setup is where you define the semester, topics, and quizzes. Calendar turns those rules into a teaching plan. Quiz Bin turns Google Forms CSV exports into class insights. The tabs at the top switch between them.",
    view: "setup",
    target: ".view-tabs",
    shape: "pill",
    padding: 7,
    placement: "below"
  },
  {
    id: "semester",
    title: "Set the rules for the semester",
    body: "Start and end dates are hard boundaries. Class days and their time windows decide how much teaching time exists. The low-priority threshold controls when a topic with no room becomes asynchronous instead of unscheduled. This demo uses Mon/Wed/Fri, 9:00–12:00, with one holiday.",
    view: "setup",
    target: '#setup-view [data-tutorial="semester"] .card-header',
    shape: "rect",
    padding: 10,
    placement: "below"
  },
  {
    id: "topics",
    title: "Topics carry the plan",
    body: "Each topic has estimated hours, a priority, and optional prerequisites. The scheduler finishes prerequisites first and uses priority to share shortages fairly. Topic rows are edited as one batch, then saved together.",
    view: "setup",
    target: '#setup-view [data-tutorial="topics"] .card-header',
    shape: "rect",
    padding: 10,
    placement: "below"
  },
  {
    id: "quizzes",
    title: "Reserve quiz days and track coverage",
    body: "A quiz reserves a class day and records which topics it covers. If those topics are not fully scheduled before the quiz date, the app warns you and can move the quiz automatically when the coverage is complete. This demo has two checkpoints.",
    view: "setup",
    target: '#setup-view [data-tutorial="quizzes"] .card-header',
    shape: "rect",
    padding: 10,
    placement: "below"
  },
  {
    id: "generate",
    title: "Generate the schedule",
    body: "Generate Schedule uses dependency order, quiz deadlines, priority, and 30-minute floors to place every topic. In normal use it saves the setup and opens the Calendar. In this tour the result stays temporary and nothing is written.",
    view: "setup",
    target: '#setup-view [data-tutorial="generate"]',
    shape: "pill",
    padding: 8,
    placement: "above"
  },
  {
    id: "calendar-toolbar",
    title: "Move around the calendar",
    body: "Switch between month and week, jump to a date, or return to Today. Suspend Range blocks out lost class time and reflows the affected work. Reschedule Remaining retries unfinished topics from a date you choose.",
    view: "calendar",
    target: "#calendar-toolbar",
    shape: "rect",
    padding: 8,
    placement: "below"
  },
  {
    id: "calendar-day",
    title: "Read a teaching day",
    body: "Each colored block is a scheduled topic with its hours. Quiz days, suspended days, and open class days get their own flags. After the tour, click any day to add time, remove a topic, suspend the day, or inspect what is planned.",
    view: "calendar",
    target: () =>
      firstMatchingDay((day) => Boolean(day.querySelector(".topic-pill"))),
    shape: "rect",
    padding: 6,
    placement: "auto"
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
    body: "Undo restores the previous change, Discard returns to the last accepted state, and Accept & Save commits pending calendar edits. Load Demo still loads the built-in demo semester; Guided Demo is the separate tour you are in now. These controls are paused while the tour runs.",
    view: "calendar",
    target: ".header-actions",
    shape: "rect",
    padding: 8,
    placement: "below"
  },
  {
    id: "quiz-bin-report",
    title: "Quiz Bin turns exports into reports",
    body: "Quiz Bin reads the CSV from a Google Forms response sheet. This temporary report was built from six anonymous responses: names and IDs are ignored, answers are graded, and correct answers are inferred from full-credit responses. Real imports are stored separately from the scheduler.",
    view: "quiz-bin",
    target: "#quiz-bin-view .qb-detail-head .card-header",
    shape: "rect",
    padding: 10,
    placement: "below"
  },
  {
    id: "quiz-bin-tabs",
    title: "Explore the report",
    body: "Overview summarizes the class, Questions shows answer distributions and inferred keys, and Responses lists anonymous scores with a detail drawer. Import notes explains warnings and grading mode, and Export downloads the report data.",
    view: "quiz-bin",
    target: "#quiz-bin-view .qb-tabs",
    shape: "pill",
    padding: 6,
    placement: "below"
  },
  {
    id: "finish",
    title: "You have seen the whole workspace",
    body: "That is the full loop: set up the semester, generate and adjust the calendar, then use Quiz Bin to learn from quiz results. Finish the tour to return to your own workspace exactly as you left it. Nothing from this tour was saved.",
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
  onFinish = () => {}
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
  let previousFocus = null;
  let repositionFrame = 0;
  const inertedRegions = [];

  function setAppInert(enabled) {
    if (enabled) {
      inertedRegions.length = 0;
      const regions = [
        document.querySelector(".app-header"),
        document.getElementById("app-main")
      ];
      for (const region of regions) {
        if (region && !region.hasAttribute("inert")) {
          region.setAttribute("inert", "");
          inertedRegions.push(region);
        }
      }
      return;
    }
    for (const region of inertedRegions) {
      region.removeAttribute("inert");
    }
    inertedRegions.length = 0;
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

    backButton.addEventListener("click", goBack);
    nextButton.addEventListener("click", goNext);
    skipButton.addEventListener("click", skipToEnd);
    exitButton.addEventListener("click", () => finish("exit"));
  }

  function updateCard(step) {
    title.textContent = step.title;
    body.textContent = step.body;
    counter.textContent = `Step ${index + 1} of ${steps.length}`;
    backButton.disabled = index === 0;
    nextButton.textContent =
      index === steps.length - 1 ? "Finish tour" : step.nextLabel || "Next";
    skipButton.hidden = index === steps.length - 1;
    progress.querySelectorAll(".tutorial-dot").forEach((dot, dotIndex) => {
      dot.classList.toggle("active", dotIndex === index);
      dot.classList.toggle("complete", dotIndex < index);
    });
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
    const preferred = step.placement && step.placement !== "auto" ? step.placement : null;
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
    return Object.entries(space).sort((left, right) => right[1] - left[1])[0][0];
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

    left = clamp(left, VIEWPORT_MARGIN, window.innerWidth - cardWidth - VIEWPORT_MARGIN);
    top = clamp(top, VIEWPORT_MARGIN, window.innerHeight - cardHeight - VIEWPORT_MARGIN);
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
        step.shape === "circle" ? "50%" : step.shape === "pill" ? "999px" : "16px";
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
    updateCard(step);
    const target = resolveTarget(step);
    if (target && scroll) {
      const rect = target.getBoundingClientRect();
      if (rect.top < 72 || rect.bottom > window.innerHeight - 72) {
        target.scrollIntoView({ block: "center", inline: "nearest" });
      }
    }
    positionStep(step, target);
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
    index = bounded;
    renderStep({ scroll: true });
  }

  function goNext() {
    if (index === steps.length - 1) {
      finish(skipped ? "skipped" : "complete");
      return;
    }
    goTo(index + 1);
  }

  function goBack() {
    goTo(index - 1);
  }

  function skipToEnd() {
    if (index === steps.length - 1) {
      finish("skipped");
      return;
    }
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

  function handleKeydown(event) {
    if (!active) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finish("exit");
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goBack();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = [...card.querySelectorAll("button:not([disabled]):not([hidden])")]
      .filter((element) => element.offsetParent !== null);
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
    if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
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
    window.cancelAnimationFrame(repositionFrame);
    document.body.classList.remove("tutorial-active");
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
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ensureDom();
    document.body.classList.add("tutorial-active");
    setAppInert(true);
    window.addEventListener("resize", scheduleReposition);
    window.addEventListener("scroll", scheduleReposition, true);
    document.addEventListener("keydown", handleKeydown, true);
    renderStep({ scroll: true });
  }

  return {
    start,
    stop: (reason = "external") => finish(reason),
    isActive: () => active
  };
}
