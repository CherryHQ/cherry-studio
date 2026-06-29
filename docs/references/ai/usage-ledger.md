# Usage Ledger

Durable, per-request record of AI token usage, request cost, attribution, and
request performance. It is the usage-analysis source of truth and is decoupled
from the lifecycle of the chat message, topic, provider, model, or API key that
produced the usage.

- Table: `usage_ledger` (`src/main/data/db/schemas/usageLedger.ts`)
- Service: `usageLedgerService` (`src/main/data/services/UsageLedgerService.ts`)
- API:
  - `GET /usage-ledger/entries`
  - `GET /usage-ledger/stats`
  - `GET /usage-ledger/timeline`
  - `GET /usage-ledger/cost-backfill/preview`
  - `POST /usage-ledger/cost-backfill/run`

Normal ledger rows are written only by the main process. The renderer-facing
write API is limited to explicit maintenance operations, currently historical
cost backfill after the user changes model pricing.

---

## 1. Why a ledger

Before the ledger, usage statistics were derived from `message.stats`, the JSON
blob on persisted chat messages. That model is insufficient for billing and
analysis.

### 1.1 Stateless AI requests are invisible to messages

Several AI surfaces never produce a persisted assistant message:

| Surface | Entry point | Why `message.stats` cannot see it |
| --- | --- | --- |
| API Gateway | `proxyStream.ts` -> `AiService.streamText` | Gateway streams responses; it does not create message rows |
| Translate | translate flow -> `generateText` | Results are stored as translation text, not assistant messages |
| Topic auto-rename | `TopicNamingService` -> `generateText` | One-shot summary updates the topic name |
| Embeddings / knowledge | `AiService.embedMany` | Vectors are persisted to the knowledge index |
| Discarded temporary chats | temporary chat stream | Messages may stay in memory and never be kept |
| Image generation | `AiService.generateImage` | Outputs are images, not chat assistant messages |

The billing funnel and direct call-site hooks record these requests into
`usage_ledger` even when there is no message row.

### 1.2 Usage must survive source deletion

`message` rows can disappear with topic cleanup. API keys live inside
`user_provider.apiKeys` JSON and disappear when users delete or rotate them.
Provider names, model metadata, and assistant/agent display data can also
change. A billing record cannot depend on those live objects still existing.

The ledger stores plain snapshots with no foreign keys. Deleting a topic,
provider, model, key, assistant, or agent never deletes the ledger row.

### 1.3 Cost and attribution need auditability

The ledger stores:

- token buckets using AI SDK v6 names;
- request modality (`language`, `embedding`, `image`);
- source snapshot (`assistant` or `agent`);
- provider/model/API-key snapshot;
- cost, cost source, cost breakdown, and pricing snapshot;
- request timings used by the Usage request table.

That makes historical reports stable. UI reads persisted ledger values; it does
not recalculate historical cost on every render.

---

## 2. Architecture

```
                     AI pipeline / request sources
  -------------------------------------------------------------------------
  AiService.streamText / generateText
    builds every aiSdk Agent request
    -> billingHookPart(...).onFinish -> UsageLedgerService.recordRequest()

  AiService.embedMany / generateImage
    use non-Agent SDK APIs
    -> direct recordRequest() at the call site

  Stream persistence
    -> MessageServiceBackend enriches message.stats with cost
    -> MessageService.update post-commit hook
    -> UsageLedgerService.recordFromMessage()

  AgentSessionMessageService.saveMessage(s)
    Claude Code agent-session messages bypass the chat message table
    -> post-commit recordRequest()

  V2 migration
    UsageLedgerMigrator projects existing chat and agent-session messages
    into usage_ledger during migration

  Model settings maintenance
    pricing save -> preview missing historical cost
    user CTA -> run cost backfill

  -------------------------------------------------------------------------
                     usage_ledger (SQLite, no foreign keys)
  -------------------------------------------------------------------------
  DataApi:
    GET  /usage-ledger/entries
    GET  /usage-ledger/stats
    GET  /usage-ledger/timeline
    GET  /usage-ledger/cost-backfill/preview
    POST /usage-ledger/cost-backfill/run
```

Design rules:

1. **Capture at request boundaries.** aiSdk text requests are captured from
   `AiService.billingHookPart`; embeddings and image generation are captured
   at their `AiService` call sites because they do not construct an Agent.
2. **Converge chat writes by row key.** Chat requests use the assistant
   message id as `messageId`, so the live billing funnel and durable
   `MessageService.update` hook upsert the same row. Stateless requests use a
   generated request id.
3. **Keep cost stable.** Cost is persisted with `costBreakdown` and
   `pricingSnapshot`. Updating model pricing later does not change old rows
   unless the user explicitly runs cost backfill.
4. **Keep lifecycle independent.** All references are snapshots. There are no
   `references()` from `usage_ledger` to business tables.
5. **Do not block user flows.** Live ledger writes are best-effort and are
   usually fired asynchronously. They must not make a chat, gateway request, or
   message save fail.

### Division of labour vs `message.stats`

| | `message.stats` | `usage_ledger` |
| --- | --- | --- |
| Purpose | Per-message source data for UI and persistence | Billing/analytics record with attribution and stable history |
| Lifecycle | Dies with the message/topic | Survives deletion of messages, topics, providers, keys, assistants, and agents |
| Writes | Stream persistence and migration | Request hooks, post-commit hooks, migration, explicit maintenance |
| Cost | Enriched before message persistence when possible | Stores the persisted/enriched cost snapshot |
| Timings | Per-message timings | Projected timings for request table metrics (`TTFT`, `TPS`) |
| Recalculation | Not recalculated by UI | Not recalculated by UI; backfill is explicit |

---

## 3. Data model

`usage_ledger` uses a UUIDv7 primary key and epoch-millisecond timestamps.
`messageId` is unique and acts as the idempotency key.

| Group | Columns | Notes |
| --- | --- | --- |
| Identity | `messageId`, `topicId`, `providerId`, `providerName`, `modelId`, `modality` | No FKs. `modelId` is a `UniqueModelId` (`providerId::modelId`) when available. `modality` is `language`, `embedding`, or `image`. |
| Source snapshot | `sourceType`, `sourceId`, `sourceName`, `sourceIcon` | User-facing origin of usage. Current values are `assistant` and `agent`; stateless rows may be null. |
| API-key snapshot | `apiKeyId`, `apiKeyLabel`, `apiKeyMasked`, `apiKeyAttribution` | Denormalized at write time. Raw key secrets are never stored. |
| Token usage | `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens`, `noCacheTokens`, `cacheReadTokens`, `cacheWriteTokens` | Mirrors `MessageStats` / AI SDK v6 usage. `noCacheTokens` is needed for accurate cache-hit denominator. |
| Image usage | `imageCount` | Used only for `modality = 'image'`. |
| Cost | `cost`, `costCurrency`, `costSource`, `costBreakdown`, `pricingSnapshot` | `costSource` is `provider` or `computed`. `pricingSnapshot.capturedAt` records when local pricing was captured. |
| Performance | `timeFirstTokenMs`, `timeCompletionMs`, `timeThinkingMs` | Used by the Usage request table for TTFT, completion time, thinking time, and generated tokens/sec. |

Indexes:

- unique `messageId`;
- `(providerId, createdAt)`;
- `(apiKeyId, createdAt)`;
- `(sourceType, sourceId, createdAt)`;
- `createdAt`.

### API-key attribution

The concrete serving key is not threaded through the AI request pipeline, so
the ledger resolves attribution from `ProviderService` state at write time.
The confidence is persisted in `apiKeyAttribution`.

| Value | Meaning | Source |
| --- | --- | --- |
| `exact` | Deterministic | Live write, provider has exactly one enabled key |
| `rotation` | Best effort | Live write, multiple enabled keys; uses the provider round-robin pointer |
| `backfill` | Historical fallback | Migration assigns the provider's first configured key because the serving key was not recorded historically |
| `auth` | Provider-level credential | IAM/keyless/OAuth credential, no API key row |
| `none` | Unresolvable | No key, lost pointer, deleted key/provider, or missing historical snapshot |

Upsert semantics protect the best attribution seen so far:

- usage, cost, timing, source, and provider display columns are updated by the
  latest writer;
- `topicId` never regresses to null;
- key identity keeps the earliest non-`none` attribution because that write was
  closest to the actual request time.

---

## 4. Cost snapshots

Cost is persisted, not display-time calculated.

### Live request cost

`enrichStatsWithCost()` is shared by message persistence and
`UsageLedgerService.recordRequest()`.

- Provider-reported cost is trusted only when
  `provider.apiFeatures.reportsActualCost === true` and a provider cost is
  present in the raw usage blob. The current intended example is OpenRouter.
- Otherwise cost is computed from current model pricing via
  `computeLanguageCost()`.
- Computed language cost uses:
  - `inputTokenDetails.noCacheTokens` at the input rate, falling back to
    `inputTokens` when no cache breakdown exists;
  - `cacheReadTokens` and `cacheWriteTokens` at their dedicated rates, falling
    back to input rate if the dedicated rate is absent;
  - `outputTokens` at the output rate.
- Image cost is computed at `AiService.generateImage` from `pricing.perImage`
  when the unit is per generated image. Pixel-unit image pricing is not
  estimated.

Every computed cost stores `costBreakdown` and `pricingSnapshot`, so a row is
auditable even if model pricing changes later.

### Historical migration cost

`UsageLedgerMigrator` runs during v2 migration and projects existing assistant
chat messages plus agent-session messages into `usage_ledger`.

- If old `stats.cost` exists, it is copied as-is.
- If cost is missing and the model has current pricing, migration computes a
  `computed` cost and stores the pricing snapshot.
- If pricing is unavailable, migration still writes usage tokens and leaves
  cost null.
- Image rows are not inferred from old message stats; the migrator backfills
  historical language usage from message and agent-session tables.

### Explicit cost backfill

After users save model pricing in the model settings drawer, the renderer calls
`GET /usage-ledger/cost-backfill/preview` for that model. If there are rows
that can be calculated, the drawer shows a CTA. Clicking it calls
`POST /usage-ledger/cost-backfill/run`.

Backfill rules:

- only rows for the requested `modelId`;
- optional `from` / `to` time range;
- only `modality IN ('language', 'embedding')`;
- only `cost IS NULL`;
- requires usable model pricing;
- never overwrites rows that already have cost;
- never overwrites `costSource = provider`;
- writes in chunks through `DbService.withWriteTx()`;
- refreshes Usage queries after success.

Usage page open, filter changes, and stats queries do not trigger cost
backfill.

---

## 5. Write paths

| Path | Covers | Mechanism |
| --- | --- | --- |
| `AiService.billingHookPart` | aiSdk text requests: chat, API gateway, translate, topic rename, discarded temp chats | `onFinish` -> fire-and-forget `recordRequest`; row key is assistant message id for chat or generated request id for stateless calls |
| `AiService.embedMany` | Embedding calls | Direct `recordRequest` with `modality = 'embedding'`; token-priced from input pricing |
| `AiService.generateImage` | Image generation | Direct `recordRequest` with `modality = 'image'` and `imageCount`; per-image pricing when available |
| `MessageService.update` | Persisted assistant chat messages | Post-commit `recordFromMessage`; converges with the billing funnel on the message id |
| `TemporaryChatService.persist` | Temp chats the user keeps | Raw insert path bypasses `MessageService.update`, so it explicitly records kept messages and topic context |
| `AgentSessionMessageService.saveMessage(s)` | Claude Code agent-session messages | Post-commit `recordRequest`; agent sessions use a separate message table and bypass the chat funnel |
| `UsageLedgerMigrator` | Historical chat and agent-session messages during v2 migration | Bulk projection into `usage_ledger` with `onConflictDoNothing` |
| Cost backfill API | Historical rows missing cost | Explicit user-triggered maintenance, not live request capture |

`recordRequest` is a no-op unless:

- `modelId` is parseable as `providerId::modelId`;
- there is a usage signal (`inputTokens`, `outputTokens`, `totalTokens`,
  `cost`) or `imageCount`;
- the request modality is valid.

---

## 6. Query API

### `GET /usage-ledger/entries`

Lists raw request rows with offset pagination.

Query:

- `page`, `limit` (default 50, max 200);
- `providerId`;
- `apiKeyId`;
- `from`, `to` (epoch milliseconds);
- `sortBy`: `createdAt`, `totalTokens`, `cost`, `timeFirstTokenMs`,
  `tokensPerSecond`;
- `sortDirection`: `asc`, `desc`.

Rows are sorted with null metric values last, then by `createdAt desc` and
`id asc` for stable ordering. Provider display names are resolved from the
current provider table when the stored snapshot is missing or only equals the
provider id.

### `GET /usage-ledger/stats`

Aggregates usage and cost by one dimension:

- `provider`;
- `apiKey`;
- `model`;
- `source`.

Query:

- `groupBy` (required);
- optional `providerId`;
- optional `from`, `to`.

`costCurrency` always participates in the group key. Different currencies are
never summed into one bucket.

Returned totals include:

- `totalCost`;
- `totalInputTokens`;
- `totalOutputTokens`;
- `totalTokens`;
- `totalNoCacheTokens`;
- `totalCacheReadTokens`;
- `totalCacheWriteTokens`;
- `entryCount`.

### `GET /usage-ledger/timeline`

Aggregates local-calendar daily buckets for the selected time window.

Returned totals include tokens, cache buckets, cost, and request count. The
timeline's `totalCost` is a simple numeric sum for chart shape; the renderer
uses cost mode only when the selected window is effectively single-currency.

### Cost backfill endpoints

```
GET /usage-ledger/cost-backfill/preview?modelId=provider::model&from&to
POST /usage-ledger/cost-backfill/run
```

Both return:

- `scannedCount`;
- `recalculableCount`;
- `skippedNoPricingCount`;
- `skippedProviderCostCount`;
- `estimatedCostByCurrency`.

`run` also returns `updatedCount`.

---

## 7. Usage UI semantics

The Usage settings page is an analysis view over persisted ledger data.

Top-level KPIs are derived from ledger stats/timeline:

- cost;
- request count;
- tokens;
- cache hit rate.

Cache hit rate is calculated only from observable cache-token fields:

```
cacheReadTokens / (noCacheTokens + cacheReadTokens + cacheWriteTokens)
```

If the selected window has no observable cache denominator, the UI should show
an explanatory empty state such as "Starts with new requests" rather than
treating historical missing fields as 0% cache hit.

The Explore area combines:

- daily timeline (`/usage-ledger/timeline`);
- breakdowns by provider/model/API key/source (`/usage-ledger/stats`);
- paginated request rows (`/usage-ledger/entries`) with TTFT/TPS metrics.

Clicking a day narrows the active analysis window. Request rows stay raw and
paginated; breakdown rows are aggregate views.

---

## 8. Coverage

| Surface | Recorded | Notes |
| --- | --- | --- |
| Persistent chat | Yes | Billing funnel plus `MessageService.update` converge on the assistant message id |
| Multi-model chat | Yes | One assistant message/ledger row per model response |
| API Gateway | Yes | Funnel path, generated request id |
| Translate / topic rename | Yes | Funnel path through `generateText` |
| Temporary chats kept by user | Yes | Funnel records usage; `persist()` adds durable topic context |
| Temporary chats discarded by user | Yes | Funnel records usage even if no temp chat is kept |
| V2-migrated chat history | Yes | `UsageLedgerMigrator` projects assistant message stats |
| V2-migrated agent-session history | Yes | `UsageLedgerMigrator` projects assistant agent-session message stats |
| Agent sessions | Yes | `AgentSessionMessageService.saveMessage(s)` hook |
| Claude Code as chat provider | Yes | Its adapter flows through aiSdk stream path and chat persistence |
| Embeddings | Yes | `AiService.embedMany`, `modality = 'embedding'` |
| Image generation | Yes | `AiService.generateImage`, `modality = 'image'`, `imageCount` |

---

## 9. Known limitations

- **Multi-key concurrency**: `rotation` attribution can name the wrong key
  when concurrent requests or unrelated provider operations move the rotation
  pointer before the ledger write resolves.
- **Historical key attribution**: migration uses the provider's first
  configured API key when available because legacy rows did not record the
  serving key. This is intentionally labeled `backfill`, not `exact`.
- **Crash-window loss for stateless calls**: a crash between request finish and
  the async ledger write can lose a stateless row. There is no durable source
  to reconstruct gateway/translate/rename rows.
- **Chat crash recovery is migration-time, not read-time**: historical migrated
  rows are filled by `UsageLedgerMigrator`. Runtime writes are still
  best-effort; there is no `list()`/`stats()` lazy reconcile pass.
- **Continue-after-tool-approval under-count**: if the stream pipeline restarts
  its usage accumulator for a continuation, the ledger faithfully records the
  final message stats it receives. The fix belongs upstream in the stream
  pipeline.
- **Cost does not drift with pricing edits**: changing model pricing does not
  recalculate old rows automatically. Users must run explicit cost backfill,
  and the first version only fills missing cost.
- **Cross-currency timeline cost**: timeline cost is a simple charting sum.
  Detailed cost reporting must use stats buckets where `costCurrency` is part
  of the grouping key.
- **Image pricing scope**: only flat per-image pricing is recorded. Pixel-unit
  image pricing is skipped rather than estimated incorrectly.

---

## 10. File map

| File | Role |
| --- | --- |
| `src/main/data/db/schemas/usageLedger.ts` | Table, indexes, check constraints |
| `src/shared/data/types/usageLedger.ts` | Entity schema and ledger enums |
| `src/shared/data/api/schemas/usageLedger.ts` | Query schemas, response types, route table |
| `src/main/data/api/handlers/usageLedger.ts` | DataApi handlers and boundary validation |
| `src/main/data/services/UsageLedgerService.ts` | Record/upsert, attribution, list, stats, timeline, cost backfill |
| `src/main/data/services/utils/costEnrichment.ts` | Shared cost enrichment and pricing snapshots |
| `src/shared/utils/cost.ts` | Pure token/image cost math and provider-cost extraction |
| `src/main/ai/AiService.ts` | Billing funnel plus embedding/image direct record sites |
| `src/main/data/services/MessageService.ts` | Persisted chat capture hook |
| `src/main/data/services/TemporaryChatService.ts` | Kept-temp-chat capture hook |
| `src/main/data/services/AgentSessionMessageService.ts` | Agent-session capture hook |
| `src/main/data/migration/v2/migrators/UsageLedgerMigrator.ts` | Migration-time historical ledger fill |
| `src/renderer/pages/settings/UsageSettings/index.tsx` | Usage analytics UI |
| `src/renderer/pages/settings/ProviderSettings/ModelList/ModelDrawer/EditModelDrawer.tsx` | Model-pricing save and cost-backfill CTA |
| `src/main/data/services/__tests__/UsageLedgerService.test.ts` | Service coverage for record/list/stats/timeline/backfill |
| `src/main/data/migration/v2/migrators/__tests__/UsageLedgerMigrator.test.ts` | Migration coverage |
