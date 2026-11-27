# Agent Note: Backfill embeddings from the in-base copy, one indexing job per leaf

Status: proposed

English | [中文](2026-10-22-knowledge-backfill-from-in-base-copy.zh.md)

## Problem

`KnowledgeIngestionService.enableEmbeddingModel` sets an embedding model on a BM25-only base, then backfills vectors by reindexing every root through `knowledge.reindex-subtree`. That backfill has two problems.

- **Items read as `completed` without vectors.** The model is committed while every item stays `completed`, and an item leaves `completed` only when its reindex job reaches its lock section. Reindex jobs declare `recovery: 'abandon'`, so after a quit the next start cancels a job that never got there. The boot sweep (`failInterruptedItems`) fails only in-flight items, so those items stay `completed` without vectors: vector search silently misses them and nothing prompts a repair (#22365).
  - On `main` the window lasts until the single backfill job takes its lock. It is longer while that job re-fetches URL roots.
  - The [async source copy Spec](2026-10-21-knowledge-async-source-copy.md) enqueues one job per root, which widens the window to the whole time the backfill's jobs are queued.
- **It depends on the originals.** `reindex-subtree` re-acquires every root from its original: it re-copies files, rescans folders, and re-fetches URLs.
  - The admission check (`assertSubtreesCanReindex`) therefore rejects enabling a model for the whole base when a single original has been moved or deleted.
  - The backfill also re-copies and re-fetches content the base already holds (#22092).

A backfill only needs vectors for the items search can return, the `completed` ones. Each of them already holds its content in the base: the `raw/` copy, a pinned processed artifact, or a URL or note snapshot.

## Proposal

The backfill stops going through reindex and reuses the regular per-item indexing path.

- **Rows first.** Under the base mutation lock, one write transaction does three things:
  - commits the model, through a transaction form of `KnowledgeBaseService.update`;
  - moves every `completed` leaf of the base (file, url, note) to `processing`;
  - reconciles the leaves' containers, so directories become `processing` through the existing container rollup.

  Either the model and the statuses commit together or neither does. From then on, no backfill target reads as `completed` until its own indexing completes.
- **`failed` leaves are left alone.** They keep their status and error and get no job. A later reindex indexes them with the model.
- **One indexing job per leaf.** After the lock is released, the backfill calls `scheduleItem` for each activated leaf, the same way `addItems` schedules a new item. If scheduling a leaf throws, that leaf is marked `failed` with the reason and the remaining leaves are still scheduled. A delete cancels only the jobs of the items it removes.
- **In-base sources only.** `knowledge.index-documents` reads the `raw/` file or its pinned processed artifact, and the captured URL or note snapshot. It fetches nothing and copies nothing. Every `completed` leaf has such a source: a URL or note completes only after its snapshot is captured, and a file only after its copy has landed.
  - `scheduleItem` runs without `forceFileReprocess`, so a file that already has a processed artifact is not reprocessed.
  - `rebuildMaterial` replaces each item's BM25-only material in one transaction, so nothing needs deleting first.
- **Admission.** The base must be allowed to run runtime operations and every target subtree must be `completed` or `failed`; `KnowledgeBaseService.update` still rejects switching an already-configured model. The source-existence check is dropped, so a moved or deleted original no longer blocks the backfill. These statuses are read under the base mutation lock, so an item that an add starts while enabling waits for the lock is seen; it would otherwise index without vectors, because the backfill only picks up `completed` leaves.
  - No `knowledge.reindex-subtree` job of the base may be pending or running. A refresh leaves its items `completed` until its job resets them, so their status does not show it. A backfill admitted beside it could index the old copy over the refreshed one, and the refresh would then skip the item as already `completed`. The check runs under the base mutation lock, just before the write transaction.
  - Reindex admission reads its subtree statuses again, and enqueues, under the same lock. A backfill that activates the items while a reindex is still checking their sources therefore makes that reindex reject.
- **Recovery stays as it is.** `knowledge.index-documents` keeps `recovery: 'abandon'`. After a quit, unfinished leaves are still in an in-flight status, so the boot sweep fails them with `indexing_interrupted`. Leaves that finished stay `completed`.
- **User-triggered reindex still re-acquires from the original.** Only its status check moves under the base lock, as above. Separating "rebuild from the in-base copy" from "refresh from source" for reindex is left to #22092.

This partially supersedes the [async source copy Spec](2026-10-21-knowledge-async-source-copy.md): its AC9 clause about the backfill and its restart-gap limitation. Both notes stay active and cross-linked.

## Alternatives considered

- **Activate roots when their jobs are enqueued, keeping one `reindex-subtree` job per root.** This closes the restart window, but the backfill still re-acquires from the originals. A moved original therefore still blocks it, and a root whose original vanished before its job ran needs an extra failure path.
- **One backfill job for every root, activated in the same transaction as the model, plus an integrity scan whenever a base is opened (#22402).** A delete during the backfill cancels the shared job and fails every other root. The scan marks items `failed` even when the reindex it points to cannot repair them, for example when the original has moved. It also runs a synchronous main-process scan on every visit to a base.
- **Backfill `failed` leaves too, as `main` does.** Search never returns a `failed` leaf, so vectors would add nothing it can find. The backfill would become a retry nobody asked for: a URL whose first fetch failed has no snapshot and would be fetched, and a file whose processing failed would go through the processor again.
- **Mark reindexed items active when the reindex is enqueued.** The backfill admission would then see a pending refresh from item statuses alone. But a waiting refresh would hide its items from search, and after a quit the boot sweep would fail items whose old index is still good. A dedicated pending status would avoid both, but it needs a migration and UI work, and it belongs with #22092.
- **Resume never-started backfill jobs after a restart.** JobManager would need recovery that depends on job state, and the embedding API would be called again after a quit without the user asking.
- **Track backfill progress on the base.** A base-level "vectors pending" state would keep items `completed` and BM25-searchable during the backfill. It needs a migration and new UI, so it is deferred.

## Acceptance criteria

- AC1 — Enabling an embedding model on a BM25-only base commits the model and moves every non-deleting leaf out of `completed` together; when that write fails, neither the model nor any item status changes. (verification: unit)
- AC2 — Each leaf is indexed by its own job from the base's own copy: no original is re-copied, no folder is rescanned, no URL is fetched, and a file with a processed artifact is not reprocessed. (verification: unit)
- AC3 — Enabling an embedding model succeeds, and every leaf is indexed, when some items' original files or folders have been moved or deleted. (verification: unit)
- AC4 — After an app quit during the backfill, every leaf that had not finished indexing is `failed` with `indexing_interrupted` at the next start, the leaves that finished stay `completed`, and no leaf is `completed` without vectors. (verification: unit)
- AC5 — Deleting an item during the backfill stops only that item's work; the other leaves still finish. (verification: unit)
- AC6 — A leaf whose indexing job cannot be scheduled is marked `failed` with the reason, and the other leaves are still scheduled. (verification: unit)
- AC7 — A user-triggered reindex still re-acquires from the original source, and still rejects an item whose original is missing. (verification: unit)
- AC8 — A leaf that is `failed` when the model is enabled keeps its status and error and gets no indexing job, so a URL whose first fetch failed is not fetched. (verification: unit)
- AC9 — While a reindex of the base is pending or running, enabling an embedding model is rejected and changes neither the model nor any item status; it succeeds once that reindex settles. (verification: unit)
- AC10 — A reindex whose items a backfill activates while their sources are being checked is rejected and enqueues no job. (verification: unit)
- AC11 — When an add starts an item while enabling waits for the base lock, enabling is rejected and changes neither the model nor any item status. (verification: unit)

## Risks

- **The base is hidden from search during the backfill.** Every leaf stays in an active status until its own indexing completes, and active items are excluded from search, BM25 included. `main` behaves the same for a file base once its backfill job starts. A base-level pending state would avoid this (see the alternatives).
- **One job row per leaf.** A large base adds as many rows to its queue as importing the same number of items, and later work on that base waits behind them.
- **A one-time processor run.** A file indexed before the base had a document processor has no processed artifact, so the backfill sends it through the processor once. That may be a paid call.
- **Failed items need a manual reindex.** A leaf that was `failed` before the model was enabled, or whose backfill fails or is interrupted by a quit, stays without vectors until the user reindexes it. The model is already set by then, so the backfill cannot run again. That reindex still needs the original until #22092 lands.
