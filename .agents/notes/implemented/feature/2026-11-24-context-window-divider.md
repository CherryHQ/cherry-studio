# Agent Note: Show the recent-messages cut in Home chat

Status: implemented

English | [中文](2026-11-24-context-window-divider.zh.md)

## Problem

`chat.context_settings.max_messages` and the per-assistant `contextSettings.maxMessages` make main serve only the last N rows of the active path. The cut was visible only in settings. The v1 migration maps `contextCount` to `maxMessages = contextCount + 1`, and v1 wrote its default of 5 into every assistant, so most upgraded assistants carry a limit of 6 that their users never chose. A finite limit also skips turn-start compaction, so dropped turns are not summarized either. Users then report that the model "forgets" a short conversation and suspect lost history (#25260).

## Decision

Home chat draws a divider at the exact point where the next submit's window starts, reading "Messages above are not sent to the model (Recent messages kept: N)".

- `normalizeMaxMessages`, `applyMaxMessagesWindow`, and the property-presence merge `resolveMaxMessages` live in `src/shared/utils/contextSettings.ts`. Main (`PersistentChatContextProvider`, `TemporaryChatService`, `resolveContextSettings`) and the renderer call the same functions, so the drawn cut cannot drift from the served one.
- `useTopicMessages` returns `pathMessages`, the loaded root → active-node rows without siblings, which are the rows main windows.
- `findContextWindowBoundary` in `src/renderer/pages/home/messages/contextWindowBoundary.ts` drops rows through the latest clear-context marker, appends the pending user row unless the next submit fills a reserved blank user leaf, applies the shared window, and returns the first row the request keeps. That row is always a user row and therefore a single-message list group. When only the new message fits, the divider follows the history instead.
- The effective limit mirrors main: the assistant override applies only when the topic has an `assistantId`, otherwise the global preference.
- The shared `MessageList` gains a `messageHead` slot, rendered above the group that opens with the given message. Home passes the divider through it, or through `afterMessages`, and never in image-capture mode.
- Nothing is drawn when no row is dropped. A boundary with a non-zero start is a user row already loaded, so a partially loaded path is enough. When the cut falls inside an unloaded page, nothing is drawn until that page loads.

## Alternatives considered

- Computing the cut in main and returning it with branch messages was rejected: DataApi does not auto-sync, so a preference or assistant change would leave a stale divider until the next refetch.
- LobeChat's position formula (`historyCount === length - index`) was rejected because it ignores the backward extension to a user row and would sit up to a turn away from the real cut.
- Marking what the previous request actually carried, as SillyTavern does, was rejected: it needs main to report served ids per turn, and the question users ask is whether the next message will still see an earlier one.
- Rewriting migrated limits of 6 to unlimited was left out. A v1 user who deliberately kept 5 cannot be told apart from one who never touched it, and the decision belongs to maintainers.

## Consequences

The divider predicts the next new turn on the active path. Regenerating an older message, steering a live turn, temporary chats, and Agent sessions window from a different anchor or surface and show no divider. Its position depends on the renderer's active path matching the parent main resolves at submit time; a mismatch misplaces only the divider, not the request. The window helpers now sit in the shared layer, and future changes to the windowing rule apply to both processes at once.

## Verification

- Regression — `src/renderer/pages/home/messages/__tests__/contextWindowBoundary.test.ts`: no divider when unlimited or nothing is dropped; the pending user row is counted (limit 6 keeps three full turns, cuts before u2 after four); backward extension to the user row; after-history placement when only the new message fits; windowing restarts after a clear-context marker; a reserved blank leaf is filled, not appended.
- Regression — `src/shared/utils/__tests__/maxMessagesWindow.test.ts`: the moved window keeps its contract (exact last N on a user row, backward extension, resumed assistant turn, malformed limits as unlimited).
- Regression — `src/main/ai/contextBuild/__tests__/resolveContextSettings.test.ts`: an explicit assistant `null` still overrides a finite global through `resolveMaxMessages`.
- Electron — dev build over CDP on a 14-row active path whose assistant has no override: a global limit of 6 draws the divider above the fifth user message, the row `findContextWindowBoundary` predicts; a limit of 1 draws it after the last message; clearing the limit removes it, each without a reload.
