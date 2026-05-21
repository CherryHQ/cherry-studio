# Knowledge Service Product Decisions

This document records product-level semantics for knowledge runtime operations.
Use it when reviewing code in this directory so implementation concerns do not
override the intended user-facing behavior.

## Terms

A directory root is the user-selected directory source. It is a Knowledge
container source, not a FileManager entry. It keeps its source path so future
prepare/reindex work can rescan the directory.

A file leaf is an indexable file source. It is the only Knowledge filesystem
source that FileManager owns. File leaves store a `fileEntryId`; runtime readers
resolve content through FileManager instead of storing or reusing raw paths.

A file source reference is the `file_ref` row that links one file leaf item to
its FileManager entry. Knowledge creates and deletes those rows in the same
SQLite transaction as the owning `knowledge_item` so item/ref state rolls back
together.

## `createBase`

`createBase` is treated as a single user-facing creation operation: the SQLite
base row and the runtime/vector-store base must both be created, or the base
should not remain visible to the user.

The operation runs in two steps:

1. Create the knowledge base row in SQLite.
2. Initialize the runtime/vector-store resources for that base id.

If step 1 fails, no base exists and the error is returned to the caller. If step
2 fails after the SQLite row was created, delete the SQLite base row and return
the runtime error to the caller.

Example: a user creates a knowledge base named `Research` with embedding model
`ollama::nomic-embed-text` and dimension `1024`.

- If SQLite creation fails, `Research` is never created.
- If SQLite creates `kb-1` but vector-store initialization fails, delete `kb-1`
  from SQLite and return the vector-store error.
- If both steps succeed, return `kb-1` and let the UI show the new base.

This means `createBase` should behave atomically from the user's point of view:
no half-created empty base should remain when runtime initialization failed.

Composition rule: operations that call `createBase` should inherit this
creation behavior. Once `createBase` succeeds, later work belongs to the next
operation. For example, `restoreBase` is `createBase` plus `addItems` for copied
root sources; if `createBase` succeeds but adding restored sources fails, keep
the new base because that matches "create an empty base, then add sources and
the add failed".

## `addItems`

`addItems` means **accept user-provided root sources and start processing them**.
It does not mean the content is already indexed or searchable when the call
returns.

The operation has three product stages:

1. Validate that the target base can accept runtime work.
2. Normalize caller input into create-item data.
3. Create root items and submit runtime tasks for background processing.

The success boundary is the acceptance boundary: root items were created,
marked `processing`, and submitted to the runtime queue. Indexing continues
after the call returns.

Example: a user adds a note to `kb-1`.

- Create a root note item.
- Mark it `processing`.
- Enqueue indexing work.
- Return success to the caller.
- In the background, the item moves through `reading` / `embedding` and then
  becomes `completed`, or becomes `failed` if processing cannot finish.

For file roots, the orchestration layer resolves user paths through
FileManager before runtime acceptance. Runtime code should receive a
`fileEntryId`, not a raw filesystem path.

Example: a user adds `/docs/guide.md`.

- If `.md` is supported, create or reuse an external FileManager entry.
- Pass `{ type: 'file', data: { source: '/docs/guide.md', fileEntryId } }` to
  runtime.
- Runtime creates the knowledge item and indexes the referenced file.

If FileManager creates an external entry but later Knowledge acceptance fails,
the unreferenced external entry is not rolled back by Knowledge. FileManager's
orphan sweep owns that cleanup path. This keeps FileManager's external entry
semantics as a path-level upsert and keeps Knowledge responsible only for
accepted items and their refs.

If input normalization fails, the add request was not accepted.

Example: a user adds `/docs/cache.sqlite`.

- The extension is not supported for knowledge bases.
- Reject before creating a FileManager entry.
- Do not create a knowledge item.
- Do not call runtime.

Runtime root acceptance is best treated as batch-atomic. If creating one root
item fails after earlier roots were accepted, delete the already accepted roots
best-effort and reject the call.

Example: a user adds `note-1` and `note-2` in one request.

- `note-1` is created and marked `processing`.
- Creating `note-2` fails.
- Delete `note-1` best-effort.
- Do not enqueue background processing.
- Return the original create failure.

Once a root item has been accepted and submitted to runtime, later failures are
item lifecycle failures, not add-request failures.

Example: `note-1` is accepted, but document reading or embedding fails later.

- `addItems` may already have returned success.
- Keep `note-1`.
- Clean up any written vectors for that item.
- Mark `note-1` as `failed` with the processing error.

Directory and sitemap roots are container sources. They first run a preparation
task that expands children, then the expanded leaf items are indexed.

Example: a user adds `/docs`.

- Create the directory root.
- Mark it `processing` with phase `preparing`.
- Scan the directory outside the base write lock.
- Commit accepted child items and enqueue child indexing under the base write
  lock.
- Move the root out of `preparing` once expansion has been accepted.

Preparation has two product stages. The discovery stage reads the outside world:
directory scanning, sitemap fetching, and FileManager external-entry upserts for
file leaves. This stage must not hold the Knowledge base write lock. The commit
stage mutates Knowledge state: remove stale descendants, create child items and
file source references, update container status, and enqueue child jobs. That
stage is serialized under the base write lock so delete/reindex cannot
interleave with a half-accepted expansion.

The commit stage is lock-serialized but it is not one SQLite transaction for the
whole prepared tree plus job enqueue. Each created file item still owns its
`knowledge_item`/`file_ref` transaction. If a later child create or enqueue
fails, JobManager retry should rerun preparation; stale leaf descendants are
removed at the start of the next commit attempt.

If the base or root item is deleted after discovery but before commit, the
preparation task should complete without writing children or enqueueing child
jobs. User deletion wins.

When a file leaf is indexed, runtime checks FileManager's dangling state before
reading. If the file is missing, indexing fails with a stable missing-source
error and follows the normal retry/failure lifecycle. A retry may still succeed
if the external file comes back before retry attempts are exhausted.

## `deleteBase`

`deleteBase` removes a knowledge base by stopping runtime work first, deleting
vector-search artifacts second, and deleting the user-visible SQLite state last.

Vector artifacts are the persisted vector-search resources for a base. They are
not the SQLite base/item rows. For example, if `kb-1` indexes `guide.md`, SQLite
stores the base, item, source metadata, and item lifecycle state; the vector
artifacts store the embedded chunks used for vector search, such as the base's
vector store file, table, or collection.

The normal flow is:

1. Stop all pending/running runtime tasks for the base.
2. Wait for active base write locks to drain.
3. Delete the base's vector artifacts.
4. Delete the SQLite base and its items.

Example: a user deletes `kb-1`.

- Stop any indexing or directory/sitemap preparation tasks for `kb-1`.
- Wait for in-flight vector/database writes for `kb-1` to finish or time out.
- Delete `kb-1`'s vector store resources.
- Delete `kb-1` and its knowledge items from SQLite.
- The UI should no longer show `kb-1`.

The artifact deletion is the retry boundary. If artifact cleanup fails, keep the
SQLite base visible so the user still has a UI affordance to retry deletion. The
reverse order would leave orphan vector files with no base row to act on.

Failure boundaries:

- If runtime task interruption or lock waiting fails, do not delete vector
  artifacts and do not delete SQLite state. The base remains visible.
- If vector artifact deletion fails, do not delete SQLite state. The base
  remains visible and the user can retry deletion.
- If SQLite deletion fails after vector artifact deletion succeeds, return a
  partial cleanup error. The base may still be visible, but its vectors are
  already gone; a later retry can finish SQLite cleanup, or recovery can handle
  the inconsistent base.

Example: deleting vector artifacts for `kb-1` fails with
`artifact delete failed`.

- Keep `kb-1` in SQLite.
- Keep its items visible.
- Return the artifact deletion error.
- The user can retry delete from the UI.

Example: vector artifacts for `kb-1` are deleted, but SQLite deletion fails with
`sqlite delete failed`.

- `kb-1` may still be visible in SQLite.
- Its vector-search artifacts are already gone.
- Return a partial cleanup error explaining that artifact cleanup succeeded but
  SQLite cleanup failed.
- A later retry can finish deleting the base row.

## `deleteItems`

`deleteItems` removes selected knowledge source trees from an existing base. It
shares the same deletion principles as `deleteBase`, but the deletion scope is
an item tree rather than the whole base.

Before deletion, caller-provided item ids are normalized into the smallest set
of top-level deletion targets. If a selected item is a descendant of another
selected item, only the ancestor is deleted.

Example: a user selects all of these items:

- `dir-root`
- `dir-root / child.md`
- `dir-root / subdir / leaf.md`

The normalized deletion target is only `dir-root`, because deleting `dir-root`
also deletes its descendants. This avoids duplicate runtime interruption,
duplicate vector deletion, and duplicate SQLite deletion.

If the user selects sibling items such as `note-1` and `note-2`, both remain in
the normalized deletion set because neither contains the other.

The normal flow is:

1. Normalize selected ids into top-level item roots.
2. Stop pending/running runtime tasks for those roots and their descendants.
3. Delete vectors for the affected leaf items.
4. Delete the selected SQLite item trees, including descendant rows and their
   `file_ref` rows.

Example: a user deletes a note root `note-1`.

- Stop any runtime task for `note-1`.
- Delete vectors whose external id is `note-1`.
- Delete the SQLite item row for `note-1`.
- The UI should no longer show `note-1`.

Example: a user deletes a directory root `/docs`.

- Stop runtime work for `/docs` and all expanded descendants.
- Find indexable leaf descendants, such as `a.md` and `b.md`.
- Delete vectors for those leaf items.
- Delete the `/docs` SQLite item tree.
- Clean up `file_ref` rows for deleted file items.

`deleteItems` intentionally overlaps with `deleteBase`: both interrupt runtime
work before deleting user-visible state, and both clean vector-search data. The
scope and cleanup order differ:

- `deleteBase` stops the whole base, deletes the SQLite base/items, then deletes
  the whole base vector store.
- `deleteItems` stops selected item trees, deletes only the affected item
  vectors, then deletes the SQLite item trees.

For item deletion, vector cleanup happens before SQLite item deletion because
the operation only removes a subset of the base's vectors. Keeping the item rows
until after vector cleanup preserves the item ids and tree shape needed for
targeted cleanup.

Failure boundaries:

- If runtime interruption or vector cleanup fails, do not delete SQLite item
  rows. Mark interrupted items `failed` best-effort and return the runtime
  cleanup error. The selected items remain visible and can be retried.
- If SQLite item deletion fails after vector cleanup succeeds, return the
  SQLite deletion error. The items may still be visible, but their vectors may
  already be gone; the user should be able to retry deletion or reindex.
- Once SQLite item deletion succeeds, the items are deleted from the user's
  point of view. Descendants and `file_ref` rows are part of the SQLite item
  tree cleanup.

Example: deleting `dir-root` fails while deleting vectors for `child.md`.

- Keep `dir-root` and its descendants in SQLite.
- Mark `dir-root` / affected descendants `failed` best-effort with the vector
  cleanup error.
- Do not call SQLite item deletion.
- Return the vector cleanup error.

Example: vectors for `note-1` are deleted, but SQLite item deletion fails.

- `note-1` may still be visible.
- Its vectors may already be gone.
- Return the SQLite deletion error.
- A later retry can delete the item, or reindex can rebuild vectors if the item
  should remain.

## `reindexItems`

`reindexItems` is intentionally modeled as **delete old derived data, then rebuild
from the source**, while preserving the root item identity.

It is not implemented as a literal `deleteItems` followed by `addItems`.
`deleteItems` removes the selected root item; `reindexItems` must keep that root
item because it represents the user's source and UI identity.

The shorter product model is:

```text
reindex = keep the root source + delete generated output + add again from that source
```

For a directory or sitemap root, the root item is the user-owned source record.
Its expanded descendants are derived runtime data:

- directory children expanded from the current filesystem scan
- sitemap URL children expanded from the current sitemap response
- vectors generated from those descendants
- `file_ref` rows owned by deleted file descendants

For leaf roots (`note`, `file`, `url`), reindex keeps the root row, deletes that
root's old vectors, marks the same root `processing`, and indexes it again.

Example: reindexing `note-1` keeps the `note-1` item id and source data, deletes
the old `note-1` vectors, then rebuilds vectors for `note-1`.

For container roots (`directory`, `sitemap`), reindex keeps the container root
row, deletes the old expanded children and their vectors/file refs, marks the
same root `processing` with phase `preparing`, and expands the source again.

Example: reindexing `dir-root` with old children `old-a.md` and `old-b.md`
keeps `dir-root`, deletes vectors and SQLite rows for `old-a.md` / `old-b.md`,
then scans the directory again and creates fresh children from the current
filesystem state.

When a user clicks reindex, the product expectation is:

1. Interrupt active work for the selected roots and their descendants.
2. Delete old vectors for the previous leaf descendants.
3. Delete old expanded descendants for directory/sitemap roots, including their
   `file_ref` rows.
4. Keep the selected root item row and its source data.
5. Mark the root as `processing` / `preparing`.
6. Re-run the same source expansion and indexing flow used by add.
7. If rebuild fails, keep the root item and mark it `failed`; do not restore the
   old expanded descendants.

This is deliberate. Reindex is not a "refresh while preserving last known good
children" operation. It is closer to "delete the generated output for this
source and run add again", except that the original root item id and source data
are retained.

Review implication: reports that directory/sitemap reindex can lose old
expanded children after a rebuild failure are only bugs if the root item itself,
its source data, or the final failed status is wrong. Losing old descendants is
expected behavior.

## `restoreBase`

`restoreBase` creates a **new knowledge base copy** and then adds the source
root items into that new base. It does not repair or replace the source base in
place.

The source base is treated as a template for configuration and root sources:

1. Read the source base config.
2. Create a new base using the requested embedding model / dimensions and the
   source base's other runtime settings.
3. Once `createBase` succeeds, the new base is user-visible state and should
   not be deleted by later restore-item failures.
4. Read only root knowledge items from the source base (`groupId: null`).
5. Convert those root items back into create-item inputs.
6. Add them to the new base through the normal add flow.
7. Keep the source base and its items unchanged.

Expanded descendants from the source base are intentionally not copied. Restore
does not copy old chunks, old vectors, or a historical file-content snapshot.
For directory and sitemap roots, descendants are rebuilt by the add/runtime flow
in the restored base. For file roots, the existing `fileEntryId` is reused;
FileManager is not asked to re-import or relocate the file during restore.

Example: a source base indexed `/docs/guide.md` when its content was `v1`. If
the user edits the same path to `v2` before restore, the restored base will read
the current file through the reused `fileEntryId` and index `v2`. This matches
the product model: restore copies root source configuration, then runs the
normal add/index flow in a new base.

If adding restored root items fails after `createBase` succeeds, the product
semantics match creating a new base and then adding items manually: keep the new
base and let the add/runtime failure state explain what failed. The source base
remains unchanged either way.

Completed bases can only be restored when the embedding model or dimensions
change. Failed bases can be restored with the same embedding config because the
operation is used to recover from invalid or missing runtime configuration.

## `search`

`search` is a read-only query against the current vector store contents. It does
not rebuild sources, retry failed items, inspect item lifecycle status, or read
the original source files.

The operation first checks whether the base can run runtime work. If the base is
`failed`, search is rejected because the base's runtime/vector-store state is
not trustworthy. The user should restore the base before searching it.

After that base-level guard, search does not filter by SQLite item status. The
vector store is the search surface and it only knows the chunks/vectors that
actually exist in the store. Consistency between item lifecycle state and vector
contents must be maintained by add, reindex, delete, and failure cleanup paths;
search should not compensate by querying SQLite item state.

The search pipeline is:

1. Validate that the query has searchable tokens.
2. Embed the query using the base embedding model.
3. Query the vector store using the base search mode, such as default vector
   search, hybrid search, or BM25 when supported by the vector store.
4. Rerank the retrieved results if the base has a rerank model.
5. Apply the base relevance threshold.
6. Map vector-store nodes to `KnowledgeSearchResult`.

Example: a base contains these source items:

- `a.md` is `completed` and has vectors in the store.
- `b.md` is `processing` and has not written vectors yet.
- `c.md` is `failed` and its vectors were cleaned up.

Searching `install guide` may return chunks from `a.md`. It will not return
`b.md` until vectors exist, and it will not return `c.md` if cleanup removed its
vectors. Search does not inspect those item statuses; it only sees the vector
store contents.

If a failed item still appears in search because stale vectors remained after a
historical cleanup bug, the fix belongs in the write/cleanup path. Search should
not add item-status filtering to hide vector-store inconsistency.

## `listItemChunks`

`listItemChunks` is a read-only listing operation for chunks already present in
the vector store under a selected item scope. It does not search, embed, rerank,
apply relevance thresholds, reread sources, rebuild chunks, or filter by item
lifecycle status.

The pipeline is:

1. Check that the base can run runtime work. If the base is `failed`, reject the
   request and require restore first.
2. Check that the requested `itemId` belongs to the requested `baseId`.
3. Resolve the requested item scope to leaf items. For `note`, `file`, and `url`
   roots, the leaf item is the item itself. For `directory` and `sitemap` roots,
   the leaf items are expanded descendant `note`, `file`, and `url` items.
4. If there are no leaf items, return an empty list.
5. Open the base vector store.
6. For each leaf item, list chunks by `vectorStore.listByExternalId(item.id)`.
7. Flatten the chunk groups and map vector-store documents to
   `KnowledgeItemChunk`.

Example: `dir-root` has expanded children `a.md`, `b.md`, and `c.md`.

- `a.md` is `completed` and has 3 chunks in the vector store.
- `b.md` is `processing` and has not written chunks yet.
- `c.md` is `failed` and cleanup removed its chunks.

Listing chunks for `dir-root` returns the 3 chunks that currently exist for
`a.md`. It does not fail because `b.md` is still processing, and it does not
special-case `c.md` because item status is not part of the vector-store listing
surface.

Compared with `search`, `listItemChunks` has no query, no embedding, no rerank,
and no threshold filtering. Search asks "which existing chunks match this
query?". `listItemChunks` asks "which existing chunks belong to this item
scope?".

## `deleteItemChunk`

`deleteItemChunk` is a manual vector-store edit for one existing chunk. It
deletes the selected chunk document/vector only; it does not delete the SQLite
knowledge item, change item lifecycle status, reread the source, or rebuild the
index.

The pipeline is:

1. Check that the base can run runtime work. If the base is `failed`, reject the
   request and require restore first.
2. Check that the requested `itemId` belongs to the requested `baseId`.
3. Open the base vector store.
4. Delete the chunk with `vectorStore.deleteByIdAndExternalId(chunkId, itemId)`.

The `itemId` must be the leaf item that owns the chunk in the vector store. When
the UI lists chunks for a directory or sitemap root, returned chunks may belong
to descendant leaf items. Deleting one of those chunks must use the chunk's own
`chunk.itemId`, not the selected directory/sitemap root id.

Example: the user opens the chunk panel for `dir-root`, and the list contains a
chunk from child file `file-child-1`:

```text
chunk.id = chunk-child-1
chunk.itemId = file-child-1
```

Deleting that chunk calls:

```text
deleteItemChunk(base-1, file-child-1, chunk-child-1)
```

It must not call:

```text
deleteItemChunk(base-1, dir-root, chunk-child-1)
```

because vector-store chunk ownership is keyed by the leaf item external id.

If vector-store deletion fails, keep the chunk visible in the UI and show the
delete error. The item and its lifecycle status remain unchanged.

If the user later reindexes the owning item or its parent root, the deleted
chunk may be generated again from the source. `deleteItemChunk` removes one
current index result; it is not a permanent source-level exclusion rule.
