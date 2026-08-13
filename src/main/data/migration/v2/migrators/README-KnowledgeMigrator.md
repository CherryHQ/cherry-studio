# KnowledgeMigrator

`KnowledgeMigrator` migrates legacy knowledge data from Redux + Dexie exports into the new SQLite schema.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Knowledge bases + lightweight items | Redux `knowledge.bases` | `ReduxStateReader.getCategory('knowledge')` |
| Full note content | Dexie `knowledge_notes` | `knowledge_notes.json` |
| File metadata fallback | Dexie `files` | `files.json` |
| Legacy vector databases | Filesystem | `ctx.paths.knowledgeBaseDir/<sanitizedBaseId>` (via `MigrationPaths`) |

> **Note**: The legacy vector DB path comes from `ctx.paths.knowledgeBaseDir`, which is pre-computed by `MigrationPaths` from the resolved v1 userData directory. The base id is sanitized with `sanitizeFilename(baseId, '_')`. Do NOT call `app.getPath('userData')` directly — see `migration/v2/README.md` Path Safety section.

## Target Tables

- `knowledge_base`
- `knowledge_item`

## Key Transformations

1. Base metadata migration
   - Legacy base model/rerank model are transformed to `embeddingModelId` and `rerankModelId`.
   - Model references are resolved against migrated `user_model` rows.
   - Missing or dangling embedding model references are preserved as recoverable failed bases with `embeddingModelId = null`, `status = failed`, and `error = missing_embedding_model`.
   - `error = missing_embedding_model` is the current shared `KnowledgeBaseErrorCode` member for recoverable base-level embedding model loss.
   - Missing or dangling rerank references are cleared with warnings.
   - Retrieval mode is not migrated; runtime uses hybrid retrieval when an embedding model is present and BM25 otherwise.
   - Legacy preprocess provider id is mapped to `fileProcessorId`.
   - Invalid runtime tuning fields are normalized to schema-safe defaults/nulls instead of causing the whole base to be skipped.

2. Unified item payload migration
   - Legacy item `content` is transformed into the new `knowledge_item.data` union payload by item type.
   - Supported migrated item types are `file`, `url`, `note`, and `directory`.
   - Legacy `sitemap` items with valid string content are migrated as ordinary `url` items.
   - V2 models `knowledge_item` as a flat item list with optional `groupId`.
   - Official v1 exports do not provide grouping metadata.
   - Migrated items are therefore inserted with `groupId = null` by design.
   - `directory` is a container/source declaration in `knowledge_item`; its own container-level vectors are handled by `KnowledgeVectorMigrator` as non-indexable and are not written to the V2 vector store.

3. Note content source priority
   - Prefer Dexie `knowledge_notes` content.
   - Fall back to Redux item `content` when note export is missing.

4. Dexie lookup loading strategy
   - `knowledge_notes` and `files` are scanned via streaming readers.
   - The migrator first collects required note/file ids from Redux knowledge items.
   - Only matching records are retained in memory for transformation.

5. Processing status normalization
   - Legacy `processingStatus` is treated as runtime-only and not trusted for migration.
   - Item status is inferred from `uniqueId`:
     - `uniqueId` present and non-empty -> `completed`
     - otherwise -> `idle`

6. Vector dimension dependency
   - Completed bases require a resolved positive `knowledge_base.dimensions` value.
   - The migrator resolves dimensions from the legacy per-base vector DB, using the first non-null `vectors.vector` blob length.
   - This migrator does not copy vector rows. It only prepares the base and item records needed by `KnowledgeVectorMigrator`.
   - If dimension resolution fails for a base with a resolved embedding model, the base and its items are skipped because the target schema cannot safely materialize a completed base.
   - If the embedding model is missing or dangling, the base is preserved as `failed`; valid legacy `dimensions` are kept, otherwise `dimensions` is `null`.

## Field Mappings

### knowledge_base mapping

| Source (Legacy base) | Target (`knowledge_base`) | Notes |
|----------------------|---------------------------|-------|
| `id` | `id` | Direct copy |
| `name` | `name` | Direct copy |
| _no legacy grouping field_ | `groupId` | V1 knowledge bases do not carry group metadata; migrate as `null` |
| `dimensions` | `dimensions` | Completed bases use legacy vector DB blob length (`length(vector)/4`); failed bases keep valid legacy dimensions or `null` |
| `model` | `embeddingModelId` / `status` / `error` | Converted to `provider::modelId`, then resolved against `user_model`; missing/dangling references produce a failed recoverable base |
| `rerankModel` | `rerankModelId` | Optional, converted to `provider::modelId`, then resolved against `user_model`; dangling references are cleared |
| `preprocessProvider.provider.id` | `fileProcessorId` | Optional |
| `chunkSize` | `chunkSize` | Copied when positive integer; otherwise normalized to the default chunk size |
| `chunkOverlap` | `chunkOverlap` | Copied when non-negative integer and smaller than `chunkSize`; otherwise normalized to the default overlap for the resolved chunk size |
| `threshold` | `threshold` | Copied when within `[0, 1]`; otherwise cleared |
| `documentCount` | `documentCount` | Copied when positive; otherwise cleared |
| `created_at` | `createdAt` | Timestamp conversion |
| `updated_at` | `updatedAt` | Timestamp conversion |

### knowledge_item mapping

| Source (Legacy item) | Target (`knowledge_item`) | Notes |
|----------------------|---------------------------|-------|
| `id` | `id` | Direct copy |
| base owner `id` | `baseId` | From parent base |
| _no legacy grouping field_ | `groupId` | V1 exports are flat, so migrated items are inserted without grouping metadata (`null`) — except the synthesized children of an expanded `directory`, which point at their container |
| `type` | `type` | Supported target types: file/url/note/directory. Legacy sitemap maps to url. |
| `content` + Dexie lookups | `data` | Type-specific transform |
| `uniqueId` | `status` | `uniqueId` non-empty => `completed`, otherwise `idle` |
| `processingError` | `error` | Direct copy |
| `created_at` | `createdAt` | Timestamp conversion |
| `updated_at` | `updatedAt` | Timestamp conversion |

## Dropped / Skipped Data

- `video` items are skipped.
- `memory` items are skipped.
- Legacy per-base knowledge store paths that resolve to directories are skipped as unsupported pre-v2 layouts.
- Invalid/malformed items are skipped and recorded as warnings in `prepare`.
- Invalid knowledge-base tuning fields are normalized during migration; they do not cause the base or its items to be skipped.

## Directory and Legacy Sitemap Semantics

- `directory` items are migrated into `knowledge_item` as container/source declarations when their legacy payload is valid.
- Legacy `sitemap` items are migrated into `knowledge_item` as `url` items when their legacy payload is valid.
- V1 does not provide separate child `knowledge_item` ids for every expanded directory child document, but it does record one loader source string per embedded file. `expandLegacyDirectoryItem` therefore synthesizes one `file` child per distinct loader source so the v1 vectors can be re-attributed instead of dropped.
- Paths mirror a native directory expansion: the container claims a deduped top-level `raw/` prefix (`docs`, `docs_1`, …) and each child takes `<prefix>/<its path relative to the folder>`. The subtree is derived purely from the v1 source strings — both separators, case-folded segment comparison, per-segment `sanitizeFilename` — with no filesystem access, so the same v1 export migrates identically on macOS and Windows. A source recorded outside the container's folder path falls back to its filename alone and is counted into one aggregated warning per container.
- Prefix occupancy is tracked by `foldPathSegment` key (NFC + lower-case), not by literal name, while the emitted prefix keeps its original spelling. `raw/docs` and `raw/Docs` are one directory on Windows and default macOS volumes, so two v1 folders differing only in case (or in Unicode composition) must not both claim it — otherwise deleting or re-indexing either container runs `removeDir(raw/<prefix>)` over the other's bytes and leaves its rows and index entries behind. `.Cherry` is folded against `CHERRY_META_DIR` for the same reason, even though `assertSafeKnowledgeRelativePath` only rejects the exact lower-case spelling.
  - This covers prefix-vs-prefix within the migration. Two related collisions are **not** fixed here because they live in the shared native helpers: `collectReservedTopLevelNames` / `chooseDirectoryPathPrefix` compare literally, so a container re-index can re-pick a case-colliding prefix, and `reserveImportedFileRelativePath` can hand a copied file a name that case-collides with a directory prefix. Both predate the migration and affect natively added directories today.
- The resulting paths are **path-shaped but unbacked**: no bytes are copied (v1 never stored the folder inside Cherry), so a migrated child still cannot be reindexed from disk. Reindexing the *container* while the original folder still exists fills `raw/<prefix>` for real, converging the migrated shape onto the native one. The prefix is normally re-picked identically — `chooseDirectoryPathPrefix` excludes the container itself and derives from the same basename — so paths and display names do not churn. Two cases do change paths on that reindex:
  - A prefix that took a `_N` at migration time, when whatever forced the suffix has since been deleted: the reindex reclaims the shorter name.
  - A segment that `sanitizeFilename` rewrote. The migration sanitizes every segment; the native expansion does not sanitize at all, because it walks a folder that exists on *this* machine — `chooseDirectoryPathPrefix` takes its `path.basename` and `expandDirectoryNode` reuses the `treePath` it just read — so those names are legal here by construction and sanitizing would only misname real files. The migration reads v1 strings that may have been recorded on another OS, cannot verify them against a local file, and is the sole guarantor that the emitted path passes `assertSafeKnowledgeRelativePath` — so it cannot skip the step. Consequence: a folder named `a<b` migrates to `a_b` and reverts to `a<b` when its container is reindexed on a POSIX host. Both spellings are valid v2 paths; only which one is in force changes.
- Any legacy vector rows that map back to a root `directory` item are considered container-level vectors and are skipped by `KnowledgeVectorMigrator` with warnings.
- Legacy vector rows that map back to a legacy `sitemap` item are migrated as URL vectors because the item now maps to target type `url`.
- Child content vectors are only migrated when they can be mapped to an existing migrated `file`, `url`, or `note` item id.

### Relative path ownership

The two phases split ownership of the base's `raw/` namespace, and the order is not interchangeable:

- **`prepare` pins directory prefixes.** A container's prefix is written into `container.data.relativePath` and immediately becomes the item row, the index-store `material.relative_path`, and the UI display name — none of which can be rewritten later. Prefixes are deduped against a **per-base** set (`raw/` is per-base, so sharing one across bases would needlessly push the second base's `docs` to `docs_1`) seeded with `CHERRY_META_DIR`, because a v1 folder literally named `.cherry` would otherwise emit a `relativePath` that `assertSafeKnowledgeRelativePath` rejects on every read.
- **`execute` names copied files, and yields.** `copyKnowledgeFilesForBase` seeds its `reservedPaths` with `.cherry` plus every directory container's already-pinned prefix, so a v1 file named `docs` lands on `docs_1` instead of squatting in `raw/docs` — where deleting or reindexing the container would `removeDir` it. Filenames are the ones that can move: `reserveImportedFileRelativePath`'s `_N` suffix exists for exactly this.

What forces this direction is not which phase *can* compute a name — `prepare` already knows the base's `fileProcessorId`, and it does touch the filesystem to resolve dimensions — but what a name is already load-bearing for. A prefix becomes a live item row, index material and display name the moment `prepare` writes it, so it can never move. A file's `relativePath` is committed nowhere until the copy loop runs, so it can. Moving the filename reservation into `prepare` would not change that; it would only split the copy loop's dedup state across two phases.

Directory children are skipped by the copy loop and never enter `reservedPaths`: they carry no bytes, their paths are already final, and they cannot collide with a copied file because every child path has a `<prefix>/` segment while every copied filename is a single segment.

## Current Constraint Decisions

- `dimensions` is required only for completed bases; failed migrated bases may have `dimensions = null`.
- The legacy Redux `dimensions` field is not treated as the migration source of truth.
- `dimensions` is resolved from legacy vector DB content by inspecting:
  - the per-base legacy vector DB file
  - the `vectors` table
  - a non-null vector blob whose byte length can be converted to a positive dimension count (`length(vector)/4`)
- If the per-base legacy knowledge store path resolves to a directory instead of a SQLite file, that base is treated as an unsupported legacy layout and is skipped.
- If the legacy vector DB is missing, empty, invalid, or the vector blob length cannot be parsed into a valid positive dimension count, a base with a resolvable embedding model is treated as unusable in V2 migration:
  - the base is skipped
  - all items under that base are skipped
  - a warning is recorded during `prepare`
- Missing or dangling embedding model identity is cleared to `null`, `status` is set to `failed`, and `error` is set to `missing_embedding_model` with a warning. That error value is a shared `KnowledgeBaseErrorCode`, not a free-form string. It does not require legacy vector DB inspection; valid legacy `dimensions` are preserved and invalid or missing legacy `dimensions` are stored as `null`.
- Non-structural tuning config (`chunkSize`, `chunkOverlap`, `threshold`, `documentCount`) is migrated on a best-effort basis:
  - valid values are preserved
  - invalid `chunkSize` / `chunkOverlap` values are replaced with defaults
  - invalid nullable tuning values such as `threshold` / `documentCount` are cleared
  - the base still migrates
- V2 keeps `knowledge_item` flat and uses optional `groupId` for grouping queries.
- Legacy v1 knowledge data does not include that field, so migrated items keep it as `null`.
- This document describes migration behavior only; runtime APIs may set `groupId` after migration.
- Runtime schema enforces same-base group ownership through `(baseId, groupId) -> (baseId, id)`.

## Missing Embedding Model Recovery

A common recoverable case is a legacy knowledge base whose embedding model id exists in Redux but not in the V2 `user_model` table. For example, Redux may contain `ollama::dengcao/Qwen3-Embedding-0.6B:Q8_0` while no matching migrated user model row exists.

The migrator handles this as a recoverable failed base:

```text
embeddingModelId = null
status = failed
error = missing_embedding_model
```

The base and its `knowledge_item` rows are preserved. `KnowledgeVectorMigrator` skips vectors for this base because the embedding model contract cannot be verified.

User recovery is handled by runtime restore, not by mutating the failed base in place:

```text
knowledge:restore-base
 -> create a new knowledge base with the source base config and selected embedding model
 -> copy source root items only
 -> run the normal createBase + addItems indexing flow
```

The original failed base remains available after restore so the UI can let the user confirm success before deleting it.

## Validation

- Count validation uses migrator stats:
  - `sourceCount`
  - `targetCount`
  - `skippedCount`
- Integrity check:
  - Detect orphan `knowledge_item` rows without valid `knowledge_base`.
