const STOP_WORDS = new Set([
  "quiz",
  "test",
  "exam",
  "assessment",
  "google",
  "forms",
  "form",
  "responses",
  "response",
  "sheet",
  "copy"
]);
const DATE_TOLERANCE_DAYS = 3;

function normalizeMatchText(value) {
  return String(value ?? "")
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchTokens(value) {
  return normalizeMatchText(value)
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
}

function titleSimilarity(left, right) {
  const leftTokens = matchTokens(left);
  const rightTokens = matchTokens(right);
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

function dateMatches(importDate, quizDate) {
  if (!importDate || !quizDate) {
    return null;
  }
  const left = Date.parse(`${importDate}T00:00:00Z`);
  const right = Date.parse(`${quizDate}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  return Math.abs(left - right) <= DATE_TOLERANCE_DAYS * 86400000;
}

export function suggestQuizLink({
  quizzes = [],
  title = "",
  fileName = "",
  date = ""
} = {}) {
  const candidates = [];

  for (const quiz of quizzes) {
    if (!quiz?.id || !quiz?.title) {
      continue;
    }
    const titleScore = Math.max(
      titleSimilarity(title, quiz.title),
      titleSimilarity(fileName, quiz.title)
    );
    if (titleScore < 0.6) {
      continue;
    }
    const dateMatch = dateMatches(date, quiz.date);
    const dateCompatible = dateMatch !== false;
    const confidence =
      dateCompatible && titleScore >= 0.6 ? "high" : "possible";
    candidates.push({
      quiz,
      titleScore,
      dateMatch,
      confidence
    });
  }

  candidates.sort(
    (left, right) =>
      right.titleScore - left.titleScore ||
      Number(Boolean(right.dateMatch)) - Number(Boolean(left.dateMatch))
  );

  const highConfidence = candidates.filter(
    (candidate) => candidate.confidence === "high"
  );
  if (highConfidence.length === 1) {
    return {
      quiz: highConfidence[0].quiz,
      confidence: "high",
      candidates
    };
  }
  if (highConfidence.length > 1) {
    return { quiz: null, confidence: "ambiguous", candidates };
  }
  if (candidates.length === 1) {
    return {
      quiz: null,
      confidence: "possible",
      candidates
    };
  }
  if (candidates.length > 1) {
    return { quiz: null, confidence: "ambiguous", candidates };
  }
  return { quiz: null, confidence: "none", candidates: [] };
}
