# Agent Note: Native agent model calls over object transport

Status: proposed

English | [中文](2026-11-18-agent-object-transport.zh.md)

## Problem

Pi and Pi Durable run in Main but call Cherry's internal HTTP gateway. Native Pi providers serialize requests and parse SSE, while the gateway parses requests and serializes events around Cherry's single AI SDK execution pipeline.

The [harness boundary decision](2026-10-17-agent-harness-boundaries.md) removed a custom Pi-to-AI-SDK model port to avoid maintaining native replay, tool and streaming semantics in Cherry. Removing internal codecs must retain that protocol boundary.

## Proposal

Extend the existing pinned Pi AI patch with an optional object transport for Anthropic Messages, OpenAI Chat Completions, OpenAI Responses and Gemini. Native providers build their existing protocol requests and consume their existing protocol events; the transport exchanges these objects without translating Pi context to AI SDK messages. Default native HTTP execution remains available.

Extract shared gateway preparation and protocol-event execution. HTTP routes retain authentication, JSON parsing, response commitment and SSE formatting. Desktop bindings supply trusted in-process session attribution and request selections. Both paths share model admission, converters, AI SDK execution, credentials, provider compatibility, tracing and the sole billing writer. Client tools have no gateway executor; native runtimes retain retry ownership.

Object delivery is bounded. Cancellation, early iterator closure and failure release pending consumers and abort upstream execution. Slow consumption must not create an unbounded queue. Preserve provider errors and terminal outcomes; never retry a partly consumed call through HTTP.

This partially supersedes only the internal HTTP requirement in the harness boundary decision. Pi/Pi Durable retain native scheduling, history, tools, compaction and recovery. Existing UIMessage conversion, tool-argument JSON fragments, persistence and real upstream network codecs remain. External clients, including Claude Code, keep HTTP.

The protocol boundary also preserves structured reasoning signatures, cache-write and reasoning-token breakdowns, and explicit terminal truncation or filtering. Provider citations and tool-argument delta delivery remain outside this extension.

Gemini request configuration supported by the pinned AI SDK maps through the shared per-call contract: sampling, JSON/schema output, function selection, safety settings, cached context, and native media, label and service options. Both HTTP and object calls use the same projection. Unsupported local client behavior fails as an SDK capability error without a fabricated HTTP status. Client function execution remains with the native runtime. File output and Google finish metadata retain the native event shape; Pi text sessions keep their existing output capabilities.

## Alternatives considered

- In-memory fetch retains JSON/SSE codecs.
- A Pi-to-AI-SDK adapter restores the removed model port and metadata maintenance.
- Another process isolates Main but retains internal codecs and changes resource ownership.
- Direct upstream providers split Cherry's AI SDK compatibility, credentials and billing.

## Acceptance criteria

- AC1 — All four native protocols exchange request/event objects through optional transport while default HTTP behavior remains valid. (verification: unit — native-provider transport tests)
- AC2 — Object and HTTP calls share gateway conversion and AI SDK execution, preserving reasoning, tools, selections and provider errors without an internal HTTP/JSON/SSE round trip. (verification: unit — native-binding and gateway integration tests)
- AC3 — Cancellation, failure, early iterator closure and slow consumers settle without leaked work or unbounded buffering. (verification: unit — object-stream lifecycle tests)
- AC4 — Root, child and detached calls preserve initiating usage/tracing ownership and one provider billing record per call. (verification: unit — production gateway integration using setupTestDatabase)
- AC5 — Pi and Pi Durable use object transport; external HTTP behavior and reproducible dependency installation remain valid. (verification: unit — affected desktop/HTTP tests; packaged artifact — dependency build and typecheck)

- AC6 — Chat Completions structured reasoning_details survives same-model tool continuation unchanged, including encrypted-only reasoning. (verification: unit — native Pi through production gateway round-trip tests)
- AC7 — OpenAI dialects retain reported cache-write usage without double-counting uncached input, cache reads/writes or totals. (verification: unit — usage conversion and native consumer tests)
- AC8 — Anthropic retains reported thinking_tokens without changing text or signature replay. (verification: unit — usage conversion and native consumer tests)
- AC9 — Explicit final length/content-filter outcomes take precedence over tool presence; errors and cancellations remain failed or aborted. (verification: unit — four-protocol terminal outcome tests)

- AC10 — Gemini HTTP and object requests preserve pinned-SDK-supported configuration through shared preparation, including safety/cache context, sampling, JSON/schema output, function selection and native provider options; unsupported local client behavior does not become an HTTP error envelope. (verification: unit — converter, standard parameter and production gateway/native consumer tests)
- AC11 — Gemini responses preserve file parts and Google finish metadata needed by configured modalities and continuation, without adding tool execution to the gateway or changing Pi text-session output capabilities. (verification: unit — protocol adapters and production gateway tests; manual — Electron text/tool and HTTP structured-output acceptance)

## Risks

Provider SDKs perform implicit shaping, validation and error classification. Object events must match native consumers, including SDK-normalized Gemini fields. Anthropic startup and mid-stream failures must not become completion. Published references must not be mutated. Tracing and billing must retain frozen ownership. No CPU or latency improvement is claimed before measurement.
