# Agent Note: Settle Mermaid jobs when worker dispatch fails

Status: implemented

English | [中文](2026-11-27-mermaid-worker-dispatch.zh.md)

## Problem

A queued render is removed from the Mermaid queue before its worker starts or receives the message. If either step throws synchronously during queue advancement, its callers can be left waiting and following jobs may never start.

## Decision

Dispatch failures reject the removed job's waiters and discard the worker before advancing the queue. The render deadline starts only after posting succeeds.

## Alternatives considered

- Leaving dispatch failures to the render deadline cannot handle a worker constructor that throws before a timer exists.

## Consequences

An affected preview reports its render error and other diagrams can dispatch on a fresh worker. A worker that continues to fail settles each affected request with an error.

## Verification

- Regression — `src/renderer/services/__tests__/MermaidRenderService.test.ts`: both worker constructor and message-post failures reject the affected request and allow the next diagram to render.
