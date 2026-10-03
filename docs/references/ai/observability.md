---
description: OTel tracing for AI calls and agent runtimes — Cherry roots, SDK adapters, runtime spans, local projection, and sinks
sources:
  - src/main/ai/observability
---

# Observability

The `src/main/ai/observability/` subsystem: OTel tracing, the local span
projection, and the sink registry. "Trace / telemetry" is the
user-facing surface; this doc covers the whole subsystem.

## What's instrumented

When developer mode is enabled and a topic trace context exists, an AI SDK call
run through Cherry produces an OpenTelemetry span tree:

```
chat.turn                                      (root, created by context provider)
├── ai.streamText                              (AI SDK auto)
│   ├── ai.streamText.doStream                 (AI SDK auto)
│   ├── ai.toolCall (per tool invocation)      (AI SDK auto)
│   └── ai.streamText.<step>                   (AI SDK auto)
└── attributes: topicId, modelName, …          (set by AiTurnTrace / AdapterTracer)
```

AI SDK's `experimental_telemetry` produces the inner spans; Cherry owns
the root span through `AiTurnTrace` so it lands in the same observability
path without going through the AI SDK adapter.

The main-process observability boundary is `src/main/ai/observability`:

- `core/` creates Cherry-owned turn roots and common `cs.*` attributes.
- `adapters/aiSdk/` interprets AI SDK child spans.
- `adapters/claudeCode/` interprets Claude Code OTLP spans and logs.
- `storage/` keeps the in-memory span projection and JSONL-compatible history.
- `sinks/` defines the extension point for local and future external export.

## Agent task timing and local history

Agent sessions collect timing metadata in normal mode. One accepted user input is
one task; coalesced steers retain each input's task and an explicit shared execution
relationship. Receive-only background rows do not create synthetic user tasks.
Pi and DSH spans carry task identities captured at execution time. Claude Code
uses host tool hooks and explicit subagent lifecycle events for task association;
its warm subprocess retains a session-level traceparent. Native spans without a
reliable task identity remain outside task results rather than being assigned by
time overlap or by the turn active when their delayed export arrives.

`TaskTimingRecorder` records task boundaries, queue/approval waits, and host tool
boundaries using a monotonic duration clock and millisecond wall-clock timestamps.
Claude tool hook intervals include permission waiting; separate approval nodes
make that wait visible. Concurrent node durations are never summed into the task
duration. Background children can finish after their launching task's response.
Missing completions have no measured duration, including unfinished records read
after restart. Historical traces without task associations remain readable in the
developer trace view but are not retroactively presented as task measurements.

`TraceStorageService` persists Agent starts and updates through a coalesced,
serialized writer. It atomically replaces JSONL history and retains running or
concurrently updated spans in memory. Terminal `TraceFlushListener` saves remain
in place for both ordinary chat and Agent streams. Recording failures do not fail
the execution; query results flag known persistence failures as incomplete.

History remains under `{userData}/Runtime/trace/<topicId>/<traceId>` and uses the
existing cache cleanup and retention budgets. This is local diagnostic history,
not a permanent audit log. The old `~/.cherrystudio/trace` path is cleanup-only.

The Agent side panel reads `ai.agent.session.timing`. The session-bound, read-only
`task_timing` builtin uses the same metadata projection: list tasks, retrieve one
(or the latest ended task), sort nodes, and paginate. It cannot access arbitrary
sessions or execute actions. Neither query exposes captured inputs, outputs,
events, or raw API bodies, even when developer mode is enabled. Missing records
are unavailable, never estimates, and querying never re-executes a node.

## AdapterTracer

`src/main/ai/observability/adapters/aiSdk/adapterTracer.ts` wraps the OTel `Tracer` returned
by the global provider. On every `startSpan` / `startActiveSpan` it:

1. Patches `span.end()` to also call `AiSdkSpanAdapter.convertToSpanEntity(...)`
   and hand the result to the observability sink registry.
2. Stamps `trace.topicId` and `trace.modelName` so the main-side
   `TraceStorageService` can key spans per topic.

`AdapterTracer` is intentionally only for AI SDK child spans:

- `buildTelemetry` (`runtime/aiSdk/params/buildTelemetry.ts`) — passed to AI
  SDK as `experimental_telemetry.tracer`. Captures every AI SDK auto-span.
  Returns `undefined` (no telemetry, no tracer) when there is no `topicId`
  or developer mode is off — see below.

## AiSdkSpanAdapter

`src/main/ai/observability/adapters/aiSdk/aiSdkSpanAdapter.ts` converts an OTel span into the
`SpanEntity` shape `TraceStorageService` stores and persists:

- Reads span name, attributes, events, status, links.
- Recovers AI SDK's hierarchical attribute conventions:
  `ai.xxx` is a level, `ai.xxx.yyy` is a sub-level under it.
- Normalises usage attributes across the base and LLM spans, preferring AI SDK v6 keys with legacy
  and semantic-convention fallbacks: input from
  `ai.usage.inputTokens` / `ai.usage.promptTokens` / `gen_ai.usage.input_tokens` (and the single
  `ai.usage.tokens` embeddings shape), output from
  `ai.usage.outputTokens` / `ai.usage.completionTokens` / `gen_ai.usage.output_tokens`, plus
  `ai.usage.totalTokens`, `ai.usage.cachedInputTokens`, and `ai.usage.reasoningTokens` (emitted as
  `completion_tokens_details.reasoning_tokens`).

Claude Code Agent SDK spans do not go through `AiSdkSpanAdapter`; they are
converted by `src/main/ai/observability/adapters/claudeCode/ClaudeCodeOtlpAdapter.ts`.

Pi has no native OTel exporter. Its runtime connection creates Cherry-owned
`pi.generate_content` spans at the provider stream boundary and
`pi.execute_tool` spans from Pi's tool lifecycle events. These spans use the
agent-session trace context supplied by the host and flow through the existing
`NodeTraceService` and `TraceStorageService`; parallel tool calls are tracked by
tool-call id and unfinished spans are closed when the connection ends.

DSH likewise uses Cherry-owned spans instead of an external OTLP adapter.
`DshTraceRecorder` records `dsh.generate_content`, tool, compaction, and child
runtime spans under the agent-session trace root, refreshes its trace context
between turns, and closes unfinished spans when the connection ends.

## Sensitive data capture & redaction

> Cross-referenced from `ClaudeCodeTraceBridgeService.prepareTrace`.

The Claude Code OTLP bridge is available for Agent tracing in normal mode.
Only developer mode turns on verbose Claude Code telemetry:

- `OTEL_LOG_USER_PROMPTS` — user prompt text
- `OTEL_LOG_TOOL_DETAILS` / `OTEL_LOG_TOOL_CONTENT` — tool calls and their content
- `OTEL_LOG_RAW_API_BODIES` — raw API request/response bodies

These payloads land in span attributes that `TraceStorageService` persists as
**plaintext JSONL trace files on disk**, so a trace can contain secrets
(authorization headers, API keys embedded in raw bodies) alongside the prompt
and tool content.

**Detailed developer traces are not redacted.** Stripping secrets would mean parsing
arbitrary OTLP attribute structures across the ingest path and would risk
dropping legitimate trace data. The accepted tradeoff is that capture is
**local-only and developer-gated**. Normal-mode storage instead uses an explicit
metadata allowlist and discards content/events at every ingress. Turning detailed
capture into a redaction/threat-model
guarantee is a deferred decision. Treat exported trace files as sensitive.

## Developer-mode gating

Agent task timing is always available; detailed content capture and ordinary-chat
tracing remain developer-only. The storage service removes non-allowlisted
attributes and all events/links before retaining normal-mode Agent spans. Native
Claude content logging flags are disabled in normal mode. The generic chat AI SDK
`buildTelemetry` still returns `undefined` outside developer mode.

## Where to read more

- Code: `src/main/ai/observability/`
- Span projection: `src/main/ai/observability/storage/TraceStorageService.ts`
- AI SDK telemetry docs: https://ai-sdk.dev/docs/reference/ai-sdk-core/telemetry
