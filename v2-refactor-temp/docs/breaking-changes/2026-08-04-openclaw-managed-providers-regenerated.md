---
title: OpenClaw providers managed by Cherry Studio are regenerated
category: changed
severity: breaking
introduced_in_pr: "#17804"
date: 2026-08-04
---

## What changed

When Cherry Studio syncs the selected provider to OpenClaw, it now removes previously generated providers whose ids start with `cherry-` and rebuilds the selected provider using fields supported by the installed OpenClaw version. Providers and other configuration outside the `cherry-*` namespace remain user-managed and are preserved.

## Why this matters to the user

Manual edits and previously synced providers under the `cherry-*` namespace are no longer preserved across a provider sync. Cherry Studio also validates the resulting configuration before replacing the current file or starting the gateway, so unsupported user-managed OpenClaw settings now stop the operation with an error instead of reaching the gateway startup.

## What the user should do

Keep custom OpenClaw providers outside the `cherry-*` namespace and do not rely on manual edits to Cherry-managed providers. If validation reports an unsupported user-managed setting, such as `tools.web.fetch.ssrfPolicy`, remove or update that setting according to the installed OpenClaw version and retry.

## Notes for release manager

Qualify the earlier OpenClaw settings-page migration notice: valid user-managed configuration remains preserved, but Cherry-managed providers are regenerated and invalid user-managed settings require correction.
