# Quiz Bin: Google Forms CSV Extraction and Insights Plan

> **Status:** Superseded. This plan is kept for historical context; the implemented Quiz Bin is documented in `README.md` under **Quiz Bin**. The implementation no longer uses student identity, topics, manual answer keys, confidence/source metadata, or a separate review step.
>
> **Revised after reviewing the sample CSV:** `Philippines and Its Archipelago Quiz.csv` includes per-question `[Score]` and `[Feedback]` columns. The plan now treats those exported scores as the primary grading source and makes the answer key optional.
>
> **Goal:** Add a third main screen called **Quiz Bin** where a teacher uploads Google Forms response CSVs and sees class-level and student-level insights, including frequently missed questions, that the Google Forms CSV export does not provide.

---

## 1. Summary

Google Forms is a practical quiz delivery tool, and its CSV export is easy to obtain. However, the CSV is a flat response table. It is not an analytics report. It gives us raw answers and scores, but it does not give us:

- average, median, or pass rate,
- score distribution,
- per-question difficulty,
- frequently missed questions,
- distractor analysis,
- per-student gaps,
- per-topic mastery.

The provided sample export includes a `[Score]` and a `[Feedback]` column for every question. That means per-question correctness can be read directly from the CSV, without reconstructing the answer key.

This plan supports both export shapes:

1. **Scored export (preferred):** question columns come with `[Score]` and `[Feedback]` companions. The app reads points directly, so no answer key is required.
2. **Plain export:** only answer text and a total score are present. The app can show score-level insights immediately, and can optionally use a teacher-entered answer key for question-level insights.

This plan adds a **Quiz Bin** screen that imports the CSV, computes those insights locally in the browser, and stores the results for later comparison.

The app remains dependency-free and client-side. No server, account, or Google API integration is required.

---

## 2. What a Google Forms CSV actually contains

### 2.1 Scored export (confirmed by the provided sample)

The provided `Philippines and Its Archipelago Quiz.csv` has 32 columns for 10 questions:

```text
Timestamp
Total score
<Question 1>
<Question 1> [Score]
<Question 1> [Feedback]
<Question 2>
<Question 2> [Score]
<Question 2> [Feedback]
...
```

The first data row looks like this:

| Timestamp | Total score | Q1 answer | Q1 [Score] | Q1 [Feedback] | ... |
| --- | --- | --- | --- | --- | --- |
| `2026/11/13 11:32:52 AM GMT+8` | `4.00 / 10` | `Over 7600` | `1.00 / 1` | *(blank)* | ... |
| `2026/11/13 11:35:04 AM GMT+8` | `1.00 / 10` | `Exactly 6000` | `0.00 / 1` | *(blank)* | ... |

Observed details that the parser must handle:

- Each question occupies **three columns**: answer, `[Score]`, `[Feedback]`.
- `[Score]` values look like `1.00 / 1`, `0.00 / 1`, or `-- / 1` when unanswered.
- The total score looks like `4.00 / 10`.
- `[Feedback]` can be empty for every row.
- The export contains **no student name, email, or ID** in this sample. Identity must be generated or added by the teacher.
- Headers are full question text and can contain commas, apostrophes, and other punctuation.
- Timestamps can use a non-ISO, locale-style format with a timezone suffix.

### 2.2 Plain export

Some exports or manual-grading workflows may contain only:

```text
Timestamp, Email Address, Score, <Question 1>, <Question 2>, ...
```

In that shape, per-question correctness is not available. The app then falls back to score-only insights or an optional answer key.

### 2.3 Key facts that shape the design

1. **One row = one submission.** There is no guaranteed student ID.
2. **Scored exports have three columns per question.** `[Score]` and `[Feedback]` must be grouped with their parent question, not treated as separate questions.
3. **Answer cells contain text**, not points. Multiple-choice questions contain the chosen option text. Checkbox answers may be one comma-joined cell.
4. **Per-question scores use a points format.** `1.00 / 1` is full credit, `0.00 / 1` is no credit, and `-- / 1` is an unanswered question. Partial credit must be supported.
5. **The answer key is still absent**, even in the scored export. It is not needed to determine correctness, but it is needed if the teacher wants to display the correct answer text.
6. **Grid questions become multiple columns**, often with headers like `Question [Row label]`.
7. **A "Download responses (.csv)" download may arrive as a `.zip`** containing one CSV, depending on the environment.
8. **CSV is a snapshot.** Re-downloading later produces a new file with new rows.

### 2.4 What is missing from the CSV

The missing layer is **analysis**, not raw correctness:

- class averages and pass rates,
- score distribution,
- per-question correct rates and difficulty ranking,
- frequently missed questions,
- common wrong answers,
- student status and gaps,
- topic-level mastery.

The answer key is optional in scored exports. It only becomes required for question-level insights in a plain export, where there is no `[Score]` column.

**Recommended key handling:**

- If `[Score]` columns exist, skip the key step entirely and read points from the export.
- If they do not exist, offer an optional **Answer Key** step:
  - question type (single choice, multiple choice, short answer, unscored),
  - correct answer or accepted answers,
  - points,
  - optional topic tag.
- Save a key against the linked quiz and reuse it on later uploads.
- Allow a companion key CSV in this format as a later enhancement:

```csv
question,correct_answer,points,topic
What is 2 + 2?,4,1,Variables & Data Types
Which loop repeats while a condition is true?,while,1,Loops
```

This is our own format, not a Google Forms export.

---

## 3. Goals and non-goals

### Goals

- Add a dedicated **Quiz Bin** screen reachable from the main navigation.
- Import a Google Forms response CSV entirely in the browser.
- Let the teacher map columns when headers are unusual.
- Use exported per-question scores when present, with an optional answer key as a fallback.
- Link an import to an existing scheduled quiz.
- Show class insights, question insights, student insights, and topic insights.
- Persist imports locally so insights survive a refresh.
- Export the computed insights as a CSV, since that is exactly what Google Forms does not provide.
- Keep the existing Setup and Calendar behavior intact.

### Non-goals for the first release

- Google Forms or Google Sheets API integration.
- Automatic fetching of responses from Google.
- Writing grades back to Google Classroom or any gradebook.
- A server, login system, or cloud database.
- AI-generated analysis or natural-language grading.
- Automatic grading of essays or free-form paragraphs.
- Editing a student's answers after import.
- Replacing the existing quiz coverage and scheduling logic.

---

## 4. User experience

### 4.1 Navigation

Add a third tab beside **Setup** and **Calendar**:

```text
[ Setup ]  [ Calendar ]  [ Quiz Bin ]
```

The existing navigation lives in `index.html` and is wired in `js/ui.js` through:

- `.view-tab[data-view]`
- `switchView(view)`
- `renderChrome()`
- `renderAll()`

The new view should be added the same way: a new `<section id="quiz-bin-view" class="view hidden">`, a new tab, and a new branch in the render dispatch.

Important existing behavior to preserve: `switchView()` blocks leaving Setup when topic rows have unsaved drafts. Quiz Bin should not bypass or weaken that guard.

### 4.2 Quiz Bin screen layout

```text
+--------------------------------------------------------------------------+
| Quiz Bin                                      [ Upload CSV ]  [ Help ]  |
| Import Google Forms responses and turn them into class insights.        |
+--------------------------------------------------------------------------+
| Imports                                                                  |
| +----------------------------------------------------------------------+ |
| | Philippines and Its Archipelago Quiz · 13 Nov 2026 · 2 responses · Avg 25% · At risk 2 | |
| | [ View insights ]  [ Re-import ]  [ Export CSV ]  [ Delete ]        | |
| +----------------------------------------------------------------------+ |
|                                                                          |
| Selected import: Philippines and Its Archipelago Quiz                    |
| +------------------+ +------------------+ +------------------+           |
| | Responses  2     | | Average   25%    | | Median    25%    |           |
| +------------------+ +------------------+ +------------------+           |
| | Pass rate  0%    | | Highest   40%    | | Lowest    10%    |           |
| +------------------+ +------------------+ +------------------+           |
|                                                                          |
| [ Overview ] [ Questions ] [ Students ] [ Topics ] [ Data quality ]      |
|                                                                          |
| Overview                                                                 |
|  Score distribution                                                      |
|  0-9    |#                                                              |
|  10-19  |#                                                              |
|  ...                                                                     |
|                                                                          |
|  Frequently missed questions                                             |
|  1. Q2  Capital city                  100% missed   Cebu City / Quezon  |
|  2. Q5  Southernmost island group     100% missed   Batanes / Visayas    |
|                                                                          |
|  Students needing attention                                              |
|  Response 1   40%   missed Q2, Q5, Q6, Q7, Q8, Q9                         |
|  Response 2   10%   missed Q1-Q9 except Q10                              |
+--------------------------------------------------------------------------+
```

### 4.3 Empty state

When no import exists:

- Headline: **Turn Google Forms responses into useful insights.**
- Short explanation of what the CSV contains and what the app will add.
- Large drag-and-drop area plus a **Choose CSV** button.
- A three-step summary:
  1. Upload the Google Forms CSV.
  2. Confirm the detected columns and scoring source.
  3. Review insights.
- A short note: files stay in the browser; nothing is uploaded to a server.

### 4.4 Import flow

The import is a wizard inside the existing modal system or a dedicated in-page panel. A dedicated panel is preferred for long CSVs and many questions; the existing modal should be used for confirmations and short errors.

#### Step 1: Choose file and target quiz

- Drop or choose `.csv` (and later `.zip`).
- Show file name, size, and detected encoding.
- Pick a target:
  - link to an existing quiz from `appState.quizzes`, or
  - create an unlinked import with a manual title and date.
- If the selected quiz already has an import, show a replace/compare choice.

#### Step 2: Map columns

Auto-detect roles and let the teacher override each column:

| Role | Meaning |
| --- | --- |
| Student name | Display name, when the form collects one |
| Student ID | Stable identifier, when the form collects one |
| Email | Fallback identity and deduplication |
| Timestamp | Submission time |
| Total score | Google Forms `Total score` column |
| Question answer | The student's answer text |
| Question score | Paired `[Score]` column; enables grading without a key |
| Question feedback | Paired `[Feedback]` column; optional display |
| Ignore | Metadata or unwanted column |

The mapper should group the three-column pattern automatically:

```text
<question text>            -> question answer column
<question text> [Score]    -> paired score column
<question text> [Feedback] -> paired feedback column
```

`[Score]` and `[Feedback]` headers must never become their own questions.

For each question, also capture:

- display label,
- question type when known,
- maximum points, inferred from `[Score]` values when possible,
- correct answer or accepted answers when a key is used,
- optional topic tag.

The preview table shows the first 3 to 5 rows with mapped values so the teacher can catch bad guesses immediately. For the provided sample it should show 10 questions, not 30.

#### Step 3: Scoring source and grading rules

Detect the scoring source automatically:

- **Export scores present:** derive per-question points from `[Score]` columns. Skip the answer-key step. Show the detected maximum points per question.
- **Export scores absent:** show a score-only import, with an optional answer key for question-level correctness.
- **Partial export:** allow the teacher to mark specific questions as unscored or to supply a key only for missing questions.

Grading rules:

- Single choice / dropdown: full credit when the exported score equals the possible points, partial when the export says so, and no credit otherwise. If using a key, compare the normalized answer.
- Checkboxes / multiple answers: use the exported score. If using a key, select all correct options; all-or-nothing by default.
- Short answer: use the exported score. If using a key, enter accepted answers; matching is case-insensitive and whitespace-normalized.
- Paragraph / essay: use the exported score when present; otherwise mark as **manual / unscored** for v1.
- Linear scale / grid: support when the export provides scores or the correct value is known; otherwise score-only.
- Blank answer: counts as missed by default. `-- / 1` and an empty answer both mean unanswered.
- Passing percentage: default 75%, editable per import.

Because the sample export has no name or email, the import should label rows `Response 1`, `Response 2`, and so on. The teacher can optionally rename a response in the Students tab. The import wizard should also recommend adding a Name or Student ID question to future Google Forms.

#### Step 4: Validate and import

Show a summary before saving:

- rows found,
- rows skipped and why,
- questions found,
- paired score columns found,
- scored vs unscored questions,
- maximum possible points,
- duplicate student warnings when identity exists,
- score mismatch warnings (exported total vs sum of per-question scores),
- blank/unknown headers,
- number of students at risk after import.

Actions: **Back**, **Import**, **Cancel**.

#### Step 5: Insights

After import, open the new import's Insights view and show a toast: `Imported 2 responses from "Philippines and Its Archipelago Quiz.csv".`

### 4.5 Imports list

Each saved import card shows:

- quiz title and date,
- source file name,
- import date,
- response count,
- average percentage,
- pass rate,
- number of at-risk students,
- actions: View insights, Re-import, Export CSV, Delete.

Deleting an import requires confirmation and never modifies the scheduled quiz or existing schedule data.

### 4.6 Insight tabs

Use tabs or segmented controls inside Quiz Bin:

1. **Overview**: KPIs, score distribution, frequently missed questions, students needing attention.
2. **Questions**: full per-question table and option distribution.
3. **Students**: roster with score, percentage, status, missed questions.
4. **Topics**: mastery by topic, tied to the quiz's covered topics when available.
5. **Data quality**: skipped rows, duplicates, blanks, score mismatches, ungraded questions.

---

## 5. CSV contract and parsing

### 5.1 Parser requirements

Write a small RFC 4180-style parser instead of adding a dependency. It must handle:

- UTF-8 BOM (`\uFEFF`) at the start,
- comma, semicolon, and tab delimiters with auto-detection,
- CRLF and LF line endings,
- quoted fields containing commas, newlines, and escaped double quotes (`""`),
- empty trailing fields,
- duplicate and empty headers,
- non-ASCII names and question text.

Suggested pure function:

```js
parseCSV(text) -> {
  headers: string[],
  rows: string[][],
  delimiter: "," | ";" | "\t",
  warnings: string[]
}
```

### 5.2 Column detection

```js
detectColumns(headers) -> {
  timestampIndex,
  emailIndex,
  nameIndex,
  studentIdIndex,
  totalScoreIndex,
  questionColumns: [{
    index,
    header,
    label,
    scoreIndex,
    feedbackIndex
  }],
  ungroupedScoreHeaders,
  warnings
}
```

Detection rules:

- **Total score:** header equals `score` or contains `total score`. Do not confuse it with a `[Score]` companion column.
- **Question score companion:** header ends with `[Score]` and has a matching base question header.
- **Question feedback companion:** header ends with `[Feedback]` and has a matching base question header.
- **Timestamp:** header contains `timestamp`, `date submitted`, or matches a known time header.
- **Email:** header contains `email`.
- **Name/ID:** headers containing `name`, `student`, `student id`, `external id`, or `id number`.
- **Question answer:** a non-metadata header. Prefer headers that have a paired `[Score]` or `[Feedback]` column.
- **Ignore:** any column the teacher excludes.

For the provided sample, detection must produce:

- 1 total score column,
- 10 question answer columns,
- 10 paired score columns,
- 10 paired feedback columns,
- no identity column.

`[Score]` and `[Feedback]` columns must never be counted as questions.

If no identity column exists, fall back to email, then generate `Response 1`, `Response 2`, and warn. The teacher can rename responses later.

All detections are suggestions. The mapping UI always allows override.

### 5.3 Value normalization

**Total score** can appear as:

- `8`,
- `8.0`,
- `8 / 10`,
- `4.00 / 10`,
- `8/10`,
- `80%`,
- blank.

**Per-question score** can appear as:

- `1.00 / 1` (full credit),
- `0.00 / 1` (no credit),
- `0.50 / 1` (partial credit),
- `-- / 1` (unanswered),
- blank.

Suggested parser:

```js
parsePoints("1.00 / 1") -> { earned: 1, max: 1, unanswered: false }
parsePoints("0.00 / 1") -> { earned: 0, max: 1, unanswered: false }
parsePoints("-- / 1")   -> { earned: 0, max: 1, unanswered: true }
```

Never guess silently. Show the parsed value in the preview and flag unparsable cells.

**Timestamps** may use a locale-style format with a timezone, for example:

```text
2026/11/13 11:32:52 AM GMT+8
```

Parse leniently where possible, store both the raw string and an ISO-like normalized value, and keep the raw value for display and duplicate detection.

**Feedback** may be empty for every response. Preserve it when present, but do not require it.

**Checkbox answers** are commonly a single comma-joined cell. Splitting on commas is ambiguous when an option contains a comma. For v1:

- show the raw value in the import preview,
- split on `, ` by default,
- allow the teacher to confirm the option list or edit the split,
- preserve the raw value for audit,
- prefer the exported `[Score]` column over trying to re-grade the split answer.

**Blank answers** are preserved as blank, not as an empty string that looks like a valid option. An empty answer plus `-- / 1` is a skipped question.

### 5.4 Correctness and answer matching

When per-question score columns are present, the exported score is the source of truth:

| Condition | Result |
| --- | --- |
| `earned === max` and `max > 0` (within 0.01) | Correct / full credit |
| `earned > 0` and `earned < max` | Partially correct |
| `earned === 0` and answer is not blank | Incorrect |
| `earned === 0` and answer is blank, or `-- / max` | Unanswered / missed |
| no score column, key present | Grade using the rules below |
| no score column, no key | Show answers only; exclude from correctness insights |

Fallback answer matching when using a key:

| Question type | Matching rule |
| --- | --- |
| Single choice / dropdown | Normalized exact match against one correct value |
| Checkboxes / multiple answers | Set equality with all correct values |
| Short answer | Trim, collapse whitespace, case-insensitive; optional accepted-answer aliases |
| Paragraph / essay | Unscored in v1 unless the export provides a score |
| Linear scale | Exact numeric match |
| Grid / question group | Per-row correctness when mapped; otherwise score-only |
| File upload | Ignored for grading |

Normalization should not strip meaningful punctuation from short answers by default. Use aliases for variants such as `O(n)` vs `O(n) time`.

**Score reconciliation:** compare the exported total score with the sum of per-question earned points. If the difference is greater than 0.01, keep both values, show the exported total as authoritative for the student's overall score, and add a data-quality warning.

### 5.5 Validation and error handling

Import must fail clearly, not partially, when:

- the file has no data rows,
- no question answer columns can be identified,
- `[Score]` or `[Feedback]` headers exist without their parent question,
- a total score column exists but no value can be parsed,
- an answer key is explicitly enabled but incomplete for scored questions.

Import may continue with warnings when:

- a row has no identity,
- duplicate email or student ID exists,
- the exported total differs from the sum of per-question scores,
- a question has a score column but no usable score values,
- a question is unscored,
- a column is ignored,
- a response is blank or unanswered.

Duplicate handling: when identity exists, default to keeping the latest submission per student and show the discarded row count. When identity does not exist, keep all rows as `Response N` and do not attempt to merge them.

### 5.6 ZIP handling

Google Forms sometimes downloads a `.zip` containing one CSV. Two options:

- **v1:** accept `.csv` only and show a clear message asking the teacher to unzip the download.
- **v1.1:** accept `.zip` and extract the single `.csv` entry client-side. This can be done with the browser's `DecompressionStream` for deflate-raw plus a small ZIP directory parser, but it is a separate, testable unit. Do not make it block the first release.

---

## 6. Insight definitions

All computations are deterministic and local. No AI or external service is involved.

### 6.1 Class overview KPIs

For each import:

- **Responses:** number of graded rows after duplicate handling.
- **Average score:** mean of student percentages.
- **Median score:** middle percentage.
- **Highest / lowest:** max and min percentages.
- **Pass rate:** percentage of students at or above the passing threshold.
- **Standard deviation:** population standard deviation, shown to one decimal place.
- **Completion:** percentage of responses with no blank answers.
- **At-risk count:** students below the passing threshold.

Always display the response count next to averages. Avoid presenting precise statistics for very small classes without a note.

### 6.2 Score distribution

Buckets of 10 percentage points:

```text
0-9, 10-19, 20-29, ..., 90-100
```

Render as a horizontal bar chart with counts and percentages. The 90-100 bucket includes 100.

### 6.3 Question-level insights

Correctness is taken from the paired `[Score]` column when it exists. The answer key is only a fallback.

For each question:

- possible points (from `[Score]` denominator or the key),
- times answered,
- full-credit count,
- partial-credit count,
- incorrect count,
- blank / unanswered count,
- average points earned,
- full-credit rate (`fullCreditCount / responseCount`),
- difficulty label:
  - Easy: 80% or higher,
  - Moderate: 50% to 79%,
  - Hard: below 50%,
- most common wrong answer (excluding full-credit and blank answers),
- answer distribution for choice questions,
- correct answer text when a key exists.

**Frequently missed questions** ranking:

```text
missedCount = responseCount - fullCreditCount
missedRate = missedCount / responseCount
```

This intentionally treats partial credit and blanks as missed. Show the breakdown so the teacher can distinguish "partial" from "wrong" and "skipped".

Rank descending by `missedRate`, then by possible points descending, then by question order. Default panel shows the bottom five; the full table shows every scored question.

A question can also be flagged when its full-credit rate is below a configurable threshold. Default: below 60%. Make the rule visible in the UI so the teacher knows why a question appears.

Unscored questions are excluded from this ranking and labeled **Not graded**. They can still show answer distributions.

For the provided sample, every question is worth 1 point, so full credit is `1.00 / 1`, no credit is `0.00 / 1`, and `-- / 1` is a skipped question.

### 6.4 Student-level insights

For each student:

- name, email, ID, or generated label (`Response 1`),
- submitted timestamp,
- total points and possible points,
- percentage,
- pass/fail relative to the threshold,
- status:
  - **On track:** at or above the passing threshold,
  - **Approaching:** 50% to the passing threshold minus one,
  - **At risk:** below 50%,
- missed question list,
- skipped question list,
- partial-credit question list.

The Students tab supports sorting by score, name, or missed count, and filtering to at-risk students. When the export has no identity, response labels can be renamed by the teacher.

### 6.5 Topic-level insights

When questions are tagged with topics, aggregate mastery:

- topic name,
- questions in the topic,
- total points,
- points earned,
- mastery percentage,
- student count below threshold on that topic.

If the import is linked to a quiz with `coveredTopicIds`, default the topic choices to the quiz's topics and warn when a tagged topic is not covered by the quiz.

Suggested deterministic recommendation text:

- Below 50%: `Reteach before moving on.`
- 50% to 74%: `Review with a short practice set.`
- 75% or higher: `Ready to move on.`

This is a rules-based recommendation, not a claim about individual students.

### 6.6 Data quality insights

Show:

- rows skipped,
- duplicate students when identity exists,
- missing identity (anonymous responses),
- blank / skipped answers,
- partial-credit answers,
- score mismatches between the total and the sum of per-question scores,
- unparsable score cells,
- questions without exported scores and without an answer key,
- questions with all-correct or all-incorrect results,
- ignored `[Feedback]` columns and ignored metadata columns,
- mapping changes since the last import.

### 6.7 Export

Add **Export insights CSV** with two possible exports:

- question summary,
- student summary.

A combined workbook is out of scope because this project has no XLSX dependency. A `.csv` per tab is sufficient.

Example question export:

```csv
question,topic,points,responses,full_credit,partial,incorrect,blank,full_credit_rate,most_common_wrong
What is 2 + 2?,Variables & Data Types,1,24,22,0,2,0,91.7%,3
```

Example student export:

```csv
student,email,score,possible,percent,status,missed_questions
Student A,a@example.com,7,10,70%,Approaching,"Q4; Q7"
```

---

## 7. Data model

### 7.1 Storage decision

Do **not** put quiz imports inside `appState`.

Reasons:

- `appState` is normalized, cloned, snapshotted, compared for dirty state, and stored under the `aidaptable` key.
- Uploaded results are not part of semester scheduling.
- Large answer sets would bloat every history snapshot and every undo.
- Undo/redo should not silently remove a teacher's imported results.

Use a separate storage key:

```text
aidaptable:quizbin
```

Suggested module: `js/quiz-storage.js` with the same defensive pattern as `js/storage.js`.

Do not store the raw CSV by default. Store the parsed, normalized import plus file metadata. This limits PII exposure and localStorage growth.

### 7.2 Proposed persisted schema

```js
{
  version: 1,
  imports: [
    {
      id: "qb1",
      quizId: "q2",                 // null when unlinked
      quizTitle: "Philippines and Its Archipelago Quiz", // snapshot in case the quiz is deleted
      quizDate: "2026-11-13",
      sourceFileName: "Philippines and Its Archipelago Quiz.csv",
      sourceRowCount: 2,
      importedAt: "2026-11-13T10:02:00.000Z",
      passingPercent: 75,
      duplicatePolicy: "latest",    // or "all"
      scoringSource: "exported-scores", // exported-scores | answer-key | score-only
      questions: [
        {
          id: "qb1-q1",
          key: "approximately-how-many-islands...", // normalized header for re-import matching
          prompt: "Approximately how many islands make up the Philippine archipelago according to recent mapping",
          type: "single",           // single | multiple | short | paragraph | scale | grid | unscored
          options: [],
          correctAnswers: [],       // optional; export scores are authoritative
          acceptedAnswers: [],
          points: 1,                // from the [Score] denominator when available
          pointSource: "export",    // export | key | manual
          hasExportedScore: true,
          hasFeedback: true,
          topic: "Philippines & Its Archipelago",
          graded: true
        }
      ],
      students: [
        {
          id: "s1",
          name: "Response 1",
          labelSource: "generated", // generated | form | teacher
          email: "",
          studentId: "",
          submittedAtRaw: "2026/11/13 11:32:52 AM GMT+8",
          submittedAtISO: "2026-11-13T11:32:52+08:00",
          exportedScoreRaw: "4.00 / 10",
          exportedScore: 4,
          exportedMax: 10,
          answers: [
            {
              questionId: "qb1-q1",
              raw: "Over 7600",
              rawScore: "1.00 / 1",
              values: ["Over 7600"],
              answered: true,
              correct: true,
              partial: false,
              pointsEarned: 1,
              pointsPossible: 1,
              feedback: ""
            }
          ]
        }
      ],
      grading: {
        computedTotal: 4,
        possibleTotal: 10,
        scoreMismatches: 0,
        unparsableScoreCells: 0
      }
    }
  ]
}
```

Derived insights are recomputed from this schema. Do not persist averages, charts, or rankings, so there is only one source of truth.

### 7.3 Normalization and limits

`normalizeQuizBinState(raw)` should:

- reject non-object input,
- clamp strings,
- validate ISO dates,
- keep only known question types,
- drop answers for missing questions,
- keep imports sorted by `importedAt` descending,
- cap stored imports to a reasonable number (for example 30) and warn,
- never throw on malformed storage.

If localStorage size becomes a real problem, migrate the quiz bin to IndexedDB in a later phase. Start with localStorage because the app already uses it and the expected data volume is small.

### 7.4 Linking and deletion

- A quiz may have zero, one, or many imports. Default UI: one active import per quiz; re-import replaces after confirmation.
- Deleting a scheduled quiz should **not** delete its imports. Mark the import as unlinked and keep `quizTitle` and `quizDate` as a snapshot.
- Deleting an import is always explicit and confirmed.

---

## 8. Planned architecture

No files are changed in this planning step. The following is the intended structure.

### New modules

| File | Responsibility |
| --- | --- |
| `js/quiz-csv.js` | Pure CSV parser, delimiter detection, paired `[Score]`/`[Feedback]` column grouping, score/timestamp normalization |
| `js/quiz-key.js` | Optional answer-key normalization, answer matching, and fallback grading when no score columns exist |
| `js/quiz-insights.js` | Pure aggregations: KPIs, distribution, question ranking, student status, topic mastery, data quality |
| `js/quiz-storage.js` | Separate `aidaptable:quizbin` persistence, normalization, versioning |
| `js/quiz-bin-view.js` | Quiz Bin rendering, import wizard, filters, event wiring, CSV export |

Keeping these out of `js/ui.js` matters: `ui.js` is already about 95 KB and contains the setup, calendar, quiz, and modal controllers. Adding a full analytics screen there would make it harder to test and maintain.

### Existing files to touch later

| File | Change |
| --- | --- |
| `index.html` | Add the `Quiz Bin` tab and `#quiz-bin-view` section |
| `js/ui.js` | Add `"quiz-bin"` to view switching, rendering, and chrome toggling; preserve the unsaved-topic guard |
| `css/styles.css` | Add styles for dropzone, KPI cards, distribution bars, question ranking, insight tables, status chips |
| `PD8/README.md` | Document the new screen, the Google Forms CSV shape, and the optional answer-key workflow |
| `test/` | Add parser, grading, and insight tests, using the provided sample CSV as a fixture |

### Suggested interfaces

```js
// quiz-csv.js
parseCSV(text)
detectDelimiter(text)
detectColumns(headers)          // groups answer + [Score] + [Feedback]
parsePoints(raw)                // "1.00 / 1" -> { earned, max, unanswered }
parseTotalScore(raw)            // "4.00 / 10" -> { earned, max }
normalizeTimestamp(raw)         // handles "2026/11/13 11:32:52 AM GMT+8"

// quiz-key.js (optional fallback)
gradeResponse(answer, question)
buildAnswerKey(questionColumns)

// quiz-insights.js
computeQuizInsights(quizImport, options)
rankFrequentlyMissed(questions, responses, options)

// quiz-storage.js
loadQuizBin()
saveQuizBin(state)
clearQuizBin()

// quiz-bin-view.js
renderQuizBinView({ appState, state, onChange })
```

### Rendering and events

- Follow the existing escape-first pattern with `escapeHTML`.
- Use `openModal` for confirmations and short validation errors.
- Reuse the existing toast pattern for import success/failure.
- Use event delegation on the Quiz Bin root for table actions.
- Keep all insight computation in pure functions so it can be tested with `node --test`.

### Integration with existing quiz coverage

Phase 5 only, and optional:

- On the Setup quiz row, show an **Insights available** chip when an import exists for that quiz.
- Add a **View insights** action that switches to Quiz Bin and selects the import.
- Use the quiz's `coveredTopicIds` to pre-fill topic choices.

This creates a useful loop:

```text
Schedule quiz -> import responses -> see topic mastery -> adjust teaching -> next quiz
```

Do not automatically modify the schedule based on insights in v1. Recommendations should stay advisory.

---

## 9. Implementation phases

### Phase 0: Decisions and fixtures

- Confirm identity fallback, passing threshold, replace-on-re-import behavior, and whether to show correct-answer text when no key exists.
- Use the provided `Philippines and Its Archipelago Quiz.csv` as the primary fixture.
- Add 2 to 3 more fixtures:
  - class with name/email and choice questions,
  - class with checkbox answers and quoted commas,
  - malformed file for validation tests.
- T-shirt size: S.

### Phase 1: Navigation and screen shell

- Add the Quiz Bin tab and view section.
- Add empty state and static layout.
- Wire view switching without breaking the existing unsaved-draft guard.
- T-shirt size: S.

### Phase 2: CSV parser and column mapping

- Implement RFC 4180 parser and delimiter detection.
- Group each question with its `[Score]` and `[Feedback]` companions.
- Implement auto-detection and manual mapping UI.
- Add preview table and validation messages.
- Support `.csv` only.
- Tests for parser and detection, including the provided sample.
- T-shirt size: L.

### Phase 3: Scoring, optional key, and persistence

- Read per-question scores and infer maximum points from the export.
- Implement partial credit, `--` handling, and total-score reconciliation.
- Build the optional answer-key editor for exports without score columns.
- Save imports to `aidaptable:quizbin`.
- Build the imports list, delete, re-import, and response renaming.
- Support score-only mode.
- T-shirt size: L.

### Phase 4: Core insights

- KPI cards, score distribution, frequently missed questions.
- Full question table with answer distribution.
- Student table with status filters.
- Data-quality panel.
- T-shirt size: L.

### Phase 5: Topic lens, exports, and integration

- Question-to-topic tagging.
- Topic mastery and rule-based recommendations.
- CSV exports.
- Link to scheduled quiz and show insights chip in Setup.
- Optional comparison with a previous import.
- T-shirt size: M.

### Phase 6: Polish and hardening

- ZIP support if still needed.
- Large-file performance and storage limits.
- Empty/loading/error states.
- Accessibility: keyboard file picker, table headers, focus handling, aria labels.
- README and in-app help.
- Full test pass.
- T-shirt size: M.

---

## 10. Test plan

Add tests under the existing `test/` directory and run with `npm test`.

### Parser tests

- simple comma-separated file,
- BOM at start,
- CRLF line endings,
- quoted field with comma,
- quoted field with embedded newline,
- escaped double quotes,
- empty trailing fields,
- duplicate headers,
- semicolon delimiter,
- tab delimiter,
- non-ASCII text,
- unclosed quote error,
- provided sample with quoted headers and `[Score]` / `[Feedback]` companions.

### Column detection tests

- standard Google Forms headers,
- name/email/total-score detection,
- `Total score` versus `[Score]` disambiguation,
- a three-column question group becomes one question,
- sample yields 10 questions, not 30,
- custom headers,
- no identity column,
- score column absent,
- question header that looks like metadata.

### Grading tests

- `1.00 / 1` is full credit,
- `0.00 / 1` is incorrect,
- `0.50 / 1` is partial credit,
- `-- / 1` is unanswered,
- blank answer with a score is handled correctly,
- exported total is reconciled against per-question sum,
- single-choice exact and incorrect through the fallback key,
- case-insensitive short answer,
- whitespace normalization,
- accepted-answer alias,
- checkbox exact set match,
- checkbox partial set,
- points greater than one,
- question with no key and no score column.

### Sample-specific tests

Using `Philippines and Its Archipelago Quiz.csv`:

- 2 response rows,
- 10 questions,
- 10 score companions,
- 10 feedback companions,
- total scores parse to 4 and 1,
- possible points parse to 10,
- question 8 is blank / `-- / 1` for both rows,
- question 10 is the only question answered correctly by both rows,
- class average is 25%,
- median is 25%,
- pass rate at 75% is 0%,
- questions 2, 5, 6, 7, 8, and 9 are missed by both responses.

### Insight tests

- average, median, min, max,
- population standard deviation,
- pass rate at 75%,
- histogram bucket boundaries (especially 90-100),
- frequently missed ranking with ties,
- partial credit and blanks included in missed rate,
- most common wrong answer excludes full-credit and blank answers,
- student status thresholds,
- generated `Response N` labels when identity is absent,
- topic mastery weighted by points,
- data-quality counts.

### Storage tests

- empty storage,
- malformed JSON,
- unknown version,
- missing fields,
- import cap,
- delete,
- reload persistence.

### Manual QA

- import 0 responses,
- import 1 response,
- import a 500-row file,
- import a file with quoted commas and newlines,
- refresh and confirm persistence,
- delete and re-import,
- switch between Setup, Calendar, and Quiz Bin with unsaved topic drafts,
- verify no network requests during import.

---

## 11. Acceptance criteria

The feature is ready when:

1. A **Quiz Bin** tab is visible and works beside Setup and Calendar.
2. A teacher can drag and drop a Google Forms CSV and see a preview.
3. Column roles can be corrected before import.
4. `[Score]` and `[Feedback]` columns are grouped with their question and are not counted as separate questions.
5. Per-question scores from the export are used without requiring an answer key.
6. An optional answer key works for plain exports and is reused for the same quiz.
7. A score-only import works without an answer key.
8. The Overview tab shows responses, average, median, pass rate, highest, lowest, and at-risk count.
9. The Questions tab shows per-question correct rate, partial credit, blanks, and the most common wrong answer.
10. A **Frequently missed questions** panel ranks questions using a visible, documented rule.
11. The Students tab shows each response's score, percentage, status, and missed questions, using generated labels when the form has no identity.
12. The Topics tab shows mastery for tagged questions and hides gracefully when no topics are tagged.
13. Imports persist across a page reload.
14. Deleting an import removes only that import.
15. Insights can be exported as CSV.
16. The provided sample imports as 2 responses and 10 questions, producing a 25% average and identifying Q2, Q5, Q6, Q7, Q8, and Q9 as missed by both responses.
17. Existing scheduling and quiz coverage tests still pass.
18. The app still works without a server, build step, or external dependency.

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Some exports lack `[Score]` companions | Per-question correctness unavailable | Detect automatically; fall back to optional answer key or score-only mode |
| No student identity in the sample export | No per-student roster without labels | Generate `Response N`; allow renaming; recommend a Name/ID question in future forms |
| `[Score]` / `[Feedback]` mistaken for questions | Question count doubles or triples | Group companions by base header; test with the provided sample |
| Question headers change between exports | Re-import breaks matching | Match by normalized header, show remap UI, keep old key |
| Checkbox options contain commas | Wrong answer splitting | Show raw value, confirm split, prefer exported scores over re-grading |
| `-- / 1` or blank score cells | Wrong correctness counts | Parse as unanswered, not incorrect; show separately |
| Google Forms sometimes downloads a ZIP | Import fails for some teachers | Clear unzip instruction in v1; ZIP support later |
| Exported total differs from per-question sum | Teacher distrust | Show both and flag mismatches instead of hiding them |
| Small class sizes (the sample has 2) | Misleading percentages | Always show n; avoid overconfident language |
| localStorage limits | Imports fail to save | Store parsed data only, cap imports, warn, plan IndexedDB migration |
| Student PII in browser storage | Privacy concern | No server upload, no raw CSV by default, explicit delete, privacy note |
| Large file performance | UI stalls | Parse off the render path where practical, show progress, test with 500 rows |

---

## 13. Open questions and recommended defaults

These can be confirmed during Phase 0. Recommended defaults are listed first.

1. **Scoring source**
   - Recommended: prefer exported `[Score]` columns; offer an optional answer key only when they are absent.

2. **Answer key usage**
   - Recommended: not required for the provided sample. Use it only to display correct-answer text or to grade plain exports.
   - Alternative: always ask for a key even when scores exist.

3. **Student identity**
   - Recommended: support generated `Response N` labels and manual renaming; ask teachers to include a Name or Student ID question in future Google Forms.
   - Alternative: require a name or email before import.

4. **Passing threshold**
   - Recommended: 75% default, editable per import.

5. **Frequently missed rule**
   - Recommended: rank by missed rate where missed includes wrong, partial, and blank; separately flag questions below 60% full credit.

6. **Re-import behavior**
   - Recommended: one active import per quiz, replace after confirmation, keep the option to compare later.

7. **Partial credit**
   - Recommended: honor the exported `[Score]` values; do not re-grade. Count partial as missed for the frequently-missed ranking but show it separately.

8. **Unscored questions**
   - Recommended: paragraph/essay uses its exported score when present; otherwise unscored with answer distribution only.

9. **Topic tagging**
   - Recommended: optional per question, pre-filled from the linked quiz's covered topics.

10. **Raw CSV storage**
    - Recommended: do not store the raw file; store parsed answers and metadata only.

11. **ZIP support**
    - Recommended: defer to Phase 6; v1 asks the teacher to unzip.

12. **Automatic schedule changes from insights**
    - Recommended: no. Show recommendations only.

---

## Appendix A: Import summary for the provided sample

```text
File: Philippines and Its Archipelago Quiz.csv
Target: Philippines and Its Archipelago Quiz (13 Nov 2026)

Rows found:          2
Rows imported:       2
Identity:            none detected; labeled Response 1 and Response 2
Questions:           10
Score columns:       10 paired
Feedback columns:    10 paired
Scored questions:    10
Unscored questions:  0
Possible points:     10

Warnings:
- No student name, email, or ID in the export. Responses are labeled Response 1-2.
- Q8 (underground river) is unanswered in both rows ("-- / 1").
- Exported totals match the sum of per-question scores.
```

## Appendix B: Insight output for the provided sample

```text
Philippines and Its Archipelago Quiz
2 responses · Average 25% · Median 25% · Pass rate 0% · At risk 2 · SD 15.0

Frequently missed questions
1.  Q2   What is the capital city of the Philippines
         100% missed (0/2)   answers: Cebu City, Quezon City
2.  Q5   Which major island group is located at the southernmost part of the country
         100% missed (0/2)   answers: Batanes, Visayas
3.  Q6   What major body of water borders the western coast
         100% missed (0/2)   answers: Bering Sea, Tasman Sea
4.  Q7   What is the highest mountain peak in the Philippines
         100% missed (0/2)   answers: Mount Kanlaon, Mount Pulag
5.  Q8   Famous underground river national park in Palawan
         100% missed (0/2)   no answer (both skipped)
6.  Q9   What is the official currency used in the country
         100% missed (0/2)   answers: Ringgit, Ringgit
7.  Q1   Approximately how many islands make up the archipelago
         50% missed (1/2)    most common wrong answer: Exactly 6000
8.  Q3   Which is the largest island in the Philippine archipelago
         50% missed (1/2)    most common wrong answer: Mindanao
9.  Q4   The Philippine Trench is primarily located in which ocean basin
         50% missed (1/2)    most common wrong answer: Atlantic Ocean
10. Q10  What strait separates the northernmost part from Taiwan
         0% missed (2/2)     all correct

Students
Response 1   4/10   40%   At risk   missed Q2, Q5, Q6, Q7, Q8, Q9
Response 2   1/10   10%   At risk   missed Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9
```

The correct-answer text is not available in this CSV, so the Questions tab shows student answers and the most common wrong answer. If the teacher supplies a key, the tab can also show the correct option.

## Appendix C: What the teacher does, end to end

1. Build the quiz in Google Forms with quiz mode enabled. Include a Name or Student ID question so future exports can identify students.
2. Download responses as CSV from the Responses tab.
3. Open **Quiz Bin**, upload the CSV, and link it to the scheduled quiz.
4. Confirm the detected questions and the paired `[Score]` columns.
5. If score columns are present, no answer key is needed. If they are absent, optionally enter a key for question-level insights.
6. Review Overview, Questions, Students, and Topics. Rename `Response N` labels if the form collected no names.
7. Optionally tag questions with topics to unlock topic mastery.
8. Export the insight CSV if a record is needed.
9. Use the recommendations to decide what to reteach before the next quiz.
