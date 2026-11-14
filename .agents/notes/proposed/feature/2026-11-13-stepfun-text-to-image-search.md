# Agent Note: StepFun Text-to-Image Search

Status: proposed

English | [中文](2026-11-13-stepfun-text-to-image-search.zh.md)

## Problem

StepFun web search is already available as a `searchKeywords` provider (`packages/web-search/src/providers/stepfun.ts`, catalog entry in `packages/web-search/src/catalog.ts:37`). StepFun also offers a text-to-image search API at `POST https://api.stepfun.com/step_plan/v1/search-image`, which Cherry Studio cannot call. Its path is not under `/v1`, it is only available through the Step Plan channel, and it is billed per call. The shared capability union `WEB_SEARCH_CAPABILITIES = ['searchKeywords', 'fetchUrls']` (`src/shared/data/preference/preferenceTypes.ts:313`) has no image capability, so the settings UI has nowhere to expose it.

## Proposal

- Add `searchImages` to `WEB_SEARCH_CAPABILITIES` and to the Zod capability schema derived from it (`src/shared/data/presets/webSearchProviders.ts`). Stored preference values that contain only the existing capabilities remain valid.
- Declare `searchImages` on StepFun in both the protocol catalog (`packages/web-search/src/catalog.ts`) and the preset (`src/shared/data/presets/webSearchProviders.ts:116`, currently `['searchKeywords']`). Its endpoint is resolved from the `apiHost` origin and uses the `/step_plan/v1/search-image` path, while keyword search keeps `/v1/search`.
- Implement the image call in the same protocol module (`packages/web-search/src/providers/stepfun.ts`). Send `query` and `topk`, with `topk` capped at a documented maximum. Map `data.result.search_results` to image results containing the original URL (`contentUrl`), the alt-text description (`snippet`), dimensions, `hostPageUrl`, and `hostname`. A `data.result.block` value of `true` returns an empty list. A non-zero `code` raises a provider error carrying `msg`.
- Render the image capability in `src/renderer/pages/settings/WebSearchSettings/` and its metadata in `src/renderer/utils/webSearchProviderMeta.ts` only for providers that declare it. Reuse existing StepFun iconography; add no new icon.

## Alternatives considered

- Reuse `searchKeywords` for image queries: rejected. The response shape, endpoint path, and billing differ, so the call would silently return the wrong result type.
- Register a separate "StepFun Image" provider: rejected. It would duplicate API-key configuration for the same account and split one provider identity across two entries.
- Defer image search and ship only keyword search: this is the current state. It stays the fallback if the capability-model change is not approved.

## Acceptance criteria

- AC1 — `searchImages` is a valid shared capability, and the StepFun catalog and preset declare both `searchKeywords` and `searchImages`; no other provider's capability set changes. (verification: unit — capability schema and catalog tests)
- AC2 — The image call posts to the `/step_plan/v1/search-image` path on the configured origin with bearer authentication, `query`, and a `topk` value capped at the documented maximum. (verification: unit — request-shape test in `packages/web-search/src/__tests__/stepfun.test.ts`)
- AC3 — A `code` of 0 maps `data.result.search_results` to image results with URL, description, dimensions, and host page; `data.result.block: true` yields an empty list without error. (verification: unit)
- AC4 — A non-zero `code` surfaces as a provider error that includes `msg`. (verification: unit)
- AC5 — The settings UI shows image search for StepFun and does not show it for providers that do not declare `searchImages`. (verification: renderer)
- AC6 — Keyword search behavior is unchanged, including its `/v1/search` endpoint and `n` cap of 20; the existing `stepfun.test.ts` cases still pass. (verification: unit)

## Risks

- Returned images belong to their source websites, and the API performs no copyright or commercial-use review. The UI and result consumers must not imply a license to reuse them.
- Each image call is billed under the Step Plan channel. Users on a plain StepFun key may receive authentication or entitlement errors; these must be shown as provider errors, not as empty results.
- Changing the shared capability union touches persisted preference validation. Existing stored values must still parse, which AC1 covers.
- Path normalization for `apiHost` currently rewrites the path to `/v1/search` (`packages/web-search/src/providers/stepfun.ts`). Adding a second path must not change keyword-search URLs, which AC6 covers.
