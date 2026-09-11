---
title: Legacy in-app Anthropic OAuth removed
category: removed
severity: breaking
introduced_in_pr: #15088
date: 2026-05-18
---

## What changed

The legacy in-app Anthropic web-OAuth flow has been removed. Anthropic
providers that were configured via that OAuth flow (`auth.kind === 'oauth'`)
are re-seated to api-key mode by the v1→v2 migrator, and the renderer no
longer offers the OAuth toggle for the `anthropic` provider.

## Why this matters to the user

A user who previously signed in to Anthropic through the in-app OAuth
button will find that provider in api-key mode after upgrading, with no
key set — model requests will fail until a key is entered.

## What the user should do

Open Settings → Providers → Anthropic and enter an Anthropic API key.

## Notes for release manager

Pair with `2026-05-18-aws-bedrock-api-key-auth-renamed.md` (same PR,
provider-settings follow-up).
