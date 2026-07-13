---
title: Poe reasoning and web search require the Responses API endpoint
category: changed
severity: breaking
introduced_in_pr: #14144
date: 2026-07-13
---

## What changed

Poe is now integrated through the OpenAI Responses API. The per-model
`extra_body` special-casing on the legacy chat-completions path (reasoning
effort / thinking budget / web search) has been removed. Fresh installs
default Poe to the Responses endpoint automatically.

## Why this matters to the user

Users migrating from v1 (and existing v2 pre-release installs) keep Poe on
the old chat-completions endpoint. Plain chat keeps working, but the
reasoning-effort control and the built-in web search toggle silently do
nothing on that endpoint.

## What the user should do

Open Settings → Model Providers → Poe and switch the API endpoint to
`openai-responses`. All features (reasoning control, web search) work
there via the standard pipeline.

## Notes for release manager

Per current Poe docs, web search on chat completions is discontinued
upstream (Responses API only), so the v1-era web-search toggle was already
partially broken regardless of this change. Affected cohorts: v1-migrated
users (migration preserves the v1 endpoint by design) and pre-release v2
installs (preset seeder is insert-only). Consider whether release-time
migration should force-switch Poe's default endpoint instead — see PR
#14144 discussion.
