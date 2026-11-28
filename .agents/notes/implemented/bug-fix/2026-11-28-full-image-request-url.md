# Agent Note: Full image request URLs are POSTed as-is

Status: implemented

English | [中文](2026-11-28-full-image-request-url.zh.md)

## Problem

Custom image endpoint base URLs are treated as base hosts: `formatApiHost` appends `/v1` (dotted versions like `/v2.1/` are not recognised) and `OpenAICompatibleImageModel` appends `/images/generations`. A full vendor path such as iFlytek Spark TTI `https://maas-api.cn-huabei-1.xf-yun.com/v2.1/tti` becomes `.../v2.1/tti/v1/images/generations` (404). Pasting a full OpenAI path `.../v1/images/generations` doubles the suffix the same way.

## Decision

`isFullImageRequestUrl()` in `src/shared/utils/api/format.ts` detects a complete image request URL on the parsed pathname: it ends with `/images/generations|edits` (an optional query string is ignored for detection), or it is a dotted-version vendor path with exactly one trailing segment (`/v2.1/tti`). Gateway bases such as `.../v2.1/openai/v1` (two segments after the dotted version), `.../v2.1/openai` (gateway marker), or a trailing plain version (`.../v2.1/v1`) stay base hosts. A trailing `#` is stripped before detection. `normalizeFullImageRequestUrl()` preserves the query verbatim (`.../generations?tenant=x`, `.../v2.1/tti?prefix=tenant/`). `formatBaseURL()` in `src/main/ai/provider/config.ts` returns the normalized full URL with no `/v1` append only for an explicitly configured image endpoint, so a blank image field falling back to a chat host such as `.../v2.1/openai/v1` keeps SDK path joining; `buildOpenAICompatibleConfig()` installs a fetch wrapper that routes by actual operation (`/images/edits` vs `/images/generations`) across distinct generation/edit full URLs and records the resolved outbound URL via `HTTP_TRACE_FINAL_URL_SLOT` so developer-mode `http.url` shows the path actually sent. The custom-provider preview in `customProviderCreation.ts` shows the final URL as-is. Bare hosts such as `https://relay.example.com/custom#` and vendor-like non-conforming paths such as `.../multimodal-generation/generation#` keep the legacy `base + /images/...` behaviour, as documented in the image-endpoint help across all renderer locales.

## Alternatives considered

- Vendored Spark TTI transport with native `header/parameter/payload` mapping: correct wire shape for TTI but a larger preset/registry change; deferred since the issue asks for full-path POSTing.
- Treating every trailing-`#` image host as a full URL: breaks existing `.../custom#` base behaviour covered by NewAPI tests.
- Extending `hasApiVersion` for dotted versions globally: only fixes the `/v1` append, not the SDK `/images/...` append.

## Consequences

Full image URLs (generation and edit, query preserved) are POSTed exactly as entered; base hosts and gateway bases such as `.../v2.1/openai/v1` are unchanged. Operation-aware routing sends `/images/edits` to the configured edit full URL when generation and edit URLs differ. Developer-mode traces show the resolved outbound URL. TTI still receives the OpenAI-compatible body, so a vendor expecting the native TTI shape returns its own schema error with the correct URL. No change for NewAPI/AiHubMix gateway transports.

## Verification

- Regression — `src/shared/utils/api/__tests__/api.test.ts`: `.../v2.1/tti`, `.../v2.1/tti#`, and `.../v1/images/generations` (plus `?tenant=x` variants) are full URLs; `.../custom#`, `.../gateway/v1`, `.../v2.1/openai/v1`, `.../v2.1/openai#`, and `.../multimodal-generation/generation#` are not; query values keep trailing slashes.
- Regression — `src/main/ai/provider/__tests__/config.test.ts`: full image URLs resolve to `openai-compatible` with the exact `baseURL` (query preserved) and a rewriting fetch; blank image with gateway chat base and explicit `.../v2.1/openai#` keep `customFetch`; distinct generation/edit full URLs route by `/images/edits` vs `/images/generations`.
- Regression — `src/renderer/pages/settings/ProviderSettings/ProviderList/__tests__/customProviderCreation.test.ts`: full image URLs (including query) preview as-is; gateway-style paths keep legacy preview.
- Regression — `src/main/ai/observability/__tests__/httpTraceFetch.test.ts`: `HTTP_TRACE_FINAL_URL_SLOT` overwrites redacted `http.url` with the resolved outbound URL.
