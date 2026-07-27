# AI Usage Records

`ai_usage_record` is a durable, best-effort analytical read model for AI
request usage, cost, attribution, and performance. It is not an immutable
billing ledger or a payment-system source of truth: writes can be retried,
upserted, or lost in a crash window, and some provider operations do not expose
an honest usage signal.

- Schema: `src/main/data/db/schemas/aiUsageRecord.ts`
- Service: `src/main/data/services/aiUsageRecord/`
- Read-only DataApi:
  - `GET /ai-usage-records`
  - `GET /ai-usage-records/stats`
  - `GET /ai-usage-records/timeline`

The main process owns all writes. Renderer code only queries the read model.

## Why this is separate from `message.stats`

`message.stats` remains the per-message usage snapshot used by chat
persistence. It cannot represent requests that do not create a message, such
as translation, topic naming, embeddings, image generation, API Gateway
traffic, or a temporary chat the user discards.

Usage records also outlive their source objects. The table stores presentation
and credential identity as snapshots and has no foreign keys to messages,
topics, providers, models, assistants, agents, or API keys. Deleting or
renaming those objects does not rewrite historical analytics.

The two stores deliberately converge for persisted chat:

- the live request collector captures provider usage;
- the message persistence hook captures message stats and timing;
- both use the assistant message id as `requestId`, so an upsert enriches one
  record instead of double-counting the request.

Stateless operations use a generated stable request id.

## Capture architecture

```text
Provider key selection
  -> provider config builder
       -> SDK config + non-secret serving credential receipt
  -> request construction + assistant/source snapshot
  -> provider operation
       Agent text step -----------+
       nested tool-input repair --+--> request-scoped usage collector
                                   +--> terminal best-effort record

       direct agent session ---------> final message + connection receipt
       gateway agent session --------> per-provider-call records
       embedding --------------------> direct best-effort record
       image result -----------------> record output count before file persistence

Message / direct agent persistence ---> upsert the same request when possible
V2 migration ------------------------> project historical message stats

                                 ai_usage_record
                                       |
                         bounded read-only DataApi queries
                                       |
                                Usage settings page
```

### Billable operation contract

`BILLABLE_AI_OPERATIONS` and `AI_USAGE_RECORD_OPERATION_COVERAGE` in
`src/main/ai/hooks/billingHook.ts` form the explicit coverage contract.

| Operation | Capture |
| --- | --- |
| `streamText` | Agent step hook plus nested repair collector |
| `generateText` | Agent step hook plus nested repair collector |
| `embedMany` | Direct token-usage capture |
| `generateImage` | Direct provider-output count capture |
| `rerank` | `usage-unavailable` |

Rerank is intentionally absent because the current AI SDK result exposes
neither usage nor provider cost. The architecture does not claim that every AI
request is recorded and does not fabricate a zero-cost rerank row.

The operation list is closed by behavior tests plus a main-process-wide raw
provider import boundary test that fails when a new request owner appears.
Adding a provider-backed operation requires choosing one of the two explicit
states:

- `recorded`, with a defined modality and capture owner; or
- `usage-unavailable`, with a reason.

### Nested tool repair

Tool-input repair performs another provider `generateText` call. Its usage is
reported through `createAiRepair(... onUsage)` into the same request-scoped
collector as the parent Agent steps. The collector merges every step and repair
call, accumulates provider-reported cost per call, then flushes once on finish,
abort, or error.

An observed provider call with explicit zero counters remains observable.
Provider-reported cost is also retained when every token counter is zero.

### Image generation

The synchronous path assigns a request id before calling the provider and
records `result.images.length` immediately after the provider result. Local
base64 validation or FileManager persistence happens afterward, so a paid
generation is not lost merely because local persistence fails.

The async job path uses the stable job id and records the non-empty provider URL
count before download/persistence. Restarted jobs retain the selected credential
provenance in job metadata and the request source in the non-secret job payload.

## Identity snapshots

`ProviderService` owns stored API-key selection. The provider config builder
owns the final serving configuration and must return both the SDK config and a
non-secret credential receipt. This keeps the declaration beside provider
branches that may replace a selected key with OAuth, IAM, CLI authentication,
or no credential.

Key-backed requests carry one of:

```ts
{ attribution: 'explicit' | 'matched', id, label?, masked }
```

Provider-level credentials instead carry the actual non-secret mechanism:

```ts
{ attribution: 'auth', method: 'oauth' | 'external-cli' | 'iam-aws' | 'api-key-aws' | 'iam-gcp' | 'iam-azure' }
```

An unmatched caller override carries `{ attribution: 'unknown' }`; it is never
misrepresented as the configured rotation key. The raw credential remains
inside provider configuration. The receipt and assistant/source snapshot travel
with the request into the usage event, making concurrent multi-key requests
deterministic without storing a secret.

Agent sessions assign one capture owner when their runtime route is materialized:

- direct and external-CLI routes carry the connection's receipt into the final
  assistant-message event;
- API Gateway routes keep the individual provider-call events and suppress the
  cumulative final-message event, avoiding double counting;
- if a prewarmed Claude process is consumed, its stored receipt replaces the
  separately materialized connection receipt because the warm process owns the
  credential that actually serves the request.

Cherry-launched gateway subprocesses send a process-local proof and session id
to the in-process gateway. The gateway validates the proof before attaching the
agent source to provider-call records; arbitrary gateway clients cannot claim an
agent session by supplying only an id.

Writers that do not own request construction cannot infer a credential from
current provider state; a missing receipt is `unknown`. Attribution is explicit:

| Attribution | Meaning |
| --- | --- |
| `explicit` | `ProviderService` selected this configured key for the request |
| `matched` | A caller override matched this configured key |
| `auth` | Provider-level authentication; `authMethod` records the mechanism |
| `unknown` | No trustworthy serving-credential identity is available |

API-key aggregates preserve the complete credential identity:
`providerId + apiKeyId + apiKeyAttribution + authMethod`. Consequently
`explicit` selection and a `matched` override remain separate even when they
refer to the same key, and `auth` mechanisms remain separate from `unknown`
even though both have a null `apiKeyId`. Historical migration always uses
`unknown`; it never guesses an old serving key from current provider state.

## Data model and upsert rules

`requestId` is unique and is the idempotency key. The table stores:

| Group | Fields |
| --- | --- |
| Request identity | `requestId`, `captureSource`, `topicId`, `providerId`, `providerName`, `modelId`, `modality` |
| Source snapshot | `sourceType`, `sourceId`, `sourceName`, `sourceIcon` |
| Credential snapshot | `apiKeyId`, `apiKeyLabel`, `apiKeyMasked`, `apiKeyAttribution`, `authMethod` |
| Usage | input/output/total/reasoning/cache token fields and `imageCount` |
| Cost | `cost`, `costCurrency`, `costSource`, `costBreakdown`, `pricingSnapshot` |
| Performance | `timeFirstTokenMs`, `timeCompletionMs`, `timeThinkingMs` |

Database checks enforce:

- supported modality, attribution, source type, cost source, and currency;
- a cost is either wholly absent or has amount, currency, and source;
- `explicit`/`matched` requires a key id and no auth mechanism;
- `auth` requires an auth mechanism and forbids key identity; `unknown` has neither;
- source metadata is absent together or includes source type and id;
- image rows have a positive `imageCount`; non-image rows have none.

Null means unreported or not applicable. Explicit zero remains an observed
value.

When request capture and persistence converge:

- topic, source, and presentation snapshots do not regress to null;
- runtime collector usage is authoritative; later persistence only fills
  missing usage/timing fields and cannot overwrite repair-inclusive totals;
- runtime credential provenance replaces `unknown`, while persistence never
  rewrites stored provenance from mutable provider state;
- a persisted `messageSnapshot` may replace a current-database source fallback;
- a provider-reported cost is never replaced or completed with a later local
  estimate;
- input/output totals derive `totalTokens` when the provider omits it.

## Cost semantics

Cost is computed and stored in the main process. Main-only helpers live under:

- `src/main/ai/utils/billingCost.ts` for provider blobs and image pricing;
- `src/main/data/services/utils/costComputation.ts` for language pricing;
- `src/main/data/services/utils/costEnrichment.ts` for provider/model lookup.

Provider-reported cost is trusted only for providers with
`apiFeatures.reportsActualCost`. Otherwise current model pricing is snapshotted
at write time.

For language input cost:

- `noCacheTokens` uses the normal input rate;
- cache read/write buckets use their own rates, falling back to input rate;
- when `noCacheTokens` is absent but some cache buckets are present, uncached
  input is `max(0, inputTokens - cacheReadTokens - cacheWriteTokens)`;
- output tokens use the output rate.

The subtraction prevents partial cache details from charging the cached tokens
again at the full input rate.

Legacy pricing symbols map only when the conversion is known:

- absent or `$` -> `USD`;
- `¥` or `￥` -> `CNY`;
- unsupported symbols such as `€` or `£` are logged and the pricing snapshot is
  omitted instead of being mislabeled as USD.

## Historical migration

`AiUsageRecordMigrator` runs after chat/agent migration and before later history
migrators.

- Sources: migrated assistant `message` and `agent_session_message` rows.
- Target: one `ai_usage_record` per usage-bearing source message.
- Pagination: ascending id keyset batches, never `OFFSET`.
- Progress: reported after every batch.
- Cost: existing legacy cost is normalized; compatible model pricing may fill a
  missing cost; otherwise usage remains unpriced.
- Source: immutable `messageSnapshot` author identity wins over current
  assistant/agent joins.
- Key attribution: always `unknown`.
- Validation: candidate, skipped, inserted, and target counts are checked; the
  owned table receives the standard foreign-key self-check.

See
`src/main/data/migration/v2/migrators/README-AiUsageRecordMigrator.md` for the
field-level mapping.

## Query API

All aggregate queries require a bounded inclusive `from`/`to` range. The
maximum range is 366 days. Aggregate result cardinality is bounded by a server
`limit` (default 10, max 50).

### `GET /ai-usage-records`

Cursor-paginated request rows:

- `limit`: default 50, max 200;
- optional `from`, `to`;
- `sortBy`: `createdAt`, `totalTokens`, `cost`, `timeFirstTokenMs`, or
  `tokensPerSecond`;
- `sortOrder`: `asc` or `desc`;
- `costCurrency`: required when `sortBy=cost`.

Cost sorting filters to the requested currency, so unlike currencies never
compete in one order.

### `GET /ai-usage-records/stats`

Required query fields:

- `groupBy`: `provider`, `apiKey`, `model`, or `source`;
- `from`, `to`;
- `metric`: `tokens`, `requests`, or `cost`;
- `limit`;
- `currency` when `metric=cost`.

The response contains:

- `buckets`: server-ranked top-N groups;
- `totals`: full-range totals independent of the limit;
- `other`: full totals minus the returned groups.

Usage/request metrics span every row in the range. Monetary totals include only
the selected currency.

### `GET /ai-usage-records/timeline`

The same bounded range, metric, limit, and conditional currency rules apply.
`groupBy` is optional.

The response contains:

- `buckets`: one total usage bucket per local day when ungrouped, or daily
  buckets for the server-ranked top-N identities plus explicit `isOther`
  remainders when grouped;
- `costTotals`: one full-range total per currency;
- `dailyCosts`: one daily total per currency.

Token/request metrics are never duplicated into per-currency buckets. The
renderer chooses a stable currency and reads its monetary series from
`dailyCosts`. Explicit zero-cost currency rows remain present, so a priced-free
request is distinguishable from an unpriced request.

## Usage page freshness

The Usage page queries 30, 90, or 365-day windows. It never requests an
unbounded all-time aggregate.

After a successful record upsert, `AiUsageRecordService` publishes DataApi
changes for list membership/projection, stats, and timeline. The mounted page
subscribes to those read models and debounces a batched revalidation by 300 ms;
the request list resets to its first cursor before revalidating. This is
required because global SWR focus/reconnect revalidation is intentionally
disabled for DataApi IPC queries.

## Known limitations

- Rerank is not recorded until its provider result exposes usage or cost.
- Persistence-only writers without a request-owned receipt record `unknown`.
- Historical rows cannot identify the serving key.
- A crash between a stateless request finishing and its best-effort write can
  lose the record.
- Stored local cost is an estimate based on the pricing snapshot; provider
  invoices remain authoritative.
- Cost totals are displayed per currency and are never converted or summed
  across currencies.

## File map

| File | Role |
| --- | --- |
| `src/shared/data/types/aiUsageRecord.ts` | Cross-process entity types |
| `src/shared/data/api/schemas/aiUsageRecord.ts` | Bounded read API contracts |
| `src/main/data/db/schemas/aiUsageRecord.ts` | SQLite schema and constraints |
| `src/main/data/services/aiUsageRecord/` | Write owner, queries, cursors, mappers, snapshots |
| `src/main/ai/hooks/billingHook.ts` | Operation coverage and request collector |
| `src/main/ai/tools/adapters/aiSdk/repair.ts` | Nested repair usage callback |
| `src/main/data/migration/v2/migrators/AiUsageRecordMigrator.ts` | Historical projection |
| `src/renderer/pages/settings/UsageSettings/index.ts` | Page export |
| `src/renderer/pages/settings/UsageSettings/UsageSettings.tsx` | Page composition |
| `src/renderer/pages/settings/UsageSettings/useUsageData.ts` | Queries, pagination, and freshness subscription |
| `src/renderer/pages/settings/UsageSettings/usageAnalytics.ts` | Date, metric, and chart-series utilities |
| `src/renderer/pages/settings/UsageSettings/UsageSettingsPrimitives.tsx` | Private presentation components |
