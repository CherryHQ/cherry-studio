---
title: AI usage records preserve request usage and cost analytics
category: changed
severity: notice
introduced_in_pr: "#15992"
date: 2026-06-11
---

## What changed

A new `ai_usage_record` fact table stores one immutable, best-effort record per
observable successful provider invocation, including token/image usage, cost,
per-call performance, provider/model/source, and serving-credential snapshots.
Historical v1 assistant messages are represented by explicit
`legacy-aggregate` records with an estimated logical request count.

`MessageStats` usage and cost are now a materialized aggregate of those records.
Message persistence continues to own content, status, and end-to-end message
timings, but no longer creates, updates, or repairs usage records.

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

- Language calls are captured around the actual AI SDK `doStream` /
  `doGenerate`; embedding and image middleware report every actual SDK batch;
  successful rerank calls are recorded even when usage and cost are unavailable.
- Normal language, embedding, image, and rerank request construction freezes a
  non-secret credential receipt together with provider/model/source/pricing
  snapshots before the provider call.
- Agent sessions choose one capture owner per runtime route. Direct and
  external-CLI routes record each Claude SDK assistant request using the
  serving connection's receipt; gateway routes retain provider-call records
  and ignore cumulative SDK usage. Direct/external assistant requests emitted
  without an active turn are retained as stateless records with the frozen
  connection source. Consumed warm processes retain the receipt selected when
  that process actually started.
- Missing request-owned identity remains null/`unknown`; persistence and
  migration never infer provider, model, source, key, or pricing from current
  state.
- Nested AI tool-input repair is a separate `generateText` invocation.
- Image output count is captured after provider success and before local file
  persistence.
- Migrated v1 assistant-message usage is projected once by
  `AiUsageRecordMigrator`. Source identity comes only from the message snapshot,
  request count is estimated from raw blocks, per-call metrics remain null, and
  historical API-key attribution is always `unknown`.
- Record insertion rebuilds message usage/cost projection in the same
  transaction. Record-first and message-first persistence orders converge
  without fallback, reverse lookup, or a mutable upsert.
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

This accompanies the message-stats cost/cache work. `ai_usage_record` is the
only usage/cost fact source; `MessageStats` is its materialized per-message
projection plus separately owned message timings. Records are insert-only and
the renderer has read-only access. Aggregate requests are limited to 366 days
and server-ranked top-N groups with an explicit Other remainder.
