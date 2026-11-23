# Agent Note: Legacy fallback after an MCP probe connection closes

Status: implemented

English | [中文](2026-11-19-mcp-probe-closed-legacy-fallback.zh.md)

## Problem

The SDK classifies failed `server/discover` probes with `EraNegotiationFailed`, including network failures without an HTTP response. Cherry Studio additionally required an HTTP status ≥ 500 before retrying the legacy handshake. Gateways that close the probe connection, such as Electron reporting `net::ERR_EMPTY_RESPONSE`, supply no status and never reached that fallback, preventing otherwise compatible self-hosted Streamable HTTP MCP servers from connecting. Authentication failures and probe timeouts have distinct SDK codes.

## Decision

Treat a plain `SdkError` with code `EraNegotiationFailed` as legacy evidence. For the `SdkHttpError` subclass, continue requiring HTTP status ≥ 500. Retry once on the same URL transport candidate with version negotiation in legacy mode, which sends `initialize`. Skip the retry if the combined connect signal is aborted; this covers caller cancellation and the existing connect timeout. If the legacy handshake also fails, rethrow the original probe error. The retry log includes the error message and the HTTP status when available.

## Alternatives considered

- Whitelisting individual Chromium or network error codes depends on how Electron and Node/undici report the same failure.
- An extra manual `fetch` probe duplicates SDK negotiation logic and adds a round trip.
- Retrying on HTTP 4xx would turn authentication or authorization failures into protocol guesses.

## Consequences

A legacy-only server whose gateway closes `server/discover` can connect through `initialize`. An unreachable server costs one extra `initialize` attempt, bounded by the existing connect timeout. Probe and connect timeout semantics remain unchanged. Authentication and authorization failures do not trigger legacy fallback. Failure classification and the user-visible diagnosis remain unchanged when both attempts fail because the original probe error is rethrown.

## Verification

- Regression — `connects and lists tools as legacy when server/discover closes without an HTTP response`: `net::ERR_EMPTY_RESPONSE` leads to one legacy handshake, `era === 'legacy'`, and the `mx_quote` tool.
- Regression — `returns the original closed-probe error after exactly one failed legacy handshake`: an HTTP 502 from `initialize` preserves the plain SDK probe error, its `EraNegotiationFailed` code, and the closed-connection message/cause.
- Regression — `does not retry as legacy when the caller aborts an in-flight probe`: cancellation during the probe sends no `initialize` request.
- Regression — `retries a network failure as legacy once and returns the original probe error`: a second network failure leaves the original probe diagnosis intact and bounds the legacy attempt count to one.
- Regression — `keeps a real refused TCP connection local during the %s handshake`: both cases retain `ECONNREFUSED` in the cause chain and classify the failure as environment/expected/transport_unavailable after one legacy attempt.
- Regression — `recognizes a non-HTTP SDK probe failure as legacy probe evidence` and `rejects bare network errors and SDK timeouts as legacy probe evidence`: only the SDK negotiation verdict qualifies.
- Regression — `connects and lists tools when a legacy server rejects server/discover with HTTP 500`, `connects as legacy when server/discover returns an HTML 5xx body`, and `connects as legacy when server/discover returns a bare empty 5xx body`: existing HTTP 5xx compatibility remains covered.
- Regression — `keeps HTTP 401 as an authentication failure`, `rejects %s as legacy probe evidence`, and `keeps a modern server on the modern connection path`: authentication, authorization, HTTP-status exclusions, and modern negotiation retain their contracts.
- Regression — `pnpm test:main src/main/ai/mcp/connections/__tests__/ExternalMcpConnection.test.ts src/main/ai/mcp/__tests__/failureFacts.test.ts`: 2 files and 48 tests pass.
- Regression — `pnpm exec oxfmt --check src/main/ai/mcp/connections/ExternalMcpConnection.ts src/main/ai/mcp/connections/__tests__/ExternalMcpConnection.test.ts`: both files pass formatting after the scoped write command.
