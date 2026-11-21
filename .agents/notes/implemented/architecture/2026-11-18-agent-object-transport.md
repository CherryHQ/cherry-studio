# Agent Note: Native agent model calls over object transport

Status: implemented

English | [中文](2026-11-18-agent-object-transport.zh.md)

## Problem

Pi and Pi Durable run in Main but call Cherry's internal HTTP gateway. Native Pi providers serialize requests and parse SSE, while the gateway parses requests and serializes events around Cherry's single AI SDK execution pipeline.

The [harness boundary decision](../../proposed/architecture/2026-10-17-agent-harness-boundaries.md) removed a custom Pi-to-AI-SDK model port to avoid maintaining native replay, tool and streaming semantics in Cherry. Removing internal codecs must retain that protocol boundary.

## Decision

The existing pinned Pi AI patch is extended with an optional object transport for Anthropic Messages, OpenAI Chat Completions, OpenAI Responses and Gemini. Native providers build their existing protocol requests and consume their existing protocol events; the transport exchanges these objects without translating Pi context to AI SDK messages. Default native HTTP execution remains available.

HTTP and object delivery share gateway preparation and protocol adapters. HTTP routes retain authentication, JSON parsing, response commitment and SSE formatting. Desktop bindings supply a typed trusted context for session attribution, trace parenting and request selections without synthetic bearer authentication. Explicit child captures retain their owner and trace parent when a root binding makes a detached call. Both paths share model admission, converters, AI SDK execution, credentials, provider compatibility, tracing and the sole billing writer. Client tools have no gateway executor; native runtimes retain retry ownership.

Object delivery commits startup on the same chunks as HTTP. Cancellation, early iterator closure and failure abort upstream execution. Native `timeoutMs` bounds startup and upstream idle waits. Native providers release object responses in `finally`, including hook failures before iteration. Unread protocol events have no separate bound: the stream manager already accumulates the same response, so the queue cannot outgrow it. Preserve provider errors and terminal outcomes; never retry a partly consumed call through HTTP.

This decision partially supersedes only the internal HTTP requirement in the harness boundary decision. It also replaces the [native payload allowance](../bug-fix/2026-11-15-native-model-payload-budget.md), which admitted calls before native request serialization; object calls no longer encode that request. Pi/Pi Durable retain native scheduling, history, tools, compaction and recovery. Existing UIMessage conversion, tool-argument JSON fragments, persistence and real upstream network codecs remain. External clients, including Claude Code, keep HTTP.

Protocol adapters also preserve structured reasoning signatures and native usage breakdowns. Chat Completions delivers repeated OpenRouter reasoning_details cumulative snapshots once and restores native history as provider metadata, including encrypted state without readable text. OpenAI dialects retain cache writes and Anthropic retains thinking_tokens; unreported breakdowns remain absent. Explicit final truncation or filtering takes precedence over tool presence. Provider citations and tool-argument delta delivery remain outside this extension.

Gemini request configuration supported by the pinned AI SDK maps through the shared per-call contract: sampling, JSON/schema output, function selection, safety settings, cached context, and native media, label and service options. Both HTTP and object calls use the same projection. Unsupported local client behavior fails as an SDK capability error without a fabricated HTTP status. Client function execution remains with the native runtime. File output and Google finish metadata retain the native event shape; Pi text sessions keep their existing output capabilities.

## Alternatives considered

- In-memory fetch retains JSON/SSE codecs.
- A Pi-to-AI-SDK adapter restores the removed model port and metadata maintenance.
- Another process isolates Main but retains internal codecs and changes resource ownership.
- Direct upstream providers split Cherry's AI SDK compatibility, credentials and billing.
- A capacity gate with a bounded event queue paused stream-manager intake and idle detection while the native consumer lagged. The accumulated response already holds the same content, so it bounded only a second copy at the cost of a listener hook, idle-timer pause/resume and a tool-error startup exception.

## Consequences

Provider SDKs perform implicit shaping, validation and error classification. The object path supplies native event shapes, including Anthropic SDK defaults and lazily loaded Gemini response objects. Gemini configuration follows the pinned Google language provider's supported subset. Unsupported local client behavior raises an SDK capability error without a fabricated HTTP status. Disabled client automatic function calling is accepted; native runtimes retain execution ownership. This adds a pinned native transport hook to maintain alongside the existing dependency patch. Default native HTTP remains available; desktop bindings never fall back to it after an object failure.

The gateway remains the only provider configuration, upstream credential, AI SDK execution and billing owner. HTTP listener restarts no longer invalidate Pi connections. Existing UIMessage conversion, tool-argument JSON fragments, persistence and upstream network codecs remain. No CPU or latency improvement has been measured. A lagging native consumer can hold unread events up to the response length beside the accumulated message. Peak memory after removing the native payload allowance has not been measured.

## Verification

- AC1 — `gatewayModelBinding.test.ts` (25 passed), `gatewayIntegration.test.ts` (72 passed) and native `nativeSession.test.ts` / `queryFork.test.ts` (18 passed) cover the four object protocols, native replay and unchanged default HTTP execution.
- AC2 — Production gateway integration rejects internal protocol request JSON encoding and SSE formatting for all four protocols, with zero internal HTTP requests, one upstream request and one billing record; it also covers opaque reasoning replay, tool ownership, request selections and structured provider failures.
- AC3 — Production gateway integration covers execution startup failure, partial-output stream failure, cancellation before semantic output and iterator closure before its first read. A textless batch of eight object-shaped tool errors returns all native Responses tool calls. Request-timeout and hook-failure cleanup regressions failed before their lifecycle fixes; all four native response hooks release the execution when they throw.
- AC4 — Production gateway integration with `setupTestDatabase` covers concurrent roots, native phase parenting, frozen message attribution, root/child response joins and native summary ownership with one billing writer. It calls the real `ApiGatewayService` object/capture methods; the child-capture regression failed with undefined usage context before the typed-context fix.
- AC5 — Ten affected Main files pass alongside 18 native HTTP regression tests. `pnpm install --frozen-lockfile` and `pnpm typecheck:node` pass; the dependency installation builds the native runtime packages. An isolated Electron development build opens its Main window. Packaged distribution testing and performance measurement remain separate checks.
- AC6 — `protocolFidelity.test.ts` and `gatewayIntegration.test.ts` verify one structured signature delivery despite repeated metadata, and encrypted-only reasoning reaches tool continuation through the real native Pi consumer and production converter.
- AC7 — The same tests verify Chat/Responses input total 100 splits into uncached input 50, cache read 20 and cache write 30, retaining output 10 and total 110.
- AC8 — The same tests verify Anthropic output_tokens=10 and thinking_tokens=7 cross the object wrapper into native usage; streaming and non-streaming responses retain the breakdown.
- AC9 — The same tests verify length/content-filter after a complete tool call overrides tool presence; all four native protocols retain truncated or filtered outcomes, and existing cancellation and stream failure cases still pass.
- AC10 — Production gateway tests inspect actual upstream HTTP bodies for both delivery paths, including JSON schema, safety/cache context, seed and penalties, media options, labels and service tier. Tool-selection cases cover NONE, AUTO, ANY and VALIDATED. Converter tests cover JSON-only and both schema forms, and preserve non-reasoning options under trusted reasoning overrides. Local capability regressions prove the native consumer never receives a fabricated 400. Six focused Main files pass 1,429 tests; eight affected consumers pass 378 tests.
- AC11 — Production gateway regressions preserve image `inlineData` with signatures and native finish/safety/tier/continuation metadata over HTTP and object delivery; they failed before the response fix. Protocol-adapter tests keep media separate from following text in complete output and preserve native finish reasons. Isolated Electron acceptance with Gemini 4 Argon completed file-tool round trips in both Pi (21.4 s) and Pi Durable (36.1 s), with no renderer errors. Streaming and non-streaming HTTP schema requests both returned 200, valid JSON and STOP. Image generation itself was not exercised against a paid provider; Pi text-session output capabilities remain unchanged.
