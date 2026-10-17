---
description: Task result notification publication, durable consumption, delivery policy and navigation boundaries
sources:
  - src/main/services/NotificationService.ts
  - src/main/data/services/NotificationRecordService.ts
  - src/shared/data/types/notification.ts
  - src/main/services/ConversationNavigationService.ts
  - src/renderer/hooks/useConversationLocateRequest.ts
---

# Task result notifications

`NotificationService.publishTaskResult()` is an internal capability for an authoritative runtime adapter.
It does not subscribe to task terminal events. The existing successful conversation/batch producer remains
unchanged. A future adapter must coordinate that producer before publishing the same success here.

## Input contract

Supply a stable `resultId` scoped by `source` (`assistant`, `agent`, or `scheduled-task`), one final
`status`, a task name snapshot, completion timestamp, and a conversation or scheduled-task target.
An optional actor snapshot supplies the small name/avatar label. `durationMs` must come from a reliable
runtime clock; omission means unknown, never an inferred zero. An error summary must already be safe
for user display. The service additionally uses the shared secret redactors and bounds it to 500 characters.
Do not pass raw prompts, tool output, stack traces, or provider response bodies as error summaries.

The same run must retain its identity across retries/restart and terminal-event duplicates. A new run
needs a new identity. The caller must supply authoritative cancellation/interruption facts; a Stop
response, missing dashboard entry, cache UUID, or UI duration threshold is not such a fact.

## Record and delivery policy

| Outcome | Active conversation in focused window | Background / no conversation |
| --- | --- | --- |
| Succeeded | No record, popup or sound | Unread, existing delivery preferences |
| Failed / interrupted | Initially read, record only | Unread error, no success chime |
| Confirmed user cancellation | Initially read, record only | Initially read, record only |

All results use the existing System category. Disabling it suppresses the record and delivery.
Focused ownership uses the existing active-tab query and focus recheck; an open background tab is not active.

`NotificationRecordService.consumeTaskResult()` commits the `app_state` consumption marker and optional
record in one synchronous `withWriteTx` transaction. Publication occurs only after commit. Initial read
state is part of the insert, so it cannot briefly increment unread counts. A failed transaction returns
`false` from publication and may be retried. Delivery failure after commit is best effort and does not
replay the result. Concurrent duplicates cannot both commit a record.

Records expire after 30 days; nullable JSON result metadata preserves old notification rows. Consumption
markers remain after read, dismissal, expiry and preference changes. Expired late outcomes also consume
the identity. Markers contain no task content and currently have no pruning policy: retention is required
until a future producer can guarantee a replay horizon. There is no separate task-result history table or
viewed-state workflow.

## Navigation

Conversation targets reuse `ConversationNavigationService.focusOrOpen()` across main and detached tabs.
An optional `messageId` follows the shared navigation contract: a string locates that message, `null`
scrolls to the end, and omission preserves the old behavior. Different anchors for the same conversation
are serialized, while identical pending requests coalesce. Renderer locating waits for history, loads
older pages when needed and falls back to the end if an anchor is absent.

Scheduled-task targets use `AgentTaskService.getTaskById()` and the existing task detail route. A
notification ID in the route allows the detail page to show the saved safe error even when no session
was created. Both target types are checked before navigation; deleted targets remain readable/dismissible
in the inbox and never create placeholder conversations.

## Integration and validation boundary

The notification layer does not depend on the task dashboard stack, its running cache, sidebar visibility,
or its 60-second display threshold. Native tests with controlled final inputs verify this capability,
not real provider completion, continuous-run identity, cancellation settlement, or crash recovery.
Those facts and end-to-end coverage belong to the future runtime integration.

## Release and recovery

Merge the notification-center prerequisite first. This layer adds one nullable column; existing rows,
indexes and keys are unchanged and remain readable after upgrade. Keep consumption markers intact during
repair, otherwise upstream replays could alert again. No published-result data is rewritten by migration.

If release validation fails before publishing results, revert the application code to the prerequisite
commit (for example `git revert <notification-result-commit>` in a reviewed rollback branch), leaving the
additive column and migration journal intact. After publication, older target schemas cannot understand
the new scheduled-task target. Do not downgrade that database in place; use a verified pre-upgrade backup
through the existing backup/restore flow, with explicit acceptance of losing changes since that backup.
Do not drop or rewrite user tables. Native application downgrade and recovery after an interrupted write
remain unverified; this PR does not activate a runtime producer.
