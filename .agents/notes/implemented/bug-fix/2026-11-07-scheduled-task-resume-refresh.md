# Agent Note: Refresh scheduled task cards after returning to a conversation

Status: implemented

English | [中文](2026-11-07-scheduled-task-resume-refresh.zh.md)

## Problem

MP-145 runs a recurring task from Settings, waits for a completed persisted run, then returns to its originating conversation. The card can retain its pre-run state. React Activity pauses the hidden conversation's data-change subscription, and the preserved SWR hook does not perform a new mount fetch when the conversation resumes.

## Decision

Refresh the task detail when its hook's effects become active again. Keep the initial query responsible for the first fetch, retain live data-change subscriptions, and use the existing shared task-detail cache.

## Alternatives considered

- Reloading the application or forcing a query in E2E would conceal stale product UI.
- Continuous polling would add work while an event subscription already covers visible cards.
- Changing every DataApi consumer's resume policy would exceed this task-card defect.

## Consequences

Returning to a conversation retrieves the current task projection, including completed runs and deletion. It adds one revalidation on reactivation; task execution, schedules and stored results are unchanged.

## Verification

- Regression — a real SWR/React Activity test hides the card, completes a simulated backend run and publishes its data-change event, then shows the conversation. The stale card failed before the fix and displayed the completed result afterward.
- Regression — 30 tests passed across task hooks, Activity recovery and scheduled-task cards.

- Regression — MP-145 passed in Electron, including task creation through the real Agent, successful run summary after returning, persisted result history and the deleted-card state.
