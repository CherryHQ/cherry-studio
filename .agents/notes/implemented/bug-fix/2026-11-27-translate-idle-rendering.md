# Agent Note: Stop scheduling translation frames when the output queue is empty

Status: implemented

English | [中文](2026-11-27-translate-idle-rendering.zh.md)

## Problem

The translation page's output renderer scheduled an animation frame whenever it was waiting for text, including while the page was idle. Cancelling or failing a request did not produce the completion event that stopped this loop. The issue surfaced while investigating [#25525](https://github.com/CherryHQ/cherry-studio/issues/25525).

## Decision

The shared stream renderer schedules frames only when graphemes are buffered. Incoming text resumes rendering after the queue drains. It records the request start without a frame callback so the first-token wait can still inform buffering. The translation page uses the request lifecycle to finish rendering text already received after success, cancellation, or failure.

## Alternatives considered

- Polling the empty queue keeps requesting frames while the renderer has no text to display.
- Removing output smoothing would also remove pacing during gaps in streamed responses. Queue-driven scheduling keeps that behavior.

## Consequences

The translation output stops scheduling frames once the queue empties and preserves text received before a stop. Provider requests, model parameters, and routing are unaffected. The local measurement establishes renderer scheduling behavior only.

## Verification

- Regression — `src/renderer/hooks/__tests__/useSmoothStream.test.ts`: verifies idle scheduling, resumption after a drained queue, reset, and completion flush. The regression assertions fail against the previous implementation.
- Regression — macOS Electron with a loopback SSE provider: idle callbacks fell from 70 to 0 per 1.2 seconds, and callbacks after stopping fell from 67 to 0. The completed Thai translation and the stopped request's partial text both stayed visible.
