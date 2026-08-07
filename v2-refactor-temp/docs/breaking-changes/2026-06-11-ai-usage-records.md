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

`MessageStats` usage, cost, and measured provider performance are now a
materialized aggregate of those records. Message persistence continues to own
content, status, and end-to-end runtime timing, but no longer creates, updates,
or repairs usage records.

These records are immutable analytics facts, not a financially reconcilable
billing ledger. Provider invoices remain authoritative.

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
- Provider-reported amount-only cost is retained only when the provider
  registry declares its currency (currently OpenRouter/USD); there is no
  default-currency fallback or completion-time lookup.
- Agent sessions choose one capture owner per runtime route. Direct and
  external-CLI routes record each Claude SDK provider step from its stream
  lifecycle using the serving connection's receipt; gateway routes retain
  provider-call records and ignore cumulative SDK usage. Direct/external
  requests emitted without an active turn are retained as stateless records
  with the frozen connection source. Consumed warm processes retain the
  receipt selected when that process actually started. Aborting a multi-step
  turn keeps completed step records but does not create a successful record for
  the current in-flight step.
- Missing request-owned identity remains null/`unknown`; persistence and
  migration never infer provider, model, source, key, or pricing from current
  state.
- Nested AI tool-input repair is a separate `generateText` invocation.
- Image output count is captured after provider success and before local file
  persistence. Restarted polling resolves the exact enabled submit key by its
  persisted non-secret id instead of rotating to another account.
- Image calls without trusted provider cost remain unpriced unless their
  runtime model carries explicit per-image pricing; the current preset/settings
  paths normally do not produce that pricing.
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
- New messages write only `MessageStats.runtimeTiming`; public message create
  DTOs cannot write stats. Usage/cost/provider performance are replaced only
  by the usage-record projector, while runtime persistence can write only the
  runtime timeline.
- Historical scalar message timing is read only when `runtimeTiming` is absent
  and is never converted into a synthetic persisted timeline. Model TPS is
  weighted across only provider steps with measurable output/duration;
  end-to-end throughput includes tool and approval wall time. Direct Agent
  tool duration comes from SDK `PostToolUse`/`PostToolUseFailure`, not chunk
  timing.
- Message details fetch invocation rows lazily through the existing
  `/ai-usage-records` list with paired `messageKind`/`messageId` filters to
  draw the duration distribution. They do not render an unbounded per-step
  detail list.
- Topic duplication copies message content and message-owned timing, but not
  usage/cost/provider-performance facts. The copy therefore does not claim a
  second set of provider invocations.
- Old messages have no `runtimeTiming`; one renderer view model adapts their
  legacy scalar timings and preserves the existing display.
- A crash can still lose a best-effort stateless record between provider
  completion and the SQLite write.
- Legacy model pricing in currencies other than absent/`$` (USD) or `¥`/`￥`
  (CNY) is dropped during migration rather than assigned an unreliable
  currency.

## What the user should do

Nothing. Historical migrated usage and supported new requests appear
automatically in Settings > Usage.

## Notes for release manager

This accompanies the message-stats cost/cache work. `ai_usage_record` is the
only usage/cost/provider-performance fact source; `MessageStats` is its
materialized per-message projection plus separately owned runtime timing.
Records are insert-only and the renderer has read-only access. Aggregate
requests are limited to 366 days and server-ranked top-N groups with an
explicit Other remainder.
