# Agent Note: Let file items wait in `preparing` while their bytes are copied in

Status: proposed

English | [中文](2026-10-21-knowledge-file-preparing-state.zh.md)

## Problem

Since [copying sources outside the base lock](2026-10-21-knowledge-async-source-copy.md), a file item's row exists before its bytes are in `raw/`, yet its status is `processing` like any other leaf. Nothing on the row says its bytes have not landed, which leaves three gaps:

- The list cannot tell a file still waiting for its copy from one already being processed.
- Previewing such a file (`knowledge.get_file_path`) resolves to a `raw/` path that does not exist yet.
- Restoring a base probes and copies each file's in-base material, so a file still waiting for its copy is skipped as a missing source.

`preparing` already models "the source is being acquired" for directories, but the `knowledge_item_type_status_check` constraint and the entity schema restrict it to directory items.

## Proposal

- Widen `preparing` to "the item's source is being acquired into the base" and allow it for file items, in the DB constraint (a table-rebuild migration), the entity schema, and the shared state-machine comment. URL and note items keep their current statuses.
- `addItems` creates a file row that still owes its copy as `preparing` (`createActive(..., { awaitingCopy: true })`). `knowledge.copy-sources` flips it to `processing` in the same lock section as the commit rename, then schedules the next stage. Restore copies inline and reindex keeps the old bytes on disk, so both stay on `processing`.
- Readers that need the bytes fall back to the original while a file is `preparing`: preview returns `data.source`, and restore probes and copies `data.source`.
- Existing handling already covers the rest: the boot sweep fails in-flight `preparing` rows (an interrupted copy becomes `indexing_interrupted`), reindex admission rejects them, and the renderer polls them as non-terminal and labels them "Waiting" (`status.pending`) instead of "Processing".

Out of scope: copy progress in the UI; `preparing` for URL items, since a URL only owes a copy when restored with a snapshot and restore copies inline; and tightening the `knowledge.add_items` IPC schema so the restore-only `snapshotPath` / `indexedPath` fields cannot arrive from the renderer (a follow-up).

## Alternatives considered

- Reuse `idle` for "bytes not landed yet": no migration, but nothing in the boot sweep, reindex admission, or the renderer moves an `idle` row forward, so a lost copy job would strand it.
- Keep `processing` and let each reader probe the disk: a missing file cannot tell "still copying" from "copy failed or lost", and every reader re-implements the same guess.
- Add a dedicated status such as `copying`: it would have to be threaded through the status enum, both constraints, the boot sweep, reindex admission, and the UI for the meaning `preparing` already carries.

## Acceptance criteria

- AC1 — A file added through the async copy is listed as `preparing`, shown as "Waiting" rather than "Processing", until its bytes land, then moves to `processing`. (verification: unit + renderer)
- AC2 — After the migration, a file row may be `preparing`, a note or URL row still may not, and existing rows and the child-item cascade are preserved. (verification: unit)
- AC3 — Previewing a `preparing` file opens its original. (verification: unit)
- AC4 — Restoring a base copies a `preparing` file from its original instead of skipping it as a missing source. (verification: unit)
- AC5 — A copy interrupted by an app quit or crash leaves its `preparing` file failed with `indexing_interrupted`. (verification: unit)

## Risks

- The migration rebuilds `knowledge_item`. `applyMigrations` disables foreign keys outside the migration transaction, so the rebuild does not cascade, but its duration grows with the number of item rows.
- Previewing a `preparing` file reads the user's original; if it was moved meanwhile, the preview fails like any other missing file, and the copy itself will fail the item.
