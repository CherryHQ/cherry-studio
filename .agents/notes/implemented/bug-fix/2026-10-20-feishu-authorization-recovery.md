# Agent Note: Recover interrupted Feishu authorization

Status: implemented

English | [中文](2026-10-20-feishu-authorization-recovery.zh.md)

## Problem

An initial Feishu authorization can leave a pending Connection in SQLite before credentials or identity are persisted. Startup retains that row as requiring reauthorization, but reconnect previously required an existing stable user ID and rejected recovery. Separately, response body read failures escaped the Knowledge transport retry classification; registration body timeouts became invalid-response errors and stopped polling.

## Decision

Reconnect permits first identity binding only when every persisted identity/display field, authorization timestamp, and validation timestamp is null and granted scopes are empty. Any prior authorization evidence retains the established-account checks. Recovery still uses the replacement credential reference, generation checks, and expected-reference compare-and-swap; it does not become a new initial session.

Both Feishu transports consume the body inside their transport error boundary, before parsing JSON. Knowledge body failures remain transient and use the existing bounded retries. Registration request timeouts retry within the registration deadline; other network failures retain the existing request-failure behavior. Caller cancellation and JSON/schema errors remain distinct, and raw transport details are not exposed.

HTTP 200 responses with Feishu error code `20005` invalidate the authorization through the same terminal path as HTTP 401. Transport success does not imply a usable token.

Paginated reads check token freshness after each endpoint/backoff wait, including retries. They reuse the existing refresh single-flight directly inside the credential lane rather than enqueueing another request behind themselves. Numeric missing-application-scope errors use the terminal scope-missing path on all Wiki reads; resource ACL failures remain local.

Registration accepts only the four recognized polling error statuses on HTTP 400 for the poll action; other non-success responses remain errors. This preserves pending/slow-down behavior without accepting credentials from an unsuccessful response.

Starting reconnect does not invalidate a connected credential. Successful replacement accepts either connected or reauthorization-required state under the existing expected-reference CAS. All precommit candidate failures preserve working authorization, including denial, provider/local expiry, scope and identity validation, and persistence failure. They discard the candidate without changing the active credential or pausing dependent Sources. Only failures concerning the active credential invalidate it; scope validation itself has no mutation side effects, and refresh/startup own the invalidation decision.

Initial cancellation captures its cleanup generation and checks generation, runtime-state identity, and the persisted credential reference again after asynchronous cleanup. A newer reconnect owns the retained row and runtime state. Failure cleanup uses the same fence. Credential writes enforce directory mode `0700` on POSIX even when path auto-ensure previously created the directory.

Credential replacement also advances the runtime generation at commit, fencing requests that used the old token during optional consent. Retirement uses the new lifetime signal; late failures cannot invalidate the replacement.

## Alternatives considered

Deleting and recreating the Connection discards recoverable identity-free state. Skipping account checks whenever the user ID is missing could replace an established account. Treating all response errors as retryable would conflate malformed provider data with transport failures and broaden the existing registration policy.

Persisting reauthorization-required when an optional upgrade starts would need conditional rollback and coordinated Source restoration on every failure and cancellation path. Keeping valid authorization until replacement or genuine invalidation avoids those extra transitions. Unconditional initial cleanup can erase a newer reconnect after an awaited file operation.

## Consequences

The recovery needs no schema migration. A partially populated identity remains an error rather than evidence of an unused Connection. Successful CI does not establish live Feishu or operating-system keyring acceptance.

## Verification

- Regression — `ExternalKnowledgeRuntime.test.ts`: real SQLite startup reconciliation and replacement reconnect preserve the Connection ID and persist its first identity and credentials; an actual SDK body failure retries to successful initial authorization.
- Regression — `ExternalKnowledgeRuntime.test.ts`: each surviving authorization marker blocks identity-free recovery; existing account mismatch, stale reference, cancellation, and generation cases remain covered.
- Regression — `feishuKnowledgeProvider.test.ts` and `feishuAppRegistration.test.ts`: body failure, timeout, cancellation, registration deadline, and malformed response cases preserve their distinct outcomes.

- Regression — `ExternalKnowledgeRuntime.test.ts`: the real SDK transport receives `20005`; the real SQLite Connection changes to requiring reauthorization and rejects further token acquisition.

- Regression — `authorizationRecovery.integration.test.ts`: real SQLite and credential files cover pending/committed replacement during initial cancellation, cancellation and transient failures followed by restart, genuine invalidation, and newer successful reconnect ownership.
- Regression — `feishuAppRegistration.test.ts`: HTTP 400 pending/slow-down reaches credentials with the required delay; denied/expired errors remain distinct and unsuccessful credential responses are rejected.
- Regression — `ExternalKnowledgeCredentialStore.test.ts`: a pre-existing `0755` directory becomes `0700` while the encrypted credential file remains `0600`.
