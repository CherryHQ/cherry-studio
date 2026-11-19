# Agent Note: Bound image-heavy Agent HTTP request concurrency

Status: implemented

English | [中文](2026-11-19-agent-http-request-budget.zh.md)

## Problem

Parallel Claude Agent requests can exhaust the Electron main process V8 heap. Overlapping image histories increase memory pressure during gateway conversion and provider request encoding. Claude Agent still uses internal HTTP after [Pi moved to object transport](../architecture/2026-11-18-agent-object-transport.md).

## Decision

Internal Agent session requests to `POST /v1/messages` share 32 one-MiB units before conversion. Charge by HTTP content length, rounded up and capped at the full budget. Requests of unknown length reserve the full budget. Release the reservation on completion, failure, or disconnect. Remove cancelled waiters immediately and reconsider the next request against the available budget.

## Alternatives considered

- A fixed request count gives small text requests and large image histories equal weight.
- Trimming history or scaling down images changes what the model can review.

## Consequences

Large calls can wait for capacity and retain their full history. Public requests and Pi object transport bypass the HTTP budget. The budget bounds overlapping downstream processing. HTTP body parsing precedes admission and can still consume memory.

## Verification

- Regression — `ApiGatewayService.test.ts`, `proxyStream.stream.test.ts`, and `routes.integration.test.ts` cover weighted queuing, cancellation, stream completion and disconnect, and the internal session boundary.
- Regression — macOS Electron development build with a restored profile and a local model mock completed 26 minutes of image reads and a separate image, shell, and streaming-text run, each with up to 20 concurrent subagents. Both runs completed without OOM. The Windows packaged app and the full historical conversation remain unverified.
