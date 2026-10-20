# Agent Note: Recover interrupted Feishu authorization

Status: implemented

English | [中文](2026-10-20-feishu-authorization-recovery.zh.md)

## Problem

An initial Feishu authorization can leave a pending Connection in SQLite before credentials or identity are persisted. Startup retains that row as requiring reauthorization, but reconnect previously required an existing stable user ID and rejected recovery. Separately, response body read failures escaped the Knowledge transport retry classification; registration body timeouts became invalid-response errors and stopped polling.

## Decision

Reconnect permits first identity binding only when every persisted identity/display field, authorization timestamp, and validation timestamp is null and granted scopes are empty. Any prior authorization evidence retains the established-account checks. Recovery still uses the replacement credential reference, generation checks, and expected-reference compare-and-swap; it does not become a new initial session.

Both Feishu transports consume the body inside their transport error boundary, before parsing JSON. Knowledge body failures remain transient and use the existing bounded retries. Registration request timeouts retry within the registration deadline; other network failures retain the existing request-failure behavior. Caller cancellation and JSON/schema errors remain distinct, and raw transport details are not exposed.

## Alternatives considered

Deleting and recreating the Connection discards recoverable identity-free state. Skipping account checks whenever the user ID is missing could replace an established account. Treating all response errors as retryable would conflate malformed provider data with transport failures and broaden the existing registration policy.

## Consequences

The recovery needs no schema migration. A partially populated identity remains an error rather than evidence of an unused Connection. Successful CI does not establish live Feishu or operating-system keyring acceptance.

## Verification

- Regression — `ExternalKnowledgeRuntime.test.ts`: real SQLite startup reconciliation and replacement reconnect preserve the Connection ID and persist its first identity and credentials; an actual SDK body failure retries to successful initial authorization.
- Regression — `ExternalKnowledgeRuntime.test.ts`: each surviving authorization marker blocks identity-free recovery; existing account mismatch, stale reference, cancellation, and generation cases remain covered.
- Regression — `feishuKnowledgeProvider.test.ts` and `feishuAppRegistration.test.ts`: body failure, timeout, cancellation, registration deadline, and malformed response cases preserve their distinct outcomes.
