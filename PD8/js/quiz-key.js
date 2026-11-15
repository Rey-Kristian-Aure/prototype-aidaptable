import {
  isMultipleQuestionType,
  isUngradedQuestionType,
  normalizeQuestionType,
  normalizeTimestamp,
  parsePoints,
  parseTotalScore,
  questionKey
} from "./quiz-csv.js";

const EPSILON = 0.01;

function clean(value) {
  return String(value ?? "").trim();
}

function asFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = clean(value);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function normalizeAnswer(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function splitAnswerValues(value) {
  return uniqueStrings(String(value ?? "").split(/\s*[;,|]\s*/));
}

export function inferQuestionPoints(rows, scoreIndex) {
  if (scoreIndex === null || scoreIndex === undefined || scoreIndex < 0) {
    return 0;
  }
  let max = 0;
  for (const row of rows) {
    const parsed = parsePoints(row[scoreIndex]);
    if (parsed.valid && Number.isFinite(parsed.max) && parsed.max > max) {
      max = parsed.max;
    }
  }
  return max;
}

function buildQuestionOptions(rows, index, type) {
  const values = [];
  for (const row of rows) {
    const raw = clean(row[index]);
    if (!raw) {
      continue;
    }
    if (isMultipleQuestionType(type)) {
      values.push(...splitAnswerValues(raw));
    } else {
      values.push(raw);
    }
  }
  return uniqueStrings(values);
}

function inferScoringSource(questions) {
  return questions.some((question) => question.hasExportedScore)
    ? "exported-scores"
    : "score-only";
}

function parseRowTimestamp(row, timestampIndex) {
  if (timestampIndex < 0) {
    return { raw: "", iso: "" };
  }
  return normalizeTimestamp(row[timestampIndex]);
}

function buildResponse(row, rowIndex, questions, options) {
  const submitted = parseRowTimestamp(row, options.columns.timestampIndex);
  const totalIndex = options.totalScoreIndex;
  const totalRaw = totalIndex >= 0 ? row[totalIndex] : "";
  const total = parseTotalScore(totalRaw);
  let computedTotal = 0;
  let possibleTotal = 0;

  const answers = questions.map((question) => {
    const raw = clean(row[question.index]);
    const rawScore =
      question.scoreIndex !== null ? clean(row[question.scoreIndex]) : "";
    const score = question.scoreIndex !== null ? parsePoints(rawScore) : null;
    const feedback =
      question.feedbackIndex !== null ? row[question.feedbackIndex] ?? "" : "";
    const answered = raw !== "" && !(score && score.unanswered);
    let correct = null;
    let partial = false;
    let pointsEarned = 0;
    let invalidScore = false;

    if (!question.graded) {
      correct = null;
      partial = false;
      pointsEarned = 0;
    } else if (score && score.valid) {
      pointsEarned = score.earned;
      correct = answered && pointsEarned >= question.points - EPSILON;
      partial = answered && pointsEarned > 0 && !correct;
    } else if (score && raw !== "" && score.kind === "invalid") {
      invalidScore = true;
      correct = null;
    } else {
      correct = false;
    }

    if (question.graded) {
      computedTotal += pointsEarned;
      possibleTotal += question.points;
    }

    return {
      questionId: question.id,
      raw,
      rawScore,
      values:
        isMultipleQuestionType(question.type)
          ? splitAnswerValues(raw)
          : raw
            ? [raw]
            : [],
      answered,
      unanswered: !answered,
      correct,
      partial,
      graded: question.graded,
      pointsEarned: Math.max(0, pointsEarned),
      pointsPossible: question.points,
      invalidScore,
      feedback
    };
  });

  const unparsableScoreCells = answers.filter(
    (answer) => answer.invalidScore
  ).length;

  return {
    id: `r${rowIndex + 1}`,
    label: `Response ${rowIndex + 1}`,
    submittedAtRaw: submitted.raw,
    submittedAtISO: submitted.iso,
    exportedScoreRaw: totalRaw,
    exportedScore: total.valid ? total.earned : null,
    exportedMax:
      total.valid && Number.isFinite(total.max) && total.max > 0
        ? total.max
        : null,
    computedTotal,
    possibleTotal,
    unparsableScoreCells,
    answers
  };
}

function canonicalAnswer(value) {
  return splitAnswerValues(value).map(normalizeAnswer).sort().join("|");
}

function inferQuestionKey(question, responses) {
  if (!question.graded || !question.hasExportedScore) {
    question.correctAnswers = [];
    question.correctOptions = [];
    question.answerKeySource = "none";
    question.keyResponseCount = 0;
    return;
  }

  const accepted = new Map();
  let keyResponseCount = 0;

  for (const response of responses) {
    const answer = response.answers.find(
      (entry) => entry.questionId === question.id
    );
    if (
      !answer ||
      !answer.answered ||
      answer.correct !== true ||
      answer.partial
    ) {
      continue;
    }
    const raw = clean(answer.raw);
    if (!raw) {
      continue;
    }
    keyResponseCount += 1;
    const key =
      isMultipleQuestionType(question.type)
        ? canonicalAnswer(raw)
        : normalizeAnswer(raw);
    if (!accepted.has(key)) {
      accepted.set(key, raw);
    }
  }

  question.correctAnswers = [...accepted.values()];
  question.answerKeySource = question.correctAnswers.length
    ? "inferred"
    : "none";
  question.keyResponseCount = keyResponseCount;
  question.correctOptions =
    isMultipleQuestionType(question.type)
      ? uniqueStrings(
          question.correctAnswers.flatMap((value) => splitAnswerValues(value))
        )
      : uniqueStrings(question.correctAnswers);
}

function countDuplicateRows(rows) {
  const seen = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const signature = row.map((cell) => clean(cell)).join("\u0001");
    if (seen.has(signature)) {
      duplicates += 1;
    } else {
      seen.add(signature);
    }
  }
  return duplicates;
}

export function buildQuizImport({
  id,
  sourceFileName,
  sourceFileSize = 0,
  rows,
  columns,
  targetQuiz = null,
  title,
  date,
  passingPercent = 75,
  totalScoreIndex = -1,
  questions: questionDrafts
}) {
  const warnings = [];

  for (const warning of columns?.warnings || []) {
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
  }

  const includedDrafts = (questionDrafts || []).filter(
    (question) => question.include
  );
  if (!includedDrafts.length) {
    throw new Error("Choose at least one question to import.");
  }

  const questions = includedDrafts.map((draft, index) => {
    const scoreIndex =
      draft.scoreIndex === null || draft.scoreIndex === undefined
        ? null
        : Number(draft.scoreIndex);
    const feedbackIndex =
      draft.feedbackIndex === null || draft.feedbackIndex === undefined
        ? null
        : Number(draft.feedbackIndex);
    const inferredPoints = inferQuestionPoints(rows, scoreIndex);
    const points =
      scoreIndex !== null && inferredPoints > 0
        ? inferredPoints
        : Math.max(0.01, asFiniteNumber(draft.points, 1));
    const type = normalizeQuestionType(draft.type);
    const hasUsableScore = scoreIndex !== null && inferredPoints > 0;
    const graded = hasUsableScore;

    if (
      scoreIndex !== null &&
      inferredPoints === 0 &&
      !isUngradedQuestionType(type)
    ) {
      warnings.push(
        `"${draft.header}" has a score column, but no numeric score values were found.`
      );
    }

    return {
      id: `${id}-q${index + 1}`,
      key: questionKey(draft.header, index),
      index: Number(draft.index),
      prompt: clean(draft.label) || draft.header,
      type,
      options: buildQuestionOptions(rows, draft.index, type),
      correctAnswers: [],
      correctOptions: [],
      answerKeySource: "none",
      keyResponseCount: 0,
      points,
      pointSource: hasUsableScore ? "export" : "manual",
      hasExportedScore: scoreIndex !== null,
      hasFeedback: feedbackIndex !== null,
      graded,
      sourceIndex: Number(draft.index),
      scoreIndex,
      feedbackIndex
    };
  });

  const responses = rows.map((row, index) =>
    buildResponse(row, index, questions, {
      columns,
      totalScoreIndex
    })
  );

  for (const question of questions) {
    inferQuestionKey(question, responses);
  }

  const scoreMismatches = questions.some((question) => question.graded)
    ? responses.filter((response) => {
        if (
          response.exportedScore === null ||
          !Number.isFinite(response.exportedScore)
        ) {
          return false;
        }
        return (
          Math.abs(response.exportedScore - response.computedTotal) > EPSILON
        );
      }).length
    : 0;
  const unparsableScoreCells = responses.reduce(
    (total, response) => total + response.unparsableScoreCells,
    0
  );
  const duplicateRows = countDuplicateRows(rows);
  const possibleTotal = questions
    .filter((question) => question.graded)
    .reduce((sum, question) => sum + question.points, 0);
  const exportedPossibleTotal = responses.reduce(
    (max, response) => Math.max(max, Number(response.exportedMax) || 0),
    0
  );
  const ungradedCount = questions.filter(
    (question) =>
      !question.graded && !isUngradedQuestionType(question.type)
  ).length;
  const inferredKeyCount = questions.filter(
    (question) => question.answerKeySource === "inferred"
  ).length;
  const missingKeyCount = questions.filter(
    (question) => question.graded && question.answerKeySource === "none"
  ).length;

  if (
    totalScoreIndex < 0 &&
    !warnings.some((warning) => /No total score column/i.test(warning))
  ) {
    warnings.push(
      "No total score column was detected. Percentages will be computed from the included questions."
    );
  }
  if (duplicateRows > 0) {
    warnings.push(
      `${duplicateRows} duplicate response row${duplicateRows === 1 ? " is" : "s are"} identical to another row. All responses were kept.`
    );
  }
  if (ungradedCount > 0) {
    warnings.push(
      `${ungradedCount} question${ungradedCount === 1 ? " has" : "s have"} no exported score and will be shown without grading.`
    );
  }
  if (scoreMismatches > 0) {
    warnings.push(
      `${scoreMismatches} response${scoreMismatches === 1 ? " has" : "s have"} an exported total that differs from the sum of the per-question scores. The exported total is shown as authoritative.`
    );
  }
  if (unparsableScoreCells > 0) {
    warnings.push(
      `${unparsableScoreCells} per-question score cell${unparsableScoreCells === 1 ? "" : "s"} could not be parsed.`
    );
  }

  return {
    id,
    quizId: targetQuiz?.id || null,
    quizTitle: clean(title) || clean(targetQuiz?.title) || "Untitled Quiz",
    quizDate: date || targetQuiz?.date || "",
    sourceFileName: clean(sourceFileName),
    sourceFileSize,
    sourceRowCount: rows.length,
    importedAt: new Date().toISOString(),
    passingPercent: Math.min(
      100,
      Math.max(0, asFiniteNumber(passingPercent, 75))
    ),
    scoringSource: inferScoringSource(questions),
    questions,
    responses,
    grading: {
      possibleTotal,
      exportedPossibleTotal,
      scoreMismatches,
      unparsableScoreCells,
      duplicateRows,
      inferredKeyCount,
      missingKeyCount
    },
    warnings
  };
}
