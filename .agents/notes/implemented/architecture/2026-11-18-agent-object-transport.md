# Agent Note: Native agent model calls over object transport

Status: implemented

English | [中文](2026-11-18-agent-object-transport.zh.md)

## Problem

Pi and Pi Durable run in Main but call Cherry's internal HTTP gateway. Native Pi providers serialize requests and parse SSE, while the gateway parses requests and serializes events around Cherry's single AI SDK execution pipeline.

The [harness boundary decision](../../proposed/architecture/2026-10-17-agent-harness-boundaries.md) removed a custom Pi-to-AI-SDK model port to avoid maintaining native replay, tool and streaming semantics in Cherry. Removing internal codecs must retain that protocol boundary.

## Decision

The existing pinned Pi AI patch is extended with an optional object transport for Anthropic Messages, OpenAI Chat Completions, OpenAI Responses and Gemini. Native providers build their existing protocol requests and consume their existing protocol events; the transport exchanges these objects without translating Pi context to AI SDK messages. Default native HTTP execution remains available.

HTTP and object delivery share gateway preparation and protocol adapters. HTTP routes retain authentication, JSON parsing, response commitment and SSE formatting. Desktop bindings supply trusted in-process session attribution and request selections. Both paths share model admission, converters, AI SDK execution, credentials, provider compatibility, tracing and the sole billing writer. Client tools have no gateway executor; native runtimes retain retry ownership.

Object delivery uses a capacity gate before accumulator/listener fan-out and a bounded protocol-event queue. Deliverable tool-error calls commit startup after adapter acceptance so a textless batch can drain before that queue fills. Cancellation, early iterator closure and failure release pending consumers and abort upstream execution. Slow consumption must not create an unbounded queue. Preserve provider errors and terminal outcomes; never retry a partly consumed call through HTTP.

This decision partially supersedes only the internal HTTP requirement in the harness boundary decision. Pi/Pi Durable retain native scheduling, history, tools, compaction and recovery. Existing UIMessage conversion, tool-argument JSON fragments, persistence and real upstream network codecs remain. External clients, including Claude Code, keep HTTP.

## Alternatives considered

- In-memory fetch retains JSON/SSE codecs.
- A Pi-to-AI-SDK adapter restores the removed model port and metadata maintenance.
- Another process isolates Main but retains internal codecs and changes resource ownership.
- Direct upstream providers split Cherry's AI SDK compatibility, credentials and billing.

## Consequences

Provider SDKs perform implicit shaping, validation and error classification. The object path supplies native event shapes, including Anthropic SDK defaults and Gemini response objects. This adds a pinned native transport hook to maintain alongside the existing dependency patch. Default native HTTP remains available; desktop bindings never fall back to it after an object failure.

The gateway remains the only provider configuration, upstream credential, AI SDK execution and billing owner. HTTP listener restarts no longer invalidate Pi connections. Existing UIMessage conversion, tool-argument JSON fragments, persistence and upstream network codecs remain. No CPU or latency improvement has been measured.

## Verification

- AC1 — `gatewayModelBinding.test.ts` (25 passed), `gatewayIntegration.test.ts` (43 passed) and native `nativeSession.test.ts` / `queryFork.test.ts` (18 passed) cover the four object protocols, native replay and unchanged default HTTP execution.
- AC2 — Production gateway integration rejects internal protocol request JSON encoding and SSE formatting for all four protocols, with zero internal HTTP requests, one upstream request and one billing record; it also covers opaque reasoning replay, tool ownership, request selections and structured provider failures.
- AC3 — Production gateway integration covers execution startup failure, partial-output stream failure, cancellation before semantic output, iterator closure before its first read, bounded producer progress and lossless resumption after slow consumption. A textless batch of eight object-shaped tool errors returns all native Responses tool calls instead of stalling until cancellation; this regression failed before the startup fix.
- AC4 — Production gateway integration with `setupTestDatabase` covers concurrent roots, native phase parenting, frozen message attribution, root/child response joins and native summary ownership with one billing writer.
- AC5 — Thirteen affected Main test files passed (1745 tests, 2 skipped), followed by the expanded 42-test gateway integration run; `pnpm install --frozen-lockfile` and `pnpm typecheck:node` passed. A subsequent no-listener desktop connection run passed (144 tests, 2 skipped). Dependency patch installation rebuilt the native runtime packages, and an isolated Electron development build opened its Main window. Live-provider calls, packaged distribution testing and performance measurement remain separate checks.
