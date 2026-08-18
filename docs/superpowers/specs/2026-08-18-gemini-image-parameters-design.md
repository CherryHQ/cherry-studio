# Gemini Image Parameter Delivery Design

## Problem

Cherry Studio exposes the stable Nano Banana 2 model (`gemini-3.1-flash-image`) without image-generation controls, while the preview model has no explicit smart/automatic option. Users therefore cannot reliably choose Google-managed aspect-ratio matching or request 1K, 2K, and 4K output from the painting form.

## Scope

- Add a complete image-generation capability declaration for stable Nano Banana 2.
- Make `auto` the default aspect-ratio choice for stable and preview Nano Banana 2.
- Make `auto` the default resolution choice while retaining explicit 1K, 2K, and 4K choices.
- Add a focused Google/Vertex wire regression for automatic resolution omission.
- Regenerate the provider-registry catalog.

This change is limited to Google-owned native Gemini image models and their wire contract test. It does not change generic OpenAI-compatible providers, OpenRouter's separate resolution contract, prompt parsing, or wire production code.

## Design

The provider registry remains the source of truth. Stable Nano Banana 2 is hand-listed in `packages/provider-registry/src/creators/google.ts` so its capabilities do not depend on incomplete upstream metadata. Both stable and preview models declare `auto` as the first option and default for `aspectRatio` and `imageResolution`.

The current form and request pipeline already implement the desired semantics:

- `auto` is localized and stored as a normal registry option.
- `normalizeAspectRatio('auto')` returns no value, so Google chooses the aspect ratio.
- `buildImageRequest` globally filters `auto` before Google/Vertex profile rules, so automatic `imageResolution` leaves `imageConfig.imageSize` unset.
- The Google/Vertex wire profile maps explicit aspect ratios to `imageConfig.aspectRatio`.
- The same profile still maps explicit 1K, 2K, and 4K values to `imageConfig.imageSize`.

No new renderer state, provider option namespace, or request adapter is required.

## Model Contracts

Stable `gemini-3.1-flash-image` exposes smart matching plus Google's supported ratios: `auto`, `1:1`, `1:4`, `1:8`, `2:3`, `3:2`, `3:4`, `4:1`, `4:3`, `4:5`, `5:4`, `8:1`, `9:16`, `16:9`, and `21:9`. Registry values use the existing `ASPECT_X_Y` encoding for explicit ratios.

Preview `gemini-3.1-flash-image-preview` keeps its existing explicit ratio set and adds `auto` as its default. Both variants expose `auto`, `1K`, `2K`, and `4K` for `imageResolution`, with `auto` as the default.

## Verification

A catalog contract test must fail on current main because stable Nano Banana 2 lacks `imageGeneration` and preview lacks automatic defaults. After generation, the test must verify both variants' automatic defaults and explicit 1K/2K/4K choices. A focused Google/Vertex wire test proves automatic resolution produces no provider options, while the existing explicit-tier assertion proves `2K` reaches `imageConfig.imageSize`.
