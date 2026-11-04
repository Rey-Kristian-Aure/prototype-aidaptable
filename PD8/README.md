# AiDaptable Prototype

AiDaptable is a dependency-aware, hours-based topic scheduler with adaptive recalibration and quiz coverage checks. It keeps teaching blocks together, finishes topics in deadline and priority order when time is sufficient, and shares shortages across ready topics with one-hour floors and linear priority weights. It automatically moves quizzes when their covered topics finish late.

## Run It

This is a dependency-free ES module app. It must be served over HTTP; opening `index.html` directly will not load the modules.

```bash

npm run serve
```

Then open [http://localhost:8000](http://localhost:8000).

Run the pure-logic tests with:

```bash
npm test
```

## Demo Walkthrough

1. Click **Load Demo**. The demo has 53 teaching days at three hours each (159 hours total) and eight topics whose estimates total exactly 159 hours.
2. Click **Generate Schedule**. All eight topics should fit, and every class minute should be used.
3. Open a calendar day and choose **Suspend this day** or use **Suspend Range…**.
   - Automatic suspension reflow starts at the earlier of the suspension date and the earliest still-upcoming allocated class, while keeping sessions before today fixed. An earlier future week can therefore be redistributed too.
   - In a rebuild that starts at Sep 4, 2026, only **Recursion Intro** is left partial with three hours unplaced; **Sorting & Searching** still fits and no topic becomes async. Quiz dates stay valid.
   - In a rebuild that starts at Oct 5, 2026, the nine suspended teaching days are shared across **Objects & Dictionaries**, **Recursion Intro**, and **Sorting & Searching**, so all three are partial instead of async. **Quiz 2** automatically moves from Nov 13 to Dec 2 so its fully scheduled coverage finishes first. The change summary lists the quiz move and **Undo** restores the old date.
   - If those dates are already past, the app keeps the past sessions fixed and reflows from the earliest upcoming allocation, so the exact split can differ.
4. Use the warning banner or the asynchronous sidebar to restore or drop topics. Use **Reschedule Remaining…** to retry placement. If a quiz still cannot be moved because coverage is unfinished, **Review coverage** explains which topics are short.
5. To exercise the hours-based Flow A, note that the exact-fit demo has little spare time. Free time first: remove **Loops** from Sep 14 onward with **Remove & Leave As-Is**. Then add a 3-hour **Debugging Practice** topic at priority 5 in the inline topic table, save the batch, and use the Sep 14 day popover to add three hours of Debugging Practice. Use **Reschedule Remaining…** if you want later work to reflow around the held topic.

## Scheduling Rules

- Every topic has an estimated number of hours. Each selected weekday has its own start and end time, so teaching capacity is measured in minutes rather than sessions.
- Topics may span any number of class days. A single day may hold as many topics as fit inside its class window.
- Topics are placed one at a time in dependency order. A topic is not ready until all of its prerequisites are fully scheduled or completed.
- Ready topics are ordered by the earliest quiz deadline covering that topic or any dependent, then by priority descending, then by input order. Prerequisites inherit the earliest deadline of the quiz-covered topics that depend on them.
- When all remaining needs fit, each topic is scheduled consecutively before the next starts, a day is filled before moving to a later class day, and no topic is left partial.
- When demand exceeds remaining capacity, each ready topic first reserves up to 60 minutes (or its full remaining need), then the rest is shared in proportion to priority: priority 5 versus 4 receives a 5:4 share. Time freed by topics that need less is redistributed. Each topic's target is packed consecutively, so several topics may be partial.
- If capacity cannot cover every 60-minute floor, floors are allocated in deadline/priority order and the next topic in that order receives any final short remainder. Topics left with zero time use the async/unscheduled threshold rules.
- A leftover block shorter than 60 minutes is carried to the next class day when that day can still finish the topic's target. A topic's actual final remainder may be shorter when no later class capacity exists. This prevents most small topic fragments without wasting the last available minutes.
- Quiz days and suspended days provide no teaching time.
- The semester start and end dates are hard boundaries. Topic allocations and quiz dates may fall on either boundary but never outside it.
- Shortening a semester date removes outside allocations, relocates affected quizzes to a free class day inside the new range, and reflows later work. If an affected quiz has no valid class day inside the range, the date change is rejected instead of saving out-of-range work.
- A topic that receives no time becomes asynchronous when it is at or below the low-priority threshold; a higher-priority zero-time topic becomes unscheduled and needs teacher action. A blocked prerequisite cascades to its dependents the same way.
- Async topics are sticky until the teacher restores them.
- Rearranging from a date keeps earlier allocations in place, clears later allocations, and rebuilds the remaining schedule with the same deadline, dependency, one-hour-floor, and priority-weighted rules.
- Automatic suspension reflow uses the earlier of the suspension date and the earliest still-upcoming allocated class, while keeping sessions before today fixed. Manual **Reschedule Remaining…** continues to use the date chosen by the teacher.
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
- `js/scheduler.js` — deadline-aware fair-share allocator, 60-minute floors and block carrying, automatic reflow dates, generation, and quiz reconciliation
- `js/rearrangement.js` — readjustment, semester-boundary reconciliation, automatic quiz reconciliation, Flow A removal, async/drop/restore actions
- `js/storage.js` — browser persistence
- `js/calendar.js` — calendar, toolbar, legend, allocations, and async sidebar rendering
- `js/popover.js` — day details, add-time form, and modal helpers
- `js/ui.js` — app state, inline topic batch editor, class timetable, calendar actions, summary, and event wiring
- `test/` — fair-share scheduling, quiz coverage and auto-moves, and recalibration tests
