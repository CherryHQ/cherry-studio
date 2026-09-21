# Knowledge Feature

Per-base knowledge library: ingest sources (files, directories, urls, notes, and pinned external snapshots), convert them to
markdown, chunk + embed the text, and persist everything into a per-base `index.sqlite`
(better-sqlite3 + sqlite-vec) that serves hybrid vector/BM25 search and the Concept ID-addressed
agent tools (`kb_search` / `kb_read` / `kb_tree` / `kb_manage`).

## Pipeline

`pipeline/` spells out the ingestion pipeline in stage order:

```
                 input                preprocess              index                 persist
           ┌──────────────┐      ┌────────────────┐     ┌───────────────┐     ┌───────────────┐
pipeline/  │   sources/   │ ───> │    readers/    │ ──> │   indexing/   │ ──> │  vectorstore/ │
           │ expand dirs, │      │ file → md text │     │ chunk, embed, │     │ index.sqlite  │
           │ url/note     │      │ (pdf, docx, …) │     │ rerank        │     │ (per base)    │
           │ snapshots    │      └────────────────┘     └───────────────┘     └───────────────┘
           └──────────────┘        heavy conversions (MinerU/PaddleOCR/…) run out-of-process
                                   via FileProcessingService, polled by a knowledge job
```

Jobs in `tasks/` drive the stages; `ingestion/` decides which jobs to enqueue; `query/` reads the
result back out. Nothing under `pipeline/` enqueues jobs or mutates item status — that is
orchestration, and it lives in `ingestion/` and `tasks/`.

## Directory map

| Directory | Role |
| --- | --- |
| `KnowledgeService.ts` | Lifecycle facade: registers job handlers, runs boot recovery, delegates every public method, and creates the shared per-base mutation lock (`KeyedMutex`). No domain logic. |
| `base/` | Per-base domain: lifecycle admin (`KnowledgeBaseAdminService` — create with rollback, delete, restore), failed-base guard (`baseGuards.ts`). |
| `ingestion/` | Write-side orchestration: admission checks, item creation, add-conflict resolution, job enqueueing, subtree purge (`subtreePurge.ts`), boot recovery, the reusable publication-free `prepareKnowledgeMaterial` kernel, and the existing `indexKnowledgeItem` Job composition that publishes material and lifecycle state. |
| `external/` | External Knowledge connection, read, and synchronization boundary: main-only encrypted credentials, Feishu user authorization, credential-scoped admission, trusted URL resolution, metadata traversal, normalized Docx Markdown reads, Source creation/manual-sync admission, incremental publication, and reconciliation. The provider adapter itself remains persistence-free. |
| `pipeline/sources/` | Input stage: directory expansion, url fetch (Jina reader), and URL/note snapshot capture with Cherry OKF frontmatter. External snapshots are already-pinned provider-normalized Markdown and do not use Cherry frontmatter. |
| `pipeline/readers/` | Preprocess stage: file → markdown/text `Document[]` readers (pdf/docx/epub/…). |
| `pipeline/indexing/` | Index stage: offset-preserving splitter + chunker, `AiService` embedding/rerank wrappers. |
| `pipeline/vectorstore/` | Persist stage: per-base `index.sqlite` lifecycle (`KnowledgeVectorStoreService`), the store itself (`indexStore/`, synchronous better-sqlite3 driver), vector deletion + index space reclamation (`vectorCleanup.ts`). |
| `query/` | Read side + Concept ID tool surface: base discovery and hybrid search with visibility filtering (`KnowledgeQueryService`); Concept ID read/grep/tree plus the `kb_manage` delete/refresh writes, which delegate to `ingestion/` (`KnowledgeConceptService`). |
| `tasks/` | Job handlers — the pipeline executors (see below); `prepareItem.ts` is a prepare-root handler-private helper that expands a directory root into child items. |
| `pathStorage.ts` | `raw/` path allocation: collision-free names, reservation, base file paths. |
| `items.ts` / `types.ts` | Shared item vocabulary (type aliases, predicates, source probing, material-path derivation); branded ids, queue names, idempotency keys. |

## Jobs

All jobs run on the per-base queue `base.{baseId}`; idempotency keys prevent double-enqueues.

| Job | Does | Enqueued by |
| --- | --- | --- |
| `knowledge.prepare-root` | Expand a directory root into child items, then enqueue leaf indexing. | `ingestion` (add), reindex handler |
| `knowledge.index-documents` | Adapt JobManager context to `indexKnowledgeItem`, which owns live lookup/status, URL/note capture, `prepareKnowledgeMaterial`, the base-locked store rebuild, and completion. | `ingestion`, prepare-root, fp-check |
| `knowledge.check-file-processing-result` | Poll a FileProcessingService job (5s delay per round); on success enqueue indexing. | `ingestion` (files needing conversion) |
| `knowledge.delete-subtree` | Cancel active jobs → delete vectors → strictly delete external snapshots and best-effort delete ordinary files → delete rows. | `ingestion` (delete), external replacement/reconciliation, recovery |
| `knowledge.reindex-subtree` | Verify source → re-acquire it → delete vectors → reset statuses → re-enqueue indexing. | `ingestion` (reindex) |
| `knowledge.sync-external-source` | Scan one persisted Source, incrementally publish supported documents, reconcile missing/denied documents, and settle the Source summary. | External Source creation and manual synchronization |

Indexing jobs and `knowledge.reindex-subtree` declare `recovery: 'abandon'` — an app restart never
silently resumes them (that would auto-spend the paid embedding API); boot recovery parks
interrupted items at `failed` instead. Only `knowledge.delete-subtree` uses `recovery: 'retry'`.

Item status flow: `preparing` (directory) / `processing` → `completed` | `failed`; any status →
`deleting` → row removed. `reading`/`embedding` are transient sub-phases surfaced while the index
job runs.

`prepareKnowledgeMaterial` is the reusable read → chunk → embed layer. It takes
an explicit item descriptor and returns the store rebuild input without opening
or publishing a store, changing rows or statuses, or moving a snapshot. The
operation still reads files, performs embedding calls, and reports progress;
"publication-free" means it has no persistent publication side effect. The
current `indexKnowledgeItem` composition remains the publication owner for ordinary Job
indexing. External synchronization instead stages provider Markdown at a distinct versioned
path/item id, passes that descriptor to preparation, and swaps document ownership under the
same per-base mutation lock. Slow scan/read/embed work stays outside the lock; the Source
revision and active Job id fence every publication and final summary write.

Creating a Source re-resolves the user-entered URL in main, then rechecks the base, connection,
authorization state, resolved tenant, and provider-scope uniqueness in the same write transaction
that persists the Source, enqueues its initial `knowledge.sync-external-source` Job, and binds
`activeJobId`. Manual sync
uses the same Job type, per-base queue, and per-Source idempotency key, so repeated requests
coalesce onto the active Job without replacing its original trigger or start time. The Job
payload contains only Source/Base identity, revision, and trigger; credentials and provider
payloads remain in the main-only runtime boundary.

External synchronization creates an invisible `deleting` external item before writing its versioned
snapshot, material, or vectors. Publication CAS-promotes that staging row, switches document ownership,
marks any previous owner `deleting`, and durably enqueues its subtree cleanup in one transaction. Success
therefore means the previous content is hidden and cleanup was accepted; it does not promise the old
physical bytes are already gone. A failed stage keeps its `deleting` row as the durable artifact locator
and best-effort admits the same cleanup job. Service startup and the start of each Source sync recover
committed deleting roots in batches.

URL/note snapshot files contain Cherry OKF frontmatter, which their reader
removes before chunking. External snapshots contain provider-normalized
Markdown with no Cherry wrapper; the reader preserves the decoded UTF-8 text
verbatim, including provider-authored frontmatter. The owning document's
`contentHash` must correspond to that exact chunker input.

**Reindex rebuilds from the type's authoritative local input.** A file re-copies the user's original
over its `raw/` copy (and reprocesses if the base has a document processor), a directory rescans its
original folder, a url re-fetches, and a note rewrites its snapshot from `data.content` (the note's
text in the DB is the source; its `raw/*.md` file is a derived export). An external item is different:
Layer 2 has no provider fetch, so it rebuilds from its already-pinned `raw/` snapshot. The admission
gate (`classifyKnowledgeItemReacquireSource`) rejects a reindex when the corresponding input is gone
instead of wiping vectors with nothing to rebuild from. Restore asks a *different* question and keeps
its own probe (`classifyKnowledgeItemRestoreSource`): it copies out of this base, so a file whose
original vanished still restores fine, and a restored external item becomes ownerless static content.
A directly selected active-owned external leaf may therefore be reindexed without severing ownership;
ownership admission applies to descendants that a selected container rebuild would delete.

## Concurrency

The per-base mutation lock is a core `KeyedMutex` (acquired via `runExclusive`), an **application-level** mutex serializing multi-step business
invariants that span the main DB, the index store, and the filesystem (e.g. add's
read-conflicts-then-create-rows sequence). It is not about protecting SQLite itself — the per-base
driver is synchronous, and single statements are atomic. Handlers acquire the lock only around the
mutation section, never across slow I/O (fetch, read, embed).

External Knowledge uses a separate credential-scoped lane. Refreshes for one credential collapse
into one token rotation, while different credentials keep independent request and backoff state.
Feishu reads reserve the documented endpoint budget before each individual HTTP attempt; a retry of
one page or body request does not replay completed traversal work. Preview is ephemeral and reads
metadata only. The adapter holds no queue, token, limiter, or session state of its own.
`KnowledgeService` opens its local admission gate only after the runtime starts. Shutdown closes that
gate first, lists and individually cancels pending, delayed, and running external-sync Jobs and awaits
their settlement, then stops the runtime last so cancellation remains the authoritative classification.

## Related docs

- Data-layer selection and patterns: [docs/references/data/README.md](../../../../docs/references/data/README.md)
- Concept ID = material relative path (OKF §2): the addressing primitive for `kb_read`/`kb_manage`;
  resolved against the index store and re-validated against the visible `knowledge_item`.
