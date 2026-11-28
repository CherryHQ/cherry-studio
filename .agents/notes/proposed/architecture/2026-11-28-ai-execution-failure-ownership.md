# Agent Note: AI execution failure ownership

Status: proposed

English | [中文](2026-11-28-ai-execution-failure-ownership.zh.md)

## Problem

Chat and Work can reach the same error UI through different stream protocols. A stream can carry an original error or only presentation text. The renderer currently treats an unclassified failure observed during response streaming as a transmission interruption. Persistence can derive a different diagnosis from the same error.

## Proposal

The main-process AI layer assigns a terminal failure reason from the strongest available evidence and records the stage independently. Runtime adapters preserve typed errors when available. When an upstream request is represented only by text, a narrowly recognized request-level HTTP 400 prefix may supply the status. An HTTP status mentioned inside a resource diagnostic cannot supply the request status.

Chat and Work events carry the resolved failure to live rendering and persistence. An explicit unknown reason remains unknown. A stream interruption requires evidence from the transport or a typed failure. The renderer owns localized guidance. Runtime adapters own retries. Logging owns reporting policy.

Use the existing AI error categories and project them into the versioned `ExecutionFailure` format where required. Continue to read old messages and preserve their supported diagnostics. Keep provider-specific parsing in the AI domain and the cross-process representation independent of SDK error classes.

## Alternatives considered

- Recover HTTP 400 in the renderer. This repairs one headline, while persisted failures and other stream consumers still classify separately.
- Treat every failure observed while streaming as a transport interruption. This reports a network cause even when a provider rejected the request or the cause is unknown.

## Acceptance criteria

- AC1 — Chat and Work preserve an upstream request-level HTTP 400 and its safe provider detail, while an embedded resource HTTP status stays part of the detail. (verification: main stream tests, AI execution owner)
- AC2 — A newly failed reply has the same diagnosis live and after persistence, and existing history remains readable. (verification: main projection and renderer tests, messaging owner)
- AC3 — An unclassified failure during streaming displays generic failure guidance, and a failure with explicit transport evidence retains interruption guidance. (verification: renderer classification tests, chat presentation owner)

## Risks

Some existing providers and runtimes supply only strings, so part of their failure evidence is inherently limited. Preserve explicit runtime and provider diagnoses, and keep compatibility handling for old serialized messages during migration.
