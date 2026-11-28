# Agent Note: Persist Model-check evidence with expiry and invalidation

Status: proposed

English | [中文](2026-11-28-model-check-evidence-persistence.zh.md)

## Problem

Model Check results live only in renderer memory (`modelListHealthContext.tsx`). Closing the settings page or restarting the app discards them, so a user who checked a model yesterday has no durable evidence of that check, no record of when it ran or against which configuration, and no warning when a later configuration change has silently invalidated it ([#18967](https://github.com/CherryHQ/cherry-studio/issues/18967)). A past success shown without its context is misleading: after the endpoint, credential, or model settings change, the old result no longer describes what would happen today.

The issue specifies the goal (durable evidence with check time, tested configuration identity, and failure category), staleness on relevant configuration changes, and three verification scenarios. What it does not pin down is where the evidence lives, what exactly constitutes the "tested configuration identity", and how evidence is presented without being confused with live request success. This Spec resolves those decisions.

## Proposal

*Store.* Persist check evidence in the renderer's persisted store (the same redux-persist mechanism the other settings slices use), keyed by `(providerId, modelId, capability)`. Each entry records: the outcome (`success` or `failed`), the check timestamp, the latency when successful, the failure category when failed (the existing `SerializedError`-derived category used by `ModelCheckStatus`), and the configuration identity below. No request-path data is recorded: evidence describes checks only and stays distinct from actual request success and from model enablement, per the issue.

*Configuration identity.* A string composed of non-secret fields only: the provider id, the resolved API host/endpoint, the credential reference (the `ApiKeyEntry.id` UUID from `ApiKeyEntrySchema`, never the key value, or the `provider-auth` marker for provider-level auth), the model id, and the tested capability. Storing the key id rather than any key material keeps the evidence safe to persist; rotating a key creates a new entry id, which changes the identity and stales the old evidence.

*Staleness.* Evidence is stale when the current configuration identity differs from the stored one. Staleness is computed at read time by recomposing the identity from the live provider and model configuration, so no listener has to catch every settings write. Stale evidence is never deleted automatically: it stays visible, marked stale, until the user re-runs the check or clears it.

*Presentation.* `ModelCheckStatus` shows, per model, the persisted evidence: relative check time, a stale badge when the recomposed identity differs, and the failure category on failed checks. A fresh in-memory check result always supersedes persisted evidence for display. The evidence row is visually separate from the live check state so it cannot be read as a current availability signal, and it says nothing about whether the model is enabled.

*Reset.* Changing a provider's endpoint or credential, or editing the model, does not erase evidence (it becomes stale). Deleting a provider or a model deletes its evidence with it.

## Alternatives considered

- Persist in the main-process SQLite database: rejected. The evidence is display state for the settings UI, not conversation data; the renderer persisted store already carries settings-level state and needs no migration.
- Identity including a hash of the API key: rejected. Persisting any key-derived material widens the exposure surface for no benefit; the entry id already changes on rotation.
- Invalidate by subscribing to settings writes: rejected. Recomposing the identity at read time cannot miss a write path, while a listener must enumerate them all.
- Show only the latest check per provider instead of per model: rejected. The issue asks for per provider, model, endpoint, and capability granularity, and checks are already run per model.
- Treat the issue's own spec as sufficient and skip an Agent Note: rejected. Storage location, identity composition (in particular the no-key-material rule), and read-time staleness are implementation decisions the issue leaves open.

## Acceptance criteria

- AC1 — A successful check leaves persisted evidence that survives an app restart, showing the outcome and its timestamp (verification: renderer + unit)
- AC2 — Changing the endpoint, credential, or model settings marks the prior evidence stale rather than leaving it displayed as current (verification: unit)
- AC3 — A failed check records its failure category and shows it alongside the timestamp (verification: renderer)
- AC4 — Evidence is keyed per provider, model, and capability, so checking one model never overwrites another model's evidence (verification: unit)
- AC5 — The persisted identity contains no API-key material; rotating a key (new entry id) stales prior evidence (verification: unit)
- AC6 — A real request failure after a successful check does not alter the stored check evidence, and the evidence display remains visually distinct from live request state and from enablement (verification: renderer)
- AC7 — Deleting a provider or model removes its evidence; all new copy lands in the 18 locale files (verification: unit)

## Risks

- Persisted-store growth: one small record per checked model is bounded by the user's provider and model count, and records are replaced on re-check, not appended.
- False confidence: a stale badge relies on the identity covering every field that changes check outcomes. The identity fields above match the inputs the check path actually uses; a future check-path input (for example a new proxy setting) must be added to the identity when introduced.
- Migration: none needed - the store starts empty and simply has no evidence until the first check runs.
