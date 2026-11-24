import { normalizeState, STATUS } from "./models.js";
import { normalizeQuizBinState } from "./quiz-storage.js";

// The guided tour deliberately uses its own semester and Quiz Bin state. It
// never reads or writes the scheduling state or the Quiz Bin storage keys.
export const TUTORIAL_SEMESTER = Object.freeze({
  startDate: "2026-09-07",
  endDate: "2026-12-11",
  classDays: ["Mon", "Wed", "Fri"],
  classTimes: {
    Mon: { start: "09:00", end: "12:00" },
    Wed: { start: "09:00", end: "12:00" },
    Fri: { start: "09:00", end: "12:00" }
  }
});

export const TUTORIAL_TOPICS = Object.freeze([
  {
    id: "t1",
    title: "Place Value & Rounding",
    estimatedHours: 24,
    priority: 5,
    dependencies: []
  },
  {
    id: "t2",
    title: "Fractions",
    estimatedHours: 24,
    priority: 5,
    dependencies: ["t1"]
  },
  {
    id: "t3",
    title: "Decimals",
    estimatedHours: 24,
    priority: 4,
    dependencies: ["t2"]
  },
  {
    id: "t4",
    title: "Ratios & Rates",
    estimatedHours: 24,
    priority: 4,
    dependencies: []
  },
  {
    id: "t5",
    title: "Percent Applications",
    estimatedHours: 21,
    priority: 3,
    dependencies: ["t4"]
  }
]);

export const TUTORIAL_QUIZZES = Object.freeze([
  {
    id: "tq1",
    date: "2026-10-02",
    title: "Checkpoint 1",
    coveredTopicIds: ["t1"]
  },
  {
    id: "tq2",
    date: "2026-11-06",
    title: "Checkpoint 2",
    coveredTopicIds: ["t2", "t3"]
  }
]);

export const TUTORIAL_SUSPENSIONS = Object.freeze([
  { date: "2026-11-30", note: "Bonifacio Day" }
]);

export function createTutorialDemoState() {
  const calendar = TUTORIAL_SUSPENSIONS.map((suspension) => ({
    date: suspension.date,
    type: "suspended",
    allocations: [],
    note: suspension.note,
    suspended: true
  }));

  return normalizeState({
    version: 2,
    semester: {
      ...TUTORIAL_SEMESTER,
      classDays: [...TUTORIAL_SEMESTER.classDays],
      classTimes: Object.fromEntries(
        Object.entries(TUTORIAL_SEMESTER.classTimes).map(([day, time]) => [
          day,
          { ...time }
        ])
      )
    },
    topics: TUTORIAL_TOPICS.map((topic) => ({
      ...topic,
      dependencies: [...topic.dependencies],
      status: STATUS.PENDING,
      hold: false,
      asyncReason: ""
    })),
    quizzes: TUTORIAL_QUIZZES.map((quiz) => ({
      ...quiz,
      coveredTopicIds: [...quiz.coveredTopicIds]
    })),
    calendar,
    lowPriorityThreshold: 2,
    history: []
  });
}

function tutorialQuestion({
  id,
  prompt,
  type,
  options,
  correctAnswers,
  correctOptions,
  keyResponseCount
}) {
  return {
    id,
    key: id,
    prompt,
    type,
    options: [...options],
    correctAnswers: [...correctAnswers],
    correctOptions: [...correctOptions],
    answerKeySource: "inferred",
    keyResponseCount,
    points: 1,
    pointSource: "manual",
    graded: true
  };
}

function tutorialAnswer(questionId, raw, { correct, partial = false, points }) {
  return {
    questionId,
    raw,
    rawScore: "",
    values: raw ? raw.split(/\s*,\s*/) : [],
    answered: Boolean(raw),
    unanswered: !raw,
    correct,
    partial,
    graded: true,
    pointsEarned: points,
    pointsPossible: 1,
    invalidScore: false,
    feedback: ""
  };
}

function tutorialResponse(id, submittedAtRaw, answers) {
  return {
    id,
    submittedAtRaw,
    submittedAtISO: "",
    exportedScoreRaw: "",
    exportedScore: null,
    exportedMax: null,
    computedTotal: answers.reduce((sum, answer) => sum + answer.pointsEarned, 0),
    possibleTotal: 3,
    unparsableScoreCells: 0,
    answers
  };
}

export function createEmptyTutorialQuizBinState() {
  return normalizeQuizBinState({ version: 2, imports: [] });
}

export function createTutorialQuizBinState() {
  const questions = [
    tutorialQuestion({
      id: "q1",
      prompt: "Which digit is in the hundredths place in 4.27?",
      type: "single",
      options: ["2", "7", "4", "0"],
      correctAnswers: ["2"],
      correctOptions: ["2"],
      keyResponseCount: 4
    }),
    tutorialQuestion({
      id: "q2",
      prompt: "Select all fractions equivalent to 1/2.",
      type: "multiple",
      options: ["2/4", "3/6", "4/6", "5/10"],
      correctAnswers: ["2/4, 3/6, 5/10"],
      correctOptions: ["2/4", "3/6", "5/10"],
      keyResponseCount: 3
    }),
    tutorialQuestion({
      id: "q3",
      prompt: "What is 0.75 written as a fraction in simplest form?",
      type: "single",
      options: ["3/4", "7/5", "75/10", "1/4"],
      correctAnswers: ["3/4"],
      correctOptions: ["3/4"],
      keyResponseCount: 5
    })
  ];

  const responses = [
    tutorialResponse("r1", "2026-10-02 09:10:00", [
      tutorialAnswer("q1", "2", { correct: true, points: 1 }),
      tutorialAnswer("q2", "2/4, 3/6, 5/10", { correct: true, points: 1 }),
      tutorialAnswer("q3", "3/4", { correct: true, points: 1 })
    ]),
    tutorialResponse("r2", "2026-10-02 09:11:00", [
      tutorialAnswer("q1", "2", { correct: true, points: 1 }),
      tutorialAnswer("q2", "2/4, 3/6", {
        correct: false,
        partial: true,
        points: 0.5
      }),
      tutorialAnswer("q3", "3/4", { correct: true, points: 1 })
    ]),
    tutorialResponse("r3", "2026-10-02 09:12:00", [
      tutorialAnswer("q1", "7", { correct: false, points: 0 }),
      tutorialAnswer("q2", "2/4, 3/6, 5/10", { correct: true, points: 1 }),
      tutorialAnswer("q3", "3/4", { correct: true, points: 1 })
    ]),
    tutorialResponse("r4", "2026-10-02 09:13:00", [
      tutorialAnswer("q1", "2", { correct: true, points: 1 }),
      tutorialAnswer("q2", "2/4", { correct: false, points: 0 }),
      tutorialAnswer("q3", "7/5", { correct: false, points: 0 })
    ]),
    tutorialResponse("r5", "2026-10-02 09:14:00", [
      tutorialAnswer("q1", "", { correct: false, points: 0 }),
      tutorialAnswer("q2", "2/4, 3/6, 5/10", { correct: true, points: 1 }),
      tutorialAnswer("q3", "3/4", { correct: true, points: 1 })
    ]),
    tutorialResponse("r6", "2026-10-02 09:15:00", [
      tutorialAnswer("q1", "2", { correct: true, points: 1 }),
      tutorialAnswer("q2", "2/4, 3/6, 5/10", { correct: true, points: 1 }),
      tutorialAnswer("q3", "3/4", { correct: true, points: 1 })
    ])
  ];

  return normalizeQuizBinState({
    version: 2,
    imports: [
      {
        id: "tutorial-import",
        quizId: "tq1",
        quizTitle: "Checkpoint 1",
        quizDate: "2026-10-02",
        sourceFileName: "checkpoint-1-responses.csv",
        sourceFileSize: 2048,
        sourceRowCount: responses.length,
        importedAt: "2026-10-03T09:00:00.000Z",
        passingPercent: 75,
        unlinked: false,
        scoringSource: "exported-scores",
        questions,
        responses,
        grading: {
          possibleTotal: 3,
          exportedPossibleTotal: 3,
          scoreMismatches: 0,
          unparsableScoreCells: 0,
          duplicateRows: 0,
          inferredKeyCount: 3,
          missingKeyCount: 0
        },
        warnings: []
      }
    ]
  });
}
