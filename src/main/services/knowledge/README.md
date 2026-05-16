# Knowledge Service Product Decisions

This document records product-level semantics for knowledge runtime operations.
Use it when reviewing code in this directory so implementation concerns do not
override the intended user-facing behavior.

## `reindexItems`

`reindexItems` is intentionally modeled as **delete old derived data, then rebuild
from the source**, while preserving the root item identity.

For a directory or sitemap root, the root item is the user-owned source record.
Its expanded descendants are derived runtime data:

- directory children expanded from the current filesystem scan
- sitemap URL children expanded from the current sitemap response
- vectors generated from those descendants
- `file_ref` rows owned by deleted file descendants

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

Expanded descendants from the source base are intentionally not copied. For
directory and sitemap roots, descendants are rebuilt by the add/runtime flow in
the restored base. For file roots, the existing `fileEntryId` is reused; FileManager
is not asked to re-import or relocate the file during restore.

If adding restored root items fails after `createBase` succeeds, the product
semantics match creating a new base and then adding items manually: keep the new
base and let the add/runtime failure state explain what failed. The source base
remains unchanged either way.

Completed bases can only be restored when the embedding model or dimensions
change. Failed bases can be restored with the same embedding config because the
operation is used to recover from invalid or missing runtime configuration.
