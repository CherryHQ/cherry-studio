# Agent Note: Seedream 5.5 image generation and transparent assets

Status: implemented

English | [中文](2026-11-13-seedream-5-5-image-model.zh.md)

## Problem

Without a Seedream 5.5 registry entry, users fall back to generic OpenAI-compatible image providers and encounter HTTP 400 responses. Its single-image request contract differs from Seedream 4.x and 5.0 Lite: `sequential_image_generation`, `stream` and `tools.web_search` are unsupported, and `n > 1` is ignored while only one image is counted. Forwarding older grouping controls is unsafe; forwarding `numImages` can also make the SDK fan out into multiple paid requests.

## Decision

The shared contract in `src/shared/ai/seedreamImageContract.ts` uses the exact target set `{ doubao-seedream-5-5 }`. It does not match a family prefix: Lite still needs its grouping fields. The ByteDance creator and Doubao provider declare the model with generate/edit support and at most ten reference images in either mode.

The registry declares tiers `1K`, `1.5K` and `2K` (default `1K`), custom dimensions paired with `imageResolution`, watermark default `true`, background default `auto`, and JPEG/PNG output default `jpeg`. Explicit positive integer `WxH` dimensions and tiers are mutually exclusive. Dimensions require 921600–4624220 pixels inclusive and a long-to-short-side ratio at most 16:1. The shared validator enforces these cross-field constraints without tightening global `buildParamsSchema`.

The renderer checks parameters before the submit guard and input materialization, and again at `canonicalGenerate` before generic validation. Custom dimensions become canonical `size`, never a `WxH` value in `imageResolution`. The transparent-asset preset atomically sets `background=transparent` and `outputFormat=png`, hides the individual controls and preserves the pair through other setting edits. Turning it off restores `background=auto`, keeps PNG and unlocks the controls. This is a renderer preset, not a registry operation mode.

`AiService.generateImage` resolves provider/model before the authoritative gate, using `model.presetModelId ?? parseUniqueModelId(model.id).modelId` for target identity. Before `splitParamValues`, image normalization, SDK dispatch or job enqueueing, it rejects the DMXAPI preset (including user-created preset instances), validates size and transparent-output compatibility, then sanitizes the bag. Sanitization removes `numImages`, `sequentialImageGeneration`, `maxImages`, `webSearch`, `stream` and `tools`, composes dimensions and supplies missing defaults without overwriting watermark `false`. Both SDK and job delivery receive sanitized parameters and default to one image. Failures reuse `REMOTE_ERROR`, with localized renderer messages and actionable main-process messages. DMXAPI's 5.5 protocol is unverified; its transport is unchanged.

## Alternatives considered

- Prefix matching — would also strip grouping parameters from 5.0 Lite, whose contract still needs them.
- A new registry operation mode — transparent background and PNG are coupled settings within generate/edit, not a separate operation.
- Globally tightening `buildParamsSchema` — would change unrelated models and still leave direct main-process callers outside the renderer boundary.
- Forcing 5.5 through DMXAPI transport — would claim compatibility with an unverified protocol; explicit rejection preserves that boundary.
- A custom error code — existing `REMOTE_ERROR` and presentation already carry actionable validation failures.

## Consequences

DMXAPI 5.5 is temporarily unavailable. Layer decomposition and a layer canvas belong to stage 2. Real vendor PNG alpha has not been tested; parameter and wire tests do not establish generated PNG contents.

The catalog is generated from fixed upstream cache snapshots. `result-5.md` records removal of four unrelated stale Gemini constraint-index entries during generation; the current worktree retains those entries and has no diff for `server-tool-constraints.gen.ts`. They are not part of the delivered model change. The same report flags that schema-v4 compatibility alone does not prove older clients understand paired custom dimensions and cross-field validation; catalog publication needs an appropriate client-version decision.

## Verification

Round-1 reports `result-2b.md`, `result-3.md`, `result-4.md` and `result-5.md` record the implementation evidence. `result-2b.md` describes the incomplete initial slice; later reports supply renderer, main and catalog evidence. The independent rerun counts below are supplied by the coordinator, not newly executed for this documentation slice.

- AC1 — Shared tests: 25 pass in the coordinator rerun, covering exact target identity, conflicting size sources, pixel/aspect limits, transparent output and sanitization.
- AC2 — Registry tests: 71 pass in the coordinator rerun; `result-5.md` verifies creator/catalog agreement, generate/edit, ten reference images and no grouping controls on 5.5.
- AC3 — Renderer tests: 70 pass in the coordinator rerun; `result-3.md` documents early rejection, effective-mode size projection, atomic transparent settings, Lite exclusion and URL reference-image import.
- AC4 — Main tests: 131 pass in the coordinator rerun; `result-4.md` documents SDK/job sanitization, single-request wire assertions, DMXAPI rejection and non-target compatibility; current source validates before sanitization and resolves preset identity as stated above.
- AC5 — The coordinator reports exit 0 for compatibility, i18n, builtin-knowledge and change-scope checks; `result-5.md` supplies catalog compatibility and generation evidence, including the publication limitation.
