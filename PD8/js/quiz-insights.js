import { isMultipleQuestionType } from "./quiz-csv.js";

const EPSILON = 0.01;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function clean(value) {
  return String(value ?? "").trim();
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

function splitValues(value) {
  return uniqueStrings(String(value ?? "").split(/\s*[;,|]\s*/));
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function canonical(value) {
  return splitValues(value).map(normalize).sort().join("|");
}

export function percent(part, total) {
  const denominator = Number(total);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return (Number(part) / denominator) * 100;
}

export function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function populationStandardDeviation(values) {
  if (!values.length) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function responseAnswer(response, questionId) {
  return (
    (response.answers || []).find((answer) => answer.questionId === questionId) ||
    null
  );
}

function answerIsBlank(answer) {
  if (!answer) {
    return true;
  }
  return (
    answer.answered === false ||
    answer.unanswered === true ||
    clean(answer.raw) === ""
  );
}

function responseScore(response, questions) {
  const gradedQuestions = questions.filter((question) => question.graded);
  const computedPossible = gradedQuestions.reduce(
    (sum, question) => sum + Number(question.points || 0),
    0
  );
  const computedEarned = gradedQuestions.reduce((sum, question) => {
    const answer = responseAnswer(response, question.id);
    return sum + (answer ? Number(answer.pointsEarned) || 0 : 0);
  }, 0);

  const exportedScore = Number(response.exportedScore);
  const exportedMax = Number(response.exportedMax);
  const useExported =
    Number.isFinite(exportedScore) &&
    Number.isFinite(exportedMax) &&
    exportedMax > 0;
  const score = useExported ? exportedScore : computedEarned;
  const possible = useExported ? exportedMax : computedPossible;
  return {
    score,
    possible,
    percent: percent(score, possible),
    source: useExported ? "exported" : "computed",
    computedEarned,
    computedPossible
  };
}

function statusForPercent(value, passingPercent) {
  if (value >= passingPercent) {
    return "on-track";
  }
  if (value >= Math.min(50, passingPercent)) {
    return "approaching";
  }
  return "at-risk";
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

function acceptedAnswerKeys(question) {
  if (
    question.answerKeySource !== "inferred" ||
    !Array.isArray(question.correctAnswers) ||
    !question.correctAnswers.length
  ) {
    return { singles: new Set(), combos: new Set() };
  }
  if (isMultipleQuestionType(question.type)) {
    return {
      singles: new Set(),
      combos: new Set(question.correctAnswers.map(canonical))
    };
  }
  return {
    singles: new Set(question.correctAnswers.map(normalize)),
    combos: new Set()
  };
}

function answerMatchesKey(question, raw, keys) {
  if (isMultipleQuestionType(question.type)) {
    return keys.combos.has(canonical(raw));
  }
  return keys.singles.has(normalize(raw));
}

function buildAnswerGroups(question, responses) {
  const keys = acceptedAnswerKeys(question);
  const groups = new Map();
  for (const response of responses) {
    const answer = responseAnswer(response, question.id);
    const raw = clean(answer?.raw);
    const key = raw || "(blank)";
    const group = groups.get(key) || {
      answer: key,
      blank: raw === "",
      isCorrect: raw !== "" && answerMatchesKey(question, raw, keys),
      count: 0,
      fullCredit: 0,
      partial: 0,
      incorrect: 0,
      correct: 0
    };
    group.count += 1;
    if (group.blank) {
      group.correct += 0;
    } else if (answer?.correct === true && !answer.partial) {
      group.fullCredit += 1;
      group.correct += 1;
    } else if (answer?.partial) {
      group.partial += 1;
    } else if (question.graded) {
      group.incorrect += 1;
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.blank !== right.blank) {
      return left.blank ? 1 : -1;
    }
    return right.count - left.count || left.answer.localeCompare(right.answer);
  });
}

function buildOptionGroups(question, responses) {
  if (!isMultipleQuestionType(question.type)) {
    return [];
  }
  const counts = new Map();
  let answeredCount = 0;
  for (const response of responses) {
    const answer = responseAnswer(response, question.id);
    if (answerIsBlank(answer)) {
      continue;
    }
    answeredCount += 1;
    const values = answer.values?.length
      ? answer.values
      : splitValues(answer.raw);
    for (const value of uniqueStrings(values)) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  const correct = new Set(
    (question.correctOptions || []).map((value) => normalize(value))
  );
  return [...counts.entries()]
    .map(([option, count]) => ({
      option,
      count,
      rate: percent(count, answeredCount),
      isCorrect:
        question.answerKeySource === "inferred" && correct.has(normalize(option))
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.option.localeCompare(right.option)
    );
}

function mostCommonWrongAnswer(question, responses) {
  if (!question.graded) {
    return "";
  }
  const groups = new Map();
  for (const response of responses) {
    const answer = responseAnswer(response, question.id);
    if (!answer || answerIsBlank(answer) || answer.correct === true) {
      continue;
    }
    const key = clean(answer.raw);
    if (!key) {
      continue;
    }
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const ranked = [...groups.entries()]
    .map(([answer, count]) => ({ answer, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.answer.localeCompare(right.answer)
    );
  if (!ranked.length) {
    return "";
  }
  const topCount = ranked[0].count;
  const tied = ranked.filter((item) => item.count === topCount);
  return tied.map((item) => item.answer).join(" / ");
}

function difficultyForRate(rate) {
  if (rate >= 80) {
    return "Easy";
  }
  if (rate >= 50) {
    return "Moderate";
  }
  return "Hard";
}

function correctAnswerText(question) {
  if (
    question.answerKeySource !== "inferred" ||
    !Array.isArray(question.correctAnswers) ||
    !question.correctAnswers.length
  ) {
    return "";
  }
  if (isMultipleQuestionType(question.type)) {
    return question.correctAnswers
      .map((value) => splitValues(value).join(", "))
      .join(" / ");
  }
  return question.correctAnswers.join(" | ");
}

function buildQuestionInsights(record) {
  const questions = record.questions || [];
  const responses = record.responses || [];

  const insights = questions.map((question, index) => {
    let fullCredit = 0;
    let partial = 0;
    let incorrect = 0;
    let blank = 0;
    let answered = 0;
    let pointsEarned = 0;

    for (const response of responses) {
      const answer = responseAnswer(response, question.id);
      if (answerIsBlank(answer)) {
        blank += 1;
        continue;
      }
      answered += 1;
      pointsEarned += Number(answer?.pointsEarned) || 0;
      if (answer?.correct === true && !answer?.partial) {
        fullCredit += 1;
      } else if (answer?.partial) {
        partial += 1;
      } else if (question.graded) {
        incorrect += 1;
      }
    }

    const responseCount = responses.length;
    const rate = percent(fullCredit, responseCount);
    const possiblePoints = Number(question.points || 0) * responseCount;
    return {
      ...question,
      index,
      responseCount,
      answeredCount: answered,
      fullCredit,
      partial,
      incorrect,
      blank,
      missedCount: question.graded ? responseCount - fullCredit : 0,
      missedRate: question.graded
        ? percent(responseCount - fullCredit, responseCount)
        : 0,
      rate,
      averagePointsRate: percent(pointsEarned, possiblePoints),
      difficulty: question.graded ? difficultyForRate(rate) : "Not graded",
      mostCommonWrong: mostCommonWrongAnswer(question, responses),
      answerGroups: buildAnswerGroups(question, responses),
      optionGroups: buildOptionGroups(question, responses),
      correctAnswerText: correctAnswerText(question),
      frequentRank: null
    };
  });

  const ranked = insights
    .filter((question) => question.graded && question.responseCount > 0)
    .sort((left, right) => {
      if (right.missedRate !== left.missedRate) {
        return right.missedRate - left.missedRate;
      }
      if (right.points !== left.points) {
        return right.points - left.points;
      }
      return left.index - right.index;
    });
  ranked.forEach((question, index) => {
    question.frequentRank = index + 1;
  });

  return {
    questions: insights,
    rankedQuestions: ranked,
    frequentlyMissed: ranked.slice(0, 5)
  };
}

function buildResponseInsights(record, questions, passingPercent) {
  return (record.responses || []).map((response, index) => {
    const score = responseScore(response, questions);
    const status = statusForPercent(score.percent, passingPercent);
    const missed = [];
    const skipped = [];
    const partial = [];

    for (const question of questions) {
      if (!question.graded) {
        continue;
      }
      const answer = responseAnswer(response, question.id);
      if (answerIsBlank(answer)) {
        missed.push({
          index: question.index,
          questionId: question.id,
          prompt: question.prompt
        });
        skipped.push({
          index: question.index,
          questionId: question.id,
          prompt: question.prompt
        });
      } else if (answer?.partial) {
        missed.push({
          index: question.index,
          questionId: question.id,
          prompt: question.prompt
        });
        partial.push({
          index: question.index,
          questionId: question.id,
          prompt: question.prompt
        });
      } else if (answer?.correct !== true) {
        missed.push({
          index: question.index,
          questionId: question.id,
          prompt: question.prompt
        });
      }
    }

    return {
      ...response,
      index,
      score: score.score,
      possible: score.possible,
      percent: score.percent,
      scoreSource: score.source,
      status,
      statusLabel: statusLabel(status),
      belowPass: score.percent < passingPercent,
      missed,
      skipped,
      partial
    };
  });
}

function buildDistribution(responses) {
  const buckets = Array.from({ length: 10 }, (_, index) => ({
    index,
    label: index === 9 ? "90–100%" : `${index * 10}–${index * 10 + 9}%`,
    count: 0
  }));
  for (const response of responses) {
    const index = clamp(Math.floor(response.percent / 10), 0, 9);
    buckets[index].count += 1;
  }
  return buckets;
}

export function computeQuizInsights(record) {
  const questions = record.questions || [];
  const passingPercent = Number.isFinite(Number(record.passingPercent))
    ? Number(record.passingPercent)
    : 75;
  const questionData = buildQuestionInsights(record);
  const responseData = buildResponseInsights(
    record,
    questionData.questions,
    passingPercent
  );
  const percents = responseData.map((response) => response.percent);
  const gradedQuestions = questions.filter((question) => question.graded);
  const possibleTotal = gradedQuestions.reduce(
    (sum, question) => sum + Number(question.points || 0),
    0
  );
  const missingKeyQuestions = questionData.questions.filter(
    (question) =>
      question.graded && question.answerKeySource !== "inferred"
  );
  const ungradedQuestions = questionData.questions.filter(
    (question) => !question.graded
  );

  const summary = {
    responseCount: responseData.length,
    questionCount: questions.length,
    gradedQuestionCount: gradedQuestions.length,
    possibleTotal,
    average: percents.length
      ? percents.reduce((sum, value) => sum + value, 0) / percents.length
      : 0,
    median: median(percents),
    highest: percents.length ? Math.max(...percents) : 0,
    lowest: percents.length ? Math.min(...percents) : 0,
    standardDeviation: populationStandardDeviation(percents),
    passRate: percent(
      responseData.filter(
        (response) => response.percent >= passingPercent
      ).length,
      responseData.length
    ),
    passingPercent,
    onTrack: responseData.filter(
      (response) => response.status === "on-track"
    ).length,
    approaching: responseData.filter(
      (response) => response.status === "approaching"
    ).length,
    atRisk: responseData.filter((response) => response.status === "at-risk")
      .length,
    belowPass: responseData.filter((response) => response.belowPass).length,
    completionRate: percent(
      responseData.filter((response) => response.skipped.length === 0).length,
      responseData.length
    ),
    inferredKeyCount: questionData.questions.filter(
      (question) => question.answerKeySource === "inferred"
    ).length,
    missingKeyCount: missingKeyQuestions.length,
    multipleAnswerCount: questions.filter((question) =>
      isMultipleQuestionType(question.type)
    ).length
  };

  const scoreMismatches = responseData.filter((response) => {
    if (
      response.exportedScore === null ||
      response.exportedScore === undefined ||
      !Number.isFinite(Number(response.exportedScore))
    ) {
      return false;
    }
    return (
      Math.abs(Number(response.exportedScore) - response.computedTotal) >
      EPSILON
    );
  }).length;
  const unparsableScoreCells = responseData.reduce(
    (total, response) =>
      total +
      (response.answers || []).filter((answer) => answer.invalidScore).length,
    0
  );
  const blankAnswers = responseData.reduce(
    (sum, response) =>
      sum +
      (response.answers || []).filter(
        (answer) => answer.answered === false || answer.unanswered === true
      ).length,
    0
  );
  const partialAnswers = responseData.reduce(
    (sum, response) =>
      sum +
      (response.answers || []).filter((answer) => answer.partial).length,
    0
  );

  return {
    ...questionData,
    summary,
    responses: responseData,
    distribution: buildDistribution(responseData),
    dataQuality: {
      warnings: record.warnings || [],
      scoreMismatches,
      unparsableScoreCells,
      ungradedQuestions,
      missingKeyQuestions,
      inferredKeyCount: summary.inferredKeyCount,
      duplicateRows: Number(record.grading?.duplicateRows) || 0,
      blankAnswers,
      partialAnswers
    }
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function csvLine(values) {
  return values.map(csvCell).join(",");
}

export function buildQuestionCSV(record, insights = computeQuizInsights(record)) {
  const lines = [
    csvLine([
      "number",
      "question",
      "type",
      "points",
      "responses",
      "full_credit",
      "partial",
      "incorrect",
      "blank",
      "full_credit_rate",
      "most_common_wrong",
      "inferred_answer",
      "answer_key_source"
    ])
  ];
  for (const question of insights.questions) {
    lines.push(
      csvLine([
        question.index + 1,
        question.prompt,
        question.type,
        question.points,
        question.responseCount,
        question.fullCredit,
        question.partial,
        question.incorrect,
        question.blank,
        round(question.rate, 1),
        question.mostCommonWrong,
        question.correctAnswerText,
        !question.graded
          ? "not graded"
          : question.answerKeySource === "inferred"
            ? "inferred"
            : "none"
      ])
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function buildResponseCSV(
  record,
  insights = computeQuizInsights(record)
) {
  const lines = [
    csvLine([
      "response",
      "submitted",
      "score",
      "possible",
      "percent",
      "status",
      "missed_questions",
      "skipped_questions"
    ])
  ];
  for (const response of insights.responses) {
    lines.push(
      csvLine([
        response.label,
        response.submittedAtRaw,
        round(response.score, 2),
        round(response.possible, 2),
        round(response.percent, 1),
        response.statusLabel,
        response.missed.map((item) => `Q${item.index + 1}`).join("; "),
        response.skipped.map((item) => `Q${item.index + 1}`).join("; ")
      ])
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
