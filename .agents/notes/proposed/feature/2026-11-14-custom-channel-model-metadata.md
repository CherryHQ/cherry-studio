# Agent Note: Custom-channel model metadata discovery

Status: proposed

English | [中文](2026-11-14-custom-channel-model-metadata.zh.md)

## Problem

Issue CherryHQ/cherry-studio#20523 reports that models imported from a custom OpenAI-compatible channel lose context-window and capability metadata. Users then edit every model by hand, and a missing limit can silently truncate uploaded files.

Verified in the current code:

- The generic fetcher `listOpenAICompatibleModels` (`src/main/ai/provider/listModels.ts:989-1009`) reads only `id`, `name`, and `owned_by`. `OpenAIModelSchema` (`src/main/ai/provider/listModelsSchemas.ts:11-16`) parses no limit or capability fields.
- Other fetchers already map upstream limits into `contextWindow` / `maxOutputTokens` (`listModels.ts:685`, `:1127-1128`, `:1185`). The generic path does not.
- A model with no registry match is created by `createCustomModel` (`src/main/data/services/ProviderRegistryService.ts:418-437`) with no `contextWindow` and empty `capabilities`.
- The renderer enrichment in `src/renderer/pages/settings/ProviderSettings/utils/modelSync.ts:86-140` overlays only registry data. It cannot recover limits that main never returned.

The ~10,000-token default reported in the issue was not located in code and is not claimed here.

## Proposal

1. Extend the generic OpenAI-compatible fetcher to read the same limit keys the other fetchers already use (`context_length`, `max_context_window`, `max_context_length`, `max_tokens`), mapping them to `contextWindow` and `maxOutputTokens` when present and positive.
2. Set capabilities only from explicit provider metadata. Never infer tools, web search, or image input from a model name.
3. Missing, malformed, or contradictory fields leave the existing value unchanged and emit a non-blocking warning through `loggerService`. The model stays listed. No new hardcoded context default is introduced.
4. Add an explicit, user-triggered "refresh metadata from provider" action for existing custom-channel models. It is opt-in and never runs automatically on list refresh.
5. User-set values are never overwritten by discovery. A per-field reset-to-provider action restores provider metadata.
6. Show the source of each limit (provider, registry, user, unknown) in model settings.

## Alternatives considered

- Automatic refresh on every model-list refresh: rejected for this Spec. It can overwrite a value the user relied on without an explicit action. Revisit only after the opt-in path has usage data.
- A documented conservative fallback constant when no window is reported: rejected for this Spec. The maintainer decision is to keep the existing value and warn. A constant would still truncate silently for providers that omit the field.
- Capability inference from model names: rejected. The issue forbids it, and it produces wrong tool and image requests.
- Changing built-in provider fetchers: out of scope. Those paths already read metadata.

## Acceptance criteria

- AC1 — A custom OpenAI-compatible `/models` response containing `context_length` and `max_tokens` yields `contextWindow` and `maxOutputTokens` on the listed model (verification: unit, `src/main/ai/provider/__tests__/listModels.test.ts`)
- AC2 — A response with no limit fields lists the model with no `contextWindow` and no failure (verification: unit)
- AC3 — Malformed or non-positive limit values are ignored, the model is listed, and a warning is logged (verification: unit)
- AC4 — Capability flags are set only from explicit provider metadata; a model named like a vision or tool model without metadata gets empty capabilities (verification: unit)
- AC5 — The opt-in refresh action updates only fields whose current source is provider or unknown, and leaves user-set fields unchanged (verification: unit on the service layer, `ModelService` tests)
- AC6 — Per-field reset restores the provider-supplied value for that field only (verification: renderer, model settings test)
- AC7 — Discovery and list refresh never trigger the refresh action automatically (verification: unit)
- AC8 — Each limit in model settings shows its source (verification: renderer)

## Risks

- Providers use inconsistent key names or units. Mitigation: only the keys already accepted elsewhere in `listModels.ts`; anything else is ignored.
- Persisting provider limits could conflict with later user edits. Mitigation: per-field source tracking and AC5.
- A new `source` column needs a migration. Mitigation: append a generated migration; never edit a shipped one.
