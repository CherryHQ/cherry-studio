# Agent Note: Model-selector reference pricing

Status: proposed

English | [中文](2026-11-22-model-selector-pricing.zh.md)

## Problem

Issue #19347 requests API prices in the model selector's existing detail card. Cherry already stores model pricing, supports custom prices and input-token tiers, and resolves provider billing schedules. The detail card currently shows identity, context limits and capabilities, but not these prices. Users should not need to open model settings to compare known reference rates.

A display must not turn an unknown price into zero, hide a currency difference, flatten tiered pricing or present a local estimate as a provider quote. No new live pricing source is needed for this request.

## Proposal

Add a read-only, localized reference-pricing section to `ModelSelectorDetailCardContent`, beneath the existing token limits. The ordinary selector passes its model and provider; other consumers without provider context may display stored model rates only, clearly labeled as configured rates without provider billing adjustments. Preserve model selection, hover/focus behavior, identity, tags, descriptions and capability rows.

Use the model's existing pricing and custom-price provenance. For a provider-aware card, reuse the existing provider billing/default-policy resolver and API model identity, not a parallel pricing calculator. Capture a reference instant when the card opens and show its local as-of time when schedule-dependent billing is applied. The displayed reference remains tied to that instant while open; reopening refreshes it. It is not a promise about a future request. If provider context is unavailable, never imply provider adjustments were applied. Do not perform network requests, change persisted prices or create usage records.

Show input, output, cache-read and cache-write rates with explicit currency and per-million-token units. Missing/non-finite/negative rates read as unavailable; valid zero remains numeric zero and does not make the whole model 'free'. Use enough decimal precision to preserve small positive rates without rendering them as zero. Retain the schema's documented currency default for absent token currency, never convert currencies or silently replace an explicit one. Show a distinct unavailable state when no prices are known.

For input-token tiers, show the base and each threshold with their associated input/output/cache rates rather than one misleading flat price. Thresholds retain the existing resolver's semantics and order. Keep absent cache rates unknown instead of copying ordinary input rates. Include known image/pixel and minute rates with their correct units, but only attribute currency where the existing data contract establishes it. Ambiguous non-token currency must be labeled unspecified, not guessed from an unrelated field. Long tables remain scrollable inside the existing collision-aware card, without clipping the price or its units.

Label all amounts reference estimates from configured/catalog metadata, not live quotes or final bills. Show custom-price provenance when present and a short explanation that provider billing can depend on request time, token tier, cache use and other unrepresented charges. Do not claim taxes, account discounts, regional conversion or conditional service-tier pricing unless the current pricing resolver actually represents them. Existing provider/model billing settings remain the editing owner; no new preferences, schema or catalog changes belong here.

## Alternatives considered

- Scrape provider pages on hover: adds latency, credentials/rate-limit concerns and a second price source without a freshness contract.
- Show only input/output scalars: hides cache discounts, tiers, billing schedules and currency differences that can change a comparison.
- Label missing prices free, or use a free capability tag as a price: invents a billing fact and can mislead budget-sensitive users.
- Reimplement schedule multipliers in the renderer card: diverges from existing billing ownership.
- Show a request total: the picker does not know future token counts, cache outcomes or final charges.

## Acceptance criteria

- AC1 — Opening a provider-aware model detail card shows available resolved reference rates, explicit currency/units and custom-price provenance using existing pricing/billing ownership; reopening refreshes the reference instant, while context-free consumers do not claim adjusted prices. Selection and existing detail content are unchanged. (verification: renderer and shared tests)
- AC2 — Unknown/invalid values remain unavailable, explicit zero remains zero, small positive prices remain positive, and currency is preserved without conversion or invented non-token currency. Cache, tiered input/output and supported non-token units display without collapsing distinct rates. (verification: renderer and shared tests)
- AC3 — Users can inspect the section through existing hover/focus access with readable narrow/light/dark layouts and long tier tables; English/Chinese text and all shipped locale keys are complete. No display path starts model calls, changes pricing or creates usage. (verification: renderer, visual inspection and Electron)
- AC4 — Bilingual model-selection guidance describes reference estimates and limitations. Changed-file checks, affected consumer tests and docs gates pass, with any native acceptance boundary stated explicitly and the note remaining proposed until all criteria have evidence. (verification: docs gate, renderer and Electron)

## Risks

The model schema can represent more prices than one compact card can summarize. Preserve units and tiers rather than silently omit conditions, and let the card scroll. Keep explanations short without dropping the configured-versus-live distinction.

Provider-aware and context-free consumers must not present the same number with different implied authority. Keep their labels explicit. Schedule-dependent rates need an as-of instant so an open card does not silently claim a stale rate is current. This feature does not fix catalog freshness or introduce new billing policies.
