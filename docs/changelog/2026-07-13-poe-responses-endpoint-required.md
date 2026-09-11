---
title: Poe defaults to the OpenAI Responses API endpoint
category: changed
severity: notice
introduced_in_pr: '#14144'
date: 2026-07-13
---

## What changed

Poe now serves chat through the OpenAI Responses API by default (Poe supports
it natively at `api.poe.com/v1`). Provider rows inherit the registry default,
so fresh installs and existing installs alike move to the Responses endpoint
unless the user has explicitly picked one. The legacy chat-completions endpoint
remains available and keeps its per-model reasoning contracts and web search.
Official Claude bots are unaffected by the default: they are pinned to Poe's
Anthropic-compatible endpoint (`anthropic-messages`) at the model level.

## Why this matters to the user

On the Responses endpoint, reasoning-effort control works for all bots through
the standard OpenAI pipeline. Built-in web search remains available for the
models Poe marks as supporting it. On chat-completions, reasoning only worked
for model families with audited parameter contracts, and unknown/community
bots stayed fail-closed. Users who never changed Poe's endpoint will see their
requests move to `/v1/responses` after upgrading.

## What the user should do

Nothing — automatic. To stay on chat-completions, open Settings → Model
Providers → Poe and select `openai-chat-completions` explicitly; an explicit
choice always wins over the registry default.

## Notes for release manager

Endpoint inheritance is by design (sparse provider rows, #17096): seeded and
v1-migrated rows keep a NULL default endpoint and follow the current registry
preset, so this switch reaches existing v2 installs and v1-migrated users —
not only fresh installs. Pinning legacy rows to the old endpoint was
considered and rejected: it fights the sparse-row delegation design and the
Responses path is the better default for every bot family.
