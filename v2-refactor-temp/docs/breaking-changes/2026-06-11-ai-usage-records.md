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

- `explicit`: the provider service selected this configured key;
- `matched`: a caller override matched a configured key;
- `auth`: provider-level authentication, with its OAuth/IAM/external-CLI
  mechanism retained;
- `unknown`: no trustworthy serving credential identity is available.

## Boundaries

- Normal language, embedding, and image provider config builders return the SDK
  configuration together with a non-secret credential receipt, which request
  construction carries with assistant/source snapshots into the usage event.
- Persistence-only writers without a request-owned receipt use `unknown`; they
  never infer a serving key from current rotation state.
- Nested AI tool-input repair usage is merged into its parent language request.
- Image output count is captured after provider success and before local file
  persistence.
- Rerank is not recorded because the current SDK result exposes neither usage
  nor cost. The operation coverage contract marks it `usage-unavailable`
  instead of inventing a zero-cost row.
- Migrated v1 assistant-message usage is projected once by
  `AiUsageRecordMigrator`. Immutable message author snapshots are preferred,
  partial input/output counters derive total tokens, and historical API-key
  attribution is always `unknown`; current provider state is never used to
  guess an old serving key.
- When runtime capture and message persistence converge, the runtime
  repair-inclusive usage remains authoritative and persistence only fills
  fields it did not observe.
- Explicit zero-cost currency buckets remain visible instead of being treated
  as unpriced data.
- API-key rollups keep `explicit` selection and `matched` overrides separate,
  even when they refer to the same configured key.
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
