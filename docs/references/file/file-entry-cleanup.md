# File Entry Cleanup (GC) Design

> Status: implemented (PR #16727) — the `cleanup_policy` column, the scan-based cleanup pass, and the contract updates below shipped together; this document is the design record and behavioral reference for that implementation.
>
> The binding contract in [`file-manager-architecture.md`](./file-manager-architecture.md) §7 was updated in the same series: zero-reference `manual` entries remain report-only, while `delete_when_unreferenced` entries are reclaimed by the cleanup pass described here.
>
> This document replaces the earlier outbox-queue proposal (`file-entry-cleanup-queue.md`); the queue design is preserved in [§10 Rejected Designs](#10-rejected-designs) with the rationale for its rejection.

> **Decision — cleanup is a fully silent mechanism (2026-07, product call).**
> An earlier revision of this PR surfaced the machinery to users: a FilesPage per-file **pin / unpin** toggle (a `PATCH /files/entries/:id` consumer) plus a **"clean up unreferenced files"** drain button (the escape valve for the safety abort). Product review concluded that asking users to understand "automatic cleanup" and "pinning" is unwarranted **cognitive load** — the file module already keeps the user's original on disk (chat attachments are copies), so nothing irreplaceable is at stake. All of it was therefore removed:
> - no user-visible pin/unpin control, no "pending cleanup" badge, no manual "clean up now" action;
> - the `PATCH /files/entries/:id` policy-flip endpoint is deleted (its only consumer was the pin toggle);
> - the **count-fraction safety abort is removed entirely** (see §5.3 for the rationale) — it false-positived on the *primary legitimate use case* (a user deleting many chats/paintings, whose attachments then genuinely should be reclaimed), and once the flip endpoint is gone no runtime path flips `manual → delete_when_unreferenced`, so the "library silently deleted by a bug" nightmare it guarded loses its trigger.
>
> `cleanup_policy` is still set — at creation and by the migrators — but only ever *observed*, never user-edited. Cleanup runs invisibly on init + the idle interval. Sections below are written to this silent design; where they previously described the pin/drain UI, that history is called out inline.

## 1. Problem

Some business entities own file references through dedicated association tables (`chat_message_file_ref`, `painting_file_ref`). Those tables are FK-constrained on both sides: deleting a `file_entry` cascades and removes association rows, and deleting the owning business entity cascades and removes association rows.

The second path leaves permanent garbage today:

```text
business entity deleted
  -> xxx_file_ref rows cascade-delete
  -> file_entry row remains          (DB sweep only reports, never deletes)
  -> internal physical blob remains  (FS sweep only unlinks files with NO DB row)
```

Because the row survives, neither existing sweep surface can ever reclaim the blob. Deleting a topic, message, or painting leaks every attached/generated file forever.

A second leak exists that the FK-cascade framing misses: **entries that never acquire a persistent ref**. The chat send pipeline creates the `file_entry` first (`buildFileParts.ts`) and writes `chat_message_file_ref` rows only when the message is persisted; a crash or failure in between leaves a zero-ref entry that no cascade event will ever touch. The ad-hoc `permanentDelete` in `imageGenerationJobHandler` is this same demand leaking into imperative business code.

For some files, zero refs is nevertheless the correct end state: a user-visible library entry may have zero references and still be intentionally retained. The file module cannot infer that intent from ref count alone — both cases look like `active file_entry + zero refs`. Business intent must be stored as data.

## 2. Design Goals

- Keep business delete operations free of immediate filesystem side effects.
- Store cleanup intent as per-entry data (`cleanup_policy`), evaluated by FileManager — never by SQL triggers, never inferred from ref count globally.
- Reclaim both leak classes: refs-lost-via-cascade **and** never-referenced entries.
- Preserve user-owned / manually retained library entries even at zero refs.
- Make cleanup crash-recoverable and idempotent **by construction** (derived state, no bookkeeping).
- Reuse FileManager deletion semantics (`permanentDelete` internals) for physical cleanup and cache invalidation.

## 3. Non-goals

- Do not make `ref_count = 0` globally imply deletion.
- Do not add SQL triggers or an event/outbox queue (see [§10](#10-rejected-designs)).
- Do not add per-business `onSourceDeleted` hooks to `FileRefService`.
- Do not make `FileRefService` own persistent relationship writes; source domains still own their association tables.
- Do not surface any of this to the user: no pin/unpin control, no cleanup badge, no manual "clean up now" action, no policy-flip endpoint. The mechanism is deliberately silent (see the Decision note at the top).

## 4. Business Intent: `cleanup_policy`

New `file_entry` column:

```sql
cleanup_policy TEXT NOT NULL DEFAULT 'manual'
  CHECK (cleanup_policy IN ('manual', 'delete_when_unreferenced'))
```

| Value | Meaning |
|---|---|
| `manual` | Keep the entry even at zero refs. Cleanup requires an explicit user/caller action. |
| `delete_when_unreferenced` | FileManager may delete the entry once it has zero persistent refs, no temp-session refs, and is older than the grace window. |

### 4.1 Assignment at creation — business-owned creation paths are `delete_when_unreferenced`

Files that follow an owning business object's lifecycle are `delete_when_unreferenced`. Chat attachments are **copies** (the user's original stays on disk), so automatic reclamation loses nothing irreplaceable. Add-to-library paths (a Files-page upload) are `manual` and stay so — there is no user control to change either direction at runtime (silent design).

| Creation path | Policy |
|---|---|
| Chat attachments (`src/renderer/utils/file/buildFileParts.ts`) | `delete_when_unreferenced` |
| AI-generated images (`src/main/ai/AiService.ts`) | `delete_when_unreferenced` |
| Painting inputs / outputs (`downloadImages.ts`, `runPainting.ts`, composer input hook) | `delete_when_unreferenced` |
| Image-generation transient inputs (`imageGenerationJobHandler.ts`) | `delete_when_unreferenced` — its current ad-hoc post-job `permanentDelete` is **removed**; the cleanup pass takes over (worst-case residency ≈ grace + interval, acceptable for a transient input) |
| Provider / mini-app logos (`src/main/services/entityImageBinding.ts`) | `delete_when_unreferenced` — ref-backed single-file slots (`provider_logo_file_ref` / `mini_app_logo_file_ref`); reclaimed on owner delete or slot replacement |
| Files-page uploads (add-to-library, `src/renderer/pages/files/FilesPage.tsx`) | `manual` |
| User avatar (`src/main/ipc/handlers/profile.ts`) | `manual` — the **exception**: it holds its id only as a `file:<id>` tag in the `app.user.avatar` preference (no ref table), so the anti-join would reclaim it if it were auto-managed |

**Type rule**: `cleanupPolicy` is **required** in the TS creation surfaces (`CreateFileEntryRowSchema`, `CreateInternalEntryParams` / `EnsureExternalEntryParams` IPC schemas) so every caller makes an explicit choice at compile time. The DB default `'manual'` exists only as the safe backstop for migration and raw-SQL paths — a forgotten assignment leaks (recoverable) instead of deleting (unrecoverable).

### 4.2 Policy transitions

- **`ensureExternalEntry` reuse branch — upgrade-only**: when upserting hits an existing row, the call may upgrade `delete_when_unreferenced` → `manual` (caller passes manual intent) but must never downgrade `manual` → `delete_when_unreferenced`. A library file that gets `@`-mentioned in a chat must not silently become a cleanup candidate. This is the **only** `→ manual` transition, and there is **no runtime `manual → delete_when_unreferenced` transition at all** (a file becomes auto only by being created auto, or by the migrators' one-time reference-state flip). That closure is what makes the removed safety abort unnecessary (§5.3): no bug can mass-convert a user's `manual` library into cleanup candidates.
- `cleanup_policy` applies to **both origins**. Deleting an external entry is DB-only (the user's file is never touched), per existing `permanentDelete` semantics.

> Removed: a `PATCH /files/entries/:id` policy-flip endpoint (its only consumer was the now-removed FilesPage pin toggle). See the Decision note at the top.

### 4.3 Renderer visibility

FilesPage lists **all** entries (preserving the v1 habit of browsing historical uploads), but `cleanup_policy` is **not** surfaced in any way — no pin/unpin control, no auto/kept badge, no "pending cleanup" count. The mechanism is silent: a file quietly disappearing after its owning chat/painting is deleted is the intended lifecycle (the user's original is untouched — chat attachments are copies), recorded in the breaking-changes log (§7.3). `cleanup_policy` still rides in the DataApi read shape as plain data, but nothing in the UI reads it.

## 5. Cleanup Pass (Reaper)

FileManager owns the pass because it already owns entry deletion semantics, physical cleanup, and file-module caches. It lives as a private module alongside `orphanSweep.ts` (`src/main/services/file/internal/entryCleanup.ts`), exposed as `FileManager.runEntryCleanup()`.

There is **no queue and no trigger**: the candidate set is fully derivable from current DB state, so discovery is a query, and idempotence/crash-safety follow by construction.

### 5.1 Candidate query

Reuses the anti-join skeleton of `FileEntryService.findManualUnreferenced`:

```sql
SELECT id FROM file_entry
WHERE cleanup_policy = 'delete_when_unreferenced'
  AND created_at < :now - :grace
  AND NOT EXISTS (SELECT 1 FROM chat_message_file_ref r WHERE r.file_entry_id = file_entry.id)
  AND NOT EXISTS (SELECT 1 FROM painting_file_ref  r WHERE r.file_entry_id = file_entry.id)
  AND NOT EXISTS (SELECT 1 FROM job_file_ref        r WHERE r.file_entry_id = file_entry.id)
ORDER BY created_at
LIMIT :batch   -- default 100 per pass
```

The `job_file_ref` clause is what keeps async image-generation job inputs alive: those input images / mask are `delete_when_unreferenced` entries whose ids live only in `job.input` JSON (invisible to the anti-join), so a live job holds them through a real ref row instead. Without it, a non-terminal job whose inputs aged past the grace window could have them reclaimed by a startup / interval pass before recovery resumes it, breaking `read(inputFileIds)`. Deleting the job row (terminal-row pruning) cascades the ref, releasing the inputs for reclaim.

- `deleted_at` is **not** filtered: a trashed zero-ref auto entry is reclaimed too (the user already discarded it, and trash auto-expiry is deferred).
- The unique index `(file_entry_id, source_id, role)` on each ref table backs the `NOT EXISTS` probes; at desktop scale the query is single-digit ms. A partial index on `cleanup_policy = 'delete_when_unreferenced'` is the first cheap lever if it ever measures slow (§11).
- The `NOT EXISTS` clauses MUST be generated from the `persistentFileRefTablesBySourceType` registry (`schemas/fileRelations.ts`), never hand-enumerated. A ref table missing from the anti-join makes its entire source's files look unreferenced — a catastrophe the fraction threshold (§5.3) cannot reliably catch (a source holding <50% of entries slips under it). Registry-driven generation plus a test asserting coverage of every registered table makes the omission structurally impossible.

### 5.2 Grace window

`GRACE = 1h` on `created_at`. This protects the entry-before-ref send window (§1) and any similar create-then-reference flow, without per-event bookkeeping. Crash leftovers inside the window are simply collected on a later pass. Single-transaction ref replacement (`replaceChatMessageFileRefsTx`, painting update) needs no grace at all — the pass runs under `withWriteTx` serialization and can never observe a transaction's intermediate state.

### 5.3 Safety: no volume-based abort

An earlier revision aborted a pass when candidates were both `≥ 20` and `> 50%` of all `file_entry` rows — a crude "this looks like a bug" heuristic borrowed from the FS sweep. **It was removed.** The reasoning:

- **It false-positives on the primary legitimate use case.** Cleanup exists to reclaim files whose owning chat/painting was deleted. A user clearing most of their history is exactly when the candidate fraction crosses 50% — and those attachments genuinely *should* be reclaimed. Any volume threshold (fraction *or* absolute count) cannot distinguish a legitimate mass-delete from a bug by count alone; a large-enough legitimate delete always trips it. In the silent design there is no escape valve to unstick it, so the abort would leave the very files it is meant to clean unreclaimed indefinitely.
- **The nightmare it guarded is now structurally impossible.** The abort's stated job was to catch a *classification* bug that mass-converts `manual` library files into cleanup candidates. But after removing the policy-flip endpoint (§4.2) there is **no runtime `manual → delete_when_unreferenced` path**: a file is auto only if it was created auto (few, `cleanupPolicy`-required, value-locked creation surfaces) or flipped once by a migrator (referenced ids only, tested). A user's `manual` library cannot become candidates by any runtime bug.
- **The scarier *coverage* bug is handled elsewhere.** A ref table missing from the anti-join (referenced files looking unreferenced → deleting referenced data) is caught structurally: the anti-join is generated from the `persistentFileRefTablesBySourceType` registry (§5.1), and a schema-reflection test asserts every FK-to-`file_entry` table is registered (§9) — a CI failure, not a runtime one.

What remains as protection, and why it is sufficient: the 1h `created_at` grace window (§5.2), the per-candidate in-transaction re-verification of both policy and ref count (§5.4), the registry-driven anti-join plus its coverage test (§5.1 / §9), `cleanupPolicy`-required creation surfaces with value-lock tests, and the DB default of `manual`. A genuine mass-misclassification would have to survive all of those — at which point a volume gate that also blocks every legitimate mass-delete is net negative.

### 5.4 Per-candidate protocol

For each candidate id, one serialized `DbService.withWriteTx` (callback is synchronous):

1. Re-fetch the entry; missing → skip.
2. `cleanup_policy != 'delete_when_unreferenced'` → skip (policy flipped since the query).
3. Count persistent refs **inside the transaction** (new tx-scoped method on `FileRefService`); > 0 → skip.
4. Delete the `file_entry` row.

Temp-session refs are checked **before** the transaction (they live in main-process `CacheService` memory and are not transactional; a temp ref appearing mid-transaction is tolerated — see §6). Any temp-session ref → skip the candidate this pass.

After commit, run the existing `cleanupDeletedEntry` from `permanentDelete`'s implementation: invalidate `versionCache`, remove from `DanglingCache`, best-effort unlink the internal blob (external: DB-only, user's file untouched). If unlink fails, the DB state is already converged and the FS orphan sweep reclaims the blob later.

### 5.5 Triggering

Cleanup is silent — there is no user-facing trigger:

- Once on FileManager init, after `danglingCache.initFromDb()`.
- `BaseService.registerInterval()`, every 30 min, **idle-gated** (below).
- The main-side `runSweep()` maintenance method still runs the pass as the first of its three sub-sweeps (FS + DB orphan sweep + entry cleanup), but nothing user-facing calls it — the "clean up now" button that used to was removed with the rest of the UI.

**No DB trigger is involved anywhere**, and — deliberately — no per-delete-flow nudge either. Business delete paths drop refs via FK cascade, so a JS-level nudge can only be sprinkled imperatively across every ref-dropping delete site: it multiplies with each new path, and a forgotten call degrades silently. An earlier revision shipped a debounced `scheduleCleanup()` nudge from the topic/message/painting deletes; it was removed because the latency it bought (reclaim in ~5s instead of ≤30min idle / ≤2h active / next init pass) is invisible for a background hygiene process whose grace window already accepts hours. If sub-interval reclamation ever becomes a product requirement, reintroduce it as a domain event FileManager subscribes to — not as scattered imperative calls.

**Idle gate on interval ticks.** At each tick, run only if `PowerService.getSystemIdleTime() ≥ 60s` (`core/power/PowerService.ts`; FileManager declares `@DependsOn(['PowerService'])` — same WhenReady phase) **or** the last completed pass is > 2h old (reliability floor for always-active sessions); otherwise skip and let the next tick re-check. This keeps background deletions out of moments the user is actively working, at the cost of one native call per tick.

The gate applies to interval ticks **only**. The init pass (previous-session backlog) and any `runSweep()` maintenance call run ungated. Note this is still timer-driven: `powerMonitor` pushes no "became idle" event for arbitrary thresholds, so idleness can only be sampled — an idle gate refines the interval, it cannot replace it.

### 5.6 Failure handling & observability

A failed candidate is logged and simply retried on the next pass — no attempt counters, no backoff state, no error columns. Each pass emits one structured log record via `loggerService` (mirroring `orphan-sweep`):

```typescript
{
  event: 'file-entry-cleanup',
  outcome: 'completed' | 'failed',   // no 'aborted' — the volume abort was removed (§5.3)
  candidates: number,
  deleted: number,
  skippedTempRefs: number,
  skippedRefsReappeared: number,
  gonePinned: number,          // vanished or upgraded to manual (ensureExternal reuse) between query and tx
  failed: number,              // per-candidate throws; retried next pass
  unlinkFailures: number,
  durationMs: number,
  // 'failed': errorMessage: string (raw error also logged for the stack)
}
```

## 6. Race and Failure Analysis

| Scenario | Outcome |
|---|---|
| Business delete cascades ref rows; pass runs later | Candidate appears in the next query; reclaimed. |
| Entry has another persistent ref | Anti-join excludes it; if the ref appears between query and per-candidate tx, step 3 re-check skips. |
| Single-tx ref replacement (delete + re-insert) | Never observable: `withWriteTx` serialization means the pass sees pre- or post-state only. |
| New persistent ref races the delete | Serialized writes decide order. Ref insert commits first → step 3 sees it. Delete commits first → ref insert fails FK validation (same failure mode the business flow already has against explicit `permanentDelete`). |
| Send pipeline: entry created, refs not yet written | Protected by the 1h `created_at` grace window; a crashed send's orphan is collected after the window. |
| Temp-session ref exists | Candidate skipped this pass; temp refs are restart-scoped, so the entry is collected once the session ends. |
| Temp-session ref created between check and commit | Tolerated: the temp ref points at a deleted entry, is pruned by the existing sweep, and persisting it fails FK validation. Temp refs are advisory, not a correctness boundary. |
| Policy upgraded to `manual` (ensureExternal reuse) between query and tx | Step 2 re-check skips; counted as `gonePinned`. |
| Crash after row delete, before unlink | Blob becomes an FS orphan; existing `runFileSweep` reclaims it. |
| Crash mid-pass | No state to recover; the next pass re-derives candidates. |
| Classification/migration bug creates a huge candidate set | No volume abort (§5.3): reclamation proceeds. The residual risk is bounded structurally — no runtime `manual → auto` path (§4.2), coverage guarded by the registry + reflection test (§5.1 / §9), creation surfaces `cleanupPolicy`-required + value-locked. |

## 7. Migration & Rollout

### 7.1 Schema migration

Standard Drizzle column addition (dev-stage migrations are throwaway per repo policy; regenerate as usual). DB default `'manual'`.

### 7.2 v1 migrator classification — by reference state

- Migrators that backfill persistent refs (`ChatMigrator`, `PaintingMigrator`) set `cleanup_policy = 'delete_when_unreferenced'` on the file ids they reference — migrated files follow the same lifecycle rule as newly created ones.
- Entries with zero refs after all backfills keep the default `'manual'`.

Rationale: a blanket `delete_when_unreferenced` would let the **first cleanup pass mass-delete every v1 library file that happens to be unreferenced** — unacceptable data loss. Zero-ref survivors stay report-only, exactly like today.

### 7.3 Breaking-changes log

Entry: `v2-refactor-temp/docs/breaking-changes/2026-07-04-automatic-file-cleanup-on-deletion.md` — deleting a chat/topic/painting now silently reclaims its exclusively-owned files (the user's original is untouched — chat attachments are copies); the Files page no longer accumulates every historical upload forever. Files uploaded via the Files page (`manual`) are kept; there is no user control over retention.

## 8. Contract & Documentation Updates

Shipped in the same PR series:

- [`file-manager-architecture.md`](./file-manager-architecture.md) §7: the no-reference policy matrix gains the `cleanup_policy` axis; §7.1 "there are no automatic deletion exceptions" and §7.2 "no automatic dangling-external cleanup" are **narrowed to `manual` entries**; §10's DB pass description becomes "report manual / reclaim auto".
- [`architecture.md`](./architecture.md) §5.2 "adding a new sourceType" checklist: **no new step** — a new persistent ref table already had to join `FileRefService` aggregation and the unreferenced/count queries (steps 3/5); the cleanup pass rides those same queries. (Contrast: the rejected queue design added a per-table trigger step that would fail silently when forgotten.)
- This document replaces `file-entry-cleanup-queue.md`.

## 9. Test Plan

- **Schema**: column default + CHECK; `CreateFileEntryRowSchema` requires an explicit policy.
- **Cleanup pass unit tests** (`setupTestDatabase()`):
  - `manual` zero-ref entry → preserved;
  - `delete_when_unreferenced` zero-ref past grace → row deleted, internal blob unlinked;
  - entry with a persistent ref → preserved;
  - temp-session ref → skipped this pass;
  - entry younger than grace → skipped;
  - trashed (`deleted_at` set) auto entry → reclaimed;
  - external auto entry → row deleted, no FS touch;
  - a large candidate set (e.g. > 50% of rows) still fully reclaims — there is no volume abort (§5.3);
  - candidate query covers every table in `persistentFileRefTablesBySourceType` (behavioral per-table exclusion) **and** a schema-reflection test asserts every FK-to-`file_entry` table is registered;
  - `gonePinned` / `failed` counts: candidate upgraded to `manual` or deleted mid-flight → `gonePinned`; per-candidate throw → `failed`, entry preserved; whole-pass throw → `outcome: 'failed'` with the raw error logged;
  - idle gate: active user (< 60s idle) → tick skipped; idle → runs; > 2h since last completed pass → runs despite activity; init path unaffected by the gate;
  - batch limit respected; failed candidate retried next pass (idempotence).
- **Policy lifecycle**: `ensureExternalEntry` reuse upgrades auto→manual and never downgrades; there is no runtime `manual → auto` transition.
- **Migrators**: ref-backfilled files → auto; zero-ref survivors → manual.
- **Integration**: deleting a topic eventually reclaims its attachments; a `manual` (library-upload) file survives its business owner's deletion.

## 10. Rejected Designs

### 10.1 Outbox queue + ref-table `AFTER DELETE` triggers (the original proposal)

Each persistent ref table got an `AFTER DELETE` trigger inserting `OLD.file_entry_id` into a `file_entry_cleanup_queue` table (`file_entry_id` PK, `first_seen_at` / `last_seen_at` / `next_attempt_at` / `event_count` / `attempt_count` / `last_error`); a FileManager worker drained due rows on an interval, re-validated policy + ref counts, and deleted entries. The queue deliberately carried no FK to `file_entry` (an outbox row may legitimately outlive its target).

Rejected because every load-bearing property turned out to be equaled or beaten by the derived scan:

- **Latency is identical.** SQLite triggers cannot wake JS (better-sqlite3 exposes no update hook), so the worker had to poll the queue on an interval — the design itself named the periodic path "the reliability mechanism". Polling a queue table and polling the derived anti-join have the same reclamation latency. The queue's only remaining edge is O(events) vs O(scan) discovery cost, which at desktop scale (indexed anti-join, single-digit ms, already run today by `runSweep`) is no edge at all.
- **Blind spot: never-referenced entries.** The queue only captures the *had refs → lost refs* transition. Entries that never acquire a ref (crashed sends, abandoned transient inputs — §1's second leak class) never enqueue and leak forever. The scan covers both classes with one `created_at` grace condition.
- **Write amplification inside business transactions.** The trigger fires per deleted ref row — deleting a topic with hundreds of attachments runs hundreds of queue upserts inside the business tx, including for `manual` files whose rows the worker would only discard.
- **Per-table maintenance step.** Every new persistent ref table needed its own trigger wired through `CUSTOM_SQL_STATEMENTS`; forgetting it fails silently as missing cleanup. The scan adds no step beyond the queries a new ref table must already join.
- **Bookkeeping and edge analysis.** Retry columns, capped backoff, `ON CONFLICT` coalescing (which as drafted also reset backoff and never implemented the promised grace window — `next_attempt_at` was set to `now`), plus a page of no-FK justification for queue rows pointing at deleted entries. The scan needs none of it: state is re-derived every pass, so idempotence and crash-safety hold by construction, and roughly half the original test plan (queue mechanics) disappears.

### 10.2 Trigger-as-signal variant (dirty flag)

A slimmed hybrid was considered: keep the triggers but reduce them to a "needs scan" signal the periodic pass checks before running the anti-join. Rejected: it optimizes a cost that does not exist (skipping a <5ms query every 30 min) while retaining most trigger costs — per-table trigger maintenance, business-tx write amplification, signal-row lifecycle choreography (cleared too early → lost signal; too late → redundant scans). It cannot improve latency either, because the signal is still only visible when JS polls. Per-entry signals additionally reintroduce the never-referenced blind spot unless creation also signals or a full scan runs as backstop — at which point the signal pays for nothing. If low latency is ever wanted, a JS-level nudge from delete flows achieves it without touching the DB (§5.5 records why the shipped revision dropped even that).

### 10.3 Per-business `onSourceDeleted` hooks

Coupling every business delete flow (message, topic, assistant-cascade, painting, replacement flows) to file cleanup inverts the ownership model and misses cascade-driven deletions entirely unless every path is hand-enumerated. The decoupled pass catches all of them, including crash leftovers no hook would ever see.

### 10.4 Global `ref_count == 0` implies deletion

Cannot distinguish an intentionally retained library file from business-owned residue; violates the library-preservation stance of `file-manager-architecture.md` §7. Intent must be data (`cleanup_policy`), not inference.

## 11. Evolution Criteria

Revisit the discovery mechanism only when measurement demands it, in this order:

1. **Partial index** on `cleanup_policy = 'delete_when_unreferenced'` — first lever if the candidate query measures slow (it shrinks the anti-join's driving set to auto entries only).
2. **Queue/outbox upgrade** — justified only if (a) observed pass duration materially blocks the main process at real user scale (recall better-sqlite3 is synchronous) despite the partial index, or (b) a product requirement emerges for sub-interval reclamation that an event-driven JS nudge (§5.5) cannot satisfy, or (c) `file_entry` grows by orders of magnitude (≫100k rows). If that day comes, §10.1's blind-spot and grace-window fixes are mandatory parts of any queue implementation.

## 12. Adding a New Persistent File Ref Source

Unchanged from the existing checklist (`architecture.md` §5.2b): add the FK-constrained association table, register it in `persistentFileRefTablesBySourceType`, join `FileRefService` aggregation and the unreferenced/persistent-count queries, add tests. Because the candidate query is generated from that registry (§5.1), the cleanup pass automatically covers any registered table — there is no cleanup-specific registration step, and the coverage test fails if registration is forgotten.
