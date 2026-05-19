---
title: AiHubMix Ideogram download failures no longer show the "proxy required" hint
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-20
---

## What changed

AiHubMix painting now runs through the unified AI-SDK image model. Ideogram
models (V_1/V_2/V_2A/V_3) still return image URLs that are fetched and saved by
the patched `ai` SDK instead of the paintings download helper. When that fetch
fails, the user sees the generic image-generation failure message rather than
the previous "图片需要代理才能下载" (proxy required) toast.

## Why this matters to the user

Users on networks that cannot reach Ideogram's CDN directly (e.g. mainland
China without a proxy) previously got a specific hint telling them a proxy is
needed. After this change a failed Ideogram download surfaces only as a generic
"generation failed" message, so the cause is less obvious. Successful
generation (including via a working proxy) is unaffected.

## What the user should do

Nothing — automatic. If Ideogram images fail to download, configure a network
proxy as before; the failure is the same, only the diagnostic wording is less
specific.

## Notes for release manager

Only the error-path toast wording regressed; image generation/download itself
is unchanged. A deeper fix (re-introducing the proxy-aware toast for the
SDK-routed download path) was deliberately deferred because it would require
the composed image model to bypass the patched `ai` SDK URL download — out of
scope for the bespoke→unified cutover. Revisit if user reports indicate the
lost hint causes confusion.
