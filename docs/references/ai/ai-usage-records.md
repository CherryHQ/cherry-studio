# AI Usage Records

`ai_usage_record` is the immutable, best-effort fact source for observable AI
provider invocations. One successful provider/model invocation produces one
`invocation` row. During v1 migration, one usage-bearing historical assistant
message produces one `legacy-aggregate` row whose `requestCount` is estimated
from its block sequence.

The records drive two read models:

```text
provider/model/credential selection
              |
              v
   frozen capture context
              |
              v
      provider invocation
        | usage + cost
        | per-call metrics
        v
      ai_usage_record
        |             |
        |             +--> read-only DataApi --> Settings > Usage
        |
        +--> SUM by messageKind/messageId --> MessageStats usage/cost
```

This is analytics, not an invoice ledger. Writes are best effort and SDK retry
attempts that are not observable to Cherry Studio are not counted. Provider
invoices remain authoritative.

- Schema: `src/main/data/db/schemas/aiUsageRecord.ts`
- Service: `src/main/data/services/aiUsageRecord/`
- Capture coverage: `src/main/ai/hooks/billingHook.ts`
- Read-only DataApi:
  - `GET /ai-usage-records`
  - `GET /ai-usage-records/stats`
  - `GET /ai-usage-records/timeline`

## Invariants and ownership

- Usage and cost have one fact source: `ai_usage_record`.
- Records are insert-only. A duplicate `requestId` is ignored; a different
  payload for the same id logs an integrity warning and does not mutate the
  first row.
- Message persistence owns content, status, and message-level end-to-end
  timings. It never creates or repairs usage records.
- `MessageStats` usage, cost, and request counts are a materialized aggregate
  of records linked by `messageKind/messageId`.
- Record timings describe one provider invocation. Message timings describe
  the whole assistant message. Neither is projected into the other.
- Provider, model, source, pricing, and serving credential identity are frozen
  before the provider call. Completion never consults current configuration or
  rotation state.
- Every runtime route has one capture owner. Gateway-backed Agent traffic uses
  provider-call capture; direct/external Agent traffic uses Agent SDK messages.

There is deliberately no operation table or persistence compensation layer.

## Billable operation contract

`BILLABLE_AI_OPERATIONS` and `AI_USAGE_RECORD_OPERATION_COVERAGE` form the
closed capture contract:

| Operation | Capture owner | Record behavior |
| --- | --- | --- |
| `streamText` | language model middleware | one row per successful `doStream`, written from its `finish` usage |
| `generateText` | language model middleware | one row per successful `doGenerate` |
| `embedMany` | aiCore embedding model middleware | one row per actual `doEmbed` batch |
| `generateImage` | aiCore image model middleware or custom transport owner | one row per actual provider generation |
| `rerank` | aiCore runtime handler | one row after a successful result; usage and cost may be null |

AI SDK batching is observed below `embedMany` and `generateImage`, so each real
provider call is counted separately. Tool-input repair explicitly reuses the
language usage middleware, making its `generateText` a separate invocation.

Failed calls do not produce successful records. A streaming call is recorded
only after its finish chunk supplies final usage; previously completed calls
remain recorded if a later step fails.

Custom async image jobs record after the vendor reports success and before
local download/FileManager persistence. Submit plus polling is one generation
invocation, not one invocation per poll. The stable job id makes restart
delivery idempotent, and a successful response with zero images is retained
with `imageCount = 0` even though the job is then failed as unusable.

## Immutable capture context

Provider/model/key selection constructs `AiUsageCaptureContext` immediately
before invocation:

```ts
interface AiUsageCaptureContext {
  providerId: string
  providerName: string | null
  modelId: string
  modelName: string | null
  pricingSnapshot: AiUsagePricingSnapshot | null
  trustProviderReportedCost: boolean
  credentialReceipt: AiUsageCredentialReceipt
  source: SourceSnapshot | null
  messageRef: {
    kind: 'chat' | 'agent-session'
    id: string
  } | null
}
```

Construction clones and recursively freezes every nested value. Stateless
operations explicitly carry a null message/source where appropriate.

The credential receipt contains no secret:

```ts
type AiUsageCredentialReceipt =
  | { attribution: 'explicit' | 'matched'; id: string; label?: string; masked: string }
  | { attribution: 'auth'; method: AiUsageRecordAuthMethod }
  | { attribution: 'unknown' }
```

`explicit` and `matched` require the selected configured key identity. `auth`
identifies provider-level OAuth/CLI/IAM authentication and cannot carry a key.
`unknown` carries neither. An unmatched override is `unknown`; it is never
attributed to a rotation pointer after the fact.

If a prewarmed Claude process is consumed, the connection uses that process's
stored receipt because it selected the credential that actually serves the
request.

## Record model

The table stores:

| Group | Fields |
| --- | --- |
| Identity | `id`, unique `requestId`, `recordKind`, `requestCount` |
| Optional message link | `messageKind`, `messageId` |
| Provider/model snapshot | `providerId`, `providerName`, `modelId`, `modelName` |
| Source snapshot | `sourceType`, `sourceId`, `sourceName`, `sourceIcon` |
| Operation | `modality` |
| Credential snapshot | `apiKeyId`, `apiKeyLabel`, `apiKeyMasked`, `apiKeyAttribution`, `authMethod` |
| Usage | input/output/total/reasoning/cache token fields, `imageCount` |
| Cost | `cost`, `costCurrency`, `costSource`, `costBreakdown`, `pricingSnapshot` |
| Per-call performance | `timeFirstTokenMs`, `timeCompletionMs`, `timeThinkingMs` |
| Completion time | `createdAt` |

There are no foreign keys. Renaming or deleting a provider, model, source,
message, or configured key does not rewrite history. There is no `topicId`,
`captureSource`, or `updatedAt`.

Database checks enforce the kind/message/key/cost tuples, nonnegative finite
cost, nonnegative integer counters and timings, and image-only `imageCount`.
`invocation` rows have `requestCount = 1` and non-null provider/model identity.
`legacy-aggregate` rows have a message link and may lack provider/model
identity.

Null means unavailable or not applicable. Explicit zero remains observed data.

Request id namespaces are:

- language middleware: `ai-sdk:<providerId>:<uuid>`
- aiCore provider handlers: `ai-core:<modality>:<uuid>`
- Agent SDK: `claude-agent:<assistant-message-id>`
- custom async image: `custom-image:<job-id>`
- migration: `legacy:<message-kind>:<message-id>`

## Per-invocation metrics

Language metrics are measured around the actual model middleware:

- non-streaming `doGenerate`: completion duration only;
- streaming `doStream`: completion duration, first semantic output, and
  reasoning duration;
- the stream wrapper forwards every original chunk without reordering,
  replacing, or swallowing it.

Tokens per second are not stored. The list query and renderer derive:

```text
outputTokens / (timeCompletionMs - timeFirstTokenMs)
```

If TTFT is absent or is not before completion, the denominator is
`timeCompletionMs`. Missing/non-positive output or duration produces no value.

Embedding, image, and rerank completion time is measured by the owner around
the actual provider call. Claude Agent SDK assistant messages do not expose
reliable per-request timestamps, so direct/external Agent record metrics remain
null. Gateway-backed Agent calls pass through the language middleware and have
normal per-call metrics. Legacy record metrics are also null; their historical
message-level timings stay in `MessageStats`.

## Cost semantics

The capture context contains this immutable pricing snapshot:

```ts
interface AiUsagePricingSnapshot {
  currency: Currency
  inputPerMillionTokens?: number
  outputPerMillionTokens?: number
  cacheReadPerMillionTokens?: number
  cacheWritePerMillionTokens?: number
  perImage?: { price: number; unit: 'image' | 'pixel' }
  capturedAt: string
}
```

Provider-reported cost is accepted only when the provider declares
`reportsActualCost` and the cost includes a known currency. Otherwise the
frozen snapshot is used.

Computed language cost is emitted only when every non-zero usage bucket can be
priced. Cache read/write use their own rates or the input rate, and uncached
input is derived by subtracting cache buckets when necessary so input is not
charged twice. Pixel pricing stays unpriced without a reliable pixel count.
Provider cost breakdown is saved only when complete and equal to the reported
total.

Costs are never converted or summed across currencies.

## MessageStats projection

For each linked message, the service rebuilds usage/cost fields in the same
SQLite transaction as record insertion:

- token fields sum per record; each row uses
  `totalTokens ?? inputTokens + outputTokens`;
- `requestCount = SUM(record.requestCount)`;
- `estimatedRequestCount` sums only legacy rows;
- `unpricedRequestCount` sums logical requests whose row has null cost;
- costs are grouped by currency and retain provider/computed request counts;
- explicit zero-cost rows remain priced;
- record timings are not aggregated.

The projector replaces only usage/cost/request fields and preserves existing
message timing. Message finalization performs the inverse ownership merge:
content/status/timing are updated and the current record projection is
preserved or rebuilt. Therefore record-first and message-first write order
converge to the same `MessageStats`.

Temporary message append reads the current projection. Promotion only rebuilds
that projection; it does not create a record. Agent message upsert follows the
same rule.

After commit, the service publishes changes for all three usage endpoints and
for any affected chat/agent message read model. A write failure is logged and
never changes the AI result.

## Agent runtime ownership

### Direct and external CLI

The connection carries `{ owner: 'agent-sdk', credentialReceipt, frozenModels }`.
Each Claude SDK assistant message supplies provider request id, actual nested
model, and usage:

- consecutive updates with the same id merge by maximum field value;
- a new id, steer boundary, result/error, query close, or connection close
  flushes the pending invocation;
- a flushed id is immutable; a late repeat logs an anomaly and is ignored;
- the driver freezes message association when the SDK assistant event arrives:
  an active adapter means the current turn, while no adapter means stateless;
- the host resolves current-turn events to the active assistant message.
  Stateless events keep `messageRef: null` and the connection's frozen source;
- primary/plan/small nested models resolve independently against the frozen
  model map;
- result-level `modelUsage`, duration, and total cost are reconciliation data,
  not record inputs.

The driver flushes pending usage before emitting a steer boundary, so the old
provider call attaches to the pre-steer message and the next call attaches to
the continuation.

### Gateway-backed Agent

The connection carries `{ owner: 'provider-calls' }`; SDK usage events are
ignored. Trusted in-process gateway context supplies the active assistant
message id and frozen source to the normal AiService language middleware.
After a steer, the next gateway request sees the new active message. If no
active turn can be resolved, the provider invocation is still recorded as
stateless and no association is guessed.

## Historical migration

`AiUsageRecordMigrator` runs after chat and agent message migration.

- It reads only migrated message rows; it does not join current provider,
  model, assistant, or agent configuration.
- Each usage-bearing assistant message becomes one `legacy-aggregate`.
- `ChatMigrator` and `AgentsMigrator` estimate request count from raw blocks
  and persist it in the migrated `MessageStats`, so resume does not rely on an
  in-memory map.
- The estimate starts at one and adds one for each consecutive/parallel tool
  group followed by model output. Citation/file/source blocks do not split the
  group, and a terminal tool group adds nothing.
- Provider/model may remain unknown. Source comes only from
  `messageSnapshot`. Credential attribution is always `unknown`.
- Existing v1 cost is retained according to its stored semantics. Missing cost
  is never recomputed from current pricing.
- Legacy invocation metrics remain null; historical message timings are
  preserved while usage/cost are rebuilt from the inserted record.
- Stable request ids, keyset batches, progress reporting, rollback, and
  row-by-row retry keep migration idempotent and resumable.

See
`src/main/data/migration/v2/migrators/README-AiUsageRecordMigrator.md` for the
field mapping.

## Query API and freshness

`GET /ai-usage-records` is keyset-paginated (`limit` default 50, max 200) and
sorts by `createdAt`, `totalTokens`, `cost`, `timeFirstTokenMs`, or
`tokensPerSecond`. Cost sort requires and filters to one currency.

Stats and timeline queries require an inclusive range of at most 366 days and
server-limit top-N groups. `recordCount` counts rows; `requestCount` counts
logical calls. Request ranking uses logical request count. Grouped timeline
returns explicit Other buckets; monetary series stay separated by currency.

The Usage page subscribes to the three DataApi change notifications and
debounces revalidation by 300 ms. This keeps an open page fresh even though
global SWR focus/reconnect revalidation is disabled.

## Known limitations

- A crash after a provider succeeds but before the best-effort SQLite insert
  can lose a record.
- Provider-internal retries invisible to Cherry Studio are not separate calls.
- Direct Claude Agent SDK and legacy rows have no honest per-call latency.
- Rerank is counted but may have null usage and cost.
- Historical serving keys cannot be reconstructed and remain `unknown`.
- Estimated local cost is not an invoice, and currencies are not converted.

## File map

| File | Role |
| --- | --- |
| `src/shared/data/types/aiUsageRecord.ts` | Entity and snapshot schemas |
| `src/shared/data/api/schemas/aiUsageRecord.ts` | Bounded read contracts |
| `src/main/data/db/schemas/aiUsageRecord.ts` | SQLite table and constraints |
| `src/main/data/services/aiUsageRecord/` | Insert owner, projection, queries, cursors, snapshots |
| `src/main/ai/hooks/billingHook.ts` | Language middleware and operation coverage |
| `packages/aiCore/src/core/runtime/` | Embedding/image/rerank provider-call events |
| `src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts` | Direct Agent SDK capture |
| `src/main/data/migration/v2/migrators/AiUsageRecordMigrator.ts` | v1 aggregate migration |
| `src/renderer/pages/settings/UsageSettings/` | Usage read model consumers |
