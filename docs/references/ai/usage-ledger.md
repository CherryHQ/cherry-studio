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

Today these surfaces report (at most) to `AnalyticsService.trackUsage` —
volatile telemetry, not a durable per-key billing record.

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
            AI pipeline (src/main/ai) — NOT ledger-aware
  ┌───────────────────────────────────────────────────────────┐
  │ stream runtimes → PersistenceListener → MessageServiceBackend │
  │            (computes cost: enrichStatsWithCost)            │
  └───────────────────────────┬───────────────────────────────┘
                              │ messageService.update({ stats })
  ════════════════════════════▼═══════════════ data layer ═════
  ┌─────────────────────────────────────────────────────────┐
  │ MessageService.update            TemporaryChatService    │
  │   post-commit hook                 .persist()            │
  │   (assistant + stats)              (kept temp chats)     │
  └──────────────┬──────────────────────────┬───────────────┘
                 │ fire-and-forget          │ fire-and-forget
                 ▼                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ UsageLedgerService                                       │
  │  recordFromMessage()  ← projects stats → ledger columns  │
  │  resolveKeyAttribution()  ← ProviderService state        │
  │  reconcileFromMessages()  ← lazy backfill on first read  │
  │  list() / stats()                                        │
  └──────────────────────────┬──────────────────────────────┘
                             ▼
                    usage_ledger (SQLite)
                             ▲
        GET /usage-ledger/entries · /usage-ledger/stats (DataApi)
```

Design rules:

1. **Non-invasive**: the AI pipeline never imports the ledger. The only live
   capture point is a post-commit, fire-and-forget hook in
   `MessageService.update` — a billing event *is* "an assistant message landed
   token stats", and that fact is observable entirely inside the data layer.
2. **Single-source derivation**: ledger numbers are *projected* from the
   already-persisted `message.stats`, never recomputed. The two can't disagree
   at write time by construction. Cost itself is resolved earlier, at message
   persistence (`enrichStatsWithCost` in `MessageServiceBackend`: computed
   from model pricing, or provider-reported when
   `apiFeatures.reportsActualCost`).
3. **Lifecycle decoupling**: no `.references()` anywhere. `messageId`,
   `topicId`, `providerId`, `modelId`, and the key snapshot are plain string
   columns. Deleting the message/topic/provider/key never touches ledger rows.
4. **Best-effort by contract**: ledger writes are `void ...catch(log)` —
   they must never disrupt message persistence. Losses are healed by
   reconciliation (§5).

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
| Identity | `messageId` (UNIQUE), `topicId`, `providerId`, `modelId` | Plain snapshots, no FKs. `messageId` is the idempotency key |
| Key snapshot | `apiKeyId`, `apiKeyLabel`, `apiKeyMasked`, `apiKeyAttribution` | Denormalized at write time; masked value never contains the raw key (≤8-char keys clamp to `****`) |
| Usage | `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens` | AI SDK v6 names, mirrors `MessageStats` |
| Cost | `cost`, `costCurrency`, `costSource` (`provider`/`computed`) | Mirrors `MessageStats` cost fields |

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
| 1 | `MessageService.update` hook | All live persistent-chat turns (the stream pipeline finalizes every assistant message through `update({ stats })`) | Post-commit, fire-and-forget `recordFromMessage` |
| 2 | `TemporaryChatService.persist` | Temp chats the user keeps (raw-inserts bypass the hook) | Same projection, fired after the insert tx |
| 3 | `reconcileFromMessages` | v1-migrated history; rows lost to crash/quit | Lazy backfill, §5 |

`recordFromMessage` guards: assistant role, parseable `modelId`
(`providerId::modelId`), and a usage signal (any of input/output/total
tokens or cost) — timing-only stats don't create rows. Writes go through
`DbService.withWriteTx` with `onConflictDoUpdate` on `messageId`.

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

## 7. Coverage today & extension to stateless surfaces

| Surface | Recorded | Notes |
| --- | --- | --- |
| Persistent chat (incl. multi-model, continue) | ✅ | Path 1 |
| Kept temporary chats | ✅ | Path 2 |
| v1-migrated history | ✅ (backfilled) | Path 3, `backfill`/`none` attribution |
| Discarded temporary chats | ❌ | User chose ephemerality; in-memory only |
| Agent sessions | ❌ | Separate table (`agent_session_message`); needs a sibling hook in `AgentSessionMessageService.saveMessage` |
| **API Gateway / translate / rename / embeddings** | ❌ (the motivating gap) | See recipe below |

### Recipe: recording a stateless request

The ledger is already shaped for this — `messageId` is just a unique string,
not a FK. A stateless caller records by synthesizing an id:

1. At the call site (e.g. gateway request teardown, `generateText` finish),
   build the input from the SDK usage result:
   `{ id: requestId, topicId: null, role: 'assistant', modelId, stats }`.
2. Fire `usageLedgerService.recordFromMessage(input)` (fire-and-forget),
   or add a thin `recordStatelessUsage({ requestId, modelId, stats })`
   wrapper if the `Message`-pick shape feels off.
3. That's it — attribution, masking, idempotency, and aggregation come free.

Caveats for that follow-up: those call sites live in `src/main/ai` /
`src/main/features`, so unlike the chat hook this *does* touch the request
side (one line at each teardown); reconciliation cannot heal lost stateless
rows (there is no durable source to re-derive them from); and gateway streams
should record once per request, not per chunk.

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
- **Quit-window loss**: a crash between message commit and the async ledger
  write loses that row until the next reconciliation pass.
- **Out-of-order double-persist**: two re-persists of the same message racing
  through attribution can land usage values out of commit order
  (millisecond window, no monotonic guard).

---

## 9. File map

| File | Role |
| --- | --- |
| `src/main/data/db/schemas/usageLedger.ts` | Table, indexes, check constraints |
| `src/shared/data/types/usageLedger.ts` | Entity zod schema, attribution enum |
| `src/shared/data/api/schemas/usageLedger.ts` | Query DTOs, route table |
| `src/main/data/services/UsageLedgerService.ts` | Record/attribution/reconcile/list/stats |
| `src/main/data/services/MessageService.ts` | Live capture hook (`update`) |
| `src/main/data/services/TemporaryChatService.ts` | Kept-temp-chat capture |
| `src/main/data/services/ProviderService.ts` | `getLastUsedApiKeyId` (rotation pointer owner) |
| `src/main/data/api/handlers/usageLedger.ts` | DataApi handlers |
| `src/shared/utils/api/utils.ts` | `maskApiKey` (shared; ledger clamps short keys) |
| `src/main/data/services/__tests__/UsageLedgerService.test.ts` | 23 tests: record/attribution/list/stats/reconcile |
