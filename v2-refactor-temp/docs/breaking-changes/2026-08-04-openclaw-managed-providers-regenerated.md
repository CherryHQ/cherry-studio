---
title: OpenClaw providers managed by Cherry Studio are regenerated
category: changed
severity: breaking
introduced_in_pr: "#17804"
date: 2026-08-04
---

## What changed

When Cherry Studio syncs the selected provider to OpenClaw, it now removes inactive generated providers whose ids start with `cherry-` and rebuilds the selected provider using fields supported by the installed OpenClaw version. Existing supported values on the selected provider are preserved, while Cherry Studio refreshes its identity, endpoint, credentials, and model names. Providers and other configuration outside the `cherry-*` namespace remain user-managed and are preserved.

## Why this matters to the user

Inactive previously synced providers and fields no longer supported by the installed OpenClaw schema are removed from the `cherry-*` namespace. Supported manual model and header values on the currently selected provider remain authoritative. Cherry Studio also validates the resulting configuration before replacing the current file or starting the gateway, so unsupported user-managed OpenClaw settings now stop the operation with an error instead of reaching the gateway startup.

## What the user should do

Keep custom OpenClaw providers outside the `cherry-*` namespace. Manual edits to fields supported by the installed OpenClaw version can remain on the currently selected Cherry-managed provider, but inactive Cherry-managed providers and unsupported fields will be removed. If validation reports an unsupported user-managed setting, such as `tools.web.fetch.ssrfPolicy`, remove or update that setting according to the installed OpenClaw version and retry. OpenClaw installations without structured `config schema` and `config validate --json` support must be upgraded before Cherry Studio can sync or launch them.

## Notes for release manager

Qualify the earlier OpenClaw settings-page migration notice: valid user-managed configuration and supported edits on the selected Cherry-managed provider remain preserved, but inactive Cherry-managed providers are removed and invalid user-managed settings require correction.
