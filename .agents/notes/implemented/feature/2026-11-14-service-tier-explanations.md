# Agent Note: Service Tier Explanations

Status: implemented

English | [中文](2026-11-14-service-tier-explanations.zh.md)

Tracks: CherryHQ/cherry-studio#20244

## Problem

The service-tier radio group in `ModelSpeedControl` (`src/renderer/components/ModelSpeedControl.tsx`, the `supportsServiceTier` block) showed only bare labels from `agent.speed.service_tier.*`: Standard, Auto, Fast, and Flex. Users could not tell what each tier changes (latency, cost, queue priority, capacity), which models support it, or what happens when a selected tier is unsupported. The issue's "Elastic" label does not exist in the UI; the four shipped tiers are the scope.

Two behaviors made this worse:

- `resolveSupportedServiceTier` silently replaced an unsupported selection with the model's default. The popover showed the substituted value with no explanation.
- The stored selection and the effective selection could differ, and the UI did not say so.

## Decision

1. **Plain-language tier copy.** Each tier carries one short description in the renderer locale catalogs under `agent.speed.service_tier.<tier>.description`. Copy is Cherry-authored and never quotes provider marketing terms. Each description states the practical tradeoff in one sentence and names which dimension it touches (speed, cost, priority, or capacity).
2. **Provider terms stay separate.** The registry `wire.values` mapping is projected to renderer models as a display-only `values` map on `requestControls.serviceTier` (`ProviderRegistryService.projectServiceTierControl` and `ModelService`). Provider-specific names (for example OpenAI's `priority`) appear only in a secondary "Provider value" line behind a per-section Details toggle. They are never used as the primary label.
3. **Eligibility from the registry.** Selectable tiers come only from `requestControls.serviceTier.options` for the active endpoint. The sole exception is an unsupported saved tier: it stays visible as a disabled, unselectable radio with the explanation in Decision 4. Other undeclared tiers are not listed.
4. **Unsupported selections are disabled, not coerced.** When the stored tier is not in the options for the active model, its radio is disabled with an explanation ("Not available for this model; using Standard") and the effective tier is named in it. The stored value is not rewritten on read; `resolveSupportedServiceTier` remains the submit-path coercion and is unchanged.
5. **Selected and effective values stay visible.** The trigger and the popover show both the saved choice and the effective value whenever they differ, as `saved → effective`.
6. **Safe default.** The default remains `standard`. No tier became the default through this change.

Out of scope: a cost-confirmation step before sending, new provider tiers (including `flex` as a new value), and request-pipeline changes. The request pipeline already honors the effective tier.

## Alternatives considered

- **Keep the fallback silent and document it elsewhere.** Rejected: the issue asks for explanation at the point of use, and the silent substitution is the main source of confusion.
- **Validation message on save instead of disabled radios.** Considered. It lets users pick an impossible combination and then fixes it after the fact. The chosen design prevents the selection and explains why.
- **Add latency, cost, and capacity numbers to the registry.** Deferred. Providers do not publish comparable numbers, and the registry has no such fields (`packages/provider-registry/src/schemas/provider.ts`). Qualitative copy avoids inventing figures.
- **Use provider terms as labels.** Rejected: it violates the issue's "keep provider-specific terminology distinct" requirement.

## Consequences

The popover's service-tier rows now render a description line under every tier label, so the section is taller than before. `Model.requestControls.serviceTier` gains an optional display-only `values` map; the wire `delivery` detail stays out of the renderer. The popover's radio group value is the stored selection rather than the coerced one, so a saved-but-unsupported tier appears selected and disabled until the user picks a supported tier. Submit-time coercion in the composers is untouched, so requests still send the effective tier. Descriptions are generic tradeoffs that can drift if provider behavior changes; each names its dimension instead of a number. Disabling a radio for a stored value may surprise users who set the tier on another model; the explanation names the fallback so the change is visible rather than silent. All 17 locale catalogs carry the new keys; `pnpm i18n:check` rejects leftover placeholders before merge.

## Verification

- AC1 — `pnpm i18n:sync` ran and every one of the 17 locale catalogs carries a translated `agent.speed.service_tier.<tier>.description`; no `[to be translated]` placeholders remain.
- AC2 — Each description states its primary tradeoff and names speed, cost, priority, or capacity; the primary labels remain the shared tier names in `agent.speed.service_tier.<tier>`.
- AC3 — `src/renderer/components/__tests__/ModelSpeedControl.ui.test.tsx`: only declared tiers render as selectable radios; an unsupported saved tier appears once, disabled; the undeclared-tier case renders exactly the declared options plus the saved tier.
- AC4 — `ModelSpeedControl.ui.test.tsx`: a stored `auto` on a `standard/fast/flex` endpoint renders disabled with the explanation and the effective tier named, and the radio group value stays the stored `auto` (the saved value is not rewritten).
- AC5 — `ModelSpeedControl.ui.test.tsx`: the trigger shows `saved → effective` while they differ; the popover derives both from props on every render, so closing and reopening shows the same values.
- AC6 — `ModelSpeedControl.ui.test.tsx`: `resolveSupportedServiceTier` returns `standard` for a model without a service-tier control.
- AC7 — `ModelSpeedControl.ui.test.tsx` plus `src/main/data/services/__tests__/ProviderRegistryService.test.ts`: the projection exposes `values` without `wire`, provider terms render only after expanding Details, and the primary radio labels stay the shared tier names.
