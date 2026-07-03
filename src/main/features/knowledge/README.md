# Knowledge Feature

Per-base knowledge library: ingest sources (files, directories, urls, notes), convert them to
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
| `KnowledgeService.ts` | Lifecycle facade: registers job handlers, runs boot recovery, delegates every public method. No domain logic. |
| `base/` | Per-base domain: lifecycle admin (`KnowledgeBaseAdminService` — create with rollback, delete, restore, list), failed-base guard (`baseGuards.ts`), per-base mutation lock (`KnowledgeLockManager`). |
| `ingestion/` | Write-side orchestration: admission checks, item creation, add-conflict resolution, job enqueueing, subtree purge (`subtreePurge.ts`), boot recovery. |
| `pipeline/sources/` | Input stage: directory expansion, url fetch (Jina reader), url/note snapshot capture, OKF frontmatter. |
| `pipeline/readers/` | Preprocess stage: file → markdown/text `Document[]` readers (pdf/docx/epub/…). |
| `pipeline/indexing/` | Index stage: offset-preserving splitter + chunker, `AiService` embedding/rerank wrappers, material field derivation. |
| `pipeline/vectorstore/` | Persist stage: per-base `index.sqlite` lifecycle (`KnowledgeVectorStoreService`), the store itself (`indexStore/`, synchronous better-sqlite3 driver), vector deletion + index space reclamation (`vectorCleanup.ts`). |
| `query/` | Read side: hybrid search with visibility filtering (`KnowledgeQueryService`), Concept ID tool surface (`KnowledgeConceptService`). |
| `tasks/` | Job handlers — the pipeline executors (see below); `prepareItem.ts` is a prepare-root handler-private helper that expands a directory root into child items. |
| `pathStorage.ts` | `raw/` path allocation: collision-free names, reservation, base file paths. |
| `items.ts` / `types.ts` | Shared item vocabulary (type aliases, predicates, source probing); branded ids, queue names, idempotency keys. |

## Jobs

All jobs run on the per-base queue `base.{baseId}`; idempotency keys prevent double-enqueues.

| Job | Does | Enqueued by |
| --- | --- | --- |
| `knowledge.prepare-root` | Expand a directory root into child items, then enqueue leaf indexing. | `ingestion` (add), reindex handler |
| `knowledge.index-documents` | Read → chunk → embed → `rebuildMaterial` in one store transaction. | `ingestion`, prepare-root, fp-check |
| `knowledge.check-file-processing-result` | Poll a FileProcessingService job (5s delay per round); on success enqueue indexing. | `ingestion` (files needing conversion) |
| `knowledge.delete-subtree` | Cancel active jobs → delete vectors → delete files → delete rows. | `ingestion` (delete), boot recovery |
| `knowledge.reindex-subtree` | Verify source → delete vectors → reset statuses → re-enqueue indexing. | `ingestion` (reindex) |

Indexing jobs and `knowledge.reindex-subtree` declare `recovery: 'abandon'` — an app restart never
silently resumes them (that would auto-spend the paid embedding API); boot recovery parks
interrupted items at `failed` instead. Only `knowledge.delete-subtree` uses `recovery: 'retry'`.

Item status flow: `preparing` (directory) / `processing` → `completed` | `failed`; any status →
`deleting` → row removed. `reading`/`embedding` are transient sub-phases surfaced while the index
job runs.

## Concurrency

`KnowledgeLockManager` is a per-base **application-level** mutex serializing multi-step business
invariants that span the main DB, the index store, and the filesystem (e.g. add's
read-conflicts-then-create-rows sequence). It is not about protecting SQLite itself — the per-base
driver is synchronous, and single statements are atomic. Handlers acquire the lock only around the
mutation section, never across slow I/O (fetch, read, embed).

## Related docs

- Data-layer selection and patterns: [docs/references/data/README.md](../../../../docs/references/data/README.md)
- Concept ID = material relative path (OKF §2): the addressing primitive for `kb_read`/`kb_manage`;
  resolved against the index store and re-validated against the visible `knowledge_item`.
