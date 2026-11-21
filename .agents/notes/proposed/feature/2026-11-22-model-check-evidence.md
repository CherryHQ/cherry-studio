# Agent Note: Durable model-check evidence

Status: proposed

English | [中文](2026-11-22-model-check-evidence.zh.md)

## Problem

Issue #18967 requests durable, timestamped model-check evidence with configuration invalidation and expiry. Current provider checks distinguish progress, completed results, per-key outcomes, skipped probes and enablement. `modelHealthStatusCache` stores row status in a window-memory cache; `useHealthCheck` clears it on teardown and endpoint/credential changes and reconciles some model fields. These transient results are not an availability record across restarts.

Persisting `ModelWithStatus` directly would retain credential objects and raw serialized errors, and could label an old success as current after settings change. The existing [streaming-probe decision](../../implemented/bug-fix/2026-11-17-streaming-model-check.md) already owns probe completion semantics; this proposal records evidence without replacing that decision.

## Proposal

### Evidence, not availability

Add a separate Main-owned durable evidence record for a completed explicit Settings model check. Record provider identity, unique and wire model identity, tested capability/probe kind, endpoint dialect, an opaque tested-configuration identity, completion time, expiry time, outcome, failure category and optional completion latency. Keep per-credential outcomes distinct. The summary must not turn one successful key into evidence that every key passed, or a text probe into evidence for tools, vision or other untested capabilities.

Display the most recent record for each model/credential/probe tuple in the existing model-check details, with a readable local timestamp, tested capability and configuration identity, and one of: current evidence, expired, or configuration changed. Show the actual historical passed/failed outcome separately from freshness. A current success means only that this probe completed at that time, not that future requests will work. Existing transient progress and skipped states remain transient; skipped/cancelled probes must not replace the last completed evidence with a failure.

Use an explicit initial freshness window of 24 hours from completion. Expired evidence remains visible with its original timestamp and a Recheck action, never as current availability. Recheck uses the existing explicit check dialog and its credential, timeout and generation-cost policy. Do not automatically probe on startup, expiry, opening settings or configuration changes. No background retry, new provider charge or availability-driven routing is part of this feature.

### Bind to the effective configuration

Main captures the effective configuration before the probe, using the same resolution path that produces the request. Its identity covers provider/model association, wire model ID, selected endpoint type and resolved route, relevant provider request settings/headers, credential identity and revision, model capabilities/modalities, streaming, reasoning and probe-relevant parameter settings. Include a version for the probe/identity algorithm so application or registry changes cannot silently reuse evidence under different semantics. Cosmetic names, logos and ordering do not invalidate evidence.

Use stable non-secret credential IDs plus Main-owned opaque revisions; never store credential values or an unsalted hash of a secret as the identity. Provider-managed authentication needs a revision that changes when the effective auth material/account changes, not a constant provider-auth label. Main must mint/reconcile these revisions at the authoritative credential/config mutation boundary, including settings import and preset reconciliation where they affect the resolved request. If the identity cannot be established, show prior evidence as stale/unknown rather than assuming a match.

On read, compare the stored identity with the current resolved identity, in addition to checking expiry. Invalidation must survive restart and work even if a UI was not mounted when the change occurred. A check begun under configuration A that finishes after a change to B may save historical A evidence, but cannot publish it as current B evidence. Give every probe an operation sequence; an older completion cannot overwrite a newer completed check for the same tuple. Duplicate terminal callbacks are idempotent. Provider/model deletion removes owned records and prevents a late probe from recreating an orphan.

### Persistence and privacy

Store evidence through the existing Main DataApi/service/database ownership, not renderer persist cache or user preferences. Add a migration with no invented history for past checks. Keep only the latest completed record per model/credential/probe tuple, replacing its previous configuration snapshot; this is evidence, not an audit log. Deleting a credential removes its evidence. A persistence failure must be shown as not saved and must not relabel a failed/unknown save as durable success.

Only Main can write an evidence outcome from its own probe result. The renderer may request a check or read evidence, but cannot submit arbitrary passed/failed records. Keep the existing IPC probe entry and normal provider pipeline; separate probe execution from the data-only read contract. Shared schemas describe the cross-process evidence shape. Renderer settings modules format freshness and display, while Main owns identity, validation, ordering, storage and deletion.

Persist only allowlisted failure categories such as authentication, permission, rate limit, timeout, network, unsupported probe, malformed/incomplete response and unknown. Do not retain raw response bodies, prompts, tokens, API keys, authorization headers, full credential-bearing endpoint URLs or exception stacks. Show endpoint dialect and a redacted display label, with the opaque configuration identity for distinction. Ordinary real-request success/failure and provider/model/key enablement keep their current owners; reading or restoring evidence must not change them. Existing explicit check enablement behavior is unchanged, but historical evidence must never trigger it.

## Alternatives considered

- Persist the current renderer result objects: includes secrets/errors and lacks Main-owned configuration binding.
- Delete old evidence on every change: hides useful context and does not explain why a prior check no longer applies.
- Reuse model/provider updated timestamps: cosmetic changes over-invalidate while credential replacement, registry changes or resolved-endpoint changes may be missed.
- Store raw credential or endpoint hashes: risks secret disclosure and does not provide a safe display identity.
- Periodically recheck or route around failed models: adds provider calls and changes execution policy outside this request.
- Keep a full check-event archive: increases retention and migration complexity without being needed to display the last known evidence.

## Acceptance criteria

- AC1 — Completed single-model and batch checks persist the correct per-credential/probe evidence and completion timestamp across restart; progress, skipped and cancelled checks do not manufacture terminal evidence, and migration starts without invented results. (verification: database, main and Electron)
- AC2 — Effective endpoint/dialect, credential/auth, model/probe settings and identity-version changes make prior evidence stale across mounted/unmounted settings and restart, while cosmetic changes do not. Unresolvable identity never appears current. (verification: unit, database and renderer)
- AC3 — Configuration changes during a check, reversed completion order, duplicate callbacks and provider/model/credential deletion cannot publish evidence for the wrong configuration, regress a newer record or recreate an orphan. Save failures are visible as not saved. (verification: main and database)
- AC4 — The UI separately shows historical outcome, freshness, time, capability and redacted tested identity, including partial-key results and expiry at 24 hours; Recheck is explicit and no restore/expiry path changes enablement, routing or real-request status. (verification: renderer and Electron)
- AC5 — Storage/read/log contracts exclude secrets and raw provider content; the renderer cannot forge terminal evidence. English/Chinese labels, keyboard/screen-reader access, light/dark and narrow layouts pass scoped and native checks, with unverified acceptance stated explicitly. (verification: main, database, renderer, docs gate and Electron)

## Risks

Resolved-request identity is the main correctness boundary. A partial fingerprint can look precise while silently reusing evidence for a different route, auth account or model protocol. Centralize it with existing request resolution, and test mutation paths rather than trusting renderer snapshots.

Durable evidence is local user data with a migration and deletion lifecycle. Never serialize the existing credential-bearing row state. Error classification must default to unknown without storing sensitive raw text.

A 24-hour window is a freshness policy, not a service-level guarantee. Time passing or a later request failure does not rewrite the historical result. Clock rollback must not extend the original expiry or make future-dated evidence appear current; treat inconsistent time as unknown freshness until rechecked.
