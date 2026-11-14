import { escapeHTML } from "./calendar.js";
import { openModal } from "./popover.js";
import {
  detectColumns,
  detectQuestionType,
  isMultipleQuestionType,
  isUngradedQuestionType,
  normalizeQuestionType,
  normalizeTimestamp,
  parseCSV,
  questionKey
} from "./quiz-csv.js";
import { buildQuizImport, inferQuestionPoints } from "./quiz-key.js";
import {
  buildQuestionCSV,
  buildResponseCSV,
  computeQuizInsights
} from "./quiz-insights.js";
import {
  loadQuizBin,
  normalizeQuizBinState,
  saveQuizBin
} from "./quiz-storage.js";

const root = document.getElementById("quiz-bin-view");
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];
const QUESTION_TYPES = [
  ["single", "Single answer"],
  ["short", "Short answer / fill-in"],
  ["paragraph", "Paragraph"],
  ["multiple", "Multiple answers"],
  ["grid-single", "Grid row · single"],
  ["grid-multiple", "Grid row · checkboxes"],
  ["date", "Date"],
  ["time", "Time"]
];
function questionTypeLabel(type) {
  return (
    QUESTION_TYPES.find(([value]) => value === type)?.[1] ||
    normalizeQuestionType(type)
  );
}
const TABS = [
  ["overview", "Overview"],
  ["questions", "Questions"],
  ["responses", "Responses"]
];

let bin = null;
let selectedId = null;
let activeTab = "overview";
let wizard = null;
let pendingReimportId = null;
let responseSort = "score-asc";
let showAtRiskOnly = false;
let notesOpen = false;
let getContext = () => ({ quizzes: [] });
let showToast = () => {};
let bound = false;
let fileInput = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round((number + Number.EPSILON) * factor) / factor
    : 0;
}

function percent(value, digits = 0) {
  return `${round(value, digits).toFixed(digits)}%`;
}

function points(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "0";
  }
  return Number.isInteger(number)
    ? String(number)
    : number
        .toFixed(2)
        .replace(/0+$/, "")
        .replace(/\.$/, "");
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return Number(count) === 1 ? singular : pluralForm;
}

function formatISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) {
    return "No date";
  }
  const month = MONTH_NAMES[Number(match[2]) - 1] || match[2];
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function formatDateTime(value) {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatBytes(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${round(bytes / (1024 * 1024), 1)} MB`;
}

function slug(value) {
  return (
    String(value || "quiz")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "quiz"
  );
}

function listSection(title, body, note = "") {
  return `
    <section class="card qb-panel">
      <div class="qb-panel-head">
        <div>
          <h3>${escapeHTML(title)}</h3>
          ${note ? `<p>${escapeHTML(note)}</p>` : ""}
        </div>
      </div>
      ${body}
    </section>
  `;
}

function emptyInline(message) {
  return `<div class="qb-empty-inline">${escapeHTML(message)}</div>`;
}

function getSelectedImport() {
  return bin?.imports.find((record) => record.id === selectedId) || null;
}

function linkedQuizFor(record) {
  if (!record?.quizId || record.unlinked) {
    return null;
  }
  return (
    (getContext().quizzes || []).find((quiz) => quiz.id === record.quizId) ||
    null
  );
}

function isLinked(record) {
  return Boolean(linkedQuizFor(record));
}

function snapshotBin() {
  return normalizeQuizBinState(bin);
}

function ensureSelection() {
  if (!bin?.imports.length) {
    selectedId = null;
    return;
  }
  if (!bin.imports.some((record) => record.id === selectedId)) {
    selectedId = bin.imports[0].id;
  }
}

function persistBin(snapshot) {
  const result = saveQuizBin(bin);
  if (!result.ok) {
    if (snapshot) {
      bin = snapshot;
    }
    showToast(
      result.error || "Could not save quiz results in this browser.",
      "danger"
    );
    return false;
  }
  bin = normalizeQuizBinState(bin);
  ensureSelection();
  return true;
}

function nextImportId() {
  const used = new Set((bin?.imports || []).map((record) => record.id));
  let index = 1;
  while (used.has(`qb${index}`)) {
    index += 1;
  }
  return `qb${index}`;
}

function scoringSourceLabel(source) {
  return source === "score-only" ? "Score only" : "Exported scores";
}

function statusLabel(status) {
  if (status === "on-track") {
    return "On track";
  }
  if (status === "approaching") {
    return "Approaching";
  }
  return "At risk";
}

function questionNumbers(items, limit = 8) {
  if (!items?.length) {
    return "None";
  }
  const numbers = items.map((item) => `Q${item.index + 1}`);
  if (numbers.length <= limit) {
    return numbers.join(", ");
  }
  return `${numbers.slice(0, limit).join(", ")} +${numbers.length - limit} more`;
}

function bar(value, max, variant = "") {
  const width =
    Number(max) > 0 ? clamp((Number(value) / Number(max)) * 100, 0, 100) : 0;
  return `
    <span class="qb-bar-track" aria-hidden="true">
      <span class="qb-bar-fill ${variant}" style="width: ${width}%"></span>
    </span>
  `;
}

function kpi(label, value, note = "") {
  return `
    <div class="qb-kpi">
      <span class="qb-kpi-label">${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
      ${note ? `<small>${escapeHTML(note)}</small>` : ""}
    </div>
  `;
}

function optionList(items, selectedValue) {
  return items
    .map(
      (item) => `
        <option value="${escapeHTML(String(item.value))}" ${String(item.value) === String(selectedValue) ? "selected" : ""}>
          ${escapeHTML(item.label)}
        </option>
      `
    )
    .join("");
}

function renderHeader() {
  const records = bin?.imports || [];
  return `
    <section class="qb-hero">
      <div class="qb-hero-copy">
        <span class="qb-kicker">Quiz Bin</span>
        <h2>CSV in. Analytics out.</h2>
        <p>
          Upload a Google Forms responses CSV to build a class report automatically.
          Name, email, and ID columns are ignored. Everything stays in this browser.
        </p>
      </div>
      <div class="card-actions">
        ${
          records.length
            ? `<label class="qb-inline-field">
                <span>Saved</span>
                <select data-qb-import-select aria-label="Saved imports">
                  ${optionList(
                    records.map((record) => ({
                      value: record.id,
                      label: `${record.quizTitle} · ${formatISODate(record.quizDate)} · ${record.responses.length} responses`
                    })),
                    selectedId
                  )}
                </select>
              </label>`
            : ""
        }
        <button class="btn primary" type="button" data-qb-action="upload">Import CSV</button>
        <button class="btn subtle" type="button" data-qb-action="help">How it works</button>
      </div>
    </section>
  `;
}

function renderEmptyState() {
  return `
    <section class="card qb-empty">
      <div
        class="qb-dropzone"
        data-qb-dropzone
        data-qb-action="browse-file"
        role="button"
        tabindex="0"
        aria-label="Choose a Google Forms CSV file"
      >
        <div class="qb-drop-icon" aria-hidden="true">CSV</div>
        <h3>Drop a Google Forms CSV here</h3>
        <p>or <span class="qb-link">choose a file</span> from your computer.</p>
        <small>UTF-8 CSV up to 8 MB. Use the CSV downloaded from the Responses tab.</small>
      </div>
      <div class="qb-empty-steps">
        <div class="qb-step">
          <span class="qb-step-number">1</span>
          <div><strong>Upload the CSV</strong><p>Keep the header row and the exported score columns.</p></div>
        </div>
        <div class="qb-step">
          <span class="qb-step-number">2</span>
          <div><strong>Automatic detection</strong><p>Questions, scores, types, and correct answers are detected for you.</p></div>
        </div>
        <div class="qb-step">
          <span class="qb-step-number">3</span>
          <div><strong>Read the report</strong><p>See class results, question gaps, and response-level scores.</p></div>
        </div>
      </div>
      <p class="qb-note">
        Google Forms exports sometimes download as a ZIP. Unzip it first, then
        choose the CSV inside. Raw CSV files are never uploaded or stored.
      </p>
    </section>
  `;
}

function renderDistribution(insights) {
  const max = Math.max(
    1,
    ...insights.distribution.map((bucket) => bucket.count)
  );
  const rows = insights.distribution
    .map(
      (bucket) => `
        <div class="qb-distribution-row">
          <span class="qb-distribution-label">${escapeHTML(bucket.label)}</span>
          ${bar(bucket.count, max, "brand")}
          <span class="qb-distribution-count">${bucket.count}</span>
        </div>
      `
    )
    .join("");
  return listSection(
    "Score distribution",
    `<div class="qb-distribution">${rows}</div>`,
    "Responses grouped by percentage, in 10-point bands."
  );
}

function renderFrequentlyMissed(insights) {
  const items = insights.frequentlyMissed.filter(
    (question) => question.missedCount > 0
  );
  const body = items.length
    ? `<div class="qb-missed-list">
        ${items
          .map(
            (question) => `
              <div class="qb-missed-item">
                <span class="qb-rank">${question.frequentRank}</span>
                <div class="qb-missed-copy">
                  <div class="qb-missed-title">
                    <span class="qb-qtag">Q${question.index + 1}</span>
                    <strong>${escapeHTML(question.prompt)}</strong>
                  </div>
                  <p>
                    ${percent(question.missedRate, 0)} missed
                    (${question.responseCount - question.fullCredit}/${question.responseCount})
                    · ${question.incorrect} wrong
                    · ${question.partial} partial
                    · ${question.blank} blank
                  </p>
                  <p class="qb-muted">
                    ${
                      question.mostCommonWrong
                        ? `Most common wrong: ${escapeHTML(question.mostCommonWrong)}`
                        : question.blank === question.responseCount
                          ? "No answer submitted by any response."
                          : "No common wrong answer."
                    }
                  </p>
                </div>
              </div>
            `
          )
          .join("")}
      </div>`
    : `<div class="notice success"><span>No graded question was missed by any response.</span></div>`;
  return listSection(
    "Frequently missed questions",
    body,
    "Ranked by missed rate. Wrong, partial-credit, and blank answers all count as missed."
  );
}

function renderAttention(insights) {
  const records = insights.responses
    .filter((response) => response.belowPass)
    .sort((left, right) => left.percent - right.percent)
    .slice(0, 6);
  const body = records.length
    ? `<div class="qb-attention-list">
        ${records
          .map(
            (response) => `
              <div class="qb-attention-item">
                <div>
                  <strong>${escapeHTML(response.label)}</strong>
                  <p class="qb-muted">${escapeHTML(questionNumbers(response.missed, 10))}</p>
                </div>
                <span class="qb-percent-pill">${percent(response.percent, 1)}</span>
              </div>
            `
          )
          .join("")}
      </div>`
    : `<div class="notice success"><span>Every response is at or above the passing threshold.</span></div>`;
  return listSection(
    "Responses needing attention",
    body,
    "Below the passing threshold for this import."
  );
}

function renderOverview(insights) {
  const { summary } = insights;
  const completeResponses = summary.responseCount
    ? Math.round((summary.completionRate / 100) * summary.responseCount)
    : 0;
  return `
    <div class="qb-kpi-grid">
      ${kpi("Responses", String(summary.responseCount), `${summary.gradedQuestionCount} graded questions`)}
      ${kpi("Average", percent(summary.average, 1), `Median ${percent(summary.median, 1)}`)}
      ${kpi("Pass rate", percent(summary.passRate, 0), `${summary.belowPass} below ${percent(summary.passingPercent, 0)}`)}
      ${kpi("Highest", percent(summary.highest, 1), `Lowest ${percent(summary.lowest, 1)}`)}
      ${kpi("At risk", String(summary.atRisk), `Below ${percent(Math.min(50, summary.passingPercent), 0)}`)}
      ${kpi("Std. deviation", `${round(summary.standardDeviation, 1)} pts`, "Population SD")}
      ${kpi(
        "Completion",
        percent(summary.completionRate, 0),
        completeResponses === summary.responseCount
          ? "No blank answers"
          : `${summary.responseCount - completeResponses} with blank answers`
      )}
      ${kpi("Possible points", points(summary.possibleTotal), `${summary.questionCount} questions`)}
    </div>
    <div class="qb-two-col">
      ${renderDistribution(insights)}
      ${renderFrequentlyMissed(insights)}
    </div>
    ${renderAttention(insights)}
    ${
      summary.responseCount > 0 && summary.responseCount < 5
        ? `<div class="notice info"><span>Small sample: n=${summary.responseCount}. Treat the percentages as a quick check, not a precise class measure.</span></div>`
        : ""
    }
  `;
}

function renderQuestionCard(question) {
  const groups = question.answerGroups.slice(0, 8);
  const max = Math.max(1, ...groups.map((group) => group.count));
  const groupRows = groups.length
    ? groups
        .map(
          (group) => `
            <div class="qb-answer-row">
              <span class="qb-answer-label ${group.blank ? "blank" : ""} ${group.isCorrect ? "correct" : ""}">
                ${escapeHTML(group.blank ? "(blank)" : group.answer)}
                ${group.isCorrect ? `<span class="qb-correct-mark" title="Matches the inferred answer">✓</span>` : ""}
              </span>
              ${bar(group.count, max, group.blank ? "blank" : group.isCorrect ? "good" : "warn")}
              <span class="qb-answer-count">${group.count}</span>
            </div>
          `
        )
        .join("")
    : emptyInline("No responses for this question.");

  const optionMax = Math.max(
    1,
    ...question.optionGroups.map((option) => option.count)
  );
  const optionRows = question.optionGroups
    .map(
      (option) => `
        <div class="qb-answer-row">
          <span class="qb-answer-label ${option.isCorrect ? "correct" : ""}">
            ${escapeHTML(option.option)}
            ${option.isCorrect ? `<span class="qb-correct-mark" title="Inferred correct option">✓</span>` : ""}
          </span>
          ${bar(
            option.count,
            optionMax,
            option.isCorrect ? "good" : "warn"
          )}
          <span class="qb-answer-count">${option.count} · ${percent(option.rate, 0)}</span>
        </div>
      `
    )
    .join("");

  const keyText = !question.graded
    ? "No exported score for this question, so it is shown without grading."
    : question.answerKeySource === "inferred"
      ? `Inferred key from ${question.keyResponseCount} full-credit ${plural(
          question.keyResponseCount,
          "response"
        )}: ${question.correctAnswerText}`
      : "No response earned full credit, so no correct answer can be inferred.";

  return `
    <article class="qb-question-card">
      <div class="qb-question-head">
        <span class="qb-qnum">Q${question.index + 1}</span>
        <div class="qb-question-title">
          <h3>${escapeHTML(question.prompt)}</h3>
          <p>
            ${points(question.points)} ${plural(question.points, "point")}
            · ${escapeHTML(question.difficulty)}
            ${question.type !== "single" ? ` · ${escapeHTML(questionTypeLabel(question.type))}` : ""}
          </p>
        </div>
        <div class="qb-question-rate">
          <strong>${question.graded ? percent(question.rate, 0) : "—"}</strong>
          <span>${question.graded ? "full credit" : "not graded"}</span>
        </div>
      </div>
      <div class="qb-question-stats">
        <span><strong>${question.fullCredit}</strong> full</span>
        <span><strong>${question.partial}</strong> partial</span>
        <span><strong>${question.incorrect}</strong> wrong</span>
        <span><strong>${question.blank}</strong> blank</span>
        <span><strong>${question.answeredCount}</strong> answered</span>
      </div>
      ${
        isMultipleQuestionType(question.type)
          ? `<p class="qb-muted">Answer combinations</p>`
          : ""
      }
      <div class="qb-answer-list">${groupRows}</div>
      ${
        optionRows
          ? `<p class="qb-muted">Option selections · counted per response; percentages use answered responses.</p>
             <div class="qb-answer-list">${optionRows}</div>`
          : ""
      }
      <div class="qb-question-foot">
        <p class="qb-muted">
          ${escapeHTML(keyText)}
          ${
            question.mostCommonWrong
              ? ` · Most common wrong: ${escapeHTML(question.mostCommonWrong)}`
              : ""
          }
        </p>
      </div>
    </article>
  `;
}

function renderQuestions(insights) {
  const cards = insights.questions.length
    ? insights.questions.map((question) => renderQuestionCard(question)).join("")
    : emptyInline("No questions were imported.");
  return `
    <div class="notice info">
      <span>Exported scores are the source of truth. Correct answers are inferred from responses that earned full credit. No manual answer key is needed.</span>
    </div>
    <div class="qb-question-list">${cards}</div>
  `;
}

function sortResponses(responses) {
  const result = [...responses];
  if (responseSort === "score-desc") {
    result.sort(
      (left, right) => right.percent - left.percent || left.index - right.index
    );
  } else if (responseSort === "missed-desc") {
    result.sort(
      (left, right) =>
        right.missed.length - left.missed.length || left.index - right.index
    );
  } else {
    result.sort(
      (left, right) => left.percent - right.percent || left.index - right.index
    );
  }
  return result;
}

function renderResponses(insights) {
  const visible = sortResponses(
    showAtRiskOnly
      ? insights.responses.filter((response) => response.belowPass)
      : insights.responses
  );
  const rows = visible
    .map(
      (response) => `
        <tr>
          <td><strong>${escapeHTML(response.label)}</strong></td>
          <td class="qb-nowrap">${escapeHTML(response.submittedAtRaw || "—")}</td>
          <td class="qb-nowrap">${points(response.score)} / ${points(response.possible)}</td>
          <td><strong>${percent(response.percent, 1)}</strong></td>
          <td><span class="qb-status ${escapeHTML(response.status)}">${escapeHTML(statusLabel(response.status))}</span></td>
          <td>
            <span class="qb-missed-questions">${escapeHTML(questionNumbers(response.missed, 8))}</span>
            ${
              response.skipped.length
                ? `<small class="qb-muted">Skipped: ${escapeHTML(questionNumbers(response.skipped, 6))}</small>`
                : ""
            }
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="qb-student-controls">
      <label class="form-field qb-inline-field">
        <span>Sort by</span>
        <select data-qb-response-sort>
          <option value="score-asc" ${responseSort === "score-asc" ? "selected" : ""}>Lowest score first</option>
          <option value="score-desc" ${responseSort === "score-desc" ? "selected" : ""}>Highest score first</option>
          <option value="missed-desc" ${responseSort === "missed-desc" ? "selected" : ""}>Most missed questions</option>
        </select>
      </label>
      <label class="qb-check">
        <input type="checkbox" data-qb-at-risk ${showAtRiskOnly ? "checked" : ""} />
        <span>Only responses below the passing threshold</span>
      </label>
    </div>
    ${
      rows
        ? `<div class="qb-table-wrap">
            <table class="qb-table">
              <thead>
                <tr>
                  <th>Response</th>
                  <th>Submitted</th>
                  <th>Score</th>
                  <th>Percent</th>
                  <th>Status</th>
                  <th>Missed questions</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`
        : emptyInline("No responses match this filter.")
    }
  `;
}

function renderImportNotes(insights, record) {
  const { dataQuality } = insights;
  const qualityItems = [
    ["Responses", insights.summary.responseCount],
    ["Questions", insights.summary.questionCount],
    ["Graded questions", insights.summary.gradedQuestionCount],
    ["Ungraded questions", dataQuality.ungradedQuestions.length],
    ["Inferred keys", dataQuality.inferredKeyCount],
    ["Without an inferred key", dataQuality.missingKeyQuestions.length],
    ["Score mismatches", dataQuality.scoreMismatches],
    ["Unparsable score cells", dataQuality.unparsableScoreCells],
    ["Duplicate rows", dataQuality.duplicateRows],
    ["Blank answers", dataQuality.blankAnswers],
    ["Partial-credit answers", dataQuality.partialAnswers]
  ];
  const warningList = dataQuality.warnings.length
    ? `<div class="qb-warning-list">
        ${dataQuality.warnings
          .map(
            (warning) =>
              `<div class="notice warning"><span>${escapeHTML(warning)}</span></div>`
          )
          .join("")}
      </div>`
    : `<div class="notice success"><span>No import warnings. The file mapped cleanly.</span></div>`;

  const gradingRows = record.questions
    .map(
      (question, index) => `
        <tr>
          <td>Q${index + 1}</td>
          <td>${escapeHTML(question.prompt)}</td>
          <td>${escapeHTML(questionTypeLabel(question.type))}</td>
          <td>${points(question.points)}</td>
          <td>${question.hasExportedScore ? "Exported score" : "Not graded"}</td>
          <td>${
            question.answerKeySource === "inferred"
              ? `Inferred from ${question.keyResponseCount} ${plural(
                  question.keyResponseCount,
                  "response"
                )}`
              : question.graded
                ? "No key inferable"
                : "—"
          }</td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="qb-quality-grid">
      ${qualityItems
        .map(
          ([label, value]) => `
            <div class="qb-quality-item">
              <span>${escapeHTML(label)}</span>
              <strong>${escapeHTML(String(value))}</strong>
            </div>
          `
        )
        .join("")}
    </div>
    <div class="qb-two-col">
      ${listSection(
        "Import warnings",
        warningList,
        "Warnings do not block an import; they flag data that may need a closer look."
      )}
      ${listSection(
        "Source file",
        `<dl class="qb-meta-list">
          <div><dt>File</dt><dd>${escapeHTML(record.sourceFileName || "Unknown")}</dd></div>
          <div><dt>Rows in file</dt><dd>${record.sourceRowCount}</dd></div>
          <div><dt>Imported</dt><dd>${escapeHTML(formatDateTime(record.importedAt))}</dd></div>
          <div><dt>Scoring source</dt><dd>${escapeHTML(scoringSourceLabel(record.scoringSource))}</dd></div>
          <div><dt>Quiz link</dt><dd>${
            record.quizId
              ? `${escapeHTML(record.quizTitle)}${
                  isLinked(record) ? "" : " · quiz no longer scheduled"
                }`
              : "Standalone import"
          }</dd></div>
        </dl>
        <p class="qb-note">Only parsed answers and metadata are stored. The raw CSV is not saved.</p>`,
        "Where this import came from."
      )}
    </div>
    ${listSection(
      "Question grading",
      `<div class="qb-table-wrap">
        <table class="qb-table">
          <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Points</th><th>Grading</th><th>Correct answer</th></tr></thead>
          <tbody>${gradingRows}</tbody>
        </table>
      </div>`,
      "How each question was graded and whether a key could be inferred."
    )}
  `;
}

function renderReport(record) {
  const insights = computeQuizInsights(record);
  const { summary, dataQuality } = insights;
  const validTab = TABS.some(([id]) => id === activeTab) ? activeTab : "overview";
  activeTab = validTab;
  const contents = {
    overview: renderOverview(insights),
    questions: renderQuestions(insights),
    responses: renderResponses(insights)
  };
  const noteCount =
    dataQuality.warnings.length +
    dataQuality.scoreMismatches +
    dataQuality.unparsableScoreCells +
    dataQuality.duplicateRows +
    dataQuality.ungradedQuestions.length +
    dataQuality.missingKeyQuestions.length;

  return `
    <div class="qb-detail-shell" id="qb-detail">
      <section class="card qb-detail-head">
        <div class="card-header">
          <div>
            <span class="qb-kicker">Quiz report</span>
            <h2>${escapeHTML(record.quizTitle)}</h2>
            <p>
              ${escapeHTML(formatISODate(record.quizDate))}
              ${record.sourceFileName ? ` · ${escapeHTML(record.sourceFileName)}` : ""}
              · Imported ${escapeHTML(formatDateTime(record.importedAt))}
            </p>
          </div>
          <div class="card-actions">
            <button class="btn small" type="button" data-qb-action="reimport" data-import-id="${escapeHTML(record.id)}">Re-import</button>
            <button class="btn small" type="button" data-qb-action="export" data-import-id="${escapeHTML(record.id)}">Export</button>
            <button class="btn small ghost danger-text" type="button" data-qb-action="delete-import" data-import-id="${escapeHTML(record.id)}">Delete</button>
          </div>
        </div>
        <div class="qb-detail-meta">
          <label class="qb-inline-field">
            <span>Passing threshold</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value="${summary.passingPercent}"
              data-qb-detail-field="passingPercent"
            />%
          </label>
          <span class="chip">${summary.responseCount} ${plural(summary.responseCount, "response")}</span>
          <span class="chip">${summary.questionCount} ${plural(summary.questionCount, "question")}</span>
          <span class="chip">${summary.inferredKeyCount} inferred ${plural(summary.inferredKeyCount, "key")}</span>
          <span class="chip">${escapeHTML(scoringSourceLabel(record.scoringSource))}</span>
          ${
            record.quizId
              ? `<span class="chip">${isLinked(record) ? "Linked quiz" : "Quiz not scheduled"}</span>`
              : `<span class="chip">Standalone</span>`
          }
          <button
            class="btn link"
            type="button"
            data-qb-action="toggle-notes"
            aria-expanded="${notesOpen ? "true" : "false"}"
          >${notesOpen ? "Hide import notes" : `Import notes${noteCount ? ` (${noteCount})` : ""}`}</button>
        </div>
        ${
          notesOpen
            ? `<div class="qb-import-notes">${renderImportNotes(
                insights,
                record
              )}</div>`
            : ""
        }
      </section>

      <nav class="qb-tabs" aria-label="Quiz insights">
        ${TABS.map(
          ([id, label]) => `
            <button
              type="button"
              class="qb-tab ${id === activeTab ? "active" : ""}"
              data-qb-action="tab"
              data-tab="${id}"
              aria-selected="${id === activeTab ? "true" : "false"}"
            >${escapeHTML(label)}</button>
          `
        ).join("")}
      </nav>

      <div class="qb-tab-panel">${contents[activeTab]}</div>
    </div>
  `;
}

function firstResponseDate(rows, timestampIndex) {
  if (timestampIndex < 0) {
    return "";
  }
  for (const row of rows) {
    const parsed = normalizeTimestamp(row[timestampIndex]);
    if (parsed.iso) {
      return parsed.iso.slice(0, 10);
    }
  }
  return "";
}

function wizardHeaderOptions(includeNone = true) {
  const options = includeNone
    ? [{ value: -1, label: "None (compute from questions)" }]
    : [];
  const excluded = new Set([
    wizard.columns.timestampIndex,
    ...(wizard.columns.identityCandidates || []).map(
      (candidate) => candidate.index
    )
  ]);
  wizard.parsed.headers.forEach((header, index) => {
    if (excluded.has(index) || /\[(Score|Feedback)\]\s*$/i.test(header)) {
      return;
    }
    options.push({ value: index, label: header });
  });
  return options;
}

function wizardScoreOptions(selectedValue, kind) {
  const pattern = kind === "score" ? /\[Score\]\s*$/i : /\[Feedback\]\s*$/i;
  const options = [{ value: -1, label: "None" }];
  wizard.parsed.headers.forEach((header, index) => {
    if (!pattern.test(header)) {
      return;
    }
    options.push({ value: index, label: header });
  });
  return optionList(options, selectedValue === null ? -1 : selectedValue);
}

function renderWizardAdvanced() {
  const questionRows = wizard.questions
    .map((draft, index) => {
      const inferred = inferQuestionPoints(wizard.parsed.rows, draft.scoreIndex);
      return `
        <tr data-qb-q-index="${index}">
          <td><input type="checkbox" data-qb-q-include ${draft.include ? "checked" : ""} aria-label="Include Q${index + 1}" /></td>
          <td><span class="qb-qtag">Q${index + 1}</span> ${escapeHTML(draft.header)}</td>
          <td>
            <select data-qb-q-type aria-label="Question type for Q${index + 1}">
              ${optionList(
                QUESTION_TYPES.map(([value, label]) => ({ value, label })),
                draft.type
              )}
            </select>
          </td>
          <td>
            ${
              draft.scoreIndex !== null
                ? points(inferred || draft.points)
                : `<input type="number" min="0.01" step="0.01" value="${points(draft.points)}" data-qb-q-points aria-label="Points for Q${index + 1}" />`
            }
          </td>
          <td>
            <select data-qb-q-score aria-label="Score column for Q${index + 1}">
              ${wizardScoreOptions(draft.scoreIndex, "score")}
            </select>
          </td>
          <td>
            <select data-qb-q-feedback aria-label="Feedback column for Q${index + 1}">
              ${wizardScoreOptions(draft.feedbackIndex, "feedback")}
            </select>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="qb-wizard-grid">
      <label class="form-field">
        <span>Link to a scheduled quiz</span>
        <select data-qb-wizard-field="targetQuizId">
          ${optionList(
            [
              { value: "", label: "Standalone import (no quiz link)" },
              ...(getContext().quizzes || []).map((quiz) => ({
                value: quiz.id,
                label: `${quiz.title} · ${formatISODate(quiz.date)}`
              }))
            ],
            wizard.targetQuizId
          )}
        </select>
      </label>
      <label class="form-field">
        <span>Quiz title</span>
        <input type="text" value="${escapeHTML(wizard.title)}" data-qb-wizard-field="title" />
      </label>
      <label class="form-field">
        <span>Quiz date</span>
        <input type="date" value="${escapeHTML(wizard.date)}" data-qb-wizard-field="date" />
      </label>
      <label class="form-field">
        <span>Passing threshold</span>
        <input type="number" min="0" max="100" step="1" value="${wizard.passingPercent}" data-qb-wizard-field="passingPercent" />
      </label>
      <label class="form-field">
        <span>Total score column</span>
        <select data-qb-wizard-field="totalScoreIndex">
          ${optionList(wizardHeaderOptions(true), wizard.totalScoreIndex)}
        </select>
      </label>
    </div>
    <p class="qb-note">
      Only change these if automatic detection is wrong. Name, email, and student
      ID columns are excluded automatically; responses stay anonymous.
    </p>
    <p class="qb-note">
      Single answer covers multiple choice and dropdown; multiple answers
      covers checkboxes. Grid rows are listed separately. Single answer, short
      answer / fill-in, paragraph, date, time, and grid-single treat each
      response as one answer; multiple answers and grid checkboxes split
      selections on commas, semicolons, or pipes.
    </p>
    <p class="qb-note">
      Paragraph, date, and time questions are imported without grading unless
      their score column contains numeric scores. Rating and file-upload
      questions are skipped automatically.
    </p>
    <div class="qb-table-wrap">
      <table class="qb-table qb-map-table">
        <colgroup>
          <col class="qb-map-col-include" />
          <col class="qb-map-col-question" />
          <col class="qb-map-col-type" />
          <col class="qb-map-col-points" />
          <col class="qb-map-col-score" />
          <col class="qb-map-col-feedback" />
        </colgroup>
        <thead>
          <tr><th>Include</th><th>Question</th><th>Type</th><th>Points</th><th>Score column</th><th>Feedback column</th></tr>
        </thead>
        <tbody>${questionRows}</tbody>
      </table>
    </div>
  `;
}

function wizardPreview() {
  try {
    const record = buildWizardImport(true);
    return {
      record,
      insights: computeQuizInsights(record),
      error: ""
    };
  } catch (error) {
    return {
      record: null,
      insights: null,
      error:
        error instanceof Error
          ? error.message
          : "The import preview could not be prepared."
    };
  }
}

function renderWizard() {
  const preview = wizardPreview();
  const record = preview.record;
  const header = `
    <div class="card-header">
      <div>
        <span class="qb-kicker">Import CSV</span>
        <h2>Check the import</h2>
        <p>
          ${escapeHTML(wizard.fileName)} · ${formatBytes(wizard.fileSize)}
          · ${wizard.parsed.rows.length} response ${plural(wizard.parsed.rows.length, "row")}
        </p>
      </div>
      <div class="card-actions">
        <span class="chip">Auto-detected</span>
        <button class="btn ghost small" type="button" data-qb-action="toggle-advanced">
          ${wizard.showAdvanced ? "Hide advanced mapping" : "Advanced mapping"}
        </button>
      </div>
    </div>
  `;

  if (!record) {
    return `
      <section class="card qb-wizard" data-qb-wizard>
        ${header}
        <div class="notice danger"><span>${escapeHTML(preview.error)}</span></div>
        ${wizard.showAdvanced ? renderWizardAdvanced() : ""}
        <div class="qb-wizard-actions">
          <button class="btn ghost" type="button" data-qb-action="wizard-cancel">Cancel import</button>
        </div>
      </section>
    `;
  }

  const warnings = [
    ...new Set([
      ...(record.warnings || []),
      ...(wizard.parsed.warnings || []),
      ...(wizard.columns.warnings || [])
    ])
  ];
  const missingKeys = record.questions.filter(
    (question) => question.graded && question.answerKeySource !== "inferred"
  );
  const ungraded = record.questions.filter(
    (question) => !question.graded && !isUngradedQuestionType(question.type)
  );
  const multipleCount = record.questions.filter((question) =>
    isMultipleQuestionType(question.type)
  ).length;
  const inferredCount = record.questions.filter(
    (question) => question.answerKeySource === "inferred"
  ).length;
  const replacements = (bin?.imports || []).filter(
    (entry) =>
      entry.id === wizard.replaceId ||
      (record.quizId && entry.quizId === record.quizId)
  );
  const linkedQuiz = (getContext().quizzes || []).find(
    (quiz) => quiz.id === wizard.targetQuizId
  );
  const dateNote = linkedQuiz
    ? "Date from the linked quiz."
    : wizard.dateSource === "first response"
      ? "Date from the first response."
      : wizard.dateSource === "previous import"
        ? "Date kept from the previous import."
        : "No timestamp found. Set a date in advanced mapping if needed.";

  const missingKeyNotice = missingKeys.length
    ? `<div class="notice warning"><span>No correct answer can be inferred for ${missingKeys
        .map((question) => `Q${record.questions.indexOf(question) + 1}`)
        .join(", ")} because no response earned full credit. Scores and answer distributions still work.</span></div>`
    : "";
  const ungradedNotice = ungraded.length
    ? `<div class="notice info"><span>${ungraded.length} ${plural(
        ungraded.length,
        "question"
      )} ${ungraded.length === 1 ? "has" : "have"} no exported score and will be shown without grading.</span></div>`
    : "";
  const warningsNotice = warnings.length
    ? `<div class="qb-warning-list">${warnings
        .map(
          (warning) =>
            `<div class="notice warning"><span>${escapeHTML(warning)}</span></div>`
        )
        .join("")}</div>`
    : "";
  const successNotice =
    !warnings.length && !missingKeys.length && !ungraded.length
      ? `<div class="notice success"><span>Everything was detected automatically. No exceptions found.</span></div>`
      : "";

  return `
    <section class="card qb-wizard" data-qb-wizard>
      ${header}
      <div class="qb-review-summary">
        ${kpi("Responses", String(record.responses.length), "From the CSV")}
        ${kpi("Questions", String(record.questions.length), `${multipleCount} multiple-answer`)}
        ${kpi("Possible points", points(record.grading.possibleTotal), `${record.questions.filter((question) => question.graded).length} graded`)}
        ${kpi("Inferred keys", `${inferredCount} / ${record.questions.filter((question) => question.graded).length}`, "From full-credit responses")}
        ${kpi("Passing threshold", `${wizard.passingPercent}%`, "Editable in advanced mapping")}
      </div>
      <div class="qb-review-target">
        <strong>${record.quizId ? "Linked quiz" : "Standalone import"}:</strong>
        ${escapeHTML(record.quizTitle)} · ${escapeHTML(formatISODate(record.quizDate))}
        · ${escapeHTML(record.sourceFileName)}
        · ${escapeHTML(dateNote)}
      </div>
      <div class="qb-chip-row">
        <span class="qb-stat-chip ${inferredCount ? "good" : ""}">${inferredCount} inferred ${plural(inferredCount, "key")}</span>
        <span class="qb-stat-chip ${missingKeys.length ? "warn" : ""}">${missingKeys.length} without a key</span>
        <span class="qb-stat-chip">${multipleCount} multiple-answer ${plural(multipleCount, "question")}</span>
        ${
          wizard.columns.identityCandidates.length
            ? `<span class="qb-stat-chip">${wizard.columns.identityCandidates.length} identity ${plural(
                wizard.columns.identityCandidates.length,
                "column"
              )} ignored</span>`
            : ""
        }
      </div>
      ${
        replacements.length
          ? `<div class="notice warning"><span>Importing will replace ${replacements.length} existing ${plural(
              replacements.length,
              "import"
            )}.</span></div>`
          : ""
      }
      ${warningsNotice}
      ${missingKeyNotice}
      ${ungradedNotice}
      ${successNotice}
      ${wizard.showAdvanced ? renderWizardAdvanced() : ""}
      <div class="qb-wizard-actions">
        <button class="btn ghost" type="button" data-qb-action="wizard-cancel">Cancel import</button>
        <button class="btn primary" type="button" data-qb-action="wizard-import">
          ${
            replacements.length
              ? "Replace saved import"
              : `Import ${record.responses.length} ${plural(
                  record.responses.length,
                  "response"
                )}`
          }
        </button>
      </div>
    </section>
  `;
}

function render() {
  if (!bin) {
    bin = loadQuizBin();
  }
  ensureSelection();
  if (!root) {
    return;
  }
  const selected = getSelectedImport();
  const body = wizard
    ? renderWizard()
    : selected
      ? renderReport(selected)
      : renderEmptyState();
  root.innerHTML = `<div class="qb-shell">${renderHeader()}${body}</div>`;
}

export function initQuizBinView({
  showToast: toast = () => {},
  getContext: provider = () => ({ quizzes: [] })
} = {}) {
  showToast = toast;
  getContext = provider;
  bin = loadQuizBin();
  ensureSelection();
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".csv,text/csv";
    fileInput.hidden = true;
    document.body.appendChild(fileInput);
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) {
        handleFile(file);
      }
    });
  }
  if (!bound && root) {
    root.addEventListener("click", handleClick);
    root.addEventListener("change", handleChange);
    root.addEventListener("keydown", handleKeydown);
    root.addEventListener("dragover", handleDragOver);
    root.addEventListener("dragleave", handleDragLeave);
    root.addEventListener("drop", handleDrop);
    bound = true;
  }
  render();
}

export function renderQuizBinView() {
  render();
}

export function quizBinHasInsights(quizId) {
  if (!quizId) {
    return false;
  }
  if (!bin) {
    bin = loadQuizBin();
  }
  return bin.imports.some(
    (record) => record.quizId === quizId && !record.unlinked
  );
}

export function unlinkQuizBinImports(quizId) {
  if (!quizId) {
    return;
  }
  if (!bin) {
    bin = loadQuizBin();
  }
  let changed = false;
  for (const record of bin.imports) {
    if (record.quizId === quizId && !record.unlinked) {
      record.unlinked = true;
      changed = true;
    }
  }
  if (!changed) {
    return;
  }
  const result = saveQuizBin(bin);
  if (!result.ok) {
    showToast(
      result.error || "Could not update the linked Quiz Bin import.",
      "danger"
    );
    return;
  }
  bin = normalizeQuizBinState(bin);
}

export function focusQuizBinImportForQuiz(quizId) {
  if (!bin) {
    bin = loadQuizBin();
  }
  const record = bin.imports.find(
    (entry) => entry.quizId === quizId && !entry.unlinked
  );
  if (!record) {
    return false;
  }
  selectedId = record.id;
  activeTab = "overview";
  notesOpen = false;
  wizard = null;
  return true;
}

function openFilePicker(reimportId = null) {
  pendingReimportId = reimportId;
  fileInput?.click();
}

function handleClick(event) {
  const actionElement = event.target.closest("[data-qb-action]");
  if (!actionElement) {
    return;
  }
  const action = actionElement.dataset.qbAction;
  const importId = actionElement.dataset.importId || "";
  if (action === "upload" || action === "browse-file") {
    openFilePicker(null);
  } else if (action === "help") {
    openHelp();
  } else if (action === "reimport") {
    openFilePicker(importId);
  } else if (action === "delete-import") {
    requestDeleteImport(importId);
  } else if (action === "export") {
    openExportMenu(importId);
  } else if (action === "tab") {
    activeTab = actionElement.dataset.tab || "overview";
    render();
  } else if (action === "toggle-notes") {
    notesOpen = !notesOpen;
    render();
  } else if (action === "toggle-advanced") {
    if (wizard) {
      wizard.showAdvanced = !wizard.showAdvanced;
      render();
    }
  } else if (action === "wizard-cancel") {
    wizard = null;
    pendingReimportId = null;
    render();
  } else if (action === "wizard-import") {
    completeWizardImport();
  }
}

function handleChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.matches("[data-qb-import-select]")) {
    selectedId = target.value;
    activeTab = "overview";
    notesOpen = false;
    wizard = null;
    pendingReimportId = null;
    render();
    return;
  }

  if (target.matches("[data-qb-response-sort]")) {
    responseSort = target.value;
    render();
    return;
  }

  if (target.matches("[data-qb-at-risk]")) {
    showAtRiskOnly = target.checked;
    render();
    return;
  }

  if (target.matches("[data-qb-detail-field='passingPercent']")) {
    const record = getSelectedImport();
    if (!record) {
      return;
    }
    const snapshot = snapshotBin();
    record.passingPercent = clamp(Number(target.value) || 0, 0, 100);
    if (persistBin(snapshot)) {
      render();
    }
    return;
  }

  if (target.matches("[data-qb-wizard-field='targetQuizId']")) {
    wizard.targetQuizId = target.value;
    const quiz = (getContext().quizzes || []).find(
      (entry) => entry.id === wizard.targetQuizId
    );
    if (quiz) {
      wizard.title = quiz.title;
      wizard.date = quiz.date;
      wizard.dateSource = "linked quiz";
    } else if (wizard.dateSource === "linked quiz") {
      wizard.date = wizard.firstResponseDate || "";
      wizard.dateSource = wizard.firstResponseDate
        ? "first response"
        : "not detected";
    }
    render();
    return;
  }

  if (target.matches("[data-qb-wizard-field='title']")) {
    wizard.title = target.value.trim();
    return;
  }

  if (target.matches("[data-qb-wizard-field='date']")) {
    wizard.date = target.value;
    wizard.dateSource = target.value ? "manual" : "not detected";
    return;
  }

  if (target.matches("[data-qb-wizard-field='passingPercent']")) {
    wizard.passingPercent = clamp(Number(target.value) || 0, 0, 100);
    return;
  }

  if (target.matches("[data-qb-wizard-field='totalScoreIndex']")) {
    wizard.totalScoreIndex = Number(target.value);
    render();
    return;
  }

  if (!wizard) {
    return;
  }

  const card = target.closest("[data-qb-q-index]");
  if (card) {
    const index = Number(card.dataset.qbQIndex);
    const draft = wizard.questions[index];
    if (!draft) {
      return;
    }
    if (target.matches("[data-qb-q-include]")) {
      draft.include = target.checked;
      render();
      return;
    }
    if (target.matches("[data-qb-q-type]")) {
      draft.type = normalizeQuestionType(target.value);
      render();
      return;
    }
    if (target.matches("[data-qb-q-points]")) {
      draft.points = Math.max(0.01, Number(target.value) || 1);
      return;
    }
    if (target.matches("[data-qb-q-score]")) {
      const value = Number(target.value);
      draft.scoreIndex = value < 0 ? null : value;
      const inferred = inferQuestionPoints(
        wizard.parsed.rows,
        draft.scoreIndex
      );
      if (inferred > 0) {
        draft.points = inferred;
      }
      render();
      return;
    }
    if (target.matches("[data-qb-q-feedback]")) {
      const value = Number(target.value);
      draft.feedbackIndex = value < 0 ? null : value;
      render();
    }
  }
}

function handleKeydown(event) {
  const zone = event.target.closest("[data-qb-dropzone]");
  if (zone && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openFilePicker(null);
  }
}

function handleDragOver(event) {
  const zone = event.target.closest("[data-qb-dropzone]");
  if (!zone) {
    return;
  }
  event.preventDefault();
  zone.classList.add("dragging");
}

function handleDragLeave(event) {
  const zone = event.target.closest("[data-qb-dropzone]");
  if (!zone) {
    return;
  }
  zone.classList.remove("dragging");
}

function handleDrop(event) {
  const zone = event.target.closest("[data-qb-dropzone]");
  if (!zone) {
    return;
  }
  event.preventDefault();
  zone.classList.remove("dragging");
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    handleFile(file);
  }
}

async function handleFile(file) {
  if (!file) {
    return;
  }
  const lowerName = String(file.name || "").toLowerCase();
  if (lowerName.endsWith(".zip")) {
    showToast(
      "Google Forms downloads can be ZIP files. Unzip it and choose the CSV inside.",
      "warning"
    );
    pendingReimportId = null;
    return;
  }
  if (!lowerName.endsWith(".csv")) {
    showToast("Choose a .csv file exported from Google Forms.", "danger");
    pendingReimportId = null;
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast(
      "That CSV is larger than 8 MB. Split it or use a smaller export.",
      "danger"
    );
    pendingReimportId = null;
    return;
  }

  let text = "";
  try {
    text = await file.text();
  } catch {
    showToast("The file could not be read. Try downloading it again.", "danger");
    pendingReimportId = null;
    return;
  }

  const parsed = parseCSV(text);
  if (!parsed.headers.length || !parsed.rows.length) {
    showToast(
      "No response rows were found. Use the CSV from the Google Forms Responses tab.",
      "danger"
    );
    pendingReimportId = null;
    return;
  }
  const columns = detectColumns(parsed.headers);
  if (!columns.questionColumns.length) {
    showToast(
      "No question columns were detected. Check that the CSV includes the form answers.",
      "danger"
    );
    pendingReimportId = null;
    return;
  }

  const previous = pendingReimportId
    ? bin.imports.find((entry) => entry.id === pendingReimportId)
    : null;
  const linkedQuiz =
    previous?.quizId && !previous.unlinked
      ? (getContext().quizzes || []).find(
          (quiz) => quiz.id === previous.quizId
        )
      : null;
  const firstDate = firstResponseDate(parsed.rows, columns.timestampIndex);
  const title =
    previous?.quizTitle ||
    linkedQuiz?.title ||
    file.name.replace(/\.csv$/i, "") ||
    "Imported Quiz";
  const date =
    previous?.quizDate || linkedQuiz?.date || firstDate || "";
  const dateSource = previous?.quizDate
    ? "previous import"
    : linkedQuiz?.date
      ? "linked quiz"
      : firstDate
        ? "first response"
        : "not detected";

  const questions = columns.questionColumns.map((column, index) => {
    const oldQuestion =
      previous?.questions.find(
        (question) =>
          question.prompt === column.header ||
          question.key === questionKey(column.header, index)
      ) || null;
    const detectedType = detectQuestionType(
      column.header,
      parsed.rows,
      column.index
    );
    return {
      include: true,
      index: column.index,
      header: column.header,
      label: oldQuestion?.prompt || column.header,
      scoreIndex: column.scoreIndex,
      feedbackIndex: column.feedbackIndex,
      type:
        oldQuestion && oldQuestion.type !== "single"
          ? normalizeQuestionType(oldQuestion.type)
          : detectedType,
      points:
        inferQuestionPoints(parsed.rows, column.scoreIndex) ||
        oldQuestion?.points ||
        1
    };
  });

  wizard = {
    showAdvanced: false,
    fileName: file.name,
    fileSize: file.size,
    parsed,
    columns,
    replaceId: previous?.id || null,
    targetQuizId: previous?.unlinked
      ? ""
      : previous?.quizId || linkedQuiz?.id || "",
    title,
    date,
    dateSource,
    firstResponseDate: firstDate,
    passingPercent: previous?.passingPercent ?? 75,
    totalScoreIndex: columns.totalScoreIndex,
    questions
  };
  pendingReimportId = null;
  render();
  document
    .querySelector("[data-qb-wizard]")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncWizardFromDOM() {
  if (!wizard) {
    return;
  }
  const valueOf = (name) => {
    const element = root?.querySelector(`[data-qb-wizard-field="${name}"]`);
    return element ? element.value : undefined;
  };
  const targetQuizId = valueOf("targetQuizId");
  if (targetQuizId !== undefined) {
    wizard.targetQuizId = targetQuizId;
  }
  const title = valueOf("title");
  if (title !== undefined) {
    wizard.title = title.trim();
  }
  const date = valueOf("date");
  if (date !== undefined) {
    wizard.date = date;
  }
  const passing = valueOf("passingPercent");
  if (passing !== undefined) {
    wizard.passingPercent = clamp(Number(passing) || 0, 0, 100);
  }
  const totalScore = valueOf("totalScoreIndex");
  if (totalScore !== undefined) {
    wizard.totalScoreIndex = Number(totalScore);
  }

  root?.querySelectorAll("[data-qb-q-index]").forEach((card) => {
    const index = Number(card.dataset.qbQIndex);
    const draft = wizard.questions[index];
    if (!draft) {
      return;
    }
    const include = card.querySelector("[data-qb-q-include]");
    if (include) {
      draft.include = include.checked;
    }
    const type = card.querySelector("[data-qb-q-type]");
    if (type) {
      draft.type = normalizeQuestionType(type.value);
    }
    const score = card.querySelector("[data-qb-q-score]");
    if (score) {
      const value = Number(score.value);
      draft.scoreIndex = value < 0 ? null : value;
      const inferred = inferQuestionPoints(
        wizard.parsed.rows,
        draft.scoreIndex
      );
      if (inferred > 0) {
        draft.points = inferred;
      }
    }
    const feedback = card.querySelector("[data-qb-q-feedback]");
    if (feedback) {
      const value = Number(feedback.value);
      draft.feedbackIndex = value < 0 ? null : value;
    }
    const pointInput = card.querySelector("[data-qb-q-points]");
    if (pointInput) {
      draft.points = Math.max(0.01, Number(pointInput.value) || 1);
    }
  });
}

function buildWizardImport(preview = false) {
  if (!preview) {
    syncWizardFromDOM();
  }
  const targetQuiz =
    (getContext().quizzes || []).find(
      (quiz) => quiz.id === wizard.targetQuizId
    ) || null;
  return buildQuizImport({
    id: preview ? "qb-preview" : nextImportId(),
    sourceFileName: wizard.fileName,
    sourceFileSize: wizard.fileSize,
    rows: wizard.parsed.rows,
    columns: wizard.columns,
    targetQuiz,
    title: wizard.title,
    date: wizard.date,
    passingPercent: wizard.passingPercent,
    totalScoreIndex: wizard.totalScoreIndex,
    questions: wizard.questions
  });
}

function completeWizardImport() {
  if (!wizard) {
    return;
  }
  if (!wizard.title.trim()) {
    wizard.title = wizard.fileName.replace(/\.csv$/i, "") || "Imported Quiz";
  }
  let record;
  try {
    record = buildWizardImport(false);
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : "The import could not be saved.",
      "danger"
    );
    return;
  }
  const replaceId = wizard.replaceId;
  const replacements = (bin.imports || []).filter(
    (entry) =>
      entry.id === replaceId ||
      (record.quizId && entry.quizId === record.quizId)
  );
  const snapshot = snapshotBin();
  bin.imports = [
    record,
    ...(bin.imports || []).filter(
      (entry) =>
        entry.id !== replaceId &&
        !(record.quizId && entry.quizId === record.quizId)
    )
  ];
  if (!persistBin(snapshot)) {
    return;
  }
  selectedId = record.id;
  activeTab = "overview";
  notesOpen = false;
  wizard = null;
  pendingReimportId = null;
  render();
  showToast(
    `Imported ${record.responses.length} ${plural(
      record.responses.length,
      "response"
    )} from "${record.sourceFileName}".${
      replacements.length ? " The previous import was replaced." : ""
    }`,
    "success"
  );
  document
    .getElementById("qb-detail")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function requestDeleteImport(importId) {
  const record = (bin?.imports || []).find((entry) => entry.id === importId);
  if (!record) {
    return;
  }
  openModal({
    title: "Delete this import?",
    content: `
      <p>
        Delete the imported results for <strong>${escapeHTML(record.quizTitle)}</strong>
        (${escapeHTML(formatISODate(record.quizDate))})? This removes
        ${record.responses.length} ${plural(record.responses.length, "response")} from Quiz Bin.
      </p>
      <p>The scheduled quiz and the rest of the app are not changed.</p>
    `,
    actions: [
      { label: "Cancel" },
      {
        label: "Delete",
        variant: "danger",
        onClick: () => {
          const snapshot = snapshotBin();
          bin.imports = bin.imports.filter((entry) => entry.id !== importId);
          if (!persistBin(snapshot)) {
            return;
          }
          render();
          showToast("Import deleted.", "success");
        }
      }
    ]
  });
}

function openExportMenu(importId) {
  openModal({
    title: "Export report",
    content: `
      <p>Download this report as a CSV file. Exports contain anonymous response labels and no names, emails, or student IDs.</p>
    `,
    actions: [
      { label: "Cancel" },
      {
        label: "Questions CSV",
        onClick: () => {
          exportQuestions(importId);
        }
      },
      {
        label: "Responses CSV",
        variant: "primary",
        onClick: () => {
          exportResponses(importId);
        }
      }
    ]
  });
}

function downloadCSV(filename, content) {
  const blob = new Blob([`\uFEFF${content}`], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportQuestions(importId) {
  const record =
    (bin?.imports || []).find((entry) => entry.id === importId) ||
    getSelectedImport();
  if (!record) {
    return;
  }
  const insights = computeQuizInsights(record);
  downloadCSV(
    `${slug(record.quizTitle)}-questions.csv`,
    buildQuestionCSV(record, insights)
  );
  showToast("Question insights exported.", "success");
}

function exportResponses(importId) {
  const record =
    (bin?.imports || []).find((entry) => entry.id === importId) ||
    getSelectedImport();
  if (!record) {
    return;
  }
  const insights = computeQuizInsights(record);
  downloadCSV(
    `${slug(record.quizTitle)}-responses.csv`,
    buildResponseCSV(record, insights)
  );
  showToast("Response insights exported.", "success");
}

function openHelp() {
  openModal({
    title: "How Quiz Bin works",
    content: `
      <div class="qb-help">
        <p><strong>1. Export from Google Forms.</strong> Open the quiz response sheet, choose
        <em>Download responses (.csv)</em>, and unzip the download if needed.</p>
        <p><strong>2. Drop the CSV.</strong> Quiz Bin detects the timestamp, total score,
        question columns, question types, and paired <code>[Score]</code> and
        <code>[Feedback]</code> columns automatically. Name, email, and student ID columns
        are ignored, and responses are labeled <em>Response 1</em>, <em>Response 2</em>, and so on.</p>
        <p><strong>3. Check the import.</strong> Only exceptions are shown. Exported scores
        are the source of truth, and correct answers are inferred from responses that earned
        full credit. No manual answer key is needed. Link a scheduled quiz only if this import
        belongs to one.</p>
        <p><strong>4. Read the report.</strong> Overview shows class results and missed
        questions. Questions shows answer distributions and inferred keys. Responses shows
        anonymous scores and missed questions. Import notes lists warnings, score mismatches,
        and grading details.</p>
        <p>Quiz Bin never uploads the file. Only parsed answers and metadata are saved in
        this browser.</p>
      </div>
    `,
    actions: [{ label: "Got it", variant: "primary" }]
  });
}
