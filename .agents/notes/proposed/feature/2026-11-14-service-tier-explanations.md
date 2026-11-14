# Agent Note: Service Tier Explanations

Status: proposed

English | [中文](2026-11-14-service-tier-explanations.zh.md)

Tracks: CherryHQ/cherry-studio#20244

## Problem

The service-tier radio group in `ModelSpeedControl` (`src/renderer/components/ModelSpeedControl.tsx`, the `supportsServiceTier` block) shows only bare labels from `agent.speed.service_tier.*`: Standard, Auto, Fast, and Flex. Users cannot tell what each tier changes (latency, cost, queue priority, capacity), which models support it, or what happens when a selected tier is unsupported. The issue's "Elastic" label does not exist in the current UI; this Spec treats the four shipped tiers as the scope.

Two current behaviors make this worse:

- `resolveSupportedServiceTier` silently replaces an unsupported selection with the model's default. The popover shows the substituted value with no explanation.
- The stored selection and the effective selection can differ, and the UI does not say so.

## Proposal

1. **Plain-language tier copy.** Add one short description per tier in the renderer locale catalogs under `agent.speed.service_tier.<tier>.description`. Copy is Cherry-authored and never quotes provider marketing terms. Each description states the practical tradeoff in one sentence and names which dimension it touches (speed, cost, priority, or capacity).
2. **Provider terms stay separate.** Provider-specific names (for example OpenAI's `priority` or `flex`) remain in the registry `values` mapping and appear only in a secondary "Provider value" line when the user expands details. They are never used as the primary label.
3. **Eligibility from the registry.** Show only the tiers in `requestControls.serviceTier.options` for the active endpoint. Tiers the model does not declare are not listed, so no hidden tier can be selected.
4. **Unsupported selections are disabled, not coerced.** When the stored tier is not in the options for the active model, the radio for that tier is disabled with an explanation ("Not available for this model; using Standard"), and the effective tier is shown next to it. Disabled state replaces the silent fallback in the UI. The stored value is not rewritten on read.
5. **Selected and effective values stay visible.** The trigger and the popover show both the saved choice and the effective value whenever they differ.
6. **Safe default.** The default remains `standard`. No tier becomes the default by this change.

Out of scope: a cost-confirmation step before sending, new provider tiers (including `flex` as a new value), and request-pipeline changes. The request pipeline already honors the effective tier.

## Alternatives considered

- **Keep the fallback silent and document it elsewhere.** Rejected: the issue asks for explanation at the point of use, and the silent substitution is the main source of confusion.
- **Validation message on save instead of disabled radios.** Considered. It lets users pick an impossible combination and then fixes it after the fact. The chosen design prevents the selection and explains why.
- **Add latency, cost, and capacity numbers to the registry.** Deferred. Providers do not publish comparable numbers, and the registry has no such fields today (`packages/provider-registry/src/schemas/provider.ts`). Qualitative copy avoids inventing figures.
- **Use provider terms as labels.** Rejected: it violates the issue's "keep provider-specific terminology distinct" requirement.

## Acceptance criteria

- AC1 — Every displayed tier has a description in `en-us` and in every locale catalog after `pnpm i18n:sync` and translation (verification: renderer)
- AC2 — Tier descriptions state one of speed, cost, priority, or capacity as the primary tradeoff and do not reuse provider marketing terms as labels (verification: renderer)
- AC3 — Only tiers declared in `requestControls.serviceTier.options` for the active endpoint are listed; undeclared tiers never render (verification: renderer)
- AC4 — A stored tier that the active model does not support renders disabled with an explanation and the effective tier; the stored value is not overwritten on read (verification: renderer)
- AC5 — The trigger and popover show both the saved and effective tier when they differ, and show the same value after the popover is closed and reopened (verification: renderer)
- AC6 — The default selection remains `standard` for models without a stored tier (verification: unit)
- AC7 — Provider-specific values from the registry appear only in a secondary detail line, never as a primary label (verification: renderer)

## Risks

- Copy can go stale if provider behavior changes. Mitigation: descriptions are generic tradeoffs, not provider promises, and each one names its dimension instead of a number.
- Disabling a radio for a stored value may surprise users who set a tier on another model. Mitigation: the explanation names the fallback so the change is visible rather than silent.
- Translations lag behind the English copy. Mitigation: `pnpm i18n:check` rejects leftover placeholders before merge.
