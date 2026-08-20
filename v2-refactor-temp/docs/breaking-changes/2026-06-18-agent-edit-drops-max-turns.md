---
title: Agents no longer have a max-turns limit
category: data-migration
severity: breaking
introduced_in_pr: #16187
date: 2026-06-18
---

## What changed

The per-agent `max_turns` configuration is retired. The v2 edit dialog never
surfaced it, and the runtime no longer reads it either — an agent now runs until
it finishes, is interrupted, or hits a limit it does not own (context
compaction, provider errors). The built-in Cherry Assistant / Cherry Support
agents no longer ship a turn cap.

## Why this matters to the user

An agent that had a `max_turns` limit set (e.g. carried over from v1 or set
through an earlier build) no longer stops after that many request/response
cycles. Long autonomous runs that used to end with "reached maximum number of
turns" now continue. There is no field in the v2 UI to view or restore the cap.

## What the user should do

Nothing — automatic. Anyone who still wants a hard turn cap can set the
`CLAUDE_CODE_MAX_TURNS` environment variable in the agent's advanced settings.

## Notes for release manager

- Stored `max_turns` values stay in the configuration JSON blob (the `.loose()`
  schema keeps unknown extras); they are simply never read again.
- Behavior is inherited verbatim from `feat/chat-page` (added in
  `5383513090 feat(agent): enhance agent configuration with permission mode and
  soul mode options`); the durable change belongs upstream there as well.
