# Agent Note: Direct deletion of pinned Agent sessions

Status: implemented

English | [中文](2026-11-18-pinned-session-permanent-delete.zh.md)

## Problem

Pinned Agent sessions did not offer Delete Permanently in the list menu; users had to unpin them first. The [2026-10-19 permanent deletion guards](2026-10-19-permanent-deletion-guards.md) treated pins as a direct-deletion guard for both Agent sessions and Chat topics. Pinning is a common way to keep a conversation close at hand. Treating it as a deletion restriction forced users to move between pin management and deletion to complete one task.

## Decision

Direct permanent deletion of Agent sessions no longer rejects pins. The renderer list menu and history page both show and execute the action for pinned rows. The main process removes the deleted batch's own session pins with `pinService.purgeForEntitiesTx` in the same write transaction, covering both ordinary workspaces and root sessions in system workspaces.

This partially supersedes the session half of the earlier note. Busy admission, confirmation dialogs, and the Recycle Bin rule that accepts only archived sessions remain unchanged. Direct permanent deletion of Chat topics still rejects pins: `TopicService` and `topicContextMenuActions` are unchanged, and the topic menu still hides the action for pinned topics.

## Alternatives considered

- Unpin, then delete: two IPC calls would reorder the list and would not be atomic; the menu would still omit the action users were looking for.
- Enable only the UI action: the data layer would still reject the entire transaction batch, leaving a menu item that cannot perform its action.

## Consequences

Pins are no longer a deletion guard for Agent sessions. The deleted sessions' own pins are cleared within the transaction. Pins on child sessions deleted through a parent-session cascade are not guaranteed to be covered: `DELETE … RETURNING` returns only rows affected by the batch IDs, not rows removed by the foreign-key cascade. Topic behavior remains unchanged.

Stale sidebar shortcuts (`ui.sidebar_shortcut`) after permanent session deletion are an existing issue unrelated to this decision and are not fixed by this PR.

## Verification

- Regression — `src/main/data/services/__tests__/PinnedActiveDeletion.integration.test.ts`: passed; direct deletion of a pinned active session and a mixed batch removes the selected sessions, messages, and their own pins while retaining the user workspace; pinned Chat topic deletion still rejects the batch.
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionArchivePersistence.integration.test.ts`: passed; `deleteActiveSessionsPermanently` rejects unsettled stream/runtime work, deletes idle active sessions and messages while retaining the user workspace, and respects active/archived state across stale views.
- Regression — `src/renderer/components/chat/actions/__tests__/sessionItemActions.test.tsx`: passed; the menu offers and executes permanent deletion for pinned sessions while busy or in-flight deletion remains blocked.
- Regression — `src/renderer/pages/agents/components/sessions/__tests__/Sessions.test.tsx`: passed; a pin added before confirmation permits deletion, while a session becoming busy before confirmation prevents deletion; a pinned active row opens the confirmation through the permanent-delete shortcut.
- Regression — `src/renderer/pages/agents/components/sessions/__tests__/SessionItem.test.tsx`: passed; a pinned row offers executable permanent deletion and blocks it while deletion is in flight.
- Regression — `src/renderer/components/history/__tests__/HistoryRecordsView.agent.test.tsx`: passed; pinned history rows offer executable permanent deletion, a pin landing before confirmation is accepted, and busy admission is rechecked at confirmation.
