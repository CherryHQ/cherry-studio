# Agent Note: Image request timeout defaults per provider

Status: implemented

English | [中文](2026-11-10-image-request-timeout-defaults.zh.md)

## Problem

There is no reusable image request timeout. The 600,000 ms submit default and per-draft override already shipped, but users cannot save one value per provider.

## Decision

The provider row has an optional integer-millisecond `settings.imageRequestTimeoutMs` bounded from 10,000 to 1,800,000 ms. `null` in a PATCH deletes it; absence means fallback. The renderer resolves the value at request and display time in the order draft override → provider value → 600,000 ms. Drafts do not seed a copy of the provider value. An explicit draft override is cleared only on a cross-provider switch.

The setting applies only to the four provider IDs that already honour it: `ppio`, `dashscope`, `modelscope`, and `tokenhub`. The provider API Settings drawer owns the editor; the paintings composer settings popover shows the effective value. The generic `settings.timeout` is untouched.

## Alternatives considered

- A `feature.paintings.*` preference map would duplicate provider ownership and require separate lifecycle management.
- Reusing exported generic `settings.timeout` would conflate image requests with an unrelated setting.
- Per-model storage would not provide the requested per-provider default and would duplicate settings.
- Snapshotting the provider value into each new draft would prevent live inheritance of later edits.
- Resolving fallback in the main process after submission would prevent the renderer from showing the effective value and capturing it consistently at submission.

## Consequences

There is one optional JSON setting, no migration, and no default backfill. Open drafts without an override follow later provider edits; explicit overrides stay independent. A submitted job keeps its captured value. Unsupported or UUID-cloned providers keep their current behaviour. Rollback consists of deleting the field and editor.

This automation-authored delivery falls inside the maintainer's instruction to ship the reversible part of #22679 without a separate approved Spec PR — no prior human Spec approval is claimed, and reviewer acceptance is the product decision.

## Verification

- AC1 — Shared provider schema tests and main ProviderService update tests cover validation, nullable patch deletion, and persistence.
- AC2 — Renderer PaintingSettings, paintingPipeline, canonicalGenerate, and paintingProviderRuntime tests cover effective values, inheritance, and request handling.
- AC3 — ProviderApiOptionsDrawer, ProviderHeader, and useProviderMeta tests cover editor save, clear, failure, supported visibility, and unsupported providers; usePaintingModelSwitch tests cover merged draft state across switches.
- AC4 — `i18n-check` and the web TypeScript check pass.
- Regression — The node TypeScript check reports `AgentSessionRuntimeService.ts(1088,71)` TS2322 in an untouched file; the same error is reproducible on the untouched base tree and is unrelated to this change.
