---
description: Task result notification publication, durable consumption, delivery policy and navigation boundaries
sources:
  - src/main/services/NotificationService.ts
  - src/main/ai/streamManager/AiStreamManager.ts
  - src/main/ai/agents/agentTaskJobHandler.ts
  - src/main/ai/agents/runAgentTask.ts
  - src/main/data/services/NotificationRecordService.ts
  - src/shared/data/types/notification.ts
  - src/main/services/ConversationNavigationService.ts
  - src/renderer/hooks/useConversationLocateRequest.ts
---

# Task result notifications

`NotificationService.publishTaskResult()` persists authoritative runtime outcomes. `AiStreamManager`
emits unsuccessful persistent-conversation outcomes after terminal listeners settle, including quota,
provider, network and persistence failures. A failed model can notify while another model is still running.
Successful conversation/batch notifications retain their existing producer; approval waits do not emit failures.

Scheduled runs publish from `agentTaskJobHandler.onSettled`, using the committed job row. This covers
errors before session creation, execution failures, timeouts and confirmed cancellation. Their stream
listener declares result ownership so stream failure/abort events cannot duplicate the job notification.
A paused scheduled stream rejects incomplete output instead of marking the job successful. Confirmed
local/remote user stops also cancel the job; the existing job metadata retains the interruption classification.

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

Records expire after 30 days. Optional `target.result` metadata reuses the existing notification target
JSON, alongside its navigation fields; old targets need no conversion. List/detail queries and presentation
events carry the same record, with no extra endpoint, storage adapter, table, column or migration. Consumption
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
The runtime adapters have focused coverage for errors, cancellation, persistence ordering and multi-model
outcomes. Stream notification identity includes the topic, turn, model and attempt; repeated delivery of
that outcome deduplicates, while a new execution attempt is distinct. Scheduled identity is the persisted
job ID, so repeated finalization does not alert again. These adapters do not replay old conversation errors
or reconstruct terminal events after a process crash. Initial admission failures and queued continuation
failures before a new execution exists remain outside the stream adapter; scheduled pre-start failures
are covered by job settlement. Native macOS/Linux delivery and crash recovery remain unverified.

## Release and recovery

Merge the notification-center prerequisite first. This layer uses its existing schema; rows, indexes and
keys remain readable without a database upgrade. Keep consumption markers intact during repair, otherwise
upstream replays could alert again. The unmerged draft's result-column migration was removed before release.

If release validation fails before publishing results, revert the application code to the prerequisite
commit (for example `git revert <notification-result-commit>` in a reviewed rollback branch). A development
profile that ran the earlier draft migration may retain its unused nullable column; do not drop it or
rewrite its migration journal. That draft's column-only snapshots are not converted; their original
notification titles, messages and targets remain. After publication, older target schemas cannot understand
the new scheduled-task target. Do not downgrade that database in place; use a verified pre-upgrade backup
through the existing backup/restore flow, with explicit acceptance of losing changes since that backup.
Do not drop or rewrite user tables. Native application downgrade and recovery after an interrupted write
remain unverified; runtime failures are now published by the stream and job adapters.
