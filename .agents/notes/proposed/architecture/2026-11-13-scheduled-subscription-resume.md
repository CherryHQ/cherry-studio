# Agent Note: Scheduled subscription resume and snooze

Status: proposed

English | [中文](2026-11-13-scheduled-subscription-resume.zh.md)

## Problem

Issue #23914 asks for quota-recovery resume to be triggered by an explicitly registered scheduled task. The follow-up queue must not hold recovery timers or read quota snapshots, and cached "quota recovered" state must not authorize a send. The `resume` and `snooze` business semantics are not yet defined. `SchedulerService.resume/pause` only work for cron schedules, so they cannot resume a once-trigger.

## Proposal

- Owner: `CherryCloudService` in the Main process owns the pending recovery intent, its target operation, and the schedule. Renderer sends commands only. `useFollowupQueue.ts` and `useConversationTurnController.ts` stay unaware of quota, timers, and `snooze`.
- Persistence: none. The recovery timer uses `SchedulerService.registerSchedule(id, { kind: 'once', at }, callback)`. Pending intent is in-memory and is not restored after restart. A missed trigger (the app was closed at the due time) is dropped; the user resumes manually.
- Schedule id: namespaced, `cherryCloud.quotaResume:<operationId>`. It avoids the reserved `schedule:`, `job:`, and `retry:` prefixes in `docs/dev/references/job-and-scheduler/scheduler-usage.md`.
- `snooze`: `unregister(id)` then `registerSchedule(id, { kind: 'once', at: newAt })`. `pause` and `resume` are not used for once-triggers.
- Cancel: `unregister(id)`, which is idempotent.
- Fire-time validation: the callback re-checks the account generation, session, and target operation captured at registration. A mismatch drops the intent. A condition that is not yet met is handled by the owner through `snooze` or end; there is no unbounded polling.
- Concurrency: an operation token gates submission so a timer fire and a manual resume cannot both submit. A late callback or late result cannot overwrite a newer snooze or cancel.
- Lifecycle: registration and cleanup belong to the Cloud service lifecycle. Logout, account switch, cancel, or session invalidation unregisters the id. `SchedulerService` also auto-cleans on stop.
- Submission: an unaccepted submission stays a draft. An accepted one follows the existing conversation retry flow. Nothing is submitted twice.

## Alternatives considered

- JobManager persistent job: rejected for this scope. It adds a persistent schedule row and catch-up rules, which the decision to drop missed triggers and skip persistence does not need.
- `pause`/`resume` on a once-trigger: rejected. `SchedulerService` makes them no-ops for once and interval schedules.
- Queue-owned timers that read the quota snapshot: rejected. It couples submission to cached advice and duplicates the request owner's decision, as the ownership convergence note already rejects.
- Polling until quota recovers: rejected as unbounded.

## Acceptance criteria

- AC1 — A scheduled resume fires once at its due time and submits only if the captured account generation, session, and operation still match. (verification: unit; owner: main Cloud)
- AC2 — `snooze` replaces the pending once-trigger, and a superseded or late callback does not submit or overwrite the newer decision. (verification: unit; owner: main Cloud)
- AC3 — Cancel, logout, account switch, and session invalidation unregister the id so no stale account or session is resumed. (verification: unit; owner: main Cloud)
- AC4 — A manual resume racing a timer fire submits at most once. (verification: unit; owner: main Cloud)
- AC5 — The follow-up queue and submission controller contain no quota, timer, or `snooze` logic. (verification: docs gate and dependency scan; owner: renderer conversation)
- AC6 — A missed trigger after restart is dropped and no recovery timer is restored. (verification: unit; owner: main Cloud)

## Risks

- A recovery prompt never fires if the app is closed at its due time; the user must resume manually.
- Two open PRs (#18684 and #21146) touch `SchedulerService.ts`, and several PRs touch the queue and controller. Implementation should wait for those to land or be abandoned.
- No live backend environment is available. Server-side quota decisions remain authoritative at request time.
