# Agent Note: Copy Knowledge sources outside the base mutation lock

Status: proposed

English | [中文](2026-10-21-knowledge-async-source-copy.zh.md)

## Problem

The [Knowledge README](../../../../src/main/features/knowledge/README.md) requires handlers to hold the per-base mutation lock (`KeyedMutex.runExclusive`) only around the mutation section, never across slow I/O. Three paths copy user files while holding it:

- `KnowledgeIngestionService.addItems` copies every picked file into `raw/` inside the lock and resolves only after the last byte lands.
- `knowledge.prepare-root` scans a directory and copies the whole tree inside one lock section (`scanRootItem`).
- `knowledge.reindex-subtree` re-copies every selected file root from its original inside its single reset lock section; enabling an embedding model on a BM25-only base puts every root of the base in one such job.

The lock has no timeout and guards almost every write on the base: another add, item and base deletion, the final vector write and status flip of `knowledge.index-documents`, URL and note snapshot writes, the hand-off from file processing to indexing, `knowledge.delete-subtree`, and the reindex reset. A slow copy stalls all of them, and the stall grows with total bytes rather than file count. Once #22089 removes the 20-source cap, one pick of hundreds of large files can hold the lock for minutes. Lock waits also count toward job timeouts (2 minutes for `knowledge.check-file-processing-result`, 30 for `knowledge.index-documents`); what a timed-out job does once it finally acquires the lock has not been verified.

Users see the same cost directly. A direct file pick shows nothing until every copy finishes. After a same-name conflict is resolved, the conflict dialog cannot be closed until then. One unreadable file fails the add and rolls back the whole selection.

URL and note re-acquisition in reindex already fetch off the lock (`reacquire.ts`); only their small snapshot writes run inside it. The file utilities provide the matching primitive for copies: `prepareAtomicCopy` streams into a temp file next to the target, and its `commit()` is a rename.

## Proposal

Take every copy off the lock so the lock covers only name reservation, status and row writes, the final commit, and index writes.

- **File add.** Inside the lock, `addItems` keeps resolving conflicts (including the `replace` purge), reserving `raw/` names, and creating rows in `processing`, but copies no bytes. After the lock it enqueues one copy job per file item on the base queue and resolves. Name reservation is already derived from item rows, so a reserved name stays claimed before its bytes exist. Every `raw/` name choice (an add, a directory prefix, a URL or note snapshot, a processed artifact) also counts rows still being deleted, whose cleanup unlinks those names later: a same-named item in that window gets an `_N` name, or fails for a processed artifact, whose name is fixed, instead of writing a file the cleanup would delete.
- **Copy job.** A new Knowledge job copies the item's source into a prepared temp file next to its reserved path, off the lock. Inside the lock it then confirms the item is still live, commits the rename, and schedules the item's next stage (file processing or indexing). The job is listed in `KNOWLEDGE_JOB_TYPES` and carries `itemId`, so subtree and base deletion cancel it like any other Knowledge job. It declares `recovery: 'abandon'` and reuses the shared `onSettled` failure path: a failed copy marks only its own item failed with the reason, and an interrupted copy becomes `indexing_interrupted`, reindexable from the original source.
- **Directory import.** `knowledge.prepare-root` still pins the container's `raw/` prefix inside the lock, scans and copies outside it, then re-checks that the container is live and creates the child rows inside the lock. Directory copy progress keeps its current display.
- **Reindex.** `reindexItems` enqueues one `knowledge.reindex-subtree` job per selected root. A delete or `replace` cancels every job whose roots touch its subtree, so roots sharing one job (a whole base, when an embedding model is first enabled) would all be interrupted by a delete of any one of them. Each job splits its single lock section in two. The first activates the root (`processing` / `preparing`); the re-acquired bytes are then written off the lock; the second re-checks for a delete, then deletes the old vectors and expanded children before scheduling. Every delete check looks at the selected root itself, not its whole subtree: a delete of one of a container's children must not strand the already-activated container, whose reset removes that child anyway. An active root is invisible to search and reads (`query/visibility.ts`), so its old index is never served against new bytes, and each write is still an atomic tmp+rename. A failed or interrupted re-acquisition leaves the root active for `onSettled` and the boot sweep to fail, with its old vectors intact.
- **Unchanged.** IPC shapes, item statuses, and the database schema (no migration); same-name conflict detection and the rename/replace outcomes; Knowledge base restore, which keeps copying inside its call because its target base is newly created (the lock blocks nothing else) and it relies on all-or-nothing rollback.

Out of scope: an explicit "acquiring" state for file items (planned as the next change and released together with this one: let file items use `preparing`, which needs a table-rebuild migration); per-file copy progress and aggregate import progress in the UI; whether retries and embedding backfill need to re-acquire from the original at all (#22092); moving the `replace` purge after the new copy succeeds (after this change a failed copy leaves a visible, reindexable item instead of an error with nothing added); and the file-processing 30-minute limit counting queue time.

## Alternatives considered

- Keep copying in `addItems` and chunk the selection in the renderer: releases the lock between chunks but still holds it for each chunk's copy, keeps the silent wait, and needs a new conflict-precheck route because `detect` writes immediately when a chunk has no conflict.
- Copy outside the lock but still inside `addItems`: frees the lock, but the caller still waits for every byte and one failure still fails the whole add.
- Create rows as `idle` and give the copy job `recovery: 'retry'`: copying spends nothing, so resuming automatically after a crash is attractive. Rejected for now because nothing in the boot sweep, reindex admission, or the renderer moves an `idle` item forward, so a copy job lost for any reason would strand its row; `abandon` keeps the recovery story of every other indexing job.
- Enqueue copy jobs with a higher queue priority so they jump ahead of pending indexing: `EnqueueOptions.priority` already exists and would bound the wait to one running job. Deferred because the right concurrency split between copying and indexing on a base is not settled yet.
- Keep one job per reindex request and walk its roots one at a time, staging and committing each root in its own lock section: no root is ever active without its follow-up job, but any delete or `replace` still cancels the whole job, and the roots it never reached silently keep their old index (for an embedding backfill, no vectors at all).
- For reindex, stage every file copy into a temp file before the lock and only rename inside it: keeps the single lock section, but holds temp copies of every selected file at once (a whole base when enabling an embedding model). Activating first lets each write land directly, one file at a time.
- Create copying file rows as `preparing` in this change: gives "bytes not landed yet" an explicit state that boot recovery, reindex admission, and polling already handle. Deferred to its own change because `preparing` is directory-only in the `knowledge_item_type_status_check` constraint and the entity schema, so it needs a table-rebuild migration.

## Acceptance criteria

- AC1 — An interactive file add resolves before any file bytes are copied, and the new items are listed while their copies are still running. (verification: unit)
- AC2 — While a file or directory copy is running, a delete, another add, and an index job's final write on the same base complete without waiting for the copy to finish. (verification: unit)
- AC3 — A file whose copy fails because its source is missing or unreadable is marked failed with the reason, while the other files from the same add are copied and indexed. (verification: unit)
- AC4 — Deleting a copying item, or its knowledge base, cancels the copy and leaves no file of that item under the base's `raw/` directory. (verification: unit)
- AC5 — A copy interrupted by an app quit or crash leaves the item failed with `indexing_interrupted`, and reindexing it copies and indexes it. (verification: unit)
- AC6 — Same-name conflict detection, the rename/replace outcomes, and restore's all-or-nothing behavior are unchanged. (verification: unit)
- AC7 — In a packaged build, importing several hundred large files lists them at once, and deleting another item in the same base during the copy takes effect without waiting for the copy. (verification: packaged artifact)
- AC8 — While a reindex re-copies a file root, other mutations on the same base complete without waiting; the root is already out of `completed`, a delete of that root that lands meanwhile skips its reset, and a delete of one of a container root's children does not stop the container's rebuild. (verification: unit)
- AC9 — Reindexing several roots, including the backfill that enabling an embedding model starts, runs one job per root; deleting or replacing one of them during the reindex leaves the others' reindex running. (verification: unit)

## Risks

- Known limitation: the window between add and copy grows from zero to the queue wait. Knowledge jobs on a base queue run first-in, first-out, so an import into a base that still has earlier work pending (for example a previous import's indexing) copies only after that backlog drains, which can take far longer than the copy itself. Until its copy finishes, an item still needs its original file; moving or deleting it, or unplugging the drive it lives on, fails that item (not the whole add), and the list shows such items as `processing` like any other.
- Known limitation, closed in this stack before it ships: reindex jobs keep `recovery: 'abandon'`, so a reindex whose job has not reached its first lock section when the app quits is cancelled at the next start without touching its roots. Their old index stays searchable, which is harmless for a refresh, but an embedding backfill leaves those items without vectors while they still show `completed`. `main` has the same gap until its single reindex job reaches its lock section (#22365); one job per root widens it to the whole time the backfill's jobs are still queued. A follow-up PR stacked on #22094 fixes it by changing the backfill itself: it marks the items active when the model is enabled and indexes each leaf from the in-base copy, so this stack does not ship the widened window. That change partially supersedes this note (the backfill clause of AC9 and this limitation); see the [backfill Spec](2026-10-22-knowledge-backfill-from-in-base-copy.md).
- A reindex adds one job row per root to the base queue, so work queued after a large reindex (another import's copies, a delete's cleanup) waits behind it, like the copy backlog above; a delete itself still takes effect at once.
- Copy jobs share the base queue's five slots with indexing, so a large import delays other indexing in the same base (throughput, not peak load) and adds one job row per file until JobManager GC prunes it.
- `processing` now also covers waiting to copy and copying; the UI cannot tell these apart until the progress follow-up.
- An item row no longer implies its bytes are on disk. Scheduling and the file-processing start move behind the copy job's hand-off; two readers keep the gap until the explicit state lands: previewing a copying item (`knowledge.get_file_path`) finds no file, and restoring a base while some of its files are still copying skips those items as missing sources.
