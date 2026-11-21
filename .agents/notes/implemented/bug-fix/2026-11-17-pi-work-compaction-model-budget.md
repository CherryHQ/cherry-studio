# Agent Note: Pi Work compaction budgets follow the selected model

Status: implemented

English | [中文](2026-11-17-pi-work-compaction-model-budget.zh.md)

## Problem

Pi Work used Pi's default compaction settings for every model: `reserveTokens: 16384` and `keepRecentTokens: 20000`. On a 49,152-token custom model the trigger sat at 32,768 tokens and the retained tail alone could approach the 40,960-token input room, so compaction could still be followed by a context-overflow 400. Pi's default summarizer also serialized the entire old slice into one request with no input budget, so the summary request could itself overflow the same window. This is the root cause reported in issue #20963.

## Decision

Pi Work derives compaction settings from the selected model. `reserveTokens` is the output reservation plus a 10% estimate margin, capped so the trigger keeps at least 20% of the window (`MIN_INPUT_ROOM_RATIO`). `keepRecentTokens` is 20% of the window. These are computed in `src/main/ai/runtime/pi/piCompactionSettings.ts` and passed from `PiRuntimeConnection` as `compaction`.

Pi Work supplies a host summarizer, `src/main/ai/runtime/pi/piCompactionSummarizer.ts`, through `compaction.summarize`. It sends the summary request with the bound model runtime and gateway usage headers. Its input is capped at 80% of the model's input room. When the transcript exceeds that cap, it keeps the initial message and the newest messages that fit, and tells the summarizer how many earlier messages were omitted. It retries once with half the budget only when pi-ai's `isContextOverflow` recognizes the failure; any other failure is raised unchanged, so the compaction is cancelled and the original provider error is kept.

`PiSessionOptions.compaction` in `packages/agent-runtime-pi` now accepts `summarize`, and `CompactionSummarizer` and `CompactionSummaryRequest` are exported from the package index. This is the only route through which the host can take over summarization.

## Alternatives considered

- Patching `pi-coding-agent` to bound `serializeConversation`. This keeps Pi's native summarizer but adds a pnpm patch to maintain on every Pi upgrade, and it cannot reuse Cherry's per-request usage capture. Rejected in favor of the host summarizer.
- Using Pi's `modelOverrides` for reserve and keep-recent values. Rejected: it would require writing per-model keys into settings, and it still leaves the summary request unbounded.
- Clamping only the reserve and leaving the summarizer native. Rejected: the issue's second failure mode, an overflowing summary request, would remain.

## Consequences

- Pi Work compaction summaries now come from the host summarizer, not Pi's native summarizer. Their usage is captured on the root agent session through `ApiGatewayService.captureAgentSessionUsage`. Summaries for child agent sessions use the root model and are attributed to the root session.
- A summary request that still overflows after one retry fails the compaction; the conversation is left unchanged and the provider error is reported.
- A model that declares no `contextWindow` uses `DEFAULT_AGENT_CONTEXT_WINDOW` (256K) for these budgets, the same fallback the agent runtime already uses. A smaller real window without a declared size can still overflow.

## Verification

- Regression — `src/main/ai/runtime/pi/piCompactionSettings.test.ts`: a 49K model keeps at least the output reservation below the trigger and keeps the recent tail below the trigger; a small window keeps the trigger at least 20% of the window.
- Regression — `src/main/ai/runtime/pi/piCompactionSummarizer.test.ts`: an oversized transcript keeps the initial message and latest request and discloses omitted messages; a real overflow retries once with a smaller prompt; a non-overflow failure is not retried.
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts` (`compacts through the Pi facet without replaying history or creating a second user input`): a manual `/compact` over a history larger than the keep-recent budget completes without an error event.
