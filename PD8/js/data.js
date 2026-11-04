import { normalizeState, STATUS } from "./models.js";

export const DEMO_SEMESTER = Object.freeze({
  startDate: "2026-08-05",
  endDate: "2026-12-15",
  classDays: ["Mon", "Wed", "Fri"],
  classTimes: {
    Mon: { start: "09:00", end: "12:00" },
    Wed: { start: "09:00", end: "12:00" },
    Fri: { start: "09:00", end: "12:00" }
  }
});

export const DEMO_TOPICS = Object.freeze([
  {
    id: "t1",
    title: "Variables & Data Types",
    estimatedHours: 24,
    priority: 5,
    dependencies: []
  },
  {
    id: "t2",
    title: "Conditionals",
    estimatedHours: 24,
    priority: 5,
    dependencies: ["t1"]
  },
  {
    id: "t3",
    title: "Loops",
    estimatedHours: 24,
    priority: 4,
    dependencies: ["t2"]
  },
  {
    id: "t4",
    title: "Functions",
    estimatedHours: 21,
    priority: 4,
    dependencies: []
  },
  {
    id: "t5",
    title: "Arrays & Lists",
    estimatedHours: 21,
    priority: 3,
    dependencies: ["t4"]
  },
  {
    id: "t6",
    title: "Objects & Dictionaries",
    estimatedHours: 21,
    priority: 3,
    dependencies: ["t5"]
  },
  {
    id: "t7",
    title: "Recursion Intro",
    estimatedHours: 21,
    priority: 2,
    dependencies: []
  },
  {
    id: "t8",
    title: "Sorting & Searching",
    estimatedHours: 3,
    priority: 1,
    dependencies: []
  }
]);

export const DEMO_QUIZZES = Object.freeze([
  {
    id: "q1",
    date: "2026-09-25",
    title: "Quiz 1",
    coveredTopicIds: ["t1", "t2"]
  },
  {
    id: "q2",
    date: "2026-11-13",
    title: "Quiz 2",
    coveredTopicIds: ["t3", "t4", "t5"]
  }
]);

export const DEMO_HOLIDAYS = Object.freeze([
  { date: "2026-08-21", note: "Ninoy Aquino Day" },
  { date: "2026-11-30", note: "Bonifacio Day" }
]);

export function createDemoState() {
  const calendar = DEMO_HOLIDAYS.map((holiday) => ({
    date: holiday.date,
    type: "suspended",
    allocations: [],
    note: holiday.note,
    suspended: true
  }));

  return normalizeState({
    version: 2,
    semester: {
      ...DEMO_SEMESTER,
      classDays: [...DEMO_SEMESTER.classDays],
      classTimes: Object.fromEntries(
        Object.entries(DEMO_SEMESTER.classTimes).map(([day, time]) => [
          day,
          { ...time }
        ])
      )
    },
    topics: DEMO_TOPICS.map((topic) => ({
      ...topic,
      dependencies: [...topic.dependencies],
      status: STATUS.PENDING,
      hold: false,
      asyncReason: ""
    })),
    quizzes: DEMO_QUIZZES.map((quiz) => ({
      ...quiz,
      coveredTopicIds: [...quiz.coveredTopicIds]
    })),
    calendar,
    lowPriorityThreshold: 2,
    history: []
  });
}

export function createFlowADemoTopic() {
  return {
    id: "t9",
    title: "Debugging Practice",
    estimatedHours: 3,
    priority: 5,
    dependencies: [],
    status: STATUS.PENDING,
    hold: false,
    asyncReason: ""
  };
}
