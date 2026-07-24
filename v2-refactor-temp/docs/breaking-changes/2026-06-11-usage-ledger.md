---
title: Durable usage ledger records per-message token usage and cost
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-06-11
---

## What changed

A new `usage_ledger` table durably records token usage and cost per assistant
message, attributed to the provider, model, and (best-effort) the API key that
served the request. Ledger rows are snapshots: they survive deletion of the
message, topic, provider, and API key they describe. Read-only DataApi
endpoints expose entries (`GET /usage-ledger/entries`) and rollups grouped by
provider / API key / model (`GET /usage-ledger/stats`).

## Why this matters to the user

Spend tracking no longer disappears with conversation cleanup: deleting a
topic or an API key keeps its historical usage/cost. Per-key spend becomes
queryable (which key produced which cost), with an explicit confidence label —
`exact` (single enabled key), `rotation` (round-robin pointer, probable),
`auth` (provider-level credential), or `none`.

Known boundaries:
- Migrated v1 history IS backfilled once, at migration time (the one-shot
  `UsageLedgerMigrator` — not a read-time pass): rows carry the message's
  original timestamp; providers with exactly one configured key are attributed
  to it with the explicit `backfill` confidence, everything else is `none` (the
  serving key was never recorded).
- Chat ledger rows lost to a crash/quit are NOT self-healed on read: the live
  write is fire-and-forget and `list()`/`stats()` are pure reads with no
  backfill pass, so a lost row stays lost. Stateless rows
  (gateway/translate/rename) cannot be re-derived either.
- A billing funnel at the AI request chokepoint records every aiSdk request,
  including API Gateway traffic, translation, topic auto-rename, and
  ephemeral temporary chats (real spend even when the chat is discarded).
- With multiple enabled keys and concurrent requests to the same provider,
  `rotation` attribution can name the wrong key; exact attribution would
  require threading the chosen key through the request pipeline.

## What the user should do

Nothing — automatic. (No UI ships with this change yet; data accumulates for
an upcoming usage dashboard.)

## Notes for release manager

Companion of the message-stats cost engine (see
2026-06-11-message-stats-cost-and-cache.md). The ledger is written from a
billing funnel in the AI pipeline (`AiService.billingHookPart`, plus the
`embedMany`/`generateImage` call sites) and from post-commit data-layer hooks
(`MessageService.update`, `TemporaryChatService.persist`,
`AgentSessionMessageService.saveMessage`), all converging by `messageId`.
