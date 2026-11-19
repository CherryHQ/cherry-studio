# Agent Note: Multiple default models per assistant

Status: proposed

English | [中文](2026-11-19-assistant-default-models.zh.md)

## Problem

Issue [#12880](https://github.com/CherryHQ/cherry-studio/issues/12880) reports that an assistant can preset only one default model. Users who compare or cross-check answers must re-add the other models by hand in every new topic. The current data model stores one `assistant.modelId`, and the multi-model selection exists only as composer draft state.

## Proposal

- Store extra default models in a new `assistant.additional_model_ids` JSON column. The effective default list is `[modelId, ...additionalModelIds]`, deduplicated, so the primary model is never duplicated state.
- Expose the derived list as `Assistant.defaultModelIds`. Create and update DTOs accept `defaultModelIds`; a list replaces the whole default set and sets `modelId` to its first entry. A `modelId`-only update keeps the previous primary as an extra default.
- The assistant editor shows a multi-select beside the single model field. Changing the primary keeps it first and retains the previous primary as an extra default.
- When the composer enters a topic or assistant scope with more than one default and the topic has no saved multi-model selection, it seeds the selector and mentioned models with all defaults, in multi-select mode.
- Duplicating an assistant copies the full default list.

### Ownership

The shared `Assistant` schema owns the public shape. `AssistantService` owns validation and the split between `modelId` and the extra column. The composer owns runtime selection; the assistant stores defaults only.

## Alternatives considered

- **Join table `assistant_models(assistant_id, model_id, position)`.** Gives referential integrity per model, but adds a table, junction sync, and more code for a short ordered list. Rejected for the first version because the list is small and always read with its assistant.
- **Store the full list including `modelId`.** Simpler reads, but duplicates the primary and creates two sources of truth. Rejected in favor of deriving the first entry.
- **Reuse the persisted composer draft as the assistant default.** Avoids a migration, but draft state is per topic and cleared by users. Rejected because defaults must survive new topics.

## Acceptance criteria

- AC1 — An assistant round-trips an ordered default list whose first entry is its `modelId` (verification: unit)
- AC2 — An unregistered model id in the default list fails validation and writes nothing (verification: unit)
- AC3 — Duplicating an assistant copies its full default list (verification: unit)
- AC4 — Entering a new topic or switching assistant seeds the composer with all defaults when there are more than one (verification: renderer)
- AC5 — Editing the default list in the assistant editor persists it through the update API (verification: renderer)
- AC6 — The database migration applies to a populated database without rewriting prior migrations (verification: docs gate)

## Risks

- A topic whose user reduced the selection to a single model has no saved multi-model draft, so reopening it reseeds the defaults. Fixing this needs a persisted "user chose this selection" flag and is out of scope for this Spec.
- Deleting a default model sets `modelId` to null through the existing foreign key, but extra ids stored in JSON are not cascaded. Stale extra ids are filtered when the composer resolves them against the model catalog.
