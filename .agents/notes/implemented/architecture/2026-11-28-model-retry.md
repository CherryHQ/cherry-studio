# Agent Note: Separate model retry policy, dispatch, and lifecycle

Status: implemented

English | [中文](2026-11-28-model-retry.zh.md)

## Problem

The model retry wrapper selects attempts, activates credentials and models, and emits live status from several nested callbacks. Candidate evaluation can change request helpers before the library accepts the candidate. Credential state persists across tool steps, while request changes and status belong to one model call.

## Decision

The retry policy resolves caller capabilities in one place for both Chat entry points and caller-owned requests. The wrapper keeps the ordered AI SDK model rules for credential rotation, request repair, transient retry, and model fallback. Predicates compose with ai-retry and dynamic repairs return the next call options. The selected target retains its own provider middleware, tool repair, and usage attribution. The wrapper activates a target when dispatch starts.

Credential selection persists across tool steps. The retry options and reporter are local to one model call. The nested ai-retry wrappers share the reporter. A call emits a settled event once after live retry status, including stream cancellation. Provider context recovery, replay-bound tool routes, the public Gateway policy, and caller-owned transport retries retain their existing owners.

## Alternatives considered

- Use one ai-retry wrapper for every target. The library counts by provider and model ID, so two credentials for the same model would share an attempt budget.
- Extract only the event callback. This leaves candidate activation and streaming settlement split between layers.

## Consequences

Each model call creates its execution wrappers. It reuses resolved candidates across tool steps and releases live status when the outer stream completes or is cancelled. Provider adapters and the UI event schema remain available to the existing callers.

## Verification

- AC1 — `createRetryableWrap.apiKeyFailover.test.ts`: verifies retry order, credential retention across tool steps, event settlement, and ordered errors on exhaustion.
- AC2 — `createRetryableWrap.test.ts` and `gatewayIntegration.test.ts`: verify shared attempt accounting and actual request values. The integration run with PR #25726 also verified that a field repair persists through a 503 and resets for the next call.
- AC3 — `createRetryableWrap.test.ts` and `proxyStream.stream.test.ts`: verify stream cancellation, failures after content, and route-bound continuations.
- AC4 — `AiService.test.ts` and `gatewayIntegration.test.ts`: verify policy parity between Chat entry points and caller-specific gateway behavior.
- AC5 — `createRetryableWrap.test.ts` and `buildFallbackModels.test.ts`: verify dispatch-time activation and target-specific request options and adapters.
