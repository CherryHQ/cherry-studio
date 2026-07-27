---
title: AI usage records preserve request usage and cost analytics
category: changed
severity: notice
introduced_in_pr: "#15992"
date: 2026-06-11
---

## What changed

A new `ai_usage_record` read model stores best-effort per-request token, image,
cost, performance, provider, model, source, and credential attribution
snapshots. The Usage page reads paginated requests, bounded top-N rollups, and
bounded daily timelines through read-only DataApi endpoints.

These records are durable analytics, not an immutable or financially
reconcilable billing ledger. Provider invoices remain authoritative.

## Why this matters to the user

Usage analytics no longer disappear when a conversation, provider, assistant,
or API key is deleted. New provider requests appear on an already-open Usage
page through DataApi change notifications.

Costs stay separated by currency. Cost sorting and cost-ranked rollups require
an explicit currency; the UI does not compare, convert, or sum CNY and USD.

Credential attribution shows its confidence:

- `exact`: the request carried the selected key identity;
- `rotation`: a compatibility writer used current rotation state;
- `auth`: provider-level authentication such as OAuth or IAM;
- `none`: no serving credential could be determined.

## Boundaries

- Normal language, embedding, and image request construction carries the
  selected non-secret key snapshot and assistant/source snapshot into the usage
  event.
- Nested AI tool-input repair usage is merged into its parent language request.
- Image output count is captured after provider success and before local file
  persistence.
- Rerank is not recorded because the current SDK result exposes neither usage
  nor cost. The operation coverage contract marks it `usage-unavailable`
  instead of inventing a zero-cost row.
- Migrated v1 assistant-message usage is projected once by
  `AiUsageRecordMigrator`. Historical API-key attribution is always `none`;
  current rotation state is never used to guess an old serving key.
- A crash can still lose a best-effort stateless record between provider
  completion and the SQLite write.

## What the user should do

Nothing. Historical migrated usage and supported new requests appear
automatically in Settings > Usage.

## Notes for release manager

This accompanies the message-stats cost/cache work. Main-process request
capture and post-commit message hooks converge by request id; the renderer has
read-only access. Aggregate requests are limited to 366 days and server-ranked
top-N groups with an explicit Other remainder.
