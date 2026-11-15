const SCORE_SUFFIX = /\s*\[Score\]\s*$/i;
const FEEDBACK_SUFFIX = /\s*\[Feedback\]\s*$/i;
const DELIMITERS = [",", ";", "\t"];

function cleanHeader(value, index) {
  const text = String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  return text || `Column ${index + 1}`;
}

function isCompanionHeader(header) {
  return SCORE_SUFFIX.test(header) || FEEDBACK_SUFFIX.test(header);
}

function companionBase(header) {
  return header.replace(SCORE_SUFFIX, "").replace(FEEDBACK_SUFFIX, "").trim();
}

function companionKind(header) {
  if (SCORE_SUFFIX.test(header)) {
    return "score";
  }
  if (FEEDBACK_SUFFIX.test(header)) {
    return "feedback";
  }
  return "";
}

function isTimestampHeader(header) {
  return /timestamp|date submitted|submission time/i.test(header);
}

function isTotalScoreHeader(header) {
  const lower = header.toLowerCase().trim();
  return lower === "score" || lower.includes("total score");
}

function normalizedHeader(header) {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[?:.!]+$/g, "")
    .trim();
}

function isEmailHeader(header) {
  const text = normalizedHeader(header);
  if (!text) {
    return false;
  }
  if (/^(e-?mail|e-?mail address|email add(ress)?)$/.test(text)) {
    return true;
  }
  return /^(please )?(enter|type|write|provide|input) (your )?e-?mail( address)?$/.test(
    text
  ) || /^(what is|what's) your e-?mail( address)?$/.test(text);
}

function isNameHeader(header) {
  const text = normalizedHeader(header);
  if (!text) {
    return false;
  }
  return (
    /^(full )?name( of (the )?(student|respondent|learner))?$/.test(text) ||
    /^(respondent|student|learner|participant)$/.test(text) ||
    /^(student|respondent|learner)(?:'s)? (full )?name$/.test(text) ||
    /^(please )?(enter|type|write|provide|input) (your )?(full )?name$/.test(
      text
    ) ||
    /^(what is|what's) your (full )?name$/.test(text) ||
    /^your (full )?name$/.test(text) ||
    /^(full )?name \(last[^)]*\)$/.test(text)
  );
}

function isStudentIdHeader(header) {
  const text = normalizedHeader(header);
  if (!text) {
    return false;
  }
  if (
    /^(student\s*id|student\s*number|id|id\s*number|external\s*id|learner\s*reference\s*number|lrn)$/.test(
      text
    )
  ) {
    return true;
  }
  return /^(please )?(enter|type|write|provide|input) (your )?(student\s*id|student\s*number|lrn)$/.test(
    text
  );
}

function findHeaderIndex(headers, predicate) {
  return headers.findIndex((header, index) => {
    if (isCompanionHeader(header)) {
      return false;
    }
    return predicate(header, index);
  });
}

const MULTIPLE_ANSWER_HINTS = [
  /\b(select|choose|check|pick)\s+(all|any|every)\b/i,
  /\b(all|any|every)\s+that\s+apply\b/i,
  /\b(select|choose|check|pick)\s+(the\s+)?(correct\s+)?answers\b/i,
  /\b(multiple|more than one)\s+(answers?|choices?|options?|selections?)\b/i,
  /\bselect\s+multiple\b/i
];
const COMMA_MULTIPLE_HINT =
  /\bwhich of the following\b|\b(select|choose|check|pick)\b.*\b(following|subjects?|topics?|items?|options?|answers?|statements?|choices?)\b/i;
const SHORT_ANSWER_HINTS = [
  /\bfill[\s-]*in[\s-]*(the[\s-]+)?(missing[\s-]+)?(blank|word|phrase)s?\b/i,
  /\bcomplete\s+(the\s+)?(sentence|statement|phrase|blank)\b/i,
  /\b(short|brief)\s+answer\b/i,
  /\btype\s+(in\s+)?(your|the)\s+answer\b/i,
  /_{3,}/
];
const PARAGRAPH_HINTS = [
  /\b(describe|explain|discuss|elaborate|essay|paragraph|long answer|reflection)\b/i,
  /\b(tell (us|me) (about|why|how))\b/i
];
const GRID_ROW_SUFFIX = /\s+\[([^\]]+)\]\s*$/;
const DATE_VALUE_PATTERN =
  /^(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})$/i;
const TIME_VALUE_PATTERN =
  /^(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))$/i;
const RATING_HEADER =
  /\b(?:rate|rating)\s+(?:your|the|this|these)\b|\blinear\s+scale\b|\brating\s+scale\b/i;
const SCALE_HEADER = /\b(?:on\s+a\s+scale|scale\s+of\s+\d|linear\s+scale)\b/i;
const SATISFACTION_HEADER =
  /\bhow\s+(?:satisfied|likely|would\s+you\s+rate|do\s+you\s+rate)\b/i;
const FILE_UPLOAD_HEADER =
  /^\s*(?:upload|attach)\b|\bfile\s+upload\b|\b(?:upload|attach)\s+(?:a|an|your|the)\b|\badd\s+(?:a|an|your|the)?\s*(?:file|photo|document|image)\b/i;
const RATING_VALUE_HEADER =
  /\b(?:rate|rating|scale|satisfied|satisfaction|likely|recommend)\b|\bhow\s+(?:difficult|easy|satisfied|likely)\b/i;
const FILE_URL_PATTERN =
  /^https?:\/\/(?:(?:drive|docs)\.google\.com\/|(?:www\.)?\S+\/(?:file|files)\/d\/|\S+\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|zip|csv)(?:\?\S*)?$)/i;

export const QUESTION_TYPE_VALUES = [
  "single",
  "short",
  "paragraph",
  "multiple",
  "grid-single",
  "grid-multiple",
  "date",
  "time"
];

export function normalizeQuestionType(value) {
  return QUESTION_TYPE_VALUES.includes(value) ? value : "single";
}

export function isMultipleQuestionType(value) {
  return value === "multiple" || value === "grid-multiple";
}

export function isGridQuestionType(value) {
  return value === "grid-single" || value === "grid-multiple";
}

export function isUngradedQuestionType(value) {
  return value === "paragraph" || value === "date" || value === "time";
}

export function isIgnoredQuestionHeader(header) {
  const text = normalizedHeader(header);
  return (
    RATING_HEADER.test(text) ||
    SCALE_HEADER.test(text) ||
    SATISFACTION_HEADER.test(text) ||
    FILE_UPLOAD_HEADER.test(text)
  );
}

function answerValues(rows, index) {
  if (index < 0 || !Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => String(row?.[index] ?? "").trim())
    .filter(Boolean);
}

function hasMultipleAnswerShape(text, values) {
  if (values.some((value) => /[;|]/.test(value))) {
    return true;
  }
  if (COMMA_MULTIPLE_HINT.test(text)) {
    const commaRows = values.filter(
      (value) => value.split(",").filter((part) => part.trim()).length >= 2
    );
    if (commaRows.length >= Math.max(1, Math.ceil(values.length / 2))) {
      return true;
    }
  }
  return false;
}

function valuesMatchPattern(values, pattern) {
  return (
    values.length > 0 &&
    values.filter((value) => pattern.test(value)).length >=
      Math.max(1, Math.ceil(values.length / 2))
  );
}

export function detectQuestionType(header, rows = [], index = -1) {
  const text = String(header ?? "");
  const values = answerValues(rows, index);
  const gridRow = text.match(GRID_ROW_SUFFIX);

  if (gridRow) {
    return MULTIPLE_ANSWER_HINTS.some((pattern) => pattern.test(gridRow[1])) ||
      hasMultipleAnswerShape(gridRow[1], values)
      ? "grid-multiple"
      : "grid-single";
  }
  if (MULTIPLE_ANSWER_HINTS.some((pattern) => pattern.test(text))) {
    return "multiple";
  }
  if (PARAGRAPH_HINTS.some((pattern) => pattern.test(text))) {
    return "paragraph";
  }
  if (hasMultipleAnswerShape(text, values)) {
    return "multiple";
  }
  if (valuesMatchPattern(values, DATE_VALUE_PATTERN)) {
    return "date";
  }
  if (valuesMatchPattern(values, TIME_VALUE_PATTERN)) {
    return "time";
  }
  if (SHORT_ANSWER_HINTS.some((pattern) => pattern.test(text))) {
    return "short";
  }

  const longValues = values.filter(
    (value) => value.length >= 100 && /\s/.test(value)
  );
  if (longValues.length >= Math.max(1, Math.ceil(values.length / 2))) {
    return "paragraph";
  }
  return "single";
}

export function detectDelimiter(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const counts = new Map(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (inQuotes && source[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      continue;
    }
    if (char === "\n" || char === "\r") {
      break;
    }
    if (counts.has(char)) {
      counts.set(char, counts.get(char) + 1);
    }
  }

  let best = ",";
  let bestCount = -1;
  for (const delimiter of DELIMITERS) {
    const count = counts.get(delimiter) || 0;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

export function parseCSV(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(source);
  const warnings = [];
  const records = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      if (source[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    warnings.push("The file ends inside a quoted field. Check for a missing closing quote.");
  }
  if (field !== "" || row.length) {
    row.push(field);
    records.push(row);
  }

  const nonEmpty = records.filter((entry) =>
    entry.some((cell) => String(cell).trim() !== "")
  );
  if (!nonEmpty.length) {
    return { headers: [], rows: [], delimiter, warnings };
  }

  const headers = nonEmpty[0].map((header, index) => cleanHeader(header, index));
  const rows = nonEmpty
    .slice(1)
    .filter((entry) => entry.some((cell) => String(cell).trim() !== ""))
    .map((entry) => headers.map((_, index) => String(entry[index] ?? "").trim()));

  return { headers, rows, delimiter, warnings };
}

function scoreCompanionIndex(headers, header) {
  return headers.findIndex(
    (candidate) =>
      isCompanionHeader(candidate) &&
      companionKind(candidate) === "score" &&
      companionBase(candidate) === header
  );
}

function hasNumericScoreValues(rows, scoreIndex) {
  if (scoreIndex < 0) {
    return false;
  }
  return (rows || []).some((row) => {
    const parsed = parsePoints(row?.[scoreIndex]);
    return parsed.valid && Number.isFinite(parsed.max) && parsed.max > 0;
  });
}

function valuesLookLikeFileUrls(values) {
  if (!values.length) {
    return false;
  }
  const matches = values.filter((value) => FILE_URL_PATTERN.test(value)).length;
  return matches >= Math.max(1, Math.ceil(values.length / 2));
}

function valuesLookLikeSmallIntegers(values) {
  if (!values.length) {
    return false;
  }
  const matches = values.filter((value) => {
    if (!/^\d{1,2}$/.test(value)) {
      return false;
    }
    const number = Number(value);
    return number >= 0 && number <= 10;
  }).length;
  return matches >= Math.max(1, Math.ceil(values.length / 2));
}

function isLikelyIgnoredByValues(header, index, headers, rows) {
  const values = answerValues(rows, index);
  if (!values.length) {
    return false;
  }
  const scoreIndex = scoreCompanionIndex(headers, header);
  if (hasNumericScoreValues(rows, scoreIndex)) {
    return false;
  }
  if (valuesLookLikeFileUrls(values)) {
    return true;
  }
  return RATING_VALUE_HEADER.test(header) && valuesLookLikeSmallIntegers(values);
}

export function detectColumns(headers, rows = []) {
  const cleaned = headers.map((header, index) => cleanHeader(header, index));
  const warnings = [];
  const timestampIndex = findHeaderIndex(cleaned, isTimestampHeader);
  const totalScoreIndex = findHeaderIndex(cleaned, isTotalScoreHeader);
  const emailIndex = findHeaderIndex(cleaned, isEmailHeader);
  const nameIndex = findHeaderIndex(cleaned, isNameHeader);
  const studentIdIndex = findHeaderIndex(cleaned, isStudentIdHeader);

  const groups = new Map();
  const ignoredIndexes = new Set();
  const ignoredBases = new Set();
  cleaned.forEach((header, index) => {
    if (!isCompanionHeader(header) && isIgnoredQuestionHeader(header)) {
      ignoredIndexes.add(index);
      ignoredBases.add(header);
    }
  });
  if (Array.isArray(rows) && rows.length) {
    cleaned.forEach((header, index) => {
      if (
        isCompanionHeader(header) ||
        ignoredIndexes.has(index) ||
        index === timestampIndex ||
        index === totalScoreIndex ||
        index === emailIndex ||
        index === nameIndex ||
        index === studentIdIndex
      ) {
        return;
      }
      if (isLikelyIgnoredByValues(header, index, cleaned, rows)) {
        ignoredIndexes.add(index);
        ignoredBases.add(header);
      }
    });
  }
  const identityHeaders = new Set(
    [nameIndex, emailIndex, studentIdIndex]
      .filter((index) => index >= 0)
      .map((index) => cleaned[index])
  );
  cleaned.forEach((header, index) => {
    if (
      index === timestampIndex ||
      index === totalScoreIndex ||
      index === emailIndex ||
      index === nameIndex ||
      index === studentIdIndex ||
      ignoredIndexes.has(index) ||
      isCompanionHeader(header)
    ) {
      return;
    }
    groups.set(index, {
      index,
      header,
      label: header,
      scoreIndex: null,
      feedbackIndex: null
    });
  });

  cleaned.forEach((header, index) => {
    if (!isCompanionHeader(header)) {
      return;
    }
    const base = companionBase(header);
    const kind = companionKind(header);
    let targetIndex = -1;
    for (const [groupIndex, group] of groups) {
      if (group.header !== base) {
        continue;
      }
      if (kind === "score" && group.scoreIndex === null) {
        targetIndex = groupIndex;
        break;
      }
      if (kind === "feedback" && group.feedbackIndex === null) {
        targetIndex = groupIndex;
        break;
      }
    }
    if (targetIndex === -1) {
      if (!identityHeaders.has(base) && !ignoredBases.has(base)) {
        warnings.push(
          `"${header}" does not have a matching question column and will be ignored.`
        );
      }
      return;
    }
    const group = groups.get(targetIndex);
    if (kind === "score") {
      group.scoreIndex = index;
    } else {
      group.feedbackIndex = index;
    }
  });

  const questionColumns = [...groups.values()];
  if (!questionColumns.length) {
    warnings.push("No question columns were detected in this file.");
  }
  if (totalScoreIndex === -1) {
    warnings.push("No total score column was detected.");
  }
  if (timestampIndex === -1) {
    warnings.push("No timestamp column was detected.");
  }

  const identityCandidates = [];
  for (const candidate of [
    { index: nameIndex, kind: "name" },
    { index: emailIndex, kind: "email" },
    { index: studentIdIndex, kind: "studentId" }
  ]) {
    if (candidate.index >= 0) {
      identityCandidates.push({
        ...candidate,
        header: cleaned[candidate.index]
      });
    }
  }

  return {
    timestampIndex,
    totalScoreIndex,
    emailIndex,
    nameIndex,
    studentIdIndex,
    identityCandidates,
    ignoredColumns: [...ignoredIndexes].map((index) => ({
      index,
      header: cleaned[index]
    })),
    questionColumns,
    warnings
  };
}

export function parsePoints(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return {
      raw,
      earned: 0,
      max: null,
      unanswered: true,
      valid: false,
      kind: "blank"
    };
  }

  let match = raw.match(/^--\s*\/\s*([\d.,]+)$/);
  if (match) {
    const max = Number(match[1].replace(/,/g, ""));
    return {
      raw,
      earned: 0,
      max: Number.isFinite(max) ? max : null,
      unanswered: true,
      valid: Number.isFinite(max),
      kind: "skipped"
    };
  }

  match = raw.match(/^([\d.,]+)\s*\/\s*([\d.,]+)$/);
  if (match) {
    const earned = Number(match[1].replace(/,/g, ""));
    const max = Number(match[2].replace(/,/g, ""));
    return {
      raw,
      earned: Number.isFinite(earned) ? earned : 0,
      max: Number.isFinite(max) ? max : null,
      unanswered: false,
      valid: Number.isFinite(earned) && Number.isFinite(max),
      kind: "points"
    };
  }

  match = raw.match(/^([\d.,]+)\s*%$/);
  if (match) {
    const earned = Number(match[1].replace(/,/g, ""));
    return {
      raw,
      earned: Number.isFinite(earned) ? earned : 0,
      max: 100,
      unanswered: false,
      valid: Number.isFinite(earned),
      kind: "percent"
    };
  }

  const numeric = Number(raw.replace(/,/g, ""));
  if (Number.isFinite(numeric)) {
    return {
      raw,
      earned: numeric,
      max: null,
      unanswered: false,
      valid: true,
      kind: "number"
    };
  }

  return {
    raw,
    earned: 0,
    max: null,
    unanswered: false,
    valid: false,
    kind: "invalid"
  };
}

export function parseTotalScore(value) {
  return parsePoints(value);
}

export function normalizeTimestamp(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { raw, iso: "" };
  }

  const match = raw.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(AM|PM)?(?:\s*(GMT|UTC)([+-]\d{1,2})(?::?(\d{2}))?)?/i
  );

  if (!match) {
    const date = new Date(raw);
    return {
      raw,
      iso: Number.isNaN(date.getTime()) ? "" : date.toISOString()
    };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let hours = match[4] === undefined ? 0 : Number(match[4]);
  const minutes = match[5] === undefined ? 0 : Number(match[5]);
  const seconds = match[6] === undefined ? 0 : Number(match[6]);
  const meridiem = (match[7] || "").toUpperCase();
  if (meridiem === "AM" && hours === 12) {
    hours = 0;
  } else if (meridiem === "PM" && hours < 12) {
    hours += 12;
  }

  let offset = "";
  if (match[9]) {
    const zoneHours = Number(match[9]);
    const zoneMinutes = Number(match[10] || 0);
    const sign = match[9].startsWith("-") ? "-" : "+";
    offset = `${sign}${String(Math.abs(zoneHours)).padStart(2, "0")}:${String(
      Math.abs(zoneMinutes)
    ).padStart(2, "0")}`;
  }

  const pad = (item) => String(item).padStart(2, "0");
  return {
    raw,
    iso: `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(
      seconds
    )}${offset}`
  };
}

export function questionKey(header, index = 0) {
  const base = String(header ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "question"}-${index + 1}`;
}
