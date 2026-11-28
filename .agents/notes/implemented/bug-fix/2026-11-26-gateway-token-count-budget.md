# Agent Note: Share the internal Agent request budget with token counting

Status: implemented

English | [中文](2026-11-26-gateway-token-count-budget.zh.md)

## Problem

Anthropic token counting converts messages and attachments and may forward the estimate upstream. Internal Agent calls to `/v1/messages/count_tokens` could run this work concurrently without the request budget used by `/v1/messages`. Issue #25445 tracks the missing admission check.

## Decision

Use the same internal Agent session check and request budget for both routes. Token counting waits for admission before estimation, passes the request's abort signal, and releases its allocation when estimation succeeds or fails.

## Alternatives considered

An independent token-counting budget would allow generation and estimation to reach their separate limits at the same time. Sharing the existing budget caps their combined estimation and generation work.

## Consequences

Internal Agent token counting can wait behind generation work. Public requests retain their existing route behavior. Admission happens after the HTTP body has been parsed, so this covers estimation and conversion work.

## Verification

- Regression — `routes.integration.test.ts` covers waiting for admission, public requests proceeding during the wait, release on success or failure, and cancellation before estimation.
- Regression — `ApiGatewayService.test.ts` and `estimateAnthropicRequestTokens.test.ts` cover the real budget implementation and the estimator. The three targeted suites passed 139 tests.
