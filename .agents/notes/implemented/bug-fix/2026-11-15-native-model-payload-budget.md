# Agent Note: Bound native model serialization memory

Status: implemented

English | [中文](2026-11-15-native-model-payload-budget.zh.md)

## Problem

Image-heavy parallel Durable work still reproduces main-process V8 OOM after the [trace retention](2026-11-14-agent-trace-memory-recovery.md) and [observation retention](2026-11-15-native-observation-retention.md) repairs. Complete native requests, gateway decoding and provider requests coexist during a model call. Limiting diagnostics and obsolete snapshots does not bound this active working set. Waiting inside fetch is too late: the native SDK has already serialized its request.

## Decision

Superseded by [object transport](../architecture/2026-11-18-agent-object-transport.md), which removed this allowance and its regressions together with internal native request serialization. Peak memory after the removal has not been measured. The constraints below against truncating history or downsampling images still apply; the rest of this note records the removed mechanism.

The lifecycle-owned ApiGatewayService shares an abortable weighted allowance across native Pi model bindings. The existing async-mutex semaphore owns admission; the host does not schedule native steps. Estimate JSON escape overhead from the payload graph without serializing it, saturating the charge at 64 MiB. Requests charged at most 8 MiB bypass admission; larger requests share 64 one-MiB units. One oversized request can use the whole allowance without truncation.

Acquire through the SDK's asynchronous onPayload hook before its request encoder. Preserve the caller's payload hook and its undefined-return semantics. Hold the allowance until the model stream settles, release the previous allowance before a provider payload rebuild, and release on failure as well as success. Aborted queued calls reject immediately; a later semaphore grant is returned rather than dispatched. Gateway shutdown cancels pending admission.

Complete conversations, images and model-visible content remain intact. The allowance is transient and is not persisted. It limits concurrent large request working sets, not total process RSS or the size supported by an upstream service.

## Alternatives considered

- Queue inside fetch: serialization allocations already exist.
- Serialize every model call: unnecessarily delays ordinary requests.
- Increase the V8 heap: leaves image-heavy concurrency amplification intact.
- Remove or downsample historical images: changes the user's preserved model context and proofreading quality.

## Consequences

Large image-history calls may wait for another model response to finish. Native tools and small requests retain their concurrency. This trades throughput for bounded concurrent serialization without changing the model's evidence. Upstream HTTP 413 remains an upstream request-size failure; it is not repaired by deleting user history.

## Verification

- Regression — ApiGatewayService.test.ts: oversized requests serialize, small calls proceed, queued cancellation releases capacity, and shutdown cancels pending admission without preventing later reuse.
- Regression — gatewayModelBinding.test.ts: two complete synthetic 12 MiB requests reach a real native SDK transport one at a time; the unmodified binding dispatches both concurrently. Provider failure releases admission, and cancellation prevents a queued request reaching the transport while allowing the next request to proceed.
- The binding preserves full synthetic request text and the existing protocol, credentials, reasoning and usage contracts in the focused gateway integration tests.

A manual isolated live-provider run restored the same conversation history and dispatched four image-heavy child tasks early. It ran for 20 minutes before a controlled interruption without V8 OOM; the original baseline exhausted memory after approximately six minutes. Workspace files had evolved through earlier reproduction runs, so this is a bounded workload result, not a bit-identical benchmark. This does not establish Windows packaged-app acceptance or eliminate every possible memory exhaustion.
