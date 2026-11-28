# Agent Note: Separate model retry policy, dispatch, and lifecycle

Status: proposed

English | [中文](2026-11-28-model-retry.zh.md)

## Problem

The model retry wrapper selects attempts, activates credentials and models, and emits live status from several nested callbacks. Candidate evaluation can change request helpers before the library accepts the candidate. Credential state persists across tool steps, while request changes and status belong to one model call.

## Proposal

Resolve caller capabilities in one place for both Chat entry points and caller-owned requests. Keep the ordered AI SDK model rules for credential rotation, request repair, transient retry, and model fallback. Compose predicates with ai-retry and let each dynamic repair return the next call options. The selected target retains its own provider middleware, tool repair, and usage attribution. Activate a target when dispatch starts.

Keep credential selection across tool steps and the retry options and reporter local to one model call. The nested ai-retry wrappers share the reporter. A call emits a settled event once after live retry status, including stream cancellation. Preserve provider context recovery, replay-bound tool routes, the public Gateway policy, and transport retries owned by the caller.

## Alternatives considered

- Use one ai-retry wrapper for every target. The library counts by provider and model ID, so two credentials for the same model would share an attempt budget.
- Extract only the event callback. This leaves candidate activation and streaming settlement split between layers.

## Acceptance criteria

- AC1 — A 401 followed by a 503 on the replacement key uses that key for the retry and the next tool step, reports two retry events and one settlement for the first step, and preserves the ordered errors when keys are exhausted. (verification: Main model runtime)
- AC2 — Output-budget recovery shares attempt accounting with transient retry, preserves repaired request parameters through a transient failure, and starts independent calls from their original options. (verification: Main model runtime and Pi gateway)
- AC3 — Cancellation settles active retry status, committed streams are never replayed, and route-bound tool continuations use their original target or surface its failure. (verification: Main streaming and gateway)
- AC4 — Chat stream and generate share the caller policy, trusted Work retains its caller-selected recovery, and the public Gateway sends one upstream request on failure. (verification: Main policy and gateway)
- AC5 — A candidate that is never dispatched cannot change the active tool repair, usage attribution, or provider options. Cross-model dispatch uses the target's own adapters. (verification: Main model runtime and provider adapters)

## Risks

Credential and model wrappers have different attempt budgets and stream lifetimes. Flattening either boundary can change the number of calls or clear the status before the outer call completes. Target selection may reuse successful resolver results across tool steps, so activation remains tied to dispatch.
