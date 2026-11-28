# Agent Note: Preserve context overflow from provider streams

Status: implemented

English | [中文](2026-11-28-sse-context-overflow.zh.md)

## Problem

An upstream SSE error can identify context overflow by its business code without an HTTP error status. Serializing the plain error object discarded the code, so the gateway could report HTTP 500 and chat could miss the opportunity to compact its context.

## Decision

The provider adapter uses the AI Core overflow predicate for statusless stream failures and HTTP 400. It exposes recognized overflow to compaction and retry as the same typed, non-retryable error. Eligible chat requests can compact before output and retry the failed step. The AI SDK execution path selects the final cause after retries. Serialization preserves the category, and the gateway maps it to the client's error protocol.

## Alternatives considered

- Classifying at the gateway would miss chat recovery and could only use the fields that survived serialization.
- Injecting a status into the upstream error would obscure the actual provider response.

## Consequences

The upstream error status stays optional. Once the gateway has begun streaming, it reports overflow in the terminal frame and preserves delivered output.

## Verification

- Regression — A local HTTP upstream sent a code-only SSE error before and after content. Both cases failed before the fix and passed afterward.
- Regression — A 429 followed by a code-only SSE overflow preserved the final category. Chat recovery retried only the failed model step after a completed tool call.
- Regression — The Electron development instance returned HTTP 400 before content and a single context-overflow frame after content, with one upstream call per request.
