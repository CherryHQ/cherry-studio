# Agent Note: Restore scroll chaining at tool panel boundaries

Status: implemented

English | [中文](2026-10-24-tool-panel-scroll-chaining.zh.md)

## Problem

Expanded tool panels (`ToolDisclosure` light variant and `AgentToolDisclosure`) combined `overflow-auto` with `overscroll-contain`. Chromium applies that containment whenever the element is a scroll container, including when its content does not overflow and when it has reached its scroll boundary. Wheel input over a short panel, or over a long panel scrolled to the end, was swallowed and the conversation could not scroll. #21160 introduced the condition while aligning these panels with the thinking panel; #20924's review had already flagged unconditional containment as a non-blocking risk, and #21604 later removed it from the thinking panel, leaving the tool panels inconsistent with the rest of the chat surface.

## Decision

Remove `overscroll-contain` from both tool panel bodies; keep `overflow-auto` and the viewport-aware `max-h` cap. Nested scrolling now follows the policy documented in `ScrollOwnershipContext`: the panel consumes wheel, touch and keyboard input while it can still scroll, then hands boundary input to the message viewport. The thinking panel, `TerminalOutput`, MCP tool responses and meta tool code blocks already behave this way.

## Alternatives considered

- Keep `overscroll-contain`: rejected because containment also blocks input when the panel has no overflow, which is the reported failure, and it contradicts the shared nested-scroll policy.
- Apply containment only while the content overflows, as VS Code's chat content does with `consumeMouseWheelIfScrollbarIsNeeded`: rejected for this fix because it still traps input at the boundary, and CSS cannot detect overflow, so each panel would need a resize-observation state machine.
- Forward boundary wheel input from the panel to the message viewport in JavaScript: rejected because it reimplements native scroll chaining on the main thread; that forwarding path exists for cross-document iframes, which cannot chain natively, not for same-document panels.

## Consequences

While a panel can still scroll, the conversation does not move. When the panel reaches its natural boundary, or when the content never overflowed, the same gesture continues into the message viewport. Trackpad momentum can cross into the conversation after the panel ends; accepting that is the cost of not trapping all input, and it matches the browser default and the rest of the chat surface. Touch, pen and keyboard input regain the same hand-off because `canConsumeVerticalWheel` checks actual overflow before consuming.

## Verification

- Regression — `pnpm exec vitest run src/renderer/components/chat/messages/tools/__tests__/AgentToolRenderer.test.tsx`: expanded agent tool content still renders and toggles after the class change.
- Regression — `pnpm exec vitest run src/renderer/components/chat/messages/list/__tests__/MessageVirtualList.test.tsx`: a nested scroller consumes wheels while it has overflow and hands boundary input to the runtime.
- Chromium probe — a 200px `overflow:auto` panel inside a 3000px page: with containment, a short panel and a panel at its bottom both left `window.scrollY` at 0; without containment, both scrolled the window while mid-panel scrolling still stayed local.
- Manual Electron verification was not run; the reproduction path is described in the pull request.
