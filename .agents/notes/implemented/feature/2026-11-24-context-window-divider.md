# Agent Note: Show the recent-messages cut in Home chat

Status: implemented

English | [中文](2026-11-24-context-window-divider.zh.md)

## Problem

`chat.context_settings.max_messages` and the per-assistant `contextSettings.maxMessages` limit the history sent from the active path. The cut was visible only in settings. Assistants with a saved v1 default `contextCount` of 5 migrate to `maxMessages` of 6. The migration preserves the v1 unlimited setting. A finite limit also skips turn-start compaction, so dropped turns are not summarized. A model can appear to forget earlier messages in a short conversation, a symptom reported in #25260.

## Decision

Home chat draws a divider at the exact point where the next submit's window starts, reading "Messages above are not sent to the model (Recent messages kept: N)".

- Main and the renderer share `normalizeMaxMessages`, `applyMaxMessagesWindow`, and the property-presence merge `resolveMaxMessages` in `src/shared/utils/contextSettings.ts`.
- `useTopicMessages` follows parent IDs from the active node through the loaded rows. Parallel replies outside that chain do not count toward the window.
- `findContextWindowBoundary` in `src/renderer/pages/home/messages/contextWindowBoundary.ts` drops rows through the latest clear-context marker, appends the pending user row unless the next submit fills a reserved blank user leaf, applies the shared window, and returns the first row the request keeps. That row is always a user row and therefore a single-message list group. When only the new message fits, the divider follows the history instead.
- Bound topics wait for their assistant's settings before predicting the cut. An assistant without an override and an unbound topic use the global preference.
- The shared `MessageList` gains a `messageHead` slot, rendered above the group that opens with the given message. Home passes the divider through it, or through `afterMessages`, and never in image-capture mode.
- At the first loaded user row, Home checks its immediate predecessor for an earlier message after the last context reset. If the cut is in an unloaded page, the divider appears when the page loads.

## Alternatives considered

- Computing the cut in main and returning it with branch messages was rejected: DataApi does not auto-sync, so a preference or assistant change would leave a stale divider until the next refetch.
- LobeChat's position formula (`historyCount === length - index`) was rejected because it ignores the backward extension to a user row and would sit up to a turn away from the real cut.
- Marking what the previous request actually carried, as SillyTavern does, was rejected: it needs main to report served ids per turn, and the question users ask is whether the next message will still see an earlier one.
- Rewriting migrated limits of 6 to unlimited was left out. A v1 user who deliberately kept 5 cannot be told apart from one who never touched it, and the decision belongs to maintainers.

## Consequences

The divider predicts the next new turn on the active path while Home chat is idle. It is hidden while opening a turn, streaming, or awaiting approval. Temporary chats and Agent sessions do not show it. Main computes the actual request window from the submitted anchor.

## Verification

- Regression — `src/renderer/pages/home/messages/__tests__/contextWindowBoundary.test.ts`: no divider when unlimited or nothing is dropped; the pending user row is counted (limit 6 keeps three full turns, cuts before u2 after four); backward extension to the user row; after-history placement when only the new message fits; windowing restarts after a clear-context marker; a reserved blank leaf is filled, not appended.
- Regression — `src/renderer/hooks/__tests__/useTopicMessages.test.ts` exercises optimistic parallel replies. `src/renderer/pages/home/__tests__/ChatContent.test.tsx` checks assistant readiness and live-turn visibility. The boundary test also covers a cut at the first loaded row.
- Regression — `src/shared/utils/__tests__/maxMessagesWindow.test.ts`: the moved window keeps its contract (exact last N on a user row, backward extension, resumed assistant turn, malformed limits as unlimited).
- Regression — `src/main/ai/contextBuild/__tests__/resolveContextSettings.test.ts`: an explicit assistant `null` still overrides a finite global through `resolveMaxMessages`.
- Electron — dev build over CDP on a 14-row active path whose assistant has no override: a global limit of 6 draws the divider above the fifth user message, the row `findContextWindowBoundary` predicts; a limit of 1 draws it after the last message; clearing the limit removes it, each without a reload.
