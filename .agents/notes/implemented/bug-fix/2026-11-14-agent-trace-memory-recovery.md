# Agent Note: Bounded Agent traces and recovered reply ownership

Status: implemented

English | [中文](2026-11-14-agent-trace-memory-recovery.zh.md)

## Problem

Image-heavy model history is serialized into SDK telemetry and retained both as raw JSON and parsed inputs. The trace store serializes it again for size accounting. A long-lived active root prevents completed requests from being evicted, so the previous budget cannot bound retention. Windows incident dumps confirm main-process V8 OOM in JSON serialization; exact business JS frames remain unavailable.

The restored user workload also exposes hidden retention in bounded HTTP captures: a small V8 string slice can retain its entire serialized request. Developer HTTP traces, turn-text attributes and the development network inspector therefore keep large backing strings while accounting only for visible prefixes.

An active recovered Durable input can arrive before any product projection checkpoint exists. Main cannot find its reply, ignores the activity event, and later submits new input to an already-active connection.

## Decision

Disable full SDK input/output telemetry through the SDK options before serialization. Keep execution metadata, usage, bounded HTTP captures and turn text. The adapter excludes raw payload namespaces already represented by converted fields and omits JSON inputs above 512 Ki characters before parsing.

Copy bounded HTTP trace, turn-text and network-inspector previews through UTF-16 buffers before retaining them. This releases the large backing strings and preserves code units even when the capture boundary splits a surrogate pair. Only diagnostic previews are copied; the provider request and model history remain complete.

After request headers arrive, background HTTP response capture retains only the abort signal, not the request-init object and its complete body. A slow response must not extend request-body lifetime solely for tracing.

Estimate retained span size recursively without whole-span serialization. Enforce the existing span-count and size budgets across active traces: remove completed traces, completed spans, then oldest active diagnostic spans if necessary. Deletion resets viewer cursors. Terminal export restores an evicted span when it fits the budget. This discards diagnostics, not execution state. Full-span accounting and added/removed event contributions use the same estimator, so escaped JSON cannot skew rolling retention. Metadata for traces without retained spans has a separate 1,000-trace recency window; retained spans protect their trace metadata.

Durable passes the bound identity of a placed, unfinished input with recovered activity. Main resolves its unique direct assistant reply in the same context, including before the first checkpoint, and attaches output to that reply. Ambiguous or foreign bindings do not authorize choosing a reply. Existing background provenance remains the fallback.

At attachment during an unfinished placed input, committed assistant/tool output after its unique logical user-input boundary remains live for the recovered reply. Earlier answers, queued inputs and ambiguous boundaries remain historical; native work is neither resent nor restarted.

## Alternatives considered

- Increase V8 heap size: delays unbounded retention and increases resource use.
- Truncate only at export or apply OTel attribute limits: SDK serialization and its temporary allocations already occurred.
- Preserve every active trace: long turns can grow indefinitely.
- Clear the connection busy flag or resend inputs: overlaps native work or duplicates side effects.
- Prune model image history: changes model-visible context and requires separate product rules.

## Consequences

SDK spans carry less content; bounded HTTP captures remain sensitive local diagnostics. Active diagnostic details can be evicted. Complete conversation history and model requests are unchanged. Recovery requires an existing unambiguous input binding or projection owner; missing provenance is not invented.

## Verification

- Regression — `projection.test.ts`: attachment while tools are running restores committed output for the unfinished placed input; completed, queued and ambiguous input boundaries cannot replay history into a reply.

- Regression — `buildTelemetry.test.ts`: real AI SDK streaming with a large synthetic input retains the provider input and token usage without full input/output span attributes.
- Regression — `aiSdkSpanAdapter.test.ts` and `TraceSpanStore.test.ts`: duplicate payload removal, oversized input omission, bounded long active traces, oversized active spans and stale viewer cursor resets.
- Regression — `httpTraceFetch.test.ts` and `MainNetworkDevtoolsService.test.ts`: retain twenty small previews from large synthetic requests, including already-bounded slices, collect garbage, and enforce a 16 MiB retained-heap budget. Both fail at approximately 80 MiB before the backing-string repair. `turnSpanAttributes.test.ts` checks the same retention contract for both prompt and answer previews against a 32 MiB budget. Split surrogate pairs remain unchanged.
- Regression — `httpTraceFetch.test.ts`: twenty open response streams do not keep their already-sent request bodies alive; the 16 MiB retained-heap check fails near 82 MiB before removing the request-init closure capture.
- Regression — `TraceStorageService.test.ts` and `TraceSpanStore.test.ts`: rolling escaped events retain the attribute budget; evicted and metadata-only traces stay bounded while recent attribution remains available. These three cases fail before the follow-up repair.
- Regression — `PiDurableRuntimeConnection.test.ts` and `AgentSessionRuntimeService.handoff.test.ts`: placed input identity precedes content, recovery without a checkpoint writes the original reply, releases busy state and permits another input in the same session.

Local focused checks do not establish Windows packaged-app acceptance under the user's original workload. User diagnostic databases and dumps are not used as executable fixtures.
