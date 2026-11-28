# Agent Note: Sync the completed process group with the thinking auto-collapse setting

Status: implemented

English | [中文](2026-11-24-thinking-auto-collapse-sync.zh.md)

## Problem

Disabling "Collapse Thought Content" (`chat.message.thought.auto_collapse`) still left thinking content collapsed (#18457). Reasoning renders behind two nested disclosures: the outer completed `MessageProcessGroup` (`completed-process`) and the inner `ThinkingBlock` (`reasoning:${id}`). PR #18073 only fixed the inner block's initial state. The outer group used the preference solely as a mount-time `defaultExpanded`, with no sync effect, so a cached collapsed disclosure survived a preference toggle and a remount. The oversized-history guard (`>80 entries` or `>100KB`) additionally forced the outer group closed even when the user explicitly disabled auto-collapse. Completed reasoning also rendered inside a fixed `max-h-[min(32rem,60dvh)]` inner scroller, which the follow-up QQ feedback called low-readability.

## Decision

Gate the outer group on reasoning content and sync it with the preference. `MessageProcessLayout` computes `reasoningSyncTarget = hasReasoning ? !thoughtAutoCollapse : undefined` and passes it as `syncExpanded` to `MessageProcessGroup`. The group mirrors the `ThinkingBlock` pattern: a `completed-process-preference` disclosure tracks the previous target, and an effect forces `completed-process` to the new target in both directions. `undefined` (tool-only histories) skips the effect, so toggling the thinking setting never disturbs manual tool state. The default becomes `reasoningSyncTarget === true || (!oversized && expandToolSteps)`, so reasoning with auto-collapse off expands even when oversized. The `ThinkingBlock` panel keeps its viewport-aware cap only while streaming (bounded follow area) and renders completed reasoning at natural height. The inner block uses its cached disclosure throughout streaming and completion. Auto-collapse sets the initial disclosure to closed. Manual toggles update the cached disclosure, and a preference change resets it to the new default.

## Alternatives considered

- Clear `completed-process` cache entries on preference change: rejected because it is too blunt and would also expand pure tool histories that the setting does not own.
- Keep oversized histories collapsed even when auto-collapse is off: rejected because it preserves the reported failure; explicit user intent wins over the perf guard, and the existing test for tool-only collapse still passes.
- Persist `message.ui.*` disclosures across restart: rejected for this fix; preference-off already defaults to expanded on a fresh cache, and per-message manual durability is a separate feature with keyspace and eviction costs.
- Keep the completed max-height cap and add an "expand fully" affordance: rejected because the inner scroller itself is the readability complaint; streaming retains the cap where bounded follow matters.

## Consequences

Toggling the setting applies immediately to all rendered reasoning histories in both directions, including stale cached groups and oversized turns. Tool-only histories never sync and keep their manual state. Oversized reasoning with auto-collapse off now mounts its full DOM (accepted cost of honoring explicit intent); streaming turns stay capped and follow the bottom. With auto-collapse enabled, the streamed reasoning body starts collapsed. The header shows the latest completed segment on one line, and readers can open the full stream at any time.

## Verification

- Regression — 44 focused renderer tests passed across `ThinkingBlock`, `thinkingPreview`, and reasoning cases in `MessagePartsRenderer`. A local streaming provider in Electron confirmed that the first segment appears in a collapsed header, the second replaces it, and manual expansion reveals subsequent content.

Verification of the original fix.

- Regression — `pnpm vitest run src/renderer/components/chat/messages/blocks/__tests__/ThinkingBlock.test.tsx src/renderer/components/chat/messages/blocks/__tests__/MessageProcessGroup.test.tsx src/renderer/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx src/renderer/components/chat/messages/hooks/__tests__/useMessageDisclosureState.test.tsx`: 130 passed, including new streaming auto-expand/auto-collapse, manual-collapse-during-streaming, and the existing outer-group sync, mounted toggle, and oversized-reasoning cases.
- Regression — `pnpm vitest run src/renderer/components/chat/messages/__tests__/MessageGroup.test.tsx src/renderer/pages/agents/messages/__tests__/agentMessageListAdapter.test.tsx src/renderer/components/chat/settings/__tests__/ChatPreferenceSections.test.tsx`: 74 passed.
- Regression — `pnpm exec oxlint` on all touched source and test files: clean; `pnpm exec oxfmt --check` on the same set: clean after formatting.
