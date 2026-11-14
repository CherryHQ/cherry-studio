# Agent Note: Bounded Agent traces and recovered reply ownership

Status: implemented

English | [中文](2026-11-14-agent-trace-memory-recovery.zh.md)

## Problem

Image-heavy model history is serialized into SDK telemetry and retained both as raw JSON and parsed inputs. The trace store serializes it again for size accounting. A long-lived active root prevents completed requests from being evicted, so the previous budget cannot bound retention. Windows incident dumps confirm main-process V8 OOM in JSON serialization; exact business JS frames remain unavailable.

An active recovered Durable input can arrive before any product projection checkpoint exists. Main cannot find its reply, ignores the activity event, and later submits new input to an already-active connection.

## Decision

Disable full SDK input/output telemetry through the SDK options before serialization. Keep execution metadata, usage, bounded HTTP captures and turn text. The adapter excludes raw payload namespaces already represented by converted fields and omits JSON inputs above 512 Ki characters before parsing.

Estimate retained span size recursively without whole-span serialization. Enforce the existing span-count and size budgets across active traces: remove completed traces, completed spans, then oldest active diagnostic spans if necessary. Deletion resets viewer cursors. Terminal export restores an evicted span when it fits the budget. This discards diagnostics, not execution state.

Durable passes the bound identity of a placed, unfinished input with recovered activity. Main resolves its unique direct assistant reply in the same context, including before the first checkpoint, and attaches output to that reply. Ambiguous or foreign bindings do not authorize choosing a reply. Existing background provenance remains the fallback.

## Alternatives considered

- Increase V8 heap size: delays unbounded retention and increases resource use.
- Truncate only at export or apply OTel attribute limits: SDK serialization and its temporary allocations already occurred.
- Preserve every active trace: long turns can grow indefinitely.
- Clear the connection busy flag or resend inputs: overlaps native work or duplicates side effects.
- Prune model image history: changes model-visible context and requires separate product rules.

## Consequences

SDK spans carry less content; bounded HTTP captures remain sensitive local diagnostics. Active diagnostic details can be evicted. Complete conversation history and model requests are unchanged. Recovery requires an existing unambiguous input binding or projection owner; missing provenance is not invented.

## Verification

- Regression — `buildTelemetry.test.ts`: real AI SDK streaming with a large synthetic input retains the provider input and token usage without full input/output span attributes.
- Regression — `aiSdkSpanAdapter.test.ts` and `TraceSpanStore.test.ts`: duplicate payload removal, oversized input omission, bounded long active traces, oversized active spans and stale viewer cursor resets.
- Regression — `PiDurableRuntimeConnection.test.ts` and `AgentSessionRuntimeService.handoff.test.ts`: placed input identity precedes content, recovery without a checkpoint writes the original reply, releases busy state and permits another input in the same session.

Local focused checks do not establish Windows packaged-app acceptance under the user's original workload. User diagnostic databases and dumps are not used as executable fixtures.
