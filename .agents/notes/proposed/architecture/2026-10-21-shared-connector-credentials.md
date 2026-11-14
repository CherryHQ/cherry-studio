# Agent Note: Shared file credentials for local connectors

Status: proposed

English | [中文](2026-10-21-shared-connector-credentials.zh.md)

## Problem

Feishu Channel stores application credentials in channel configuration, while the unpublished Knowledge integration stores another copy together with user tokens in `ExternalKnowledgeCredentialStore`. Creating credentials through a Channel page does not make Channel their owner. Copying them between business modules leaves duplicate secrets and unclear update/deletion behavior.

Cherry Studio will implement its own connectors. A dedicated `feishu_application` table would encode one connector's credential shape into the business schema. The immediate need is a shared credential owner and durable file storage, not a universal OAuth runtime or a versioned storage framework.

## Proposal

### Scope and decision

Use a main-process `CredentialStore` backed by plaintext JSON files for credentials moved into this system. Channel, Knowledge, and later local connectors reference credentials instead of owning duplicate application secrets. Do not add `feishu_application`, a connector-specific credential table, or a new general account database.

The user explicitly chose plaintext for this phase and confirmed that the Knowledge encryption implementation is unpublished. Replace that implementation when migrating Knowledge; do not preserve permanent encrypted/plaintext storage modes for it. Existing published Channel data and local Knowledge test data still require a lossless conversion. This note records the agreed design, not completed implementation or a GitHub Spec approval.

Connector implementations remain Cherry-owned. OpenConnector is a design reference, not a dependency or runtime selected by this proposal. Remote Knowledge retrieval and the previously deferred phase B remain out of scope.

### Ownership and dependencies

The storage service owns credential lookup, creation, conditional replacement, deletion, file serialization, and change notification. Place this shared connector capability in `src/main/services/credential/`; file persistence does not make it part of the general business-data layer. Its `index.ts` exposes the service and error contract while keeping record schemas private. Register its persistent runtime state through the existing main-process lifecycle system. Protocol-specific modules own credential schemas, registration, consent, token refresh, and error classification. Business modules own their configuration, bindings, running jobs, and connection state.

The existing `feishuAppRegistration.ts` remains the shared registration protocol. Channel and Knowledge use the shared credential owner without reading each other's services or configuration. Retain Knowledge's authorization identity checks and runtime cancellation rules; do not move its entire runtime into a generic connector abstraction.

Initially Feishu uses two record kinds:

| Kind | Contents | References |
| --- | --- | --- |
| Application credential | Domain, App ID, App Secret | Channel bindings and user-authorization records |
| User authorization | Application credential reference, tokens, expiry, granted scopes | Knowledge Connection |

Application secrets have one authoritative copy. Knowledge's existing SQLite Connection remains authoritative for business authorization state and account identity; do not introduce a competing connection state in the file store. The application reference identifies reusable credentials, not permission to read a user's documents. Channel enablement and Knowledge synchronization remain independent.

### File model

Use one JSON file per credential, named by an opaque credential ID. A record contains only its ID, connector identifier, credential kind, display label, and schema-validated payload. Each connector validates its own supported payloads; `payload` is not an arbitrary unvalidated object.

Do not add `formatVersion`, `schemaVersion`, `encoding`, or a generic persisted `revision`. There is one supported target format. Introduce a migration only when an actual format change requires it. Do not add a codec registry, pluggable storage backends, or a generic OAuth provider base class for this phase.

Resolve the credentials directory through `application.getPath` using an explicitly registered path key. Keep it outside ordinary business-data export. Directory permissions are `0700` and file permissions `0600` on POSIX; permissions do not encrypt plaintext. Do not put account names, app IDs, or tokens in filenames. Derive the in-memory list from the files rather than maintaining a second authoritative manifest.

### Writes and asynchronous correctness

The main process is the sole file writer; renderer and utility processes never modify credential files directly. Serialize mutations through the store, validate content, and use temporary-file atomic replacement. A missing file is distinct from corrupt or unreadable content. Fail without overwriting corrupt content or treating it as an empty store.

Serialization alone does not reject an old network response. Preserve the existing expected-credential-reference and expected-refresh-token checks: a refresh may commit only while the current credential still matches the one it refreshed. Perform the check and file mutation within the same serialized operation. Retain runtime attempt/generation fences for cancellation, reconnect, and late error handling; the rejected generic persisted `revision` is not a reason to remove these protections.

Replacing a shared application secret must invalidate consumers' old credential snapshots. Consumers obtain the current secret for new authentication work; Channel reconciles its SDK connection and Knowledge fences old refresh/authorization attempts. Changing an App ID or domain is a new application identity and requires explicit rebinding, not overwriting an unrelated identity in place.

### Boundaries and deletion

Credential listing and management use IpcApi because these records are file-backed, not SQLite-backed DataApi resources. Renderer responses contain safe summaries and opaque references, never saved secrets. Manual secret input travels to the main process for storage; there is no general secret-export IPC. Do not log credential payloads.

Channel and Knowledge business rows retain their existing database ownership and store opaque credential references. Deleting a Channel removes its binding, not a credential shared with Knowledge. Disconnecting Knowledge follows its existing user-authorization semantics without deleting the shared application secret. User grants remain Knowledge-owned in this phase; shared storage does not imply shared revocation across future consumers.

Explicit credential deletion must account for both business bindings and credential-to-credential references. Coordinate binding admission and credential retirement in the main process so a stale usage check cannot race a new binding. Resolve usage from authoritative bindings, not a separately maintained reference count. SQLite and files do not share a transaction: write new credential material before committing a binding, retire old material afterward, and recover abandoned material without deleting referenced records.

### UI and delivery

Both entry points choose existing application credentials, create an application by QR, or enter credentials manually. Knowledge no longer exposes a Channel-specific import route or a `channel-app` credential source. With no suitable application selected, its connection flow displays QR registration as the primary entry; manual fields are secondary. Existing valid Knowledge authorization can continue directly; an existing application without user consent proceeds to authorization.

Reuse a presentational QR panel for the verification link/code, loading, waiting, expiry, retry, and cancel actions. Business owners retain their sessions and transitions. Do not use a generic authorization hook to merge different completion conditions. Registration success is not user-authorization success. The browser link is an explicit alternative to scanning; late abandoned responses cannot reopen it or cancel a replacement attempt.

Deliver storage and migration first, then switch Channel and Knowledge to references, then update the shared selection/QR interface. Publish the architecture Spec before implementation layers; place shared infrastructure below the existing Feishu stack and retain consumer integration on its owning layer.

### Migration and future encryption

For published Channel configuration, validate and transfer application credentials before replacing its binding and removing the old secret. For unpublished Knowledge files, decrypt existing local test credentials with the current reader and convert them to the agreed plaintext records, retaining user tokens and Connection identity. If decryption or a write fails, preserve the source and report recovery requirements; do not silently reset credentials. This is a one-way conversion, not a permanent dual-write or fallback path.

Deduplicate application credentials by domain and App ID only when their secret material agrees. Conflicting secrets need an explicit resolution; neither source automatically wins. Preserve source data until each conversion commits, and make restart resume safely. After migration completes, subsequent writes use only the target format; SQL migrations must remain append-only where business references change.

Future encryption belongs behind the same storage boundary. At that time choose the supported OS-backed mechanism and implement a concrete conversion without changing business credential IDs. This phase neither ships encryption nor maintains placeholder encryption modes. Previously recorded encrypted-storage and file-format-version plans are superseded for credentials migrated by this proposal.

The authorization recovery decision in the Feishu connection layer (#20699) remains authoritative for identity continuity, conditional replacement, cancellation, and stale-request protection. Its current encrypted-file verification describes existing code until this proposal is implemented.

### Executable implementation plan

The following paths and contracts are implementation targets, not existing APIs. The starting point is `d1b583fa48f1716264a67270ebbd872a9097a0f5` on `codex/issue-15970-knowledge-ui`; recheck affected callers when implementation starts. Keep the current Source/Document schema and synchronization pipeline. This credential work is independent of the deferred remote-retrieval phase.

#### Record and binding contract

New credential IDs are UUIDs; files use `<id>.json`. Register `feature.credentials` at `{userData}/Credentials/connectors`, outside `Data`, and put it in `NO_ENSURE` so the store creates it with the intended permissions. Use `application.getPath('feature.credentials', filename)` after validating the ID. Reuse `atomicWriteFile` from `@main/utils/file`; do not write a second atomic-file utility. Keep Cherry Account's existing file outside this module's scan and cleanup scope.

The following main-only type sketch fixes the initial record shape. Actual persistence uses strict Zod schemas, validates expiry timestamps and nonblank values, and checks that filename and record ID agree. Secrets are not cross-process response types.

```ts
type CredentialRecord = {
  id: string
  connector: 'feishu'
  label: string
} & (
  | {
      kind: 'application'
      payload: {
        domain: 'feishu' | 'lark'
        appId: string
        appSecret: string
        encryptKey?: string
        verificationToken?: string
      }
    }
  | {
      kind: 'user-authorization'
      payload: {
        applicationCredentialId: string
        tokens: null | {
          accessToken: string
          refreshToken: string
          accessTokenExpiresAt: number
          refreshTokenExpiresAt: number
          grantedScopes: string[]
        }
      }
    }
)
```

`tokens: null` represents a pending grant, including a cancelled first authorization that remains recoverable. The record is not proof that authorization succeeded. Move Feishu's existing `encrypt_key` and `verification_token` into the optional application fields too, so persisted Channel configuration cannot continue returning these saved secrets. Preserve non-secret channel options such as `allowed_chat_ids`.

Channel's Feishu config becomes `type`, nullable `applicationCredentialId`, and channel-only options; a null reference is an unconfigured draft and cannot connect. Domain and App ID come from the selected application's summary. Knowledge keeps the existing `credentialReference` column, pointing to a user-authorization record, and retains its Connection ID, account identity, `appId` identity projection, and `appCredentialSource`. The grant points to the application. No new SQL column or credential table is required for this shape; JSON and reference conversions are application-level work. If implementation discovers a real SQL constraint change, generate an appended migration rather than rewriting shipped migrations.

Registration purpose and Knowledge authorization policy remain explicit. Default QR registration allows selection of an existing application on Feishu; it does not force creation with `createOnly`, rename the application, or replace its preset. A locally selected application passes its App ID to request additional permissions for that application. Knowledge declares its required user scopes, then uses the `custom-app` authorization policy for either selection path: a registration result does not prove that the application was newly created. Required-scope and identity validation remain mandatory; reconnect preserves the Connection's existing policy, including historical `personal-agent` restrictions. A matching local application is reused only when its secret agrees, preserving its label and optional encryption settings. Reuse does not grant scopes or make a bot application automatically suitable for Knowledge. Keep Channel's `lark` support, but filter Knowledge selection to `feishu` until its provider supports Lark endpoints. Do not add a registration-origin field to credentials just to infer business policy.

#### Module map and service lifecycle

| Implementation target | Responsibility and affected callers |
| --- | --- |
| `src/main/services/credential/CredentialStoreService.ts` with private `credentialSchemas.ts` | File records, mutation serialization, credential-to-credential guards, safe summaries and change events. No Channel or Knowledge table imports; the Feishu connection layer owns business-reference queries and migration. |
| `src/main/core/paths/pathRegistry.ts` and `src/main/core/application/serviceRegistry.ts` | Register the path and lifecycle service; wire test mocks through the unified test system. |
| `src/main/services/FeishuRegistrationService.ts` and existing `feishuAppRegistration.ts` | Shared, owner-scoped registration sessions and existing HTTP protocol. Declare the additional permissions required by Channel/Knowledge; no user-token refresh or bot runtime here. |
| `src/shared/ipc/schemas/credential.ts`, `src/shared/ipc/schemas/feishu.ts`, matching main handlers and existing IPC composition | Validated commands and safe outputs; saved payload schemas stay main-only. |
| `src/shared/data/types/channel.ts`, `src/main/ai/channels/channelCommands.ts`, `ChannelManager.ts`, `ChannelRuntime.ts`, `channelAdapterLoader.ts`, `adapters/feishu/FeishuAdapter.ts` | Persist references, resolve main-only adapter configuration, fence delayed loads, and reconcile shared-secret changes. Adapt create/update/QR command consumers together. |
| `src/main/features/knowledge/external/ExternalKnowledgeRuntime.ts`, `ExternalKnowledgeCredentialStore.ts`, `src/main/features/knowledge/KnowledgeService.ts` | Compose application and grant records; preserve token lanes, identity checks and reconnect CAS; retire the old active store and its unrestricted orphan scan. |
| `src/renderer/components/credentials/` and the existing Knowledge/Channel forms | Shared application picker and QR presentation using `@cherrystudio/ui`; each page keeps its own authorization/binding state. |

`CredentialStoreService` is a `BaseService` in `Phase.WhenReady`. Its initialization repairs directory permissions and reads records before exposing credential writes. The Feishu connection layer runs conversion after store readiness and before either consumer activates. ChannelManager, KnowledgeService and FeishuRegistrationService declare the same-phase dependency. Existing BeforeReady database services are available through phase ordering, without additional `@DependsOn` declarations. Migration uses data-service operations, not running business services, avoiding a lifecycle cycle.

Initialization produces per-binding readiness: a failed legacy conversion blocks that binding's activation and cleanup, preserves its source, and exposes a recoverable error; unrelated valid bindings remain usable. Do not run Knowledge's existing startup reconciliation on a blocked binding and misclassify it as a missing grant. On stop, reject new operations, abort registration sessions in their owner service, let queued file commits settle, and dispose subscriptions. Consumers resolve the service after lifecycle initialization rather than from field initializers that run before it is ready.

A failed conversion must not make list/get responses echo the old inline secrets or fail the whole Channel list under the new schema. Only migration reads raw legacy configs. Public projections expose a blocked/unconfigured summary and a recovery error; Channel commands check readiness before activation. After backup restore, recheck file availability before reopening Channel or Knowledge admission, including when the process is not restarted.

#### Main-process commands and race boundaries

The store exposes only the operations needed now: `listSummaries`, `read`, `create`, `replaceApplication`, `rotateTokens`, `remove`, `withReferences`, and a change event. `read` returns a typed record or distinguishes missing, corrupt and unreadable results. `create` never overwrites an existing ID. `replaceApplication` preserves domain/App ID; identity changes create a different record. `rotateTokens` requires the expected refresh token and application snapshot as well as the grant ID. None of these operations executes provider HTTP requests while holding the mutation lane.

Use one mutation queue for this small credential set. `withReferences(ids, commit)` loads and validates the referenced records inside that queue, then invokes a synchronous main-only callback that commits the business binding through `withWriteTx`. The callback cannot await, perform network work, or re-enter the store. All creation/rebinding paths, including agent tools via `channelCommands.ts`, must use this entry. Channel deletion only removes a reference and does not automatically delete an application. `remove(id, isReferenced)` requires a synchronous business-reference predicate and runs it alongside grant-to-application checks in the same queue before unlinking; corrupt or unreadable records that prevent determining usage block deletion. The Feishu connection layer owns that predicate and the deletion IPC route, so there is no unguarded renderer deletion route in the foundation. No startup guard-registration window or optional predicate is introduced. Data services remain synchronous database writers.

For reconnect, write the candidate grant first. Inside `withReferences`, recheck the original Connection reference, runtime generation, candidate and application snapshot, then use the existing Connection/source commit operation. A lost comparison discards only that attempt's unused candidate. Token rotation rereads the grant and application within the mutation queue and refuses a changed reference/token/application snapshot; file writes cannot recreate a deleted record. A shared-secret replacement commits its file and synchronously fences affected consumers before the next queued mutation proceeds. Its event contains IDs and change kind only; Channel requests reconciliation and Knowledge advances affected runtime generations before awaiting more work.

Resolve Feishu secrets in the already-async `channelAdapterLoader.ts`; do not make `ChannelRuntime.readDesired` asynchronous. Pass a distinct main-only resolved config to FeishuAdapter. Keep ChannelRuntime's revision check after awaited loading so a stale adapter is disposed. Remove FeishuAdapter's implicit registration-on-empty-config and its secret-persistence event path; explicit registration now happens before Channel activation. Keep unrelated channel protocols unchanged.

Knowledge must stop calling a shared `listReferences()` followed by deleting everything absent from its own Connection list. It may clean only unused Knowledge grant candidates after migration and with the store's authoritative usage check. Unbound applications are intentional reusable records and are not startup garbage. No background general garbage collector or reference-count table is introduced.

#### IPC and interaction contract

| Route target | Input and observable output |
| --- | --- |
| `credential.list` | Connector/kind filter → summaries containing ID, kind, label, domain/App ID where applicable and availability; no saved payload. |
| `credential.feishu.create_application` | Manual application fields → summary; same domain/App ID with different material returns a conflict instead of silently updating an existing application. |
| `credential.feishu.replace_application` | Application ID and new secret fields → summary; retain application identity and notify consumers. |
| `credential.remove` | Credential ID → removed, already missing, in use or unreadable failure; no cascading deletion. |
| `feishu.registration.begin/complete/cancel` | Domain and registration purpose → owned session with verification URL/expiry; completion persists an application and returns its summary, never its secret. |
| Existing Knowledge authorization/reconnect routes | Selected application reference or owned registration session → existing user-consent session and then Connection; stop accepting secrets as business configuration. |

Register schemas and handlers through the existing IPC router composition. Registration sessions are bound to the calling renderer's `IpcContext` owner; another window cannot complete or cancel them. Repeated completion cannot create duplicate applications. Cancellation after a file write may leave an unbound reusable application, but must not activate a Channel or publish a Knowledge grant. Unknown IDs, wrong credential kind and unsupported domains fail before provider calls. Saved-secret read/export routes are absent; manual secrets travel once to main and are cleared from renderer state after success/cancel. For application replacement, omitted optional secret fields remain unchanged; explicit null clears only encryptKey/verificationToken, and App Secret cannot be cleared. The summary can report whether optional secrets are configured without returning their values.

UI selection is explicit when several applications exist. With none selected, show QR registration as the primary content, with “use an existing application” and manual entry available directly; start registration only for the visible active flow and cancel on hide/unmount. Selecting an application leads Channel to bind/connect and Knowledge to separate user consent. Preserve valid existing Knowledge connections. QR panels render URL/code/status/actions only; use an explicit browser-link action instead of automatically opening a browser on every transition. Label registration and document authorization separately. Missing bot capability or document scopes is an actionable business error, not a storage error or a reason to copy credentials.

#### Conversion and recovery algorithm

Migration is a bounded reader for the two actual old formats: Channel's inline Feishu config and the unpublished encrypted `external-knowledge.json`. There is no permanent format detector or version registry. Perform conversion before either consumer can refresh tokens or accept new bindings.

1. Inventory raw persisted Feishu Channel configs and Knowledge Connection references before applying the new config schema. Leave other channel types and other credential files untouched. Snapshot relevant row values for conditional commits; retain disconnected/pending Connections too.
2. Decrypt each referenced Knowledge entry using the existing safeStorage reader. Normalize applications by domain and App ID; merge only compatible material. A missing optional encryption/verification field may be filled from the other source; contradictory non-empty secrets require resolution. Never choose a winner from timestamps. Empty Channel configs become unconfigured drafts; partially populated configs remain blocked for repair.
3. Create or reuse the application file and write its user grant, including a null token set for a legitimate pending record. For existing `feishu:<uuid>` references, derive the target grant ID from the UUID suffix; validate it and refuse an occupied ID of the wrong kind or application. Unexpected legacy references require recovery, not path interpolation. On retry, validate an existing target rather than overwrite possibly newer tokens.
4. In a synchronous database transaction, compare the old Channel config or Connection reference and commit the new reference. Remove inline Channel secrets in that same update; keep Connection identity, scope projection and Source rows unchanged. A failed comparison leaves the existing binding untouched. Verify the persisted target and binding before removing the converted old entry.
5. Remove old Knowledge entries only after their conversion commits. Keep failed entries and the old encrypted file while any conversion remains unresolved; delete the file when all entries are accounted for. Unreferenced legacy entries are reported for explicit recovery/discard, not imported into guessed accounts. Once a binding has moved, ordinary reads use only target records; the old reader is migration-only.
6. On restart, already converted bindings are authoritative. Reuse validated application/grant targets from an interrupted conversion, finish source cleanup, and never restore a committed grant from an older encrypted copy. Restrict candidate cleanup to objects proven unreferenced after this pass; preserve ambiguous material for repair.

| Interruption or failure | Required recovery |
| --- | --- |
| Before a target file commits | Old source and binding still work with the old build; the new build reports migration pending for that binding. |
| Target exists, database reference not committed | Retry validates and reuses the target; no duplicate application or lost source. |
| Database committed, old source not cleaned | Continue from the target, then clean the exact old entry; never restore stale tokens. |
| Decryption, validation or disk failure | Preserve source, block only affected activation and unsafe cleanup, offer retry or explicit credential replacement. |
| Backup restored onto a different profile | Database references may lack local files; show credentials unavailable and request reconfiguration without dropping business rows or local Knowledge content. |

For a blocked Channel, explicit replacement validates and saves the replacement before conditionally rebinding; do not delete its old inline configuration first. For an established Knowledge Connection, replacement still verifies the same user/tenant before committing. An incomplete original identity remains an error under the existing recovery decision. Automatic rollback to an older executable after conversion is unsupported: it cannot interpret reference-only Channel configs. Recovery uses the new build and preserved source; do not implement dual-writing to make downgrade work.

#### Delivery units and completion gates

| Unit | Changes delivered together | Exit gate |
| --- | --- | --- |
| 0 — Spec | This bilingual plan on the bottom Spec layer; consumer-specific cross-links stay with their owning layer. | Documentation checks; current-head Spec Approval before implementation layers under the repository workflow. |
| 1 — File storage | Store, schemas, registered path/lifecycle, summary/create/replace IPC and focused filesystem/queue tests. Business deletion IPC and real consumer binding tests belong to #20699. Keep existing consumers on their current store until cutover. | AC2/AC7 storage boundary passes; migration helper can be tested but is not activated. |
| 2 — Feishu cutover | Shared registration sessions, both consumer references, real conversion, Channel adapter config, Knowledge token CAS/cleanup, and minimal changes to existing forms/agent commands to call the new contracts. Activate conversion only in this unit. | AC1/AC3/AC4/AC5 plus secret-free IPC pass together; no half-switched consumer or active old writer remains. |
| 3 — Shared interaction and acceptance | Application picker, shared QR panel, clear registration/consent flow, locales, current reference docs and desktop scenarios. | AC6 and cumulative AC1–AC7 evidence; only then transition the note to implemented. |

Do not activate migration in unit 1 while old consumers can still write the old files/configs. Unit 2 must include any API/type changes required for the current UI and agent tools to remain functional; unit 3 improves shared presentation, not a repair for a broken intermediate commit. Stack order is main → `codex/shared-connector-credentials-spec` → `codex/shared-connector-credential-store` → #20699 → #20742 → #20800 → #20856 → #20903 → #20998. Shared storage has no consumer-table dependency. #20699 owns business reference queries, deletion IPC, registration and migration; later layers adapt their own consumers. The user authorized local implementation; no GitHub Spec Approval or ready-for-review implementation PR is claimed. Recheck live bases before publishing.

#### Verification worklist

Before adding each regression, state the promised outcome it protects. Reuse `setupTestDatabase()` for business rows, real temporary credential files, unified service mocks and the existing `atomicWriteFile`. Do not stub Drizzle chains or assert only that a callback ran. New test names below are targets to create, not tests already run.

| Test target | Contract to prove |
| --- | --- |
| New `src/main/services/credential/__tests__/CredentialStoreService.test.ts` | Malformed payload/ID, permission repair, failed atomic replacement, queued-write recovery after failure, token CAS and no resurrection after deletion. |
| New `src/main/ipc/handlers/__tests__/credentialBindings.integration.test.ts` | Concurrent bind/delete, grant-to-app references, Channel deletion preserving Knowledge, secret replacement fencing both consumers, and unavailable-record deletion refusal. |
| New `src/main/services/credential/__tests__/migrateFeishuCredentials.test.ts` | Populated production DB fixtures plus real files; all interruption rows above, duplicate/conflicting applications, pending grants, preserved identities and repeated conversion. |
| New `src/main/services/__tests__/FeishuRegistrationService.test.ts` and existing `feishuAppRegistration.test.ts` | Application selection, required permissions, session owner, cancel/expiry, repeated completion, and no secret output; preserve transport retry behavior. |
| Existing Channel `ChannelManager.test.ts`, `ChannelRuntime.test.ts`, `channelCommands.test.ts`, `adapters/__tests__/FeishuAdapter.test.ts` | Async credential loading cannot connect a stale adapter; explicit registration replaces implicit adapter registration; reference-only config reaches the SDK correctly. |
| Existing Knowledge `ExternalKnowledgeRuntime.test.ts`, `authorizationRecovery.integration.test.ts`, `ExternalKnowledgeDisconnect.test.ts`, `feishuKnowledgeProvider.test.ts` | Refresh/reconnect/cancel/error races and identity continuity survive the store replacement; one consumer's cleanup cannot remove another's credentials. |
| New credential IPC tests; existing `src/main/ipc/handlers/__tests__/channel.test.ts`, data API Channel tests, `src/main/services/__tests__/LegacyBackupManager.test.ts` | Manual input and redacted responses, caller ownership, command/tool compatibility, backup exclusion and missing-file restore behavior. |
| Existing `FeishuWikiWizard.test.tsx`, Channel `ChannelDetail.test.tsx`, plus new picker/panel tests and a focused Electron scenario | Multiple applications, empty state, distinct consent, errors/retry, hide/cancel, and no browser reopening from abandoned responses. |

Run project wrappers with these explicit file paths only, in the unit that changes them. Inspect `pnpm check --plan --base <verified-base>`, run the affected typecheck projects, scoped formatting/lint, and `pnpm docs:affected --base <verified-base>`; review its candidates including Knowledge's README and IPC/data references. Locale changes require `pnpm i18n:sync` and completed translations. Documentation changes run `pnpm docs:check`; SQL changes, if any, additionally run migration-chain and populated migrate-forward checks. Leave full-project test suites to CI.

Desktop acceptance covers creating an application in Channel then selecting it in Knowledge, the reverse direction, deleting Channel while Knowledge remains usable, replacement/restart, and cancellation during registration/consent. Exercise the flow with controlled protocol responses for reproducible failure cases, then record a real Feishu application's bot connection and document authorization separately. Automated mocked success is not live-provider acceptance. No credential payload may enter screenshots or test reports.

## Alternatives considered

- A `feishu_application` table or per-connector credential tables: rejected; application credentials are reusable connector configuration, and this phase does not need a separate relational application catalog.
- Reading Channel configuration or copying its secret into Knowledge: rejected; both keep Channel as the credential source or retain divergent copies.
- A generic persisted `revision` plus `formatVersion`, `schemaVersion`, and `encoding`: rejected for the initial format; retain actual conditional token/reference updates rather than inventing a version protocol.
- Preserving encryption as a prerequisite or maintaining both target modes: deferred; the user chose plaintext for this phase, and the Knowledge implementation is unpublished.
- A universal OAuth runtime, all-connector implementation, or external connector runtime integration: out of scope; share storage and presentation while retaining protocol and business ownership.

## Acceptance criteria

- AC1 — Channel and Knowledge use the same Feishu application credential without reading each other's configuration; its App Secret is not duplicated in their business rows or user-token records (verification: main integration; owner: credential storage implementer)
- AC2 — Target records are validated plaintext JSON with no `feishu_application` table or speculative version/encoding fields; corrupt input and interrupted writes never overwrite the last valid record (verification: filesystem tests; owner: credential storage implementer)
- AC3 — Refresh or authorization responses started before replacement, cancellation, or deletion cannot overwrite or resurrect credentials or invalidate a newer session (verification: deferred-request integration tests; owner: authorization implementer)
- AC4 — Deleting a Channel preserves a Knowledge binding; referenced credential deletion is rejected, including a concurrent new binding, and application-secret replacement reaches both consumers without an old result overwriting the replacement (verification: main integration; owner: binding implementer)
- AC5 — Published Channel credentials and local unpublished Knowledge credentials survive migration/restart with their bindings and identities; conflicting secrets, unavailable decryption, or failed writes preserve recoverable source data (verification: production-migration SQLite and real-file fixtures; owner: migration implementer)
- AC6 — The real desktop presents existing-application selection or QR registration as the primary path, offers manual configuration secondarily, requires user consent separately, and handles hide/cancel/retry without reviving an abandoned session (verification: renderer and Electron; owner: UI implementer)
- AC7 — Credential queries expose summaries only, logs contain no secrets, POSIX permissions are enforced, and ordinary business-data export excludes credential files (verification: IPC, filesystem, and export tests; owner: credential boundary implementer)

## Risks

Plaintext removes at-rest encryption for migrated Knowledge credentials and permits any process with sufficient file access to read them. The user accepted this phase's storage choice; file permissions and IPC redaction do not replace encryption. Generic storage does not make every connector protocol or credential payload interchangeable.

Files and SQLite have separate commit boundaries. Migration, binding changes, and cleanup need interrupted-operation coverage. Same-app conflicting secrets cannot be resolved from identity alone. OS-backed decryption may be unavailable when converting existing local Knowledge test data; preserving the source takes precedence over completing migration.

No implementation, provider acceptance, migration test, or exact-head Spec approval is claimed by this note. Unrelated provider/MCP credential stores are not migrated by this initial Feishu scope.
