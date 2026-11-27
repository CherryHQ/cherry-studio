# Agent Note: Disambiguate the same model across providers and preserve painting params on same-model provider switch

Status: implemented

English | [中文](2026-11-27-cross-provider-same-model.zh.md)

## Problem

The same model served by more than one provider (e.g. `gemini-2.5-flash-image` via Gemini and via an aggregator) was awkward in two ways.

First, `ModelSelector` rows were indistinguishable: `useModelSelectorData` computed duplicate names per display group (one group per provider by default), so a name duplicated *across* providers never set `showIdentifier`, and non-pinned rows rendered only the model identifier — which is also identical when the `apiModelId` matches.

Second, switching to the same `apiModelId` under a different provider in Paintings wiped the form: `usePaintingModelSwitch` funneled every cross-provider switch through `createDefaultPainting`, resetting `params` to `{}`, forcing `mode` back to `generate`, and clearing `inputFiles`.

## Decision

`useModelSelectorData` computes one global duplicate-name set over all visible models; any row whose name appears more than once gets `showIdentifier`. `ModelRow` then always renders `| {providerName} · {modelIdentifier}` for such rows, so even rows with identical names and identifiers stay distinguishable. Intra-provider duplicates gain the same provider prefix for consistency.

`computeModelFieldReset` accepts `oldProviderId`/`newProviderId` (legacy `providerId` still works) and diffs both providers' registry blocks; the same `apiModelId` on a different provider no longer early-returns. `usePaintingModelSwitch` adds a same-`apiModelId` cross-provider branch that applies that diff, preserves `mode`, and keeps `inputFiles` unless the target model is positively non-edit (resolved from the ensured catalog, defaulting to preserving when unknown). Switches to a different model still fully reset.

## Alternatives considered

- Show only the identifier for non-pinned duplicates: leaves the reported case (identical `apiModelId` on both providers) with two identical rows.
- Always show the provider on every row: noisy for the common unique-name case; the suffix appears only where a duplicate exists.
- Blindly carry `params` across providers for the same model id: registry blocks can differ per provider, so values are diffed and clamped instead of copied verbatim.
- Clear `inputFiles` when the target model is unknown: would keep wiping attachments in exactly the reported scenario, so unknown targets preserve them.

## Consequences

Cross-provider duplicate rows carry a `| Provider · identifier` suffix in every `ModelSelector` consumer (chat, translate, assistants, settings, knowledge, paintings). Same-model provider switches in Paintings keep compatible params, the current mode, and attachments; only genuinely incompatible values reset. The per-display-group duplicate sets are gone; merged provider groups inherit the global behavior.

## Verification

- Regression — `useModelSelectorData.test.ts` flags cross-provider shared names and identical model ids served by two providers with `showIdentifier`; intra-provider duplicates and unique names are unchanged.
- Regression — `computeModelFieldReset.test.ts` diffs the same model across providers (clamps a rejected size, keeps a compatible one) instead of early-returning.
- Regression — `usePaintingModelSwitch.test.ts` preserves params, mode, and input files on same-model provider switches, drops input files for generate-only targets, and still fully resets when the model differs.
- Regression — `ModelSelector.test.tsx`, `ModelSelector.presentation/scroll/DetailCard` suites, `PaintingModelSelector.test.tsx`, `PaintingPage.test.tsx`, and `PaintingSettings.test.tsx` stay green.
