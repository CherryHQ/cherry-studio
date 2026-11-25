# Agent Note: Authenticate same-origin provider image downloads

Status: implemented

English | [中文](2026-11-24-provider-image-download-auth.zh.md)

## Problem

In [#25250](https://github.com/CherryHQ/cherry-studio/issues/25250), an OpenAI-compatible provider returns an image URL instead of `b64_json`. The download starts without explicitly sending the provider's API key, so image hosting that requires provider authentication returns HTTP 401. The AI SDK discards the failed image download, and users see a generic “No image generated” error rather than a download failure.

## Decision

For OpenAI-compatible image generation, send the API key actually used by the generation request only when the download target's origin matches the resolved provider endpoint's origin. Use `credentials: 'omit'` and manual redirects, validate every hop with `sanitizeRemoteUrl`, and retain the limit of 20 redirects. Follow Location only for HTTP 301/302/303/307/308; return all other responses, including 401/403 with Location, without following. A cross-origin redirect permanently removes the Bearer token from subsequent hops, including a return to the provider's origin.

When download failure leaves no generated images, use the existing `paintings.image_download_failed` message, appending the download host and HTTP status when available. Do not expose the API key or response body. Bind cancellation to the successful response stream with `addAbortSignal` and destroy the stream on an incoming `aborted` event, so body reading terminates. Cancellation does not become a download-failure error or persist an image.

## Alternatives considered

- Send the key with every image download: this would disclose provider credentials to third-party CDNs.
- Pass `configuredApiHost` to allow private-network downloads: this changes the scope of the existing security policy and needs separate work.
- Rely only on `b64_json`: provider behavior is outside the client's control. The OpenAI-compatible SDK requests this format by default, but some model prefixes omit the field and explicit configuration can override it.

## Consequences

- Same-origin image URLs from local or LAN providers remain blocked by the SSRF guard, even when the configured endpoint matches.
- Custom transport job paths, including ppio, dashscope, and modelscope, still download without explicitly sending provider credentials; authentication there needs separate work.
- If multiple images fail, the error retains only one host and HTTP-status detail.

## Verification

- Regression — After adding the redirect-status guard and one regression test, `node node_modules/vitest/vitest.mjs run --project main src/main/ai/__tests__/AiService.test.ts` reported `Test Files 1 passed (1)` / `Tests 130 passed (130)`; `node node_modules/vitest/vitest.mjs run --project main src/main/utils/__tests__/downloadAsBase64.test.ts` reported `Test Files 1 passed (1)` / `Tests 9 passed (9)`. The new test failed before the guard and passed after it. It proves that HTTP 401 with Location issues no second request, reports `HTTP 401`, and persists no image; before the guard, it instead returned a persisted SVG login image.
- Regression — `pnpm run typecheck` (the CI entry, equivalent to `pnpm check --all --group types`) passed with exit code 0.
- Regression — Existing, unrelated issue: direct `tsc -p tsconfig.node.json --composite false` reports TS2322 in unchanged `src/main/ai/agentSession/AgentSessionRuntimeService.ts:1308`; the same error reproduces in a checkout with the two product files restored to the branch point. This is a pre-existing issue outside this PR's scope.
- Regression — `npx oxlint --deny-warnings src/main/utils/downloadAsBase64.ts src/main/ai/AiService.ts src/main/ai/__tests__/AiService.test.ts tests/main.setup.ts` passed; `npx oxfmt --check src/main/utils/downloadAsBase64.ts src/main/ai/AiService.ts src/main/ai/__tests__/AiService.test.ts tests/main.setup.ts` passed for all 4 files.
- Regression — For the redirect-status guard, `npx oxlint --deny-warnings src/main/utils/downloadAsBase64.ts src/main/ai/__tests__/AiService.test.ts` passed; `npx oxfmt --check src/main/utils/downloadAsBase64.ts src/main/ai/__tests__/AiService.test.ts` passed for both files.
- Regression — A standalone Electron 45.2.2 probe against a loopback server confirmed anonymous GET returns 401 on a key-protected route, `Authorization: Bearer` returns 200, `redirect: 'manual'` emits only a 302 event without following, and abort during body reading settles in about 1ms with no uncaught error.
