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
                                      and providerPerformance

tool execution / approval lifecycle
              |
              +--> MessageStats.runtimeTiming

records + runtimeTiming --> message performance view model
```

This is analytics, not an invoice ledger. Writes are best effort and SDK retry
attempts that are not observable to Cherry Studio are not counted. Provider
invoices remain authoritative.

- Schema: `src/main/data/db/schemas/aiUsageRecord.ts`
- Service and capture contract: `src/main/data/services/AiUsageRecordService.ts`
- Capture factories: `src/main/ai/utils/usageCapture.ts`
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
- `MessageStats` usage, cost, request counts, and `providerPerformance` are a
  materialized aggregate of records linked by `messageKind/messageId`.
- `MessageStats.runtimeTiming` is message-owned. It records tool execution and
  approval waits against one epoch-based message clock; it is never projected
  into a usage record.
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
When a new-format persisted `taskId` is resumed, the transport re-reads the
exact enabled submit key by the non-secret key id in the frozen capture
context. It never rotates to another account while polling the existing remote
task. Older queued jobs without a capture context remain unattributed and can
only use current configuration. If no `taskId` exists, recovery performs a new
selection, capture, timer, and submit.

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
  reportedCostCurrency: Currency | null
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
the actual provider call. Direct/external Agent calls use the SDK's per-step
`ttft_ms` plus the monotonic `message_start` to terminal delta/stop interval;
steps without `ttft_ms` keep TTFT and completion null. Gateway-backed Agent
calls pass through the language middleware and have normal per-call metrics.
Legacy record metrics are also null; their historical message-level timings
stay in `MessageStats`.

## Cost semantics

The capture context contains this immutable pricing snapshot:

```ts
interface AiUsagePricingSnapshot {
  currency: Currency
  inputPerMillionTokens?: number
  outputPerMillionTokens?: number
  cacheReadPerMillionTokens?: number
  cacheWritePerMillionTokens?: number
  inputTokenTiers?: Array<{
    minInputTokens: number
    inputPerMillionTokens?: number
    outputPerMillionTokens?: number
    cacheReadPerMillionTokens?: number
    cacheWritePerMillionTokens?: number
  }>
  perImage?: { price: number; unit: 'image' | 'pixel' }
  capturedAt: string
}
```

Provider-reported cost is accepted only when the provider declares
`reportsActualCost` and the request-time context has a known currency. A wire
payload currency is authoritative; an amount-only payload is accepted only
when the provider registry explicitly declares `reportedCostCurrency`, which
is frozen into the context before the call. There is no default-currency
fallback or completion-time provider lookup. Otherwise the frozen pricing
snapshot is used.

Computed language cost is emitted only when every non-zero usage bucket can be
priced. Cache read/write use their own rates or the input rate, and uncached
input is derived by subtracting cache buckets when necessary so input is not
charged twice. When input-token pricing tiers are configured, the invocation's
all-in input token count selects the tier with the greatest
`minInputTokens` that does not exceed that count. That tier prices the whole
invocation; tiers are not progressive. A count exactly on a boundary enters
the new tier. If the input count is unavailable, tiered language cost remains
unpriced rather than assuming the base tier. Per-image pricing is used only
when a runtime model actually
supplies `pricing.perImage`; current preset/settings producers normally do not,
so image calls without provider-reported cost remain unpriced. Pixel pricing
also stays unpriced without a reliable pixel count.
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
- records that have output usage and a usable generation duration contribute
  to `providerPerformance.measuredOutputTokens` and
  `providerPerformance.generationDurationMs`; unmeasured records contribute to
  usage but not to either performance total;
- raw record timings are not copied into `MessageStats`.

The projector replaces only usage/cost/request/provider-performance fields and
preserves message-owned timing. A single data-layer merge primitive enforces
the inverse boundary for message finalization: runtime writers can submit only
`runtimeTiming`, while usage writers can submit only
`MessageUsageProjection`. Public message create DTOs do not accept `stats`.
Therefore record-first and message-first write order converge to the same
`MessageStats`.

Temporary message append reads the current projection. Promotion only rebuilds
that projection; it does not create a record. Agent message upsert follows the
same rule.

After commit, the service publishes changes for all three usage endpoints and
for any affected chat/agent message read model. A write failure is logged and
never changes the AI result.

## Multi-step message performance

New assistant messages may carry:

```ts
interface MessageProviderPerformance {
  measuredOutputTokens: number
  generationDurationMs: number
}

interface MessageRuntimeTiming {
  startedAt: number
  completedAt?: number
  spans: Array<ToolExecutionSpan | ApprovalWaitSpan>
}
```

There is no format-version field. New writers persist only `runtimeTiming`.
Absence of `runtimeTiming` identifies a historical message; only then may the
renderer normalize its scalar message timings into the same performance view
model. Scalar timing is never copied into a new runtime timeline because it
lacks absolute timestamps and tool/approval intervals.

`AiStreamManager` owns one runtime timing collector per message execution. AI
SDK tools report their exact execute interval through the existing loop hooks.
Direct/external Claude Agent tools use the SDK's
`PostToolUse`/`PostToolUseFailure.duration_ms`, which excludes approval and hook
time. Approval spans begin when the approval request is emitted and end on
approve, deny, abort, or error.

A continuation's context provider includes the persisted timing snapshot in
`PreparedDispatch`; `AiStreamManager` only consumes that seed. The collector
keeps the earliest root start and prior spans and writes the latest completion.
An approval decision and its span completion are committed in the same SQLite
transaction, so a restart between the decision and continuation cannot leave
the wait open.
Abort/error closes every observable active runtime span. This does not create a
successful provider record when the provider call itself has no final
usage/result.

The renderer reports two different rates:

```text
model TPS = SUM(measured output tokens) / SUM(measured generation duration)
end-to-end throughput = whole-message output tokens / wall-clock message duration
```

Tool and approval time is excluded from model TPS and included in end-to-end
throughput. Parallel intervals remain overlapping on the Model, Tool,
Approval, and Other lanes; their percentages are never added as if they were
serial.

## Agent runtime ownership

### Direct and external CLI

The connection carries `{ owner: 'agent-sdk', credentialReceipt, frozenModels }`.
Every emitted invocation id is globally namespaced by its driver (`claude-agent:`
or `pi-agent:`) before it crosses the runtime contract; the host persists that id
verbatim for cross-runtime idempotency.

Each Claude SDK assistant message supplies provider request id, actual nested
model, and usage:

- consecutive updates with the same id merge by maximum field value;
- a new id, steer boundary, or successful result commits pending invocations;
- abort, error, query close, or connection close commits only steps with
  provider completion evidence and discards the current in-flight step;
- a committed id is immutable; a late repeat logs an anomaly and is ignored;
- the driver freezes message association when the SDK assistant event arrives:
  an active adapter means the current turn, while no adapter means stateless;
- the host resolves current-turn events to the active assistant message.
  Stateless events keep `messageRef: null` and the connection's frozen source;
- primary/plan/small nested models resolve independently against the frozen
  model map;
- result-level `modelUsage`, duration, and total cost are reconciliation data,
  not record inputs.

The driver commits pending usage before emitting a steer boundary, so the old
provider call attaches to the pre-steer message and the next call attaches to
the continuation.

Pi records one invocation when each provider stream completes, including the
streams used by compaction. Provider `responseId` is preferred; session id plus
message timestamp/model is the stable fallback. Error/aborted responses do not
create records, duplicate completed ids are ignored, and Pi's
input/cache/reasoning buckets are preserved rather than re-derived from the
message-level running total.

### Gateway-backed Agent

The connection carries `{ owner: 'provider-calls' }`; SDK usage events are
ignored. Trusted in-process gateway context supplies the active assistant
message id (or a reserved steer continuation id) and frozen source to the
normal AiService language middleware.
When a `PreToolUse` hook actually injects a steer, the driver synchronously
asks the host to reserve the continuation message id and frozen source before
the hook returns. The next gateway request therefore captures that reservation;
the later `steer-boundary` persists A2 with the same id. A turn that ends
without reaching the boundary discards the unused reservation. If no active
turn or reservation can be resolved, the provider invocation is still recorded
as stateless and no association is guessed.

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
- Legacy model pricing recognizes only absent/`$` as USD and `¥`/`￥` as CNY.
  Other currency symbols are dropped instead of being assigned an invented
  currency.
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
`tokensPerSecond`. Cost sort requires and filters to one currency. Supplying
`messageKind` and `messageId` together restricts the list to one message;
supplying only one is rejected.

The message details card enables this message-scoped query only while the card
is open and follows its keyset cursor until the message's records are loaded.
Invocation timestamps supply the Model lane in the duration distribution;
individual invocation rows are not rendered as a detail list. Its compact
model TPS comes from the complete materialized `providerPerformance`, so
record pagination cannot change the headline value.

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
- Direct Agent SDK steps that omit `ttft_ms`, and all legacy rows, have no
  honest per-call latency.
- Individual provider steps with missing duration are omitted from the
  duration distribution and excluded from model TPS rather than estimated
  from tool/message events.
- Rerank is counted but may have null usage and cost.
- Topic duplication copies content and message-owned timing only. It does not
  duplicate usage/cost/provider-performance facts under new message ids.
- Image calls remain unpriced unless the provider reports a trusted cost or
  the runtime model has explicit per-image pricing.
- Historical serving keys cannot be reconstructed and remain `unknown`.
- Estimated local cost is not an invoice, and currencies are not converted.

## File map

| File | Role |
| --- | --- |
| `src/shared/data/types/aiUsageRecord.ts` | Entity and snapshot schemas |
| `src/shared/data/api/schemas/aiUsageRecords.ts` | Bounded read contracts |
| `src/main/data/db/schemas/aiUsageRecord.ts` | SQLite table and constraints |
| `src/main/data/services/AiUsageRecordService.ts` | Capture contracts, insert owner, projection, queries, cursors, and message-stats merge policy |
| `src/main/ai/utils/usageCapture.ts` | Immutable provider/model/key/pricing capture factories |
| `src/main/ai/runtime/types.ts` | Agent runtime capture-owner contract |
| `src/main/ai/hooks/billingHook.ts` | Language middleware and operation coverage |
| `packages/aiCore/src/core/runtime/` | Embedding/image/rerank provider-call events |
| `src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts` | Direct Agent SDK capture |
| `src/main/data/migration/v2/migrators/AiUsageRecordMigrator.ts` | v1 aggregate migration |
| `src/renderer/pages/settings/UsageSettings/` | Usage read model consumers |
