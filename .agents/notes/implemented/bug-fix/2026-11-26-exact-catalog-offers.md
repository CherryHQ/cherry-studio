# Agent Note: Preserve exact model offers in catalog refreshes

Status: implemented

English | [中文](2026-11-26-exact-catalog-offers.zh.md)

## Problem

A daily refresh deduplicated offers by canonical model ID. When a paid route and a free variant shared that ID, the generated catalog could keep the free price while the application still sent the paid request ID.

## Decision

Keep prices and limits on the exact vendor offer. Canonical lookup prefers the unsuffixed offer when the provider spells it with a namespace or different version separators. Exact lookup resolves tagged offers independently.

CherryIN's `(free)` offers are indexed by their exact API IDs so paid lookups cannot inherit their zero prices. CherryIN owns the published model protocols and prices in its provider declarations.

The daily workflow checks the generated catalog before updating its pull request and includes changed model data and tool indexes together.

## Alternatives considered

Keeping one row per canonical model loses independently callable offers. Selecting the first row makes pricing depend on upstream array order.

## Consequences

The catalog can serve multiple exact offers for one model. A candidate that violates an existing catalog contract needs a source correction before automation can update the pull request.

## Verification

- Regression — `catalog-invariants.test.ts`: paid and free Nemotron routes keep their own prices and canonical lookup is independent of row order.
- Regression — `alibaba-catalog.test.ts`: Qwen4 Max keeps the native output limit and the OpenRouter route uses its own limit and reasoning settings.
- Regression — `registry.test.ts` and `ProviderRegistryService.test.ts`: CherryIN's free and image prices reach exact routes and the model selection projection.
