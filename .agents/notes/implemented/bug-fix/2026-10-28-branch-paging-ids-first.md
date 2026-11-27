# Agent Note: Conversation paging loaded every message on the path

Status: implemented

English | [中文](2026-10-28-branch-paging-ids-first.zh.md)

## Problem

`getBranchMessages` returns one page (default 20) of the root -> active-node path. It called `getPathRowsToNodeTx`, which walked the whole path with a recursive CTE and then loaded the full row, including the `data` JSON, of every message on it through one `inArray(messageTable.id, ancestorIds)`. The page was sliced in memory afterwards. Each page therefore cost the full path, and a path longer than SQLite's bound-variable limit made both the conversation view and `getPathToNode` throw `SqliteError: too many SQL variables`.

## Decision

Path reads are split into two private steps in `MessageService`:

- `getPathIdsToNodeTx` runs the same recursive CTE but returns only `id, parent_id`, ordered root -> node with the virtual root dropped.
- `getRowsInOrderTx` loads full rows for a given id list in `SQLITE_INARRAY_CHUNK` chunks and returns them in that order.

`getBranchMessages` computes the page window and `nextCursor` on the id list and loads full rows only for the page. The active-path membership check in `delete` uses the id list directly. `getPathRowsToNodeTx` keeps its contract for callers that need every row (`getPathToNode`, topic duplication, chat context building).

`getRowsInOrderTx` deliberately has no `topic_id` predicate. The ids are already topic-scoped by the CTE, and with the predicate SQLite plans each chunk on `message_topic_created_idx` and scans the whole topic per chunk, which makes long paths quadratic (measured: 33k path, 685 ms with the predicate versus 110 ms without).

## Alternatives considered

- Chunk the existing full-row fetch only: rejected because it fixes the variable limit but still loads every row on the path for each page. Keeping the `topic_id` predicate on the chunks also turned it quadratic.
- Bound the recursive CTE with `LIMIT` and walk up from the cursor only one page at a time: rejected for now because the service could no longer cheaply verify that the cursor lies on the active path, so an off-path cursor would silently page another branch instead of returning `NOT_FOUND`. Worth revisiting if paths routinely reach the 100k range, where the id walk itself becomes the cost.
- Load the whole conversation in the renderer, as LibreChat and Open WebUI do: rejected because it reverses the server-paged DataApi design.

## Consequences

A page costs one id-only CTE over the path plus one row fetch for the page. Paging no longer depends on message size. The pagination contract is unchanged: cursor semantics, `nextCursor`, and `NOT_FOUND` for a cursor off the active path. Full-path readers no longer fail on long paths but still scale with path length, as their callers need every row.

## Verification

- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts` (`loads a path longer than the SQLite bound-variable limit`): a 33k-message path threw `too many SQL variables` from `getPathToNode` before the change; it now returns the full path, and `getBranchMessages` returns the newest page.
- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts` (`pages older history through nextCursor and rejects a cursor off the active path`): pins page contents, `nextCursor`, the empty cursor on the last page, and `NOT_FOUND` for an off-path cursor. It fails when `nextCursor` is computed from the wrong index.
- Regression — `pnpm test:main` over `MessageService.test.ts`, `MessageService.compaction.test.ts`, `TopicService.test.ts`, `PersistentChatContextProvider.test.ts`, `PersistentChatContextProvider.compaction.test.ts`, and `temporaryChats.integration.test.ts`: covers every `getPathRowsToNodeTx` caller.
