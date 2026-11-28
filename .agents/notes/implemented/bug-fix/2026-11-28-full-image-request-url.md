# Agent Note: Full image request URLs are POSTed as-is

Status: implemented

English | [中文](2026-11-28-full-image-request-url.zh.md)

## Problem

Custom image endpoint base URLs are treated as base hosts: `formatApiHost` appends `/v1` (dotted versions like `/v2.1/` are not recognised) and `OpenAICompatibleImageModel` appends `/images/generations`. A full vendor path such as iFlytek Spark TTI `https://maas-api.cn-huabei-1.xf-yun.com/v2.1/tti` becomes `.../v2.1/tti/v1/images/generations` (404). Pasting a full OpenAI path `.../v1/images/generations` doubles the suffix the same way.

## Decision

`isFullImageRequestUrl()` in `src/shared/utils/api/format.ts` detects a complete image request URL: a path ending with `/images/generations|edits`, or a dotted-version vendor path with a trailing segment (`/v2.1/tti`). A trailing `#` is stripped before detection. `formatBaseURL()` in `src/main/ai/provider/config.ts` returns the normalized full URL with no `/v1` append, and `buildOpenAICompatibleConfig()` installs a fetch wrapper that POSTs the OpenAI body directly to the full URL instead of the SDK-appended URL. The custom-provider preview in `customProviderCreation.ts` shows the final URL as-is. Bare hosts such as `https://relay.example.com/custom#` keep the legacy `base + /images/...` behaviour.

## Alternatives considered

- Vendored Spark TTI transport with native `header/parameter/payload` mapping: correct wire shape for TTI but a larger preset/registry change; deferred since the issue asks for full-path POSTing.
- Treating every trailing-`#` image host as a full URL: breaks existing `.../custom#` base behaviour covered by NewAPI tests.
- Extending `hasApiVersion` for dotted versions globally: only fixes the `/v1` append, not the SDK `/images/...` append.

## Consequences

Full image URLs (generation and edit) are POSTed exactly as entered; base hosts are unchanged. TTI still receives the OpenAI-compatible body, so a vendor expecting the native TTI shape returns its own schema error with the correct URL. No change for NewAPI/AiHubMix gateway transports.

## Verification

- Regression — `src/shared/utils/api/__tests__/api.test.ts`: `.../v2.1/tti`, `.../v2.1/tti#`, and `.../v1/images/generations` are full URLs; `.../custom#` and `.../gateway/v1` are not.
- Regression — `src/main/ai/provider/__tests__/config.test.ts`: full image URLs resolve to `openai-compatible` with the exact `baseURL` and a rewriting fetch; legacy `.../custom#` keeps `customFetch`.
- Regression — `src/renderer/pages/settings/ProviderSettings/ProviderList/__tests__/customProviderCreation.test.ts`: full image URLs preview as-is.
