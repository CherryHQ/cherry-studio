# Usage Ledger

Durable, per-request record of AI token usage and cost — the billing source of
truth, decoupled from the lifecycle of the data that produced it.

- Table: `usage_ledger` (`src/main/data/db/schemas/usageLedger.ts`)
- Service: `usageLedgerService` (`src/main/data/services/UsageLedgerService.ts`)
- API: `GET /usage-ledger/entries`, `GET /usage-ledger/stats` (read-only)

---

## 1. Why a ledger (requirements)

Before the ledger, usage statistics were derived exclusively from
`message.stats` — the JSON blob on persisted chat messages. That model has
three structural problems:

### 1.1 Stateless AI requests are invisible

A growing share of AI traffic never produces a persisted assistant message,
so message-derived statistics simply cannot see it:

| Stateless surface | Entry point | Why it's invisible |
| --- | --- | --- |
| **API Gateway** | `proxyStream.ts` → `AiService.streamText` | Streams attach only an `SseListener` (response forwarding); no `PersistenceListener`, no message row |
| **Translation** | translate flow | Results land in `translate_history` (text only, no token stats) |
| **Topic auto-rename** | `TopicNamingService` → `generateText` | One-shot summary call, output applied to the topic name |
| **Embeddings / knowledge** | `AiService.embedMany` | Vectors go to the knowledge index |
| **Ephemeral temporary chats** | `TemporaryChatService` (in-memory) | Messages exist only in memory unless the user keeps the chat |

Before the ledger, these surfaces reported (at most) to
`AnalyticsService.trackUsage` — volatile telemetry, not a durable per-key
billing record. The billing funnel (§2) now captures the Agent-based ones at
the request chokepoint; embeddings and image generation record at their
`AiService` call sites (§4).

### 1.2 Statistics die with their source data

`message` cascades on topic deletion; API keys are entries inside the
`user_provider.apiKeys` JSON array and vanish when removed. Any statistic
computed from live business data is silently rewritten by ordinary cleanup:
delete a topic and its spend disappears; delete a key and its identity is
unrecoverable.

### 1.3 No API-key attribution

`message.stats` knows tokens and cost, but not *which key paid for them*.
Multi-key users (rotation) had no way to answer "how much did key X spend".

**The ledger answers all three**: an append-only table with **no foreign
keys**, written at request granularity, carrying denormalized snapshots
(provider, model, key id + label + masked value) so rows stay meaningful after
everything they reference is deleted.

---

## 2. Architecture

```
            AI pipeline (src/main/ai)
  ┌─────────────────────────────────────────────────────────────────┐
  │ AiService.streamText / generateText — the single chokepoint:    │
  │   every aiSdk request (chat, gateway, translate, rename) builds │
  │   its Agent here. billingHookPart(model, messageId?) fires once │
  │   per request at onFinish ──────────────────────────┐           │
  │                                                     │           │
  │ stream runtimes → PersistenceListener →             │           │
  │   MessageServiceBackend (enrichStatsWithCost)       │           │
  └──────────────────────────┬──────────────────────────┼───────────┘
                             │ messageService.update    │ recordRequest
  ═══════════════════════════▼══════════════════════════▼═ data layer ═
  ┌───────────────────────────────────────────────────────────────┐
  │ MessageService.update hook    TemporaryChatService.persist()   │
  │   (assistant + stats)           (kept temp chats)              │
  └──────────────┬──────────────────────┬─────────────────────────┘
                 ▼                      ▼            (all fire-and-forget)
  ┌───────────────────────────────────────────────────────────────┐
  │ UsageLedgerService                                             │
  │  recordRequest()  ← upsert; enriches cost when absent          │
  │  recordFromMessage()  ← delegates with messageId as row key    │
  │  resolveKeyAttribution()  ← ProviderService state              │
  │  reconcileFromMessages()  ← lazy backfill on first read        │
  │  list() / stats()                                              │
  └──────────────────────────┬────────────────────────────────────┘
                             ▼
                    usage_ledger (SQLite)
                             ▲
        GET /usage-ledger/entries · /usage-ledger/stats (DataApi)
```

Design rules:

1. **One chokepoint for live capture**: every aiSdk request — chat stream,
   API gateway, translate, topic rename — constructs its `Agent` in exactly
   two methods (`AiService.streamText` / `generateText`). The billing funnel
   (`billingHookPart`) hooks the request's `onFinish` there, deliberately
   **separate from the telemetry hook** (`analyticsHookPart` →
   `AnalyticsService`): billing and telemetry are different concerns. The
   streaming internals (runtimes, listeners, persistence backends) stay
   ledger-free.
2. **Convergent dual write for chat**: the funnel records with the assistant
   message id as the row key — the same key the durable data-layer hook
   (`MessageService.update`, post-commit) writes after persistence. Both
   paths upsert one row: usage columns are last-write-wins, key attribution
   keeps the earliest non-`none` resolution, and `topicId` never regresses
   to NULL. Stateless requests have no message — their row key is a
   per-request id and the funnel is their only writer.
3. **Single-source derivation**: ledger numbers are *projected* from the
   accumulated usage / persisted `message.stats`, never recomputed. Cost is
   resolved by one shared function (`enrichStatsWithCost`, data layer):
   message persistence enriches `message.stats`; `recordRequest` enriches
   ledger rows whose stats don't already carry a cost. Computed from model
   pricing by default, provider-reported when `apiFeatures.reportsActualCost`.
4. **Lifecycle decoupling**: no `.references()` anywhere. `messageId`,
   `topicId`, `providerId`, `modelId`, and the key snapshot are plain string
   columns. Deleting the message/topic/provider/key never touches ledger rows.
5. **Best-effort by contract**: ledger writes are `void ...catch(log)` —
   they must never disrupt the request or message persistence. Chat-row
   losses are healed by reconciliation (§5); stateless rows have no durable
   source to re-derive from.

### Division of labour vs `message.stats`

| | `message.stats` | `usage_ledger` |
| --- | --- | --- |
| Purpose | Per-message UI (tokens, cost, **timings**) | Billing record, key attribution, aggregation |
| Lifecycle | Dies with the message/topic | Append-only, survives all deletions |
| Written by | Stream persistence (`statsFromTerminal` + cost enrichment) | Data-layer hooks projecting from stats |
| Timings | ✅ `timeFirstTokenMs` / `timeCompletionMs` | ❌ not stored |

Both are needed; the ledger is a *projection with independent lifecycle*, not
a replacement.

---

## 3. Data model

`usage_ledger` (UUIDv7 PK, epoch-ms timestamps):

| Group | Columns | Notes |
| --- | --- | --- |
| Identity | `messageId` (UNIQUE), `topicId`, `providerId`, `modelId`, `modality` | Plain snapshots, no FKs. `messageId` is the idempotency key: the assistant message id for chat, a per-request id for stateless requests. `modality`: `language`/`embedding`/`image` |
| Key snapshot | `apiKeyId`, `apiKeyLabel`, `apiKeyMasked`, `apiKeyAttribution` | Denormalized at write time; masked value never contains the raw key (≤8-char keys clamp to `****`) |
| Usage | `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens`, `imageCount` | AI SDK v6 names, mirrors `MessageStats`; `imageCount` for `image` rows |
| Cost | `cost`, `costCurrency`, `costSource` (`provider`/`computed`) | Mirrors `MessageStats` cost fields; image rows priced via `pricing.perImage` (`costBreakdown.image`) |

Indexes: unique `messageId`; `(providerId, createdAt)`; `(apiKeyId, createdAt)`;
`createdAt` — the shapes the list filters and stats group-bys scan.

### Attribution confidence (`apiKeyAttribution`)

The serving key is not recorded anywhere by the request pipeline, so
attribution is resolved from `ProviderService` state at write time and the
confidence is stored explicitly:

| Value | Meaning | When |
| --- | --- | --- |
| `exact` | Deterministic | Provider has exactly one enabled key — rotation always returns it |
| `rotation` | Most likely | Multiple enabled keys; resolved from the round-robin pointer (`providerService.getLastUsedApiKeyId`). Concurrent requests to the same provider can move the pointer, so this can be wrong |
| `backfill` | Guess | Written by reconciliation for providers with exactly one *configured* key |
| `auth` | N/A | Provider-level credential (IAM, keyless OAuth) — no key exists |
| `none` | Unresolvable | No keys, pointer lost (restart), key deleted, provider deleted |

Upsert semantics protect the record: usage/cost columns are
**last-write-wins** (re-persists carry fresher totals), key-identity columns
are **earliest-non-`none`-wins** (the first resolution is closest to request
time; a later re-resolution after a restart must not downgrade `exact` to
`none`).

> Exact attribution for the multi-key concurrent case would require threading
> the chosen key id from `getRotatedApiKey` through the request pipeline —
> rejected for now to keep the AI pipeline untouched. The `rotation` label
> exists so the UI can present those numbers as approximate.

---

## 4. Write paths

| # | Path | Covers | Mechanism |
| --- | --- | --- | --- |
| 1 | `AiService.billingHookPart` (billing funnel) | **Every aiSdk request**: chat streams, API gateway, translate, topic rename, ephemeral temp chats | Per-request `onFinish` → fire-and-forget `recordRequest`; row key = assistant message id (chat) or generated request id |
| 2 | `MessageService.update` hook | All persisted assistant messages (durable confirmation; converges with path 1 on the same row key) | Post-commit, fire-and-forget `recordFromMessage` |
| 3 | `TemporaryChatService.persist` | Temp chats the user keeps (raw-inserts bypass the hook) | Same projection, fired after the insert tx |
| 4 | `AgentSessionMessageService.saveMessage(s)` | Agent sessions (Claude Code runtime — bypasses both the funnel and the `message` table) | Post-commit, fire-and-forget `recordRequest` keyed by the session message id |
| 5 | `reconcileFromMessages` | v1-migrated history; chat rows lost to crash/quit | Lazy backfill, §5 |

`recordRequest` guards: parseable `modelId` (`providerId::modelId`) and a
usage signal (any of input/output/total tokens or cost) — timing-only stats
and zero-usage runs don't create rows. Cost is enriched in-place when the
caller's stats carry none (the funnel path). Writes go through
`DbService.withWriteTx` with `onConflictDoUpdate` on `messageId`.

Embeddings and image generation don't run through the Agent (different SDK
APIs) — they record directly at their `AiService` call sites (`embedMany`,
`generateImage`) with modality `embedding`/`image`.

---

## 5. Consistency: reconciliation

The live write is fire-and-forget and v1 migration raw-inserts messages
without firing hooks — both create "message has stats, ledger has no row"
divergence. `reconcileFromMessages()` heals it:

- Runs **lazily, once per process**, before the first `list()`/`stats()`
  read (failures log and retry on the next read).
- Anti-join: assistant messages with stats and no ledger row.
- Inserted rows mirror the **message's own `createdAt`** (usage time, not
  reconcile time) so time-windowed aggregation stays meaningful.
- `onConflictDoNothing` — existing rows are never modified.
- Backfill attribution: exactly one configured key → that key with
  `backfill`; IAM/keyless-OAuth → `auth`; anything else → honest `none`
  (attributing multi-key history to an arbitrary key would corrupt per-key
  billing).

Together: single-source projection (can't diverge at write time) + idempotent
upsert (re-persists converge) + reconciliation (missing rows heal) ⇒ the
ledger is eventually consistent with `message.stats`, while additionally
surviving deletions that `message.stats` does not.

---

## 6. Query API

Read-only — the renderer can never write the ledger.

```
GET /usage-ledger/entries?providerId&apiKeyId&from&to&cursor&limit
  → CursorPaginationResponse<UsageLedgerEntry>   (newest first, keyset cursor)

GET /usage-ledger/stats?groupBy=provider|apiKey|model&providerId&from&to
  → { buckets: UsageLedgerStatsBucket[] }
```

`costCurrency` always participates in the group key — USD and CNY are never
summed into one number. Buckets are ordered by total cost descending.

---

## 7. Coverage

| Surface | Recorded | Notes |
| --- | --- | --- |
| Persistent chat (incl. multi-model, continue) | ✅ | Funnel (path 1) + persistence hook (path 2) converging on the message id |
| **API Gateway** | ✅ | Funnel — gateway requests carry no message id, so rows get a per-request id |
| **Translate / topic rename** (`generateText`) | ✅ | Funnel |
| Temporary chats (kept **and** discarded) | ✅ | Funnel records the spend either way; `persist()` (path 3) adds topic context for kept chats |
| v1-migrated history | ✅ (backfilled) | Path 4, `backfill`/`none` attribution |
| **Agent sessions** (Claude Code runtime) | ✅ | Sibling hook in `AgentSessionMessageService.saveMessage`/`saveMessages` — sessions bypass the funnel (no aiSdk Agent) and the `message`-table hook (separate table). Rows have `topicId` NULL |
| Claude Code as a chat provider | ✅ | Its adapter implements aiSdk `LanguageModelV3.doStream` → flows through the funnel + message hook like any provider |
| **Embeddings** (`AiService.embedMany`) | ✅ | Modality `embedding`; token-priced via the model's input rate (enriched in `recordRequest`) |
| **Image generation** (`AiService.generateImage`) | ✅ | Modality `image`; priced per generated image via `pricing.perImage` (computed at the call site; `pixel`-unit pricing unsupported — rows record `imageCount` without cost) |

---

## 8. Known limitations

- **Multi-key concurrency**: `rotation` attribution can name the wrong key
  when several requests hit the same multi-key provider simultaneously, or
  when unrelated callers (model-list refresh, health check) advance the
  rotation pointer mid-stream.
- **Continue-after-tool-approval under-count**: the stream pipeline's usage
  accumulator restarts on continuation, so the re-persisted `message.stats`
  (and therefore the ledger row) reflects the continuation leg only. The
  ledger faithfully mirrors the message — the fix belongs upstream in the
  stream pipeline.
- **Quit-window loss**: a crash between request finish and the async ledger
  write loses that row. Chat rows heal on the next reconciliation pass;
  stateless rows (gateway, translate, rename) have no durable source to
  re-derive from and stay lost.
- **Out-of-order double-write**: two writes for the same row key racing
  through attribution can land usage values out of commit order
  (millisecond window, no monotonic guard).
- **Errored/aborted stateless requests**: the funnel records at `onFinish`;
  a request that errors mid-stream may not reach it, so its partial spend is
  unrecorded (chat partials are still captured by the persistence hook).

---

## 9. File map

| File | Role |
| --- | --- |
| `src/main/data/db/schemas/usageLedger.ts` | Table, indexes, check constraints |
| `src/shared/data/types/usageLedger.ts` | Entity zod schema, attribution enum |
| `src/shared/data/api/schemas/usageLedger.ts` | Query DTOs, route table |
| `src/main/data/services/UsageLedgerService.ts` | `recordRequest`/attribution/reconcile/list/stats |
| `src/main/data/services/utils/costEnrichment.ts` | Shared cost resolution (pricing vs provider-reported) |
| `src/main/ai/AiService.ts` | Billing funnel (`billingHookPart`) — the per-request chokepoint |
| `src/main/data/services/MessageService.ts` | Durable capture hook (`update`) |
| `src/main/data/services/TemporaryChatService.ts` | Kept-temp-chat topic context |
| `src/main/data/services/ProviderService.ts` | `getLastUsedApiKeyId` (rotation pointer owner) |
| `src/main/data/api/handlers/usageLedger.ts` | DataApi handlers |
| `src/shared/utils/api/utils.ts` | `maskApiKey` (shared; ledger clamps short keys) |
| `src/main/data/services/__tests__/UsageLedgerService.test.ts` | record/attribution/funnel/list/stats/reconcile tests |
