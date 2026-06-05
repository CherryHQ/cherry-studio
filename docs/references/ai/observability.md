# Observability

The `src/main/ai/observability/` subsystem: OTel tracing, the local span
projection, and the sink registry. "Trace / telemetry" is the
user-facing surface; this doc covers the whole subsystem.

## What's instrumented

Every AI SDK call run through Cherry produces an OpenTelemetry span
tree:

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
- `cache/` keeps the in-memory span projection and JSONL-compatible history.
- `sinks/` defines the extension point for local and future external export.

## Local history flush

`Message.traceId` is persisted with the assistant message row, but the span
tree is first collected in the main-process `SpanCacheService` memory store.
The durable history file is written by the stream terminal path:

- `PersistentChatContextProvider` attaches a `TraceFlushListener` to normal
  chat turns.
- `AgentSessionRuntimeService` attaches the same listener to
  `agent-session:${sessionId}` turns, including queued follow-up turns.
- On the topic-level terminal event (`done`, `paused`, or `error`),
  `TraceFlushListener` calls `SpanCacheService.saveSpans(topicId)`.
- Flush errors are logged as warnings and do not affect message completion.

Collection and persistence are main-process only. Spans live in
`SpanCacheService`'s in-memory store and are flushed to the JSONL history file
on the terminal event. There is no renderer-side span reader or viewer.

## AdapterTracer

`src/main/ai/observability/adapters/aiSdk/adapterTracer.ts` wraps the OTel `Tracer` returned
by the global provider. On every `startSpan` / `startActiveSpan` it:

1. Patches `span.end()` to also call `AiSdkSpanAdapter.convertToSpanEntity(...)`
   and hand the result to the observability sink registry.
2. Stamps `trace.topicId` and `trace.modelName` so the main-side
   `SpanCacheService` can key spans per topic.

`AdapterTracer` is intentionally only for AI SDK child spans:

- `buildTelemetry` (`runtime/aiSdk/params/buildTelemetry.ts`) — passed to AI
  SDK as `experimental_telemetry.tracer`. Captures every AI SDK auto-span.
  Returns `undefined` (no telemetry, no tracer) when there is no `topicId`
  or developer mode is off — see below.

## AiSdkSpanAdapter

`src/main/ai/observability/adapters/aiSdk/aiSdkSpanAdapter.ts` converts an OTel span into the
`SpanEntity` shape `SpanCacheService` stores and persists:

- Reads span name, attributes, events, status, links.
- Recovers AI SDK's hierarchical attribute conventions:
  `ai.xxx` is a level, `ai.xxx.yyy` is a sub-level under it.
- Normalises usage attributes across the base and LLM spans: input from
  `ai.usage.promptTokens` / `gen_ai.usage.input_tokens`, output from
  `ai.usage.completionTokens` / `gen_ai.usage.output_tokens`. (There is no
  reasoning-token extraction.)

Claude Code Agent SDK spans do not go through `AiSdkSpanAdapter`; they are
converted by `src/main/ai/observability/adapters/claudeCode/ClaudeCodeOtlpAdapter.ts`.

## Sensitive data capture & redaction

> Cross-referenced from `ClaudeCodeTraceBridgeService.prepareTrace`.

The Claude Code OTLP bridge runs **only when developer mode is enabled**. When
it does, it intentionally turns on verbose Claude Code telemetry:

- `OTEL_LOG_USER_PROMPTS` — user prompt text
- `OTEL_LOG_TOOL_DETAILS` / `OTEL_LOG_TOOL_CONTENT` — tool calls and their content
- `OTEL_LOG_RAW_API_BODIES` — raw API request/response bodies

These payloads land in span attributes that `SpanCacheService` persists as
**plaintext JSONL trace files on disk**, so a trace can contain secrets
(authorization headers, API keys embedded in raw bodies) alongside the prompt
and tool content.

**Redaction is deliberately not done.** Stripping secrets would mean parsing
arbitrary OTLP attribute structures across the ingest path and would risk
dropping legitimate trace data. The accepted tradeoff is that capture is
**local-only and developer-gated**; turning that into a redaction/threat-model
guarantee is a deferred decision. Treat exported trace files as sensitive.

## Developer-mode gating

Dev mode only. The span projection (`SpanCacheService`) is built and persisted
entirely in the main process; nothing in the renderer reads or renders it.
Outside developer mode `buildTelemetry` returns `undefined`, so **no tracer is
attached at all** and the AI SDK emits no spans — there is nothing to project.

## Where to read more

- Code: `src/main/ai/observability/`
- Span projection: `src/main/ai/observability/cache/SpanCacheService.ts`
- AI SDK telemetry docs: https://ai-sdk.dev/docs/reference/ai-sdk-core/telemetry
