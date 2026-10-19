# Agent Note: Permanent deletion guards

Status: implemented

English | [中文](2026-10-19-permanent-deletion-guards.zh.md)

## Problem

Two permanent-deletion paths could drop state the user had not approved.

The dirty Agent file guard discarded the draft before the final permanent-delete popup. Approving that discard and then cancelling deletion lost the draft. Showing the deletion popup first still loses the draft when the delete API fails.

Renderer pin state can lag a cross-window pin commit even when async sync is correct. Direct active Chat topic and Agent session permanent deletion could then remove a member already pinned in the database.

## Decision

The central file guard grants a narrow deferred-disposal authorization when the caller asks for it. Final cancel, guard cancel, a stale or absent deletion, and API failure do not consume it. Only an actually deleted id invokes the callback, before the hook closes tabs or invalidates queries, and only while the active selection still requires removal. The approved file and draft identity prevents discarding a later draft. Ordinary navigation still discards on confirm.

Direct active Chat topic and Agent session permanent deletion reads pin membership in the same write transaction, before any delete writes. A pinned member rejects the batch and leaves messages, pins, and targets in place. Topic `requireAll` and Agent missing-id behavior stay as they are. The pin guard covers only direct active deletion. Explicit owner cascade still deletes active and archived pinned children. Recycle-bin purge is unchanged. Existing runtime busy guards stay upstream. `TRASH_TOPIC_PINNED` / `isTrashTopicPinnedError` and `AI_AGENT_SESSION_PINNED` / `isAgentSessionPinnedError` map to the existing `recycle_bin.delete.pinned` string. There are no new locale keys and no database migration.

## Alternatives considered

- Reordering the dialogs still drops the draft when the API fails.
- Snapshotting and restoring the draft downstream is unnecessary when the approved draft is discarded only after session deletion succeeds.
- A UI-only pin gate cannot close the race between renderer pin state and the committed pin row.
- An unconditional pin ban in shared purge would block explicit owner cascade and recycle-bin purge.

## Consequences

Cancelling or failing permanent deletion keeps the approved dirty draft. A later edit, or a different file, is not discarded by the earlier authorization. Ordinary dirty-file navigation is unchanged.

A pin committed before the delete transaction rejects the whole direct active batch. Cascade and recycle-bin purge still remove pinned children on the paths that already did. Busy admission remains the existing upstream check. Callers show the existing pinned message.

## Verification

- Regression — `src/main/data/services/__tests__/PinnedActiveDeletion.integration.test.ts`: a pin committed after selection rejects the direct active topic or session batch and preserves messages and pins; a mixed batch deletes nothing; unpinned active deletion still removes messages; a missing or archived topic id stays not-found; recycle-bin purge of an already archived pinned row still succeeds; explicit assistant and agent child cascade still deletes active and archived pinned children.
- Regression — `src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentRightPane.test.tsx`: ordinary dirty navigation discards only on confirm and keeps the file when cancelled; deferred disposal keeps the draft until `commitDiscard` of the approved file and draft, and ignores that callback after either identity changes.
- Regression — `src/renderer/pages/agents/components/__tests__/Sessions.test.tsx`: cancelling the unsaved-file guard does not open permanent delete; the last active session waits for the guard before confirmation; a failed confirm does not delete.
- Regression — `src/renderer/components/history/__tests__/HistoryRecordsView.agent.test.tsx`: active history permanent delete waits for file navigation; a cancelled guard can be retried without deleting; a pin that lands before confirm is rejected.
- Regression — `src/renderer/hooks/agent/__tests__/useSession.test.ts`: `onDeleted` runs only after the id is deleted and before tabs close or queries invalidate; `AI_AGENT_SESSION_PINNED` refreshes, skips `onDeleted`, and does not close tabs.
- Regression — `src/renderer/hooks/__tests__/useTopic.test.ts`: active topic deletion uses `trash.topic.delete_permanently`; `TRASH_TOPIC_PINNED` refreshes, throws the existing pinned message, and does not close tabs.
