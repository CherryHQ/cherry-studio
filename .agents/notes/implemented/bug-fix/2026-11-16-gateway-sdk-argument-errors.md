# Agent Note: SDK argument failures are gateway request errors

Status: implemented

English | [中文](2026-11-16-gateway-sdk-argument-errors.zh.md)

## Problem

The Google SDK rejects invalid provider options before calling fetch. Its `AI_InvalidArgumentError` has no HTTP status, so the gateway previously returned 500. This represented a deterministic argument failure as a server failure (#24572). Fixing a particular SDK option enum does not repair this mapping for other invalid arguments.

## Decision

The gateway maps a statusless error named `AI_InvalidArgumentError` to 400 across generation dialects. The exact name survives the existing serialization boundary; SDK instance markers do not. An explicit HTTP status retains precedence. A standalone `AI_TypeValidationError` remains outside this rule because it can describe an invalid upstream response.

The new branch sanitizes only the selected message through the existing bounded provider-message helper, falling back to `Invalid request parameters`. It does not inspect or publish argument values or causes. Authenticated internal requests retain their existing trusted cause-detail behavior. Public responses continue to exclude diagnostic extras.

## Alternatives considered

- Returning 500 misidentifies an argument rejection and can invite clients to retry an unchanged request.
- Mapping every validation error to 400 would blame the caller for malformed upstream responses.
- Testing only error instances misses the plain serialized errors actually delivered by the stream boundary.
- Forwarding the raw argument message can expose payloads or credentials; HTTP status selection does not itself sanitize text.

## Consequences

Before response commitment, generation requests return HTTP 400 and the dialect's request-error vocabulary. After SSE commitment, HTTP remains 200 and the terminal error frame carries the request-error classification. This does not alter SDK validation, supported model options, or client retry policy. No live upstream service or downstream harness retry behavior is claimed by the tests.

## Verification

- Regression — `src/main/features/apiGateway/__tests__/errors.http.test.ts`: a real Google SDK invalid-option call makes no fetch; raw and serialized failures are checked over real local sockets in four dialects before and after stream commitment. Credential/payload messages are sanitized, explicit status wins, standalone response validation stays distinct, and trusted internal causes survive.
- Regression — `src/main/features/apiGateway/__tests__/proxyStream.stream.test.ts` and `src/main/ai/utils/__tests__/serializeError.test.ts`: affected stream and serialization consumers retain their existing behavior.
