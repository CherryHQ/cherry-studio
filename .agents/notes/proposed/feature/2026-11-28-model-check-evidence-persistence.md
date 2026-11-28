# Agent Note: Persist Model-check evidence with expiry and invalidation

Status: proposed

English | [中文](2026-11-28-model-check-evidence-persistence.zh.md)

## Problem

Model Check results live only in renderer memory (`modelListHealthContext.tsx`). Closing the settings page or restarting the app discards them, so a user who checked a model yesterday has no durable evidence of that check, no record of when it ran or against which configuration, and no warning when a later configuration change has silently invalidated it ([#18967](https://github.com/CherryHQ/cherry-studio/issues/18967)). A past success shown without its context is misleading: after the endpoint, credential, or model settings change, the old result no longer describes what would happen today.

The issue specifies the goal (durable evidence with check time, tested configuration identity, and failure category), staleness on relevant configuration changes, and three verification scenarios. What it does not pin down is where the evidence lives, what exactly constitutes the "tested configuration identity", and how evidence is presented without being confused with live request success. This Spec resolves those decisions.

## Proposal

*Store.* Use Renderer Persist Cache (`usePersistCache` / renderer `CacheService.setPersist`), with a new fixed schema key containing an evidence map keyed by `(providerId, modelId, resolvedEndpoint, capability, credentialReference)`. Persist supports fixed schema keys, not dynamic template keys. This is regenerable, non-critical UI evidence, not a setting or conversation record. Local cache reset may discard it; normal app restart must preserve it. An endpoint A result and endpoint B result coexist; rechecking the same tuple replaces only that record. Each record holds outcome, timestamp, successful latency, failed category, and the tested configuration identity. Never store raw error text, headers, tokens, credentials, or request-path results.

*Configuration identity.* Capture a canonical, versioned, non-secret snapshot from the same resolved configuration used for the probe, not settings re-read after completion. Include provider and model IDs, resolved endpoint type and sanitized base URL (no embedded userinfo or secret query values), wire model ID, capability/probe mode, credential reference, durable credential revision, and the effective probe inputs. Inputs include `supportsStreaming`, endpoint dialect/transport selection, provider/model request options and modality defaults actually consumed by `AiService.checkModel`; include a probe-contract version for fixed prompt/options and registry changes. Canonicalize an explicit non-secret allowlist, never serialize the provider/model object wholesale or hash credential bytes. Label-only edits need not invalidate evidence.

*Credential revisions.* Add a durable, opaque random revision per key entry, separate from `ApiKeyEntry.id`. Initialize it for legacy keys before accepting new evidence; change it atomically with every key-value replacement, including Edit on the same entry ID. Key creation and rotation get new revisions. Provider-level OAuth/IAM credentials need the same durable non-secret revision updated on credential/account changes, not the constant `provider-auth` marker alone. These revisions belong to the existing authoritative provider credential storage and must survive restart; they are not derived from secrets. Snapshot the actual selected key reference and revision for each check. If a credential path has no trustworthy revision yet, its evidence cannot be marked current. This requires provider schema/storage work during implementation, not an assumed existing field.

*Failure categories.* For a failed serialized error use `classifyError(error, providerId).category` from `src/renderer/utils/errorClassifier.ts`; string-only or missing/unclassifiable errors use `unknown`. `ModelCheckStatus` currently formats error text and does not supply this mapping. Persist only the category, never the raw error. Skipped checks remain skipped, not failed evidence.

*Staleness.* Evidence is stale when the current configuration identity differs from the stored one. Staleness is computed at read time by recomposing the identity from the live provider and model configuration, so no listener has to catch every settings write. Stale evidence is never deleted automatically: it stays visible, marked stale, until the user re-runs the check or clears it.

*Presentation.* `ModelCheckStatus` shows, per model, the persisted evidence: visible tested endpoint, model/capability, credential label/reference and non-secret revision/probe identity, relative check time, a stale badge when the recomposed identity differs, and the failure category on failed checks. A fresh in-memory check result always supersedes persisted evidence for display. The evidence row is visually separate from the live check state so it cannot be read as a current availability signal, and it says nothing about whether the model is enabled.

*Reset.* Changing a provider's endpoint or credential, or editing the model, does not erase evidence (it becomes stale). Deleting a provider or a model deletes its evidence with it.

## Alternatives considered

- Persist in the main-process SQLite database: rejected. The evidence is display state for the settings UI, not conversation data; Renderer Persist Cache is the supported owner for regenerable UI evidence. SQLite business records would add unnecessary lifecycle and migration work; credential revisions still require authoritative provider schema/storage changes.
- Identity including a hash of the API key: rejected. Persisting any key-derived material widens the exposure surface for no benefit; an opaque credential revision changes even for in-place key edits without exposing key-derived material.
- Invalidate by subscribing to settings writes: rejected. Recomposing the identity at read time cannot miss a write path, while a listener must enumerate them all.
- Show only the latest check per provider instead of per model: rejected. The issue asks for per provider, model, endpoint, and capability granularity, and checks are already run per model.
- Treat the issue's own spec as sufficient and skip an Agent Note: rejected. Storage location, identity composition (in particular the no-key-material rule), and read-time staleness are implementation decisions the issue leaves open.

## Acceptance criteria

- AC1 — A successful check leaves persisted evidence that survives an app restart, showing the outcome and its timestamp (verification: renderer + unit)
- AC2 — Changing the endpoint, replacing a key through Edit without changing its entry ID, or toggling model streaming marks the prior evidence stale rather than leaving it displayed as current (verification: unit)
- AC3 — A failed check records its failure category and shows it alongside the timestamp (verification: renderer)
- AC4 — Evidence is keyed per provider, model, resolved endpoint, capability and credential reference; checking the same model on endpoints A then B retains both results and visibly identifies each tested configuration (verification: unit)
- AC5 — The persisted identity contains no API-key material or key-derived hash; rotating a key or editing its value with the same entry ID stales prior evidence across restart (verification: unit)
- AC6 — A real request failure after a successful check does not alter the stored check evidence, and the evidence display remains visually distinct from live request state and from enablement (verification: renderer)
- AC7 — Deleting a provider or model removes its evidence; all new copy lands in the 18 locale files (verification: unit)

## Risks

- Cache growth: records are replaced per tuple, but historical endpoint/credential tuples can grow. Bound retention to the most recent 1000 records; evict oldest records first and allow explicit clear. Eviction is loss of evidence, never a success signal.
- False confidence: a stale badge relies on the identity covering every field that changes check outcomes. The identity fields above match the inputs the check path actually uses; a future check-path input (for example a new proxy setting) must be added to the identity when introduced.
- Migration: the new fixed evidence cache key starts empty. Durable credential revisions require provider schema/storage initialization; old evidence lacking a supported identity/revision is stale, never current.
