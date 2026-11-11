# Agent Note: Permanent deletion guards

Status: implemented

English | [中文](2026-10-19-permanent-deletion-guards.zh.md)

## Problem

Direct permanent deletion could remove a conversation the user had pinned in another window.

Renderer pin state can lag a cross-window pin commit even when async sync is correct. Direct active Chat topic and Agent session permanent deletion could then remove a member already pinned in the database.

## Decision

Direct active Chat topic and Agent session permanent deletion reads pin membership in the same write transaction, before any delete writes. A pinned member rejects the batch and leaves messages, pins, and targets in place. Topic `requireAll` and Agent missing-id behavior stay as they are. The pin guard covers only direct active deletion. Explicit owner cascade still deletes active and archived pinned children. Recycle-bin purge is unchanged. Existing runtime busy guards stay upstream. `TRASH_TOPIC_PINNED` / `isTrashTopicPinnedError` and `AI_AGENT_SESSION_PINNED` / `isAgentSessionPinnedError` map to the existing `recycle_bin.delete.pinned` string. There are no new locale keys and no database migration.

An earlier revision also deferred Agent file draft disposal until deletion succeeded. #22687 made Agent file navigation save detached drafts in the background without a discard prompt, so that guard was removed when this branch merged main.

## Alternatives considered

- A UI-only pin gate cannot close the race between renderer pin state and the committed pin row.
- An unconditional pin ban in shared purge would block explicit owner cascade and recycle-bin purge.

## Consequences

A pin committed before the delete transaction rejects the whole direct active batch. Cascade and recycle-bin purge still remove pinned children on the paths that already did. Busy admission remains the existing upstream check. Callers show the existing pinned message.

## Verification

- Regression — `src/main/data/services/__tests__/PinnedActiveDeletion.integration.test.ts`: a pin committed after selection rejects the direct active topic or session batch and preserves messages and pins; a mixed batch deletes nothing; unpinned active deletion still removes messages; a missing or archived topic id stays not-found; recycle-bin purge of an already archived pinned row still succeeds; explicit assistant and agent child cascade still deletes active and archived pinned children.
- Regression — `src/renderer/components/history/__tests__/HistoryRecordsView.agent.test.tsx`: a pin that lands before confirm is rejected.
- Regression — `src/renderer/hooks/agent/__tests__/useSession.test.ts`: `AI_AGENT_SESSION_PINNED` refreshes, returns the pinned message, and does not close tabs.
- Regression — `src/renderer/hooks/__tests__/useTopic.test.ts`: active topic deletion uses `trash.topic.delete_permanently`; `TRASH_TOPIC_PINNED` refreshes, throws the existing pinned message, and does not close tabs.
