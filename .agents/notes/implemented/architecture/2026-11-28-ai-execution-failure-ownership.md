# Agent Note: AI execution failure ownership

Status: implemented

English | [中文](2026-11-28-ai-execution-failure-ownership.zh.md)

## Problem

Chat and Work can reach the same error UI through different stream protocols. A stream can carry an original error or only presentation text. The renderer currently treats an unclassified failure observed during response streaming as a transmission interruption. Persistence can derive a different diagnosis from the same error.

## Decision

The main-process AI layer assigns a terminal failure reason from the strongest available evidence and records the stage independently. Runtime adapters preserve typed errors when available. When an upstream request is represented only by text, a narrowly recognized request-level HTTP 400 prefix may supply the status. An HTTP status mentioned inside a resource diagnostic cannot supply the request status.

Chat and Work events carry the resolved failure to live rendering and persistence. An explicit unknown reason remains unknown. A stream interruption requires evidence from the transport or a typed failure. The renderer owns localized guidance. Runtime adapters own retries. Logging owns reporting policy.

Use the existing AI error categories and project them into the versioned `ExecutionFailure` format where required. Continue to read old messages and preserve their supported diagnostics. Keep provider-specific parsing in the AI domain and the cross-process representation independent of SDK error classes.

## Alternatives considered

- Recover HTTP 400 in the renderer. This repairs one headline, while persisted failures and other stream consumers still classify separately.
- Treat every failure observed while streaming as a transport interruption. This reports a network cause even when a provider rejected the request or the cause is unknown.

## Consequences

Historical errors can still be classified from their stored details. Unknown streaming errors show generic guidance. An existing transport diagnosis continues to display interruption guidance. Chat and Work keep the desktop category even when the versioned failure format represents it as `invalid_input`.

## Verification

- AC1 — `AiStreamManager.test.ts` verifies request-level HTTP 400, structured status precedence, safe detail, and rejection of embedded resource status across terminal paths.
- AC2 — `AiStreamManager.test.ts` compares the terminal event with the persisted error part. `PiDurableRuntimeConnection.test.ts` checks HTTP 400 after recovery from the archived native reply.
- AC3 — `errorClassifier.test.ts` and `ErrorBlock.test.tsx` exercise generic unknown guidance and explicit interruption guidance.
