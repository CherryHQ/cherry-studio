# Agent Note: Bound Agent turns before meaningful output

Status: implemented

English | [中文](2026-11-07-agent-turn-startup-output-bound.zh.md)

## Problem

Agent turns could sit with zero model output for minutes. The only bound was a 120-minute per-item idle timer applied after source acquisition, so acquisition could wait indefinitely. Its expiry surfaced as `paused` rather than a visible timeout error.

The [chat stream idle decision](2026-10-29-chat-stream-idle-bound.md) continues to own the long inter-item allowance. This decision adds a separate startup bound for gated Agent executions without shortening that allowance for productive streams or other callers.

## Decision

`AiStreamManager` gives first meaningful output a 90-second budget only for `runtime.kind === 'agent-session'` with no explicit `requestOptions.timeout`. The monotonic epoch is the execution's `startedAt`, including elapsed time before the execution loop arms the deadline. Acquisition and consumption race the abort signal; late sources are cancelled without consumption, and non-cooperative cancellation cannot delay the visible failure.

An explicit meaningful-output whitelist accepts nonempty untrimmed text/reasoning and tool-input deltas; tool input, approval control and result events, including valid empty inputs/results; and usable file/source URLs or document titles. Authoritative message parts follow corresponding content checks. Administrative controls, boundaries, empty starts/skeletons, `data-*` parts and heartbeats do not retire startup. Normal empty completion remains success. Meaningful output permanently retires startup and leaves the existing idle policy in place.

When native Agent inference crosses the in-process gateway, upstream progress that cannot be represented on the wire (partial tool arguments) is reported in-process to the execution holding the startup deadline. Gateway and execution share the same output predicate, so protocol buffering cannot time out a productive model.

Connection setup, compaction and pending approvals suspend the remaining startup budget. All overlapping and repeated preparation phases share an aggregate 120-minute cap; ending preparation resumes the remainder rather than granting a fresh budget, and exhausting the cap resumes countdown even if preparation remains active. The preparation sink is optional and in-process. An authoritative `approval-requested` snapshot contributes suspension-only tool-call bookkeeping: it does not count as output, publish an approval, change approval timers or create pending/published approval anchors. The existing control-chunk path remains the only approval publication path.

Owned startup expiry surfaces as an error with `request_timeout`, using the existing visible error and manual recovery path, with no automatic retry. Genuine user cancellation and already-observed provider errors retain their classification. A synchronous terminal claim prevents late publication and duplicate terminal dispatch. Home and internal prompt streams retain the 120-minute fallback; the gateway's 20-minute override and other explicit overrides retain their existing behavior.

## Alternatives considered

- SDK `chunkMs`: measures SDK chunks rather than meaningful output and cannot uniformly cover native connection/source acquisition.
- Shorten the shared idle constant: interrupts legitimate long reasoning and post-output waits across other callers.
- Change the gateway's 20-minute constant: misses ordinary Agent turns and changes a separate explicit policy.
- Renderer-only affordance: cannot bound Main-owned acquisition, persist the failure or settle a turn after its window closes.
- Per-provider settings: add configuration and provider-specific policy without fixing the common execution boundary.

## Consequences

Silent pre-output reasoning and heartbeats are indistinguishable from a stall at this layer. A legitimate slow reasoning phase can now fail visibly and needs a manual retry. Preparation has a finite aggregate exemption. Native closing/admission barriers remain owned by the runtime and are not cleared to manufacture retry availability. There are no new settings, IPC schemas, database changes or locale keys.

## Verification

- Regression — `src/main/ai/streamManager/__tests__/StartupDeadline.test.ts`: exact expiry, permanent output disarm, nested/repeated suspension with remaining-budget accounting, aggregate preparation cap and disposal.
- Regression — `src/main/ai/streamManager/__tests__/AiStreamManager.test.ts` and `src/main/features/apiGateway/__tests__/proxyStream.stream.test.ts`: in-process progress retires a zero-chunk deadline, session/assistant matching and fallback, unchanged ungated and post-output idle behavior, plus buffered tool argument progress over 91 seconds, control filtering and ordinary-request isolation.
- Regression — `src/main/features/apiGateway/__tests__/proxyStream.startupBoundary.test.ts`: the real gateway and a real manager in one run — 91 buffered tool-argument deltas keep a zero-chunk Agent execution alive past the budget, while the same fixture without upstream output still expires at 90 s.
- Regression — `src/main/ai/streamManager/__tests__/AiStreamManager.test.ts`: gated acquisition/consumption, meaningful output, snapshot-only approval suspension without publication/timing/terminal anchors, real approval publication without snapshot duplicates, error classification, single terminal dispatch, late-source cancellation, explicit overrides and retained post-output idle behavior.
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.handoff.test.ts`: paired connection/compaction reporting, replay/cleanup, error persistence and native teardown ownership.
- Regression — `src/main/utils/__tests__/withIdleTimeout.test.ts`: pending first read and existing per-item idle contract; `src/main/ai/runtime/aiSdk/loop/__tests__/agentLoop.test.ts` and `src/main/features/apiGateway/__tests__/proxyStream.stream.test.ts`: affected consumer coverage. The two requested groups pass with 266 and 127 tests respectively.
- Electron — `tests/e2e/smoke/agentStartupOutputBound.test.ts`: the isolated-profile run against the built app passed in 1.7 min. With a real mock SSE response held open after headers and an empty assistant delta, the Agent turn showed `An error occurred / Request timed out` after 90,484 ms, the processing placeholder was gone, filling an unsent recovery draft enabled Send, and exactly one inference request was observed over the following 5 s. Screenshot and `{ requestCount: 1, errorText, elapsedMs }` JSON are attached to the run.
