# Agent Note: Per-model API key binding

Status: proposed

English | [中文](2026-11-14-model-api-key-binding.zh.md)

## Problem

Issue CherryHQ/cherry-studio#21074 requests a model-specific API key within a multi-key provider. PR #21114 implements a persisted `user_model.api_key_id` and routes the binding through chat and agent gateway requests and supported integrations. This note records that implemented contract for human review; it does not claim an approved Spec or authorize a merge.

## Proposal

- Keep the provider's automatic key selection when a model has no binding. A binding refers only to a key belonging to that provider; empty or foreign key IDs are rejected.
- Show the model key selector when the provider has multiple keys. Named keys retain their label; unnamed keys use the localized unnamed label plus their one-based position. No secret-bearing key request is needed to render the selector.
- Honor an enabled binding without alternate-key failover on HTTP 401/429. Existing handling of disabled or removed keys remains unchanged by this review follow-up.
- Preserve the binding through chat configuration, agent gateway requests, Ollama probes, retry, OpenClaw, Antigravity, DeepSeek Harness and CLI config drafts. Reject direct Claude CLI writes when role-model bindings differ, including a bound context model with an unbound role model. Reject OpenClaw sync if its schema cannot represent a per-model API key.
- Migration `0038_great_rafael_vega` adds the nullable column without changing an existing model row's other fields. Earlier unreleased experimental builds that already added the column are not a supported upgrade path.

## Alternatives considered

- Provider-only key selection does not satisfy per-model routing.
- Showing raw key UUIDs is hard to recognize; fetching secret-bearing key records only for labels adds unnecessary exposure. Localized ordinal labels avoid that fetch.
- Silent alternate-key fallback would break the requested binding. Integration formats that cannot preserve it must fail rather than silently discard it.

## Acceptance criteria

- AC1 — A provider with multiple keys exposes a model selector, persists the chosen binding and retains automatic selection for an unbound model (verification: renderer; service unit)
- AC2 — Unnamed and whitespace-only labels use distinct localized ordinal labels instead of raw key IDs, without fetching secret-bearing records (verification: renderer)
- AC3 — Empty or foreign-provider key IDs are rejected and a valid binding is preserved (verification: service unit)
- AC4 — Bound-key routing and no alternate-key 401/429 failover hold across the supported runtime paths; unrepresentable Claude/OpenClaw configurations fail explicitly (verification: runtime unit; integration)
- AC5 — Production migrations from the schema before 0038 preserve an existing model and add `api_key_id: null` (verification: migration unit)

## Risks

- A chosen credential can fail or be removed; binding semantics must not turn that into silent use of another enabled key.
- Ordinal labels distinguish unnamed keys without revealing secrets, but are position-based and can change after the key list is reordered.
- Real-provider authentication at the current head and upgrades from this PR's earlier unreleased experimental migrations remain unverified. Renderer reload persistence is not an on-wire authentication test.
