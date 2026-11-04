# Agent Note: Raise the chat stream parse-idle bound

Status: implemented

English | [中文](2026-10-29-chat-stream-idle-bound.zh.md)

## Problem

`AiStreamManager` wraps chat execution in `withIdleTimeout()`, whose timer resets on each parsed UI chunk. Its previous default was `DEFAULT_TIMEOUT` (30 minutes). Provider SSE comment heartbeats never become chunks, so a silent reasoning phase reaching that bound aborts the stream even if comments continue arriving.

This bound does not fully explain the 19–30-minute timeline reported in [Issue #23011](https://github.com/CherryHQ/cherry-studio/issues/23011): a 30-minute bound cannot produce a 19-minute abort, and shorter aborts remain unexplained.

## Decision

`CHAT_STREAM_IDLE_TIMEOUT_MS` supplies a dedicated 120-minute fallback for chat execution. `DEFAULT_TIMEOUT` remains 30 minutes for its other consumers. An explicit `requestOptions.timeout` still wins, including the gateway's 20-minute override. `streamPrompt()` inherits the execution fallback when `idleTimeoutMs` is omitted; its request construction is unchanged. Configurability and automatic retry remain with [Issue #16659](https://github.com/CherryHQ/cherry-studio/issues/16659).

## Alternatives considered

- Change `DEFAULT_TIMEOUT` itself: rejected because provider transports and the Claude Code runtime environment also consume it.
- Reset the timer on heartbeats: rejected because the parser drops SSE comments below the wrapper's parsed-chunk boundary.
- Remove or pause the timer: rejected because a dead-but-open stream must still fail eventually.
- Use 60 minutes: rejected because it provides less headroom than the two-hour approval wait the codebase already accepts.

## Consequences

Direct chat turns and internal prompt streams used by translate and miniApp inherit the longer bound. A dead-but-open internal stream is therefore reclaimed after two hours instead of 30 minutes. The bound remains finite; heartbeat handling and approval timing are unchanged.

## Verification

- Regression — `AiStreamManager.test.ts`: a direct chat turn without a timeout override stays live at 30 minutes and at 120 minutes minus 1 ms, then aborts with an idle `TimeoutError` and settles exactly once as paused at 120 minutes, with no done or error terminal.
- Regression — `AiStreamManager.test.ts`: an internal prompt stream without `idleTimeoutMs` stays live at 30 minutes and aborts with an idle `TimeoutError` after 120 minutes, settling as paused rather than completed.
- Regression — copying only the updated manager test file into the clean `0f95a597ab43d9209bcfe8c6593ae194ddc6183c` baseline makes both new tests fail at the 30-minute liveness assertion; the baseline is restored afterward.
- Regression — the manager (137 tests), `withIdleTimeout` (8), gateway stream proxy (91), translate service (18) and miniApp AI (42) suites pass, together with changed-file Oxlint, ESLint, Oxfmt, the node TypeScript check and every documentation gate.
