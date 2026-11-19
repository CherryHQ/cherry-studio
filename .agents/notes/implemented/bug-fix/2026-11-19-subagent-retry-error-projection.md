# Agent Note: Preserve subagent failures and share model retry status

Status: implemented

English | [中文](2026-11-19-subagent-retry-error-projection.zh.md)

## Problem

CherryAI rejects excess concurrent model requests with HTTP 429 and `CONCURRENCY_LIMITED`. Pi Durable retains the original failure in native history, but a child assistant message with no content projected to an empty successful product row. Reopening the child showed an unknown error or no response instead of the provider's reason. Native retry also bypassed Cherry's shared retry status.

## Decision

Completed runtime messages may carry their own model error. Child projection appends the existing `data-error` part to live and recovered content. Historical attempt errors remain visible; native input/run outcomes alone decide the task's final status, so a later successful run is not marked failed by an older error.

Desktop Pi and Pi Durable disable native provider retries. Internal object calls use the existing `ai-retry` wrapper through the caller-owned single-step SDK path, with three retries after the first attempt on the same provider and model. The wrapper surrounds provider middleware; SDK built-in retry and key/model fallback are disabled. Retry remains bounded to failures before content, and cancellation stops backoff. Exhaustion preserves the final upstream error, including its status and body.

Streaming caller requests emit the same stable `data-retry` status as chat. A typed object-transport callback forwards status outside native protocol events, and the desktop binding identifies the native call owner. Root streams and independent child views reconcile their own latest status. Success, failure and cancellation clear it. Child status is applied after archive reconciliation and is never written to native or product history. Event timing follows the existing wrapper: retry notification arrives after backoff when the next attempt is selected.

This updates the retry boundary in [SDK forwarding](../architecture/2026-11-09-gateway-sdk-forwarding.md) and [object transport](../architecture/2026-11-18-agent-object-transport.md). Public HTTP gateway requests retain their no-retry policy; native scheduling, tools, context and recovery remain with the harness.

## Alternatives considered

- Keep native retries: loses the shared model retry/status path and risks multiplying attempts if gateway retry is also enabled.
- Use SDK built-in retry beside `ai-retry`: creates a second retry owner and does not cover all pre-content stream failures.
- Infer final child status from historical error parts: incorrectly marks a successful later run as failed.
- Persist retry status or encode it into native protocol events: leaks temporary presentation into replay or saved history.

## Consequences

Provider concurrency limits still apply. Recoverable failures may succeed after bounded retries; permanent limits remain failed with their original reason. Partial output is not replayed. No new retry preference, native task restart or database migration is introduced.

## Verification

- Regression — `ChildThreadProjection.test.ts` and native Durable `projection.test.ts` preserve empty/partial failures across live projection, archive and reopening, without overriding later successful native outcomes.
- Regression — `gatewayIntegration.test.ts` uses real gateway execution against a loopback provider to verify retry recovery, four-attempt exhaustion with the final 429 body, cancellation, partial-stream non-replay and retry/settled events.
- Regression — `singleStep.test.ts` proves caller model wrapping executes retries without stacking SDK retries or local tools; `PiDurableRuntimeConnection.test.ts` proves native root and child retries are disabled.
- Regression — Pi and Pi Durable connection tests route root and two concurrent child retry statuses independently; child projection tests keep only the latest live status and exclude it from the archive.
- Regression — Isolated Electron with aimock 1.48.0 ran 20 native children: 15 completed and five exhausted their retry budget. Root and child retry indicators appeared, updated and cleared; reopening retained the original concurrency error and no retry indicator. Read-only SQLite inspection found no `data-retry` parts in the root or 20 child archives. This is local simulated-provider evidence, not a production release claim.
