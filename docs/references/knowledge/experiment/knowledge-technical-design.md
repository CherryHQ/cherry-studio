---
description: Current Knowledge storage and retrieval implementation - raw files, per-base index schema, invariants, and migration validation
sources:
  - src/main/features/knowledge/pathStorage.ts
  - src/main/features/knowledge/pipeline/vectorstore/indexStore
  - src/main/features/knowledge/query
  - src/main/data/db/schemas/knowledge.ts
  - src/main/data/migration/v2/migrators/KnowledgeVectorMigrator.ts
---

# Knowledge Storage and Retrieval Implementation

Despite the retained `experiment/` path, this document describes only the
implemented storage and retrieval contract. Several source comments link to its
numbered sections, so keep those anchors stable when editing it.

## 1. Ownership

The main database tables are authoritative:

- `knowledge_base` owns configuration, group, readiness, and recoverable error.
- `knowledge_item` owns material identity, hierarchy, type-specific source data,
  lifecycle status, and item error.

The per-base filesystem stores Knowledge-owned bytes and a derived retrieval
index. Neither the renderer nor the retrieval index decides which business items
exist. List, visibility, and lifecycle decisions return to `knowledge_item`.

## 2. Storage Layout

`pathStorage.ts` resolves each base below
`application.getPath('feature.knowledgebase.data')`:

```text
KnowledgeBase/{baseId}/
  raw/
    paper.pdf
    paper.md
    captured-page.md
    imported-directory/subtree/file.txt
  .cherry/
    index.sqlite
```

`raw/` is the material root. A `knowledge_item.data.relativePath` is a
POSIX-style path relative to this root. File type and origin come from the item,
not from path segments. A directory import reserves one top-level prefix and
retains that source's nested structure below it.

`.cherry` is reserved control storage. `assertSafeKnowledgeRelativePath` plus a
host-side `path.relative` check reject absolute paths, traversal, the material
root itself, and `.cherry/**` before a path reaches filesystem operations.

Imports copy bytes into the base. File names and prospective processed-Markdown
siblings share one reservation set; collisions are resolved with `_N` suffixes.
Deleting a base removes the entire base directory. Item cleanup removes only the
raw paths owned by the resolved subtree.

## 3. URL and Note Snapshots

URL and note content is captured as Markdown in `raw/`. App-written snapshots
carry top-level Open Knowledge Format frontmatter. Current fields include
`type`, `title`, `timestamp`, and URL `resource` where applicable.

`serializeOkfFrontmatter` JSON-quotes values. `stripOkfFrontmatter` removes the
single leading block before indexing, so stored metadata does not alter the
canonical body or its content hash. The snapshot's `relativePath` is written
back to `knowledge_item.data`.

## 4. Per-base Index Schema

`index.sqlite` is a separate better-sqlite3 database, not part of the main
Drizzle migration chain. `schema.ts` creates seven objects representing six
ordinary tables plus one FTS5 virtual table:

| Table | Current responsibility |
|---|---|
| `meta` | Base identity and index schema version |
| `material` | Item identity, relative path, and current content pointer |
| `content` | Full normalized text, deduplicated by content hash |
| `search_unit` | Ordered chunks with character offsets |
| `search_text` | Text projection consumed by FTS and embedding |
| `embedding` | Float32 vector BLOB keyed by embedding-text hash |
| `search_text_fts` | Trigram FTS5 external-content index over `search_text.text` |

The open path reads `meta.schema_version`. A non-null mismatch drops and
recreates this rebuildable index before applying current DDL. A new/blank file
has no stored version and is initialized as an empty index.

### 4.1 `meta`

`meta` has one row (`id = 1`) with `schema_version`, `base_id`, and timestamps.
`ensureIndexMeta` refuses a file whose stored `base_id` belongs to a different
base. When a blank index mounts below a base that still has completed items,
`KnowledgeVectorStoreService` logs the inconsistency instead of treating the
empty search result as normal.

### 4.2 `material`

`material.material_id` equals `knowledge_item.id`. `relative_path` is unique and
serves as the Concept ID used by `kb_read` and `kb_manage`. The table is a small
retrieval projection; display fields, lifecycle status, origin, and errors stay
in `knowledge_item`.

Search and Concept ID resolution revalidate the material ID against a completed,
same-base `knowledge_item`. An index row alone never grants visibility.

### 4.3 Content and Search Text

`content_hash = sha256(content.text)`. A material points to its current content;
chunks reference the same full-text row. `search_text` currently stores one
`body` projection per chunk. Identical body text shares one embedding by
`embedding_text_hash`.

### 4.4 Stable Unit Identity

`computeUnitId` hashes material ID, content hash, unit type, unit index, and
character boundaries. Rebuilding the same material with the same chunk result
therefore reproduces unit IDs. `computeSearchTextId` hashes target type, target
ID, and kind.

Chunker configuration is not embedded in every ID. A physical index-contract
change increments `KNOWLEDGE_INDEX_SCHEMA_VERSION` and rebuilds the derived
database.

### 4.5 FTS Row Identity

`search_text_fts` uses the stable `search_text.fts_rowid` column as
`content_rowid`, not SQLite's implicit rowid. Insert/update/delete triggers keep
the external-content table aligned. The unique `fts_rowid` index makes
`MAX(fts_rowid) + 1` assignment efficient and rejects duplicates.

## 5. Write Invariants

`KnowledgeIndexStore.rebuildMaterial()` replaces one material's content, units,
search text, and supplied embeddings in one synchronous driver transaction. It
verifies embedding coverage before commit and collects content/embedding rows
that no live material or search text references.

Same-base higher-level mutations hold the Knowledge `KeyedMutex` while changing
the index, main DB state, or Knowledge-owned files. That application mutex
serializes cross-store invariants; it does not replace a main-DB transaction.

### 5.3 Character-offset Invariant

Every unit stores `[char_start, char_end)` into its full `content.text`, and
`content.text.slice(char_start, char_end)` must equal the unit body in
`search_text`. `kb_read` returns the full indexed content or a bounded slice;
chunk inspection returns units ordered by `unit_index`.

### 5.6 Driver and Vector Portability

The index store depends on a narrow synchronous SQLite driver. DDL uses ordinary
SQLite tables plus FTS5. Vectors are raw little-endian float32 bytes in a plain
`BLOB`; sqlite-vec supplies the `vec_distance_cosine` scalar function at query
time. No ANN/vector virtual index exists.

The driver enables foreign keys per connection. Callers never `await` index SQL
or return a Promise from an index transaction callback.

## 6. Retrieval

`KnowledgeIndexStore.search()` supports `bm25`, `vector`, and `hybrid` modes:

- BM25 uses trigram FTS, with the implemented LIKE fallback for tokens too short
  for the trigram lane.
- Vector search scans stored embeddings and orders by cosine distance.
- Hybrid search over-fetches both lanes and combines their ranks with reciprocal
  rank fusion.

`KnowledgeQueryService` chooses BM25 for a base without an embedding model and
hybrid for a vector-capable base. It then filters candidates through completed
same-base items, optionally reranks, trims to `documentCount ?? 10`, applies the
threshold only to relevance scores, and assigns ranks.

Concept reads resolve `material.relative_path`, revalidate item visibility, and
read the material's full `content.text`. The organization tree is built from the
`knowledge_item.groupId` hierarchy rather than scanning `raw/`.

## 7. Delete and Reclaim

Deleting or rebuilding materials removes their search rows and collects orphaned
content and embeddings. Large multi-material deletes yield between synchronous
transactions so the main event loop is not monopolized. `reclaimSpace()` runs
FTS optimize before threshold-gated `VACUUM`, allowing deleted FTS segments and
free pages to return to the operating system.

## 8. Source Availability

File roots rebuild from their Knowledge-owned raw file. Directory roots rebuild
by rescanning their original absolute source directory. URL and note items route
through their snapshot/source-planning logic and do not require that local
file/directory probe. Reindex refuses to delete vectors when a required file or
directory source is missing or cannot be verified.

## 9. Schema Evolution

Adding a brand-new table is handled by `CREATE ... IF NOT EXISTS`. Changing an
existing table, CHECK, FTS binding, or trigger requires incrementing
`KNOWLEDGE_INDEX_SCHEMA_VERSION`; store open then recreates the whole derived
index. Main `knowledge_base`/`knowledge_item` changes still require an appended
Drizzle migration because those rows are user business data.

## 10. Migrated Index Verification

`KnowledgeVectorMigrator` writes the same current index layout through the same
store factory. It validates material/unit/embedding counts and missing embedding
coverage after the build. It also preserves the current Concept ID rule by
mapping migrated materials to their final relative paths.

When legacy directory vectors can be attributed to individual source paths, the
migrators synthesize completed file children and remap those vectors. When that
evidence is unavailable, the directory remains a failed
`directory_not_migrated` item rather than inventing file ownership.
