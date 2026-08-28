---
title: Poe defaults to the OpenAI Responses API endpoint
category: changed
severity: notice
introduced_in_pr: #14144
date: 2026-07-13
---

## What changed

Poe now serves chat through the OpenAI Responses API by default (Poe supports
it natively at `api.poe.com/v1`). Fresh installs get the Responses endpoint;
the legacy chat-completions endpoint remains available as a fallback and keeps
its per-model reasoning contracts (GPT, Gemini, Claude bots) and web search.

## Why this matters to the user

Users migrating from v1 (and existing v2 pre-release installs) keep Poe on the
chat-completions endpoint, where reasoning control only works for the model
families with audited parameter contracts and unknown/community bots stay
fail-closed. On the Responses endpoint, reasoning-effort control and built-in
web search work for all bots via the standard OpenAI pipeline.

## What the user should do

Nothing — automatic; existing behavior is unchanged. Optionally open
Settings → Model Providers → Poe and switch the API endpoint to
`openai-responses` to get reasoning control on bots without a chat-endpoint
contract.

## Notes for release manager

Affected cohorts: v1-migrated users (migration preserves the v1 endpoint by
design) and pre-release v2 installs (preset seeder is insert-only) — both stay
on chat-completions until they switch manually. Consider whether release-time
migration should force-switch Poe's default endpoint instead — see PR #14144
discussion.
