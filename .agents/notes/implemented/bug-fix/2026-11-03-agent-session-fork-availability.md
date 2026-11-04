# Agent Note: Agent session fork availability before the click

Status: implemented

English | [中文](2026-11-03-agent-session-fork-availability.zh.md)

## Problem

Issue #23361 exposed Fork entries that could be clicked but were certain to fail: the `legacy_history`, `history_changed`, and `not_turn_boundary` guards only explained the failure after the click. The old `src/renderer/pages/agents/messages/agentSessionFork.ts` implementation determined availability from message role and status alone.

## Decision

A read-only main-process probe returns enabled, disabled with an existing reason, or unknown. `ai.agent.session.fork_availability` accepts batches of at most 200 candidates, deduplicated in input order. It reuses the extracted `prepareForkSource`, the read-only preparation for a real fork. Claude and Pi validate the committed prefix in memory by comparing two reads, allowing suffix appends; Pi validates ancestors against the retained path after pruning. A migration marker produces unknown without triggering migration.

The renderer hook revalidates on events without polling and applies a three-second deadline. Unknown remains clickable to preserve existing operation capability, with an `operation_failed` explanation. The real fork contract, failure reasons, persistence, and publication remain unchanged.

## Alternatives considered

- Adding availability to the message DataApi response crosses the data layer's read-only SQLite boundary.
- Adding `dryRun` to `ai.agent.session.fork` changes the existing contract.
- Computing availability from public message anchors in the renderer cannot work: `publicMessageData` removes the anchor, and committed-prefix validation needs the native file.
- Polling every five seconds repeatedly rereads whole files at an unacceptable cost.
- Disabling every unknown would let one probe failure disable Fork globally and block the existing retired-history migration recovery path.
- A native menu explanation line is deferred; the presentation limitation is described below.

## Consequences

A cold new page rereads the native files involved in that page; the normal path reads each file's contents twice. Cross-request caching is follow-up work.

Without user interaction, external repairs are not reflected automatically. The next focus, message event, or new page triggers revalidation.

With `menu.presentation_mode=native`, menu conversion drops the description: the native menu shows a disabled item without its reason, while the cherry menu shows the actual tooltip.

## Verification

- Regression — `src/shared/ipc/schemas/__tests__/ai.test.ts`: 21 tests passed for the shared schema suite.
- Regression — `src/main/ipc/handlers/__tests__/ai.test.ts`, `src/main/ai/agentSession/fork/__tests__/availability.test.ts`, `src/main/ai/runtime/claudeCode/__tests__/claudeForkAvailability.test.ts`, and `src/main/ai/runtime/__tests__/registerDrivers.test.ts`: 73 tests passed; `src/main/data/services/__tests__/AgentSessionMessageService.test.ts`, `src/main/ai/agentSession/fork/__tests__/publication.test.ts`, and `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`: 200 consumer tests passed.
- Regression — `src/main/ai/runtime/pi/__tests__/piForkAvailability.test.ts`, `src/main/ai/runtime/pi/PiRuntimeConnection.sdkContract.test.ts`, `src/main/ai/runtime/pi/__tests__/retiredSessionHistory.test.ts`, and `src/main/ai/runtime/__tests__/registerDrivers.test.ts`: 49 tests passed.
- Regression — `src/renderer/pages/agents/messages/__tests__/agentSessionFork.test.ts`, `src/renderer/pages/agents/messages/__tests__/useAgentSessionForkAvailability.test.tsx`, `src/renderer/pages/agents/messages/__tests__/agentMessageListAdapter.test.tsx`, and `src/renderer/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx`: 75 tests passed; the first three passed 37 tests after the later hook change.
- Regression — prior scoped Node and renderer typechecks, ESLint, Oxlint, and Oxfmt checks passed; the E2E project typecheck still reports two `ReadableStream` errors outside this spec.
- Regression — `tests/e2e/smoke/agentSessionForkAvailability.test.ts`: the user's local Electron run observed enabled → disabled with the real tooltip after removing the Pi native JSONL → enabled after restoration; clicking Fork created a child session and navigated to it. The hardened assertion has not been rerun in this documentation stage.
