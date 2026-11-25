# Agent Note: StepFun Text-to-Image Search

Status: implemented

English | [中文](2026-11-13-stepfun-text-to-image-search.zh.md)

## Problem

StepFun web search is already available as a `searchKeywords` provider (`packages/web-search/src/providers/stepfun.ts`, catalog entry in `packages/web-search/src/catalog.ts`). StepFun also offers a text-to-image search API at `POST https://api.stepfun.com/step_plan/v1/search-image`, which Cherry Studio cannot call. Its path is not under `/v1`, it is only available through the Step Plan channel, and it is billed per call. The shared capability union `WEB_SEARCH_CAPABILITIES = ['searchKeywords', 'fetchUrls']` (`src/shared/data/preference/preferenceTypes.ts`) has no image capability, so the settings UI has nowhere to expose it.

## Decision

`searchImages` joins the shared capability union end to end: the web-search protocol types (`WebSearchCapability`, a `WebSearchSearchImagesCall` variant, `WebSearchImageResult` and `WebSearchImageResultSet`), `WEB_SEARCH_CAPABILITIES`, the preset capability schemas and the per-capability override schemas. StepFun declares both `searchKeywords` and `searchImages` in the protocol catalog and in `DESKTOP_REMOTE_CAPABILITIES`; no other provider's capability set changes. `WEB_SEARCH_FALLBACK_PROVIDER_IDS_BY_CAPABILITY` gains an empty `searchImages` entry so the capability has no cross-provider fallback.

The image call lives in the existing StepFun protocol module. Its endpoint is resolved from the configured `apiHost` origin and always uses the `/step_plan/v1/search-image` path, while keyword search keeps its `/v1/search` rewrite and `n` cap of 20 untouched. The request sends `query` and `topk`, where `topk` is `min(maxResults, 50)`: StepFun documents `topk` as the upper limit of returned images without a numeric maximum, so the module caps it defensively at 50 and documents that choice in code. A `code` of 0 maps `data.result.search_results` to image results carrying `contentUrl`, the alt-text `snippet`, `width`, `height`, `hostPageUrl` and `hostname`; `data.result.block: true` returns an empty list without error. A non-zero `code` raises a provider error whose message carries `msg` and whose `providerCode` carries the numeric code, so entitlement or billing failures surface as errors rather than empty results.

`WebSearchClient.execute` returns `WebSearchResultSet | WebSearchImageResultSet`, discriminated by the call capability. The desktop runtime dispatch is not wired for image search yet: `RemoteWebSearchProvider` rejects `searchImages` with `capability_unsupported`, keeping every existing keyword and fetch path byte-identical. The settings UI is data-driven from declared provider capabilities, so an Image search section appears only for providers that declare `searchImages` (today only StepFun), reusing the existing StepFun icon and provider metadata. Image search has no chat dispatch consumer, so there is no persisted default provider for the section; the section configures credentials and host only, and its connection check reuses the keyword probe.

## Alternatives considered

- Reuse `searchKeywords` for image queries: rejected. The response shape, endpoint path, and billing differ, so the call would silently return the wrong result type.
- Register a separate "StepFun Image" provider: rejected. It would duplicate API-key configuration for the same account and split one provider identity across two entries.
- Defer image search and ship only keyword search: rejected for this iteration. The capability-model change landed behind a data-driven settings surface, so providers that do not declare `searchImages` are unaffected.

## Consequences

The widened capability union touches persisted preference validation: the override schemas gain optional `searchImages` entries and existing stored values still parse unchanged. Image results are not yet consumed by chat tool dispatch; the renderer surfaces configuration only, and a future stage must wire a `web_search.search_images` IPC path and decide how image results render in conversation. The `topk` cap of 50 is a local defensive bound, not a StepFun-documented limit; revisit it if StepFun publishes a maximum. Each image call is billed under the Step Plan channel, and returned images belong to their source websites — the API performs no copyright or commercial-use review, so consumers must not imply a license to reuse them.

## Verification

- AC1 — `src/shared/data/presets/__tests__/webSearchProviders.test.ts` and `src/shared/utils/__tests__/webSearch.test.ts` (23 tests) pass with `searchImages` in the capability schema, the StepFun preset declaring both capabilities and all other providers unchanged; the StepFun catalog test in `packages/web-search/src/__tests__/stepfun.test.ts` asserts exactly `['searchKeywords', 'searchImages']`.
- AC2 — Request-shape tests in `packages/web-search/src/__tests__/stepfun.test.ts` (28 tests) assert the POST targets `/step_plan/v1/search-image` on the configured origin (default, proxy and prefixed hosts), sends bearer auth, `query`, and `topk` capped at 50.
- AC3 — Mapping tests assert `contentUrl`, `snippet`, dimensions, `hostPageUrl` and `hostname` survive into image results with `sourceInput`, missing optional fields are tolerated, and `block: true` returns an empty list.
- AC4 — A non-zero `code` rejects with `kind: 'provider'`, the `msg` text as the message and the numeric code as `providerCode`.
- AC5 — `src/renderer/utils/__tests__/webSearchProviderMeta.test.ts` (5 tests) asserts an image search section lists only StepFun while providers without `searchImages` produce no entry.
- AC6 — Keyword-search cases in `stepfun.test.ts` and the 130 cross-provider cases in `protocols.test.ts` pass unchanged, including the `/v1/search` rewrite and the `n` cap of 20. Package, node and web `tsrs` typechecks are clean.
