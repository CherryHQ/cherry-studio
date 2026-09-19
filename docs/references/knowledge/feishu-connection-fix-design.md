---
description: Remediation design for the Feishu Connection foundation in PR 20699, covering stable identity, credential replacement, runtime validation, and protocol hardening
sources:
  - src/main/features/knowledge/external
  - src/main/data/services/ExternalKnowledgeConnectionService.ts
  - src/main/data/db/schemas/externalKnowledgeConnection.ts
  - src/main/services/feishuAppRegistration.ts
  - src/main/ipc/handlers/knowledge.ts
---

# Feishu Connection Foundation — Remediation Design

This document fixes the Layer 1 contracts implemented by
[#20699](https://github.com/CherryHQ/cherry-studio/pull/20699) for
[#15970](https://github.com/CherryHQ/cherry-studio/issues/15970). It preserves the
current Knowledge-owned architecture and Scheme C: automatic PersonalAgent
registration is the default, a self-built App ID and App Secret is the fallback,
and both paths use Feishu user device authorization.

The remediation stays inside Layer 1. It does not add Sources, Documents,
traversal, ingestion, synchronization Jobs, schedules, renderer UI, Lark support,
bot-only authorization, or a global OAuth or credential platform.

## 1. Decisions

| Area | Decision |
|---|---|
| Runtime owner | `KnowledgeService` continues to own `ExternalKnowledgeRuntime` and its startup, admission, cancellation, drain, and shutdown |
| Durable data owner | `ExternalKnowledgeConnectionService` owns Connection state and the atomic reauthorization compare-and-swap |
| Secret owner | `ExternalKnowledgeCredentialStore` remains a Knowledge-private, main-process-only encrypted file |
| Provider boundary | `feishuKnowledgeProvider` remains stateless and owns Feishu HTTP parsing and error classification |
| Registration boundary | `feishuAppRegistration` remains the neutral, stateless primitive shared by Channel and Knowledge |
| Stable user identity | Cross-application identity is `tenantKey + accountUserId`; `accountOpenId` is application-scoped metadata only |
| Required identity scope | PersonalAgent and self-built applications both require `auth:user.id:read` |
| Reauthorization commit | A new opaque credential reference is staged and the Connection switches to it with one guarded SQLite update |
| Startup recovery | Admission remains closed until referenced credentials are reconciled and unreferenced credential entries are removed |

The existing lifecycle owner is required because the runtime owns authorization
sessions, per-credential queues, refresh and validation single-flight state,
abort controllers, and shutdown drain behavior. No additional lifecycle service
is justified.

## 2. Identity contract

`ExternalKnowledgeConnection` adds nullable `accountUserId`. A connected
Connection requires `accountUserId`, `accountOpenId`, `tenantKey`,
`authorizedAt`, and a non-empty granted scope set. A pending Connection has no
identity fields. A Connection in `reauthorization-required` retains its last
verified identity.

The provider user-info decoder requires `user_id`, `open_id`, and `tenant_key`.
It may retain `union_id` as optional metadata, but neither `union_id` nor
`open_id` substitutes for `user_id` during cross-application replacement.

The four synchronization scopes remain separately named business permissions:

```text
wiki:node:read
wiki:node:retrieve
docs:document.content:read
offline_access
```

`auth:user.id:read` is a required technical identity permission for both setup
paths. Automatically registered applications accept exactly the required
business permissions and this technical permission. Self-built applications may
have additional permissions, but must contain all five required permissions.

Replacement identity evaluation is deterministic:

```text
tenantKey differs                         -> identity-conflict
tenantKey matches and accountUserId differs -> identity-conflict
tenantKey and accountUserId both match    -> same identity
accountUserId is absent                   -> identity-unverifiable
```

`identity-conflict` and `identity-unverifiable` never replace the existing
credential or application metadata. The latter instructs the caller to restore
the original application authorization or create a new Connection.

## 3. Credential replacement and crash consistency

Every reconnect creates a new opaque candidate credential reference. The old
Connection reference, application metadata, identity, and credential entry stay
unchanged while authorization is in progress.

The sequence is:

1. Verify that secure credential storage is available.
2. Generate a candidate reference and retain candidate application credentials
   only in the in-memory authorization session.
3. Complete device authorization and receive tokens in memory.
4. Validate the returned scope set.
5. Fetch and validate the Feishu identity.
6. Compare `tenantKey + accountUserId` with the persisted Connection identity.
7. Write the complete candidate credential entry.
8. Call `commitReauthorization` with the Connection id, expected old reference,
   candidate reference, new application metadata, verified identity, scopes,
   and timestamps.
9. Switch the Connection with one `UPDATE ... WHERE credential_reference = ?`
   statement. Zero updated rows means the session is stale or the Connection no
   longer exists.
10. Re-key the in-memory credential state, revoke the old refresh token on a
    best-effort basis, and remove the old credential entry.

Generation checks remain immediately before and after every awaited operation.
The SQLite compare-and-swap is the durable guard against two generations both
committing. A cancellation, terminal error, scope failure, identity failure, or
CAS miss removes the candidate and leaves the old credential bytes unchanged.

The credential store exposes only the minimum enumeration needed for startup
cleanup. Reconciliation first reads all Connections, then removes credential
entries not referenced by any Connection. It never rewrites or prunes a file
that fails top-level schema validation or decryption availability checks.

Crash outcomes converge as follows:

| Crash point | Durable state | Startup result |
|---|---|---|
| Before candidate write | Connection points to old credential | Keep old credential |
| After candidate write, before CAS | Candidate is unreferenced | Remove candidate; keep old credential |
| After CAS, before old removal | Connection points to candidate; old entry remains | Keep candidate; remove old entry |
| Initial authorization before credential commit | Pending Connection has no usable credential | Preserve Connection and require reauthorization |

The design deliberately avoids an `active/staged/previous/commitMarker` journal
inside one credential entry. Such a journal would add a second recovery state
machine without making SQLite and the credential file transactional.

## 4. Runtime validation and lifecycle

Explicit validation is authoritative. `validateConnection()` invalidates the
current generation's validation cache before entering the existing credential
queue. Concurrent explicit validations still coalesce through the existing
queue and validation flight. Ordinary provider requests continue to reuse a
successful generation-level validation.

Access-token acquisition, identity validation, and the provider operation share
one terminal-error boundary:

- HTTP 401 and `invalid_grant` mark the Connection
  `reauthorization-required`;
- a missing required scope marks the Connection
  `reauthorization-required` and returns `scope-missing`;
- transient service failures and request timeouts do not change durable
  authorization state;
- caller or lifecycle cancellation does not change durable authorization state;
- a stale generation cannot publish either success or failure.

Startup uses one reusable `startFlight`. Admission remains closed while local
reconciliation and orphan cleanup run. Concurrent starts share that flight.
Stop closes admission first, aborts the lifetime, and waits for startup and
tracked in-flight work to settle before clearing runtime state.

This is a correction to the existing `KnowledgeService`-owned runtime, not a new
lifecycle abstraction. No changes to lifecycle phase or service dependencies are
required.

## 5. Registration and transport hardening

`feishuAppRegistration` uses a local decoder and does not introduce another
registration service or shared protocol layer. It:

- checks HTTP success before accepting a response;
- accepts only JSON objects with the required non-empty string fields;
- treats explicit protocol errors as failures without copying response bodies or
  provider descriptions into user-visible errors or logs;
- prefers a positive integer `expire_in`, accepts positive `expires_in` for
  compatibility, and otherwise uses the existing 600-second default;
- accepts only a positive polling interval and otherwise uses the existing
  5-second default;
- applies one deadline signal to both polling delays and in-flight HTTP calls;
- limits `slow_down` growth without adding a scheduler abstraction.

Each `net.fetch` in registration and the Knowledge Feishu provider combines the
caller signal with a 30-second request timeout. A timeout is transient; a caller
or lifecycle abort remains cancellation and is not retried.

Registration sessions gain an in-memory `claimed` flag. The first consumer marks
the session claimed synchronously before its first await. A second consumer
receives `session-not-found`. The claimed entry stays in the map until the first
consumer finishes so the existing cancellation command can still abort it.

The unused `tenantScopes` option is removed. Channel retains its current
registration behavior, while Knowledge passes only the required user scopes.

## 6. Credential-store hardening

The safe-storage adapter exposes the selected backend. On Linux, storage is
usable only when encryption is available and the selected backend is a real
keyring implementation. `basic_text` and `unknown` fail closed. Writes fail with
the existing encryption-unavailable category; reads and rotations surface the
existing undecryptable result so startup reconciliation can require
reauthorization.

Credential-file replacement reuses the repository's `atomicWriteFile` with mode
`0600`. The containing credential directory remains `0700`. The credential file
format does not change, and no shared filesystem API is extended.

## 7. Data and IPC contract cleanup

The unshipped `0024` migration is regenerated after the schema change rather
than followed by a corrective `0025`. The generated SQL and snapshot are not
edited manually.

Default ownership is reduced to one source:

- the service explicitly writes the `feishu` provider discriminator, so the
  database column has no provider default;
- the database owns the empty granted-scope default;
- nullable identity, display, and timestamp values are omitted on creation and
  naturally become `NULL`.

IPC exposes distinct error codes for missing permissions, an automatically
registered application's unexpected permissions, identity conflict, identity
unverifiability, and required reauthorization. No token or App Secret appears in
an IPC or DataApi result.

The per-domain shared schema test is deleted. Invalid command inputs remain
covered through real `IpcRouter.dispatch` tests, and secret-exclusion assertions
cover real handler and runtime return values instead of manually invoking an
unused output parser.

## 8. Verification contract

Focused tests must catch these regressions:

- cross-application replacement succeeds when `open_id` changes but
  `tenant_key + user_id` stays equal;
- tenant or `user_id` changes reject replacement without changing the old
  credential bytes or application metadata;
- missing `user_id` produces `identity-unverifiable`;
- cancellation, terminal authorization errors, scope failures, and CAS conflicts
  remove the candidate and preserve the old reference;
- startup converges correctly at every candidate-write and CAS crash boundary;
- two reconnects based on the same old reference cannot both commit;
- explicit validation performs a new identity request after a cached validation;
- an identity-request 401 transitions the Connection to
  `reauthorization-required` without running the requested provider operation;
- no provider request is admitted before reconciliation completes;
- canonical `expire_in`, compatible `expires_in`, malformed registration
  responses, registration deadline, request timeout, and caller cancellation;
- one registration session cannot be consumed twice but can still be cancelled
  after being claimed;
- Linux `basic_text` cannot create, read as usable, or rotate credentials;
- startup never prunes a referenced entry or rewrites a corrupt credential file;
- IPC returns distinct codes for scope missing, scope mismatch, identity
  conflict, and identity unverifiability;
- the migration applies to a populated database and generated migration state
  matches the schema.

Final verification runs the focused main and shared tests, migration-chain
checks, `pnpm lint`, `pnpm build:check`, `git diff --check`, and the complete
GitHub CI matrix. Because this change crosses a migration, security boundary,
shared registration primitive, and lifecycle-owned runtime, the full final gate
is proportionate.

## 9. Commit structure

1. `fix(external-knowledge): persist stable Feishu user identity`
2. `fix(external-knowledge): commit reauthorization atomically`
3. `fix(external-knowledge): make runtime validation authoritative`
4. `fix(feishu-auth): harden registration and credential transport`
5. `refactor(external-knowledge): narrow layer-one contracts`

Each commit includes its focused regression tests. The issue decision comment is
updated with the required technical identity permission and stable identity
rule. The PR body records the new test commands and results. The PR is not
considered the Stack PR1 base until CI runs rather than skips and all required
checks pass.
