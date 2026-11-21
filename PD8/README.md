# AiDaptable Prototype

AiDaptable is a dependency-aware, hours-based topic scheduler with adaptive recalibration and quiz coverage checks. It keeps teaching blocks together, finishes topics in deadline and priority order when time is sufficient, and shares shortages across ready topics with 30-minute floors and linear priority weights. It automatically moves quizzes when their covered topics finish late.

## Run It

This is a dependency-free JavaScript app with a small Node.js backend. Use Node.js 18 or later; opening `index.html` directly or using Live Server will not make the local Gemini API available.

```bash

npm run serve
```

Then open [http://localhost:8000](http://localhost:8000). For AI item analysis, put your Gemini API key in `PD8/.env` as `GEMINI_API_KEY=...` before starting the server. The `.env` file is ignored by Git and is never served to the browser. See `.env.example` for the settings format.

Run the pure-logic tests with:

```bash
npm test
```

## Demo Walkthrough

1. Click **Load Demo**. The demo has 53 teaching days at three hours each (159 hours total) and eight topics whose estimates total exactly 159 hours.
2. Click **Generate Schedule**. All eight topics should fit, and every class minute should be used.
3. Open a calendar day and choose **Suspend this day** or use **Suspend Range…**.
   - Automatic suspension reflow rebuilds the affected topic blocks in dependency order, keeping sessions before today fixed. A prerequisite split by the suspension finishes first, and its future dependents move after it on consecutive class days instead of staying on earlier free dates.
   - In a rebuild that starts at Sep 4, 2026, only **Recursion Intro** is left partial with three hours unplaced; **Sorting & Searching** still fits and no topic becomes async. Quiz dates stay valid.
   - In a rebuild that starts at Oct 5, 2026, the nine suspended teaching days are shared across **Objects & Dictionaries**, **Recursion Intro**, and **Sorting & Searching**, so all three are partial instead of async. **Quiz 2** automatically moves from Nov 13 to Dec 2 so its fully scheduled coverage finishes first. The change summary lists the quiz move and **Undo** restores the old date.
   - If those dates are already past, the app keeps the past sessions fixed and rebuilds from today, so the exact split can differ while prerequisites still precede their future dependents.
4. Use the warning banner or the asynchronous sidebar to restore or drop topics. Use **Reschedule Remaining…** to retry placement. If a quiz still cannot be moved because coverage is unfinished, **Review coverage** explains which topics are short.
5. To exercise the hours-based Flow A, note that the exact-fit demo has little spare time. Free time first: remove **Loops** from Sep 14 onward with **Remove & Leave As-Is**. Then add a 3-hour **Debugging Practice** topic at priority 5 in the inline topic table, save the batch, and use the Sep 14 day popover to add three hours of Debugging Practice. Use **Reschedule Remaining…** if you want later work to reflow around the held topic.

## Scheduling Rules

- Every topic has an estimated number of hours. Each selected weekday has its own start and end time, so teaching capacity is measured in minutes rather than sessions.
- Topics may span any number of class days. A single day may hold as many topics as fit inside its class window.
- Topics are placed one at a time in dependency order. A topic is not ready until all of its prerequisites are fully scheduled or completed.
- Ready topics are ordered by the earliest quiz deadline covering that topic or any dependent, then by priority descending, then by input order. Prerequisites inherit the earliest deadline of the quiz-covered topics that depend on them.
- When all remaining needs fit, each topic is scheduled consecutively before the next starts, a day is filled before moving to a later class day, and no topic is left partial.
- When demand exceeds remaining capacity, each ready topic first reserves up to 30 minutes (or its full remaining need), then the rest is shared in proportion to priority: priority 5 versus 4 receives a 5:4 share. Time freed by topics that need less is redistributed. Each topic's target is packed consecutively, so several topics may be partial.
- If capacity cannot cover every 30-minute floor, floors are allocated in deadline/priority order. A topic receives no time rather than a fragment under 30 minutes. Topics left with zero time use the async/unscheduled threshold rules.
- A topic is never given a fragment under 30 minutes. A sub-30-minute block is allowed only when it is the topic's entire remaining need and no larger block is possible. Otherwise a leftover block shorter than 30 minutes is carried to the next class day that can finish the topic, so no unrealistic small sessions are created.
- Quiz days and suspended days provide no teaching time.
- The semester start and end dates are hard boundaries. Topic allocations and quiz dates may fall on either boundary but never outside it.
- Shortening a semester date removes outside allocations, relocates affected quizzes to a free class day inside the new range, and reflows later work. If an affected quiz has no valid class day inside the range, the date change is rejected instead of saving out-of-range work.
- A topic that receives no time becomes asynchronous when it is at or below the low-priority threshold; a higher-priority zero-time topic becomes unscheduled and needs teacher action. A blocked prerequisite cascades to its dependents the same way.
- Async topics are sticky until the teacher restores them.
- Rearranging from a date keeps earlier allocations in place, clears later allocations, and rebuilds the remaining schedule with the same deadline, dependency, 30-minute-floor, and priority-weighted rules.
- Readjustment rebuilds affected topic blocks rather than dropping a prerequisite onto an arbitrary free day. The rebuild expands back to the first session of every incomplete topic that would otherwise be split, then rebuilds prerequisites before their dependents so a topic is never scheduled before its prerequisite.
- Sessions before today are never moved. When the teacher's current date is later than the rebuild start, the affected work is rebuilt from today: the prerequisite's remaining sessions are scheduled first on consecutive class days and all future dependent sessions move after them. Past dependent sessions stay where they were because they are already completed.
- Automatic suspension reflow and manual **Reschedule Remaining…** both use the future-only rebuild, with the suspension date or the teacher's chosen date as the starting point.
- After generation, a quiz change, or any reflow, quizzes whose covered topics now finish late are reconciled automatically. The schedule is rebuilt and the check repeats until quiz dates are valid or no further move is possible.

## Quiz Coverage

- Every quiz records the topics it covers. Adding or editing a quiz requires at least one selected topic; older saved quizzes with no coverage remain valid and produce no warning until edited.
- A selected topic counts as covered only when its full estimated time is scheduled strictly before the quiz date.
- Coverage checks are deferred until a schedule exists. After generation or any reflow, the app warns in setup, the calendar warning banner, and day popovers about any remaining uncovered quizzes.
- A quiz is moved automatically after generation, rearrangement, or a quiz edit when every selected topic is fully scheduled and a valid later class day exists. The move targets the first free class day after the latest covered topic finishes, skipping existing quizzes and suspended days. Quiz moves never target a date outside the semester.
- When the semester is shortened, an out-of-range quiz is first moved to the latest free class day on or before the new end (or the earliest free class day on or after a new start), then the schedule is readjusted.
- Automatic quiz moves appear in the change summary and are saved with the history snapshot, so **Undo** restores the previous quiz date. Generation reports moved quizzes in its toast.
- If a selected topic is partial, async, missing, or otherwise unfinished, the quiz keeps its date and the app shows a warning instead of moving it.
- Removing a topic from the setup batch also removes it from every quiz's covered-topic list.
- The manual **Review coverage** action remains available for unresolved warnings.

## Quiz Bin

- **Quiz Bin** reads the CSV exported from a Google Forms response sheet. In Google Forms, open the quiz, go to **Responses**, and download the responses as CSV. If the browser downloads a ZIP, unzip it first and choose the CSV inside.
- The importer detects the timestamp, total score, question columns, and any paired `[Score]` and `[Feedback]` columns. It groups each question with its score and feedback companions instead of treating them as separate questions. Name, email, and student ID questions are recognized automatically and excluded from the quiz questions. Rating/linear-scale columns whose values are small integers and file-upload columns whose values are Google Drive or file URLs are also ignored by their values when the paired score column is ungraded.
- Exported per-question scores are the primary grading source: `1.00 / 1` is full credit, `0.00 / 1` is no credit, partial values are partial credit, and `-- / 1` is a skipped or unanswered question. When a total score is present, the exported total is authoritative for response percentages and any mismatch with the per-question sum is flagged.
- The report distinguishes three grading modes. **Per-question scores** drive question-level correctness and inferred keys. **Score only** uses an exported total when the export has no per-question score columns; class percentages still work, but question-level correctness is unavailable. **Not graded** applies when no scores exist at all; pass/fail and at-risk labels are omitted.
- The importer recognizes the Google Forms question shapes that can appear in a quiz export: **Single answer** (multiple choice and dropdown), **Short answer / fill-in**, **Paragraph**, **Multiple answers** (checkboxes), **Grid row · single** (multiple-choice grid row), **Grid row · checkboxes** (checkbox grid row), **Date**, and **Time**. Grid rows arrive as separate columns such as `Question [Row]`; each row is imported as its own question. Rating/linear-scale and file-upload questions are skipped automatically because they are not auto-graded. The detected type can be changed in the advanced mapping section of the import check.
- Single-answer, short-answer, paragraph, date, time, and grid-single questions treat each response as one answer; multiple-answer and grid-checkbox questions split selections on commas, semicolons, or pipes and add option-level analytics. Short-answer detection uses headers such as “Fill in the blank”, “Complete the sentence”, or an underscore blank; paragraph detection uses headers such as “Describe”, “Explain”, or long free-text answers and takes precedence over comma/semicolon answer shapes; date and time are detected from their exported values. Multiple-answer detection uses “Select all” / “Choose all that apply” headers and multi-value answers; comma-separated values only trigger multiple-answer mode when the question wording also signals a choice, so a single answer such as “Legazpi City, Albay” stays single.
- Paragraph, date, and time questions normally have `-- / 0` score columns, so they are shown without grading. If their score column contains numeric scores, they are graded normally. Rating and file-upload columns are excluded from the question list and do not produce score warnings.
- Responses are anonymous. Name, email, and student ID columns are ignored and never stored; responses are labeled `Response 1`, `Response 2`, and so on. Duplicate rows are reported but kept as separate responses.
- Correct answers are inferred from responses that earned full credit. No manual answer key is needed. Key confidence is **low** when only one response supports the key, **high** when at least half of the responses do (and at least two), and **medium** otherwise. If no response earned full credit for a graded question, the report says that no key can be inferred and still shows the score and answer distribution.
- A fresh import is compared with scheduled quizzes by title, file name, and response date. A unique high-confidence match preselects the quiz link; possible or ambiguous matches leave the import standalone and show a notice in the import check. Re-importing keeps the existing quiz link.
- Importing a CSV linked to a scheduled quiz replaces the existing import for that quiz after confirmation. Re-import preserves the quiz link, title, date, passing threshold, and matching question labels, types, and points. Standalone imports do not replace any scheduled quiz.
- **Overview** shows response count, average, pass rate, score range, near-pass count, at-risk count, standard deviation, completion, possible points, points lost, score distribution, status mix, frequently missed questions, and responses needing attention. Grading-mode notices explain when only a total score or no scores are available. **Questions** adds a compact all-question table, then detailed answer distributions, inferred keys with confidence, average points, points lost, skip rate, and option-level analytics for multiple-answer questions. **Responses** sorts and filters anonymous scores, lists missed or skipped questions, and expands a detail drawer with every answer, state, points, and feedback. **Import notes** is a collapsible section with warnings, mismatches, duplicate rows, grading mode, low-confidence keys, completion, points lost, and how each question was graded.
- Frequently missed questions are ranked by missed rate, where wrong, partial-credit, and blank answers all count as missed, then by possible points and question order. The Overview shows the top five with missed-rate bars and points lost; the Questions tab still lists every question.
- **AI item analysis** sends question prompts, answer text grouped by count, and aggregate scores through the local Node.js backend to Gemini. The model and API key are configured once in `PD8/.env`; no key or backend settings appear in the browser UI. Names and individual response rows are not sent. Review answer text for sensitive details before sending. Generated interpretations are saved with the import and should be checked against classroom context.
- Completion is reported two ways: graded-question completion counts only blank graded answers, while all-answer completion also counts blank ungraded questions such as a skipped paragraph. Near pass means a response is below the passing threshold but within 10 percentage points of it.
- The import check keeps automatic mapping as the default and puts manual overrides behind a framed **Advanced mapping** toggle. The toggle exposes question inclusion, type, points, score column, feedback column, quiz link, title, date, passing threshold, and total-score column.
- Quiz Bin data is stored separately under the `aidaptable:quizbin` key, so it does not enter the scheduling state or history. Parsed answers and metadata are stored; the raw CSV is never uploaded or saved. Derived insights are recomputed from the stored answers each time. Aggregate data is sent to Gemini only after the teacher presses **Generate item analysis**. The local backend reads the private API key from `.env` and never returns it to the browser.
- Deleting a scheduled quiz does not delete its import. The import keeps its title and date snapshot and is marked as no longer linked to a scheduled quiz.

## Saving

- Semester settings, class times, demo loading, and schedule generation save automatically to `localStorage`.
- Topic rows are saved together with **Save Topic Changes**, creating one history entry for the batch. **Revert Rows** discards unsaved row edits.
- Calendar changes (add time, remove, suspend, move, rearrange) stay pending until **Accept & Save**.
- **Undo** restores the state before the last change. **Discard** returns to the last saved state.
- The data key is `aidaptable`. Legacy session-based state migrates to hours using three hours per old session and a default `09:00–12:00` class window.

## Structure

- `js/dates.js` — date parsing, formatting, time-window and hours helpers
- `js/models.js` — schema v2 state model, migration, validation, allocations, dependency ordering, history snapshots
- `js/data.js` — exact-fit hours-based demo semester and quiz coverage seed
- `js/quiz-coverage.js` — quiz coverage checks, deadline propagation, automatic move plans, and warnings
- `js/scheduler.js` — deadline-aware fair-share allocator, 30-minute floors with no sub-30 fragments, automatic reflow dates, generation, and quiz reconciliation
- `js/rearrangement.js` — readjustment, semester-boundary reconciliation, automatic quiz reconciliation, Flow A removal, async/drop/restore actions
- `js/storage.js` — browser persistence
- `js/calendar.js` — calendar, toolbar, legend, allocations, and async sidebar rendering
- `js/popover.js` — day details, add-time form, and modal helpers
- `js/quiz-csv.js` — Google Forms CSV parser, delimiter detection, paired score/feedback columns, and score/timestamp parsing
- `js/quiz-key.js` — import building, anonymous responses, exported-score grading, and inferred answer keys from full-credit responses
- `js/quiz-link.js` — conservative scheduled-quiz matching by title, file name, and response date
- `js/quiz-insights.js` — class, question, response, option-level, grading-mode, points-lost, near-pass, key-confidence, and data-quality aggregations plus CSV exports
- `js/quiz-storage.js` — separate `aidaptable:quizbin` persistence, schema migration, and normalization
- `js/quiz-bin-view.js` — Quiz Bin screen, import check, auto-link notices, report tabs, response detail drawer, import notes, deletion, and exports
- `js/ui.js` — app state, inline topic batch editor, class timetable, calendar actions, summary, and event wiring
- `test/` — scheduling, quiz coverage, recalibration, CSV parsing, scoring, insights, quiz-link matching, and Quiz Bin storage tests
