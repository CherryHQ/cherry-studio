# Agent Note: The flow-canvas tree read failed on large or deep topics

Status: implemented

English | [中文](2026-10-28-message-tree-topic-query.zh.md)

## Problem

`MessageService.getTree` served `GET /topics/:topicId/tree` with `depth`, `rootId`, and `nodeId` options, but its only caller, `TopicBranchPanel`, always sent `depth: -1`. `rootId` and `nodeId` were used only by tests.

For that one live shape the generality was pure cost. The service ran about seven queries: an active-path recursive CTE, a virtual-root lookup, a first-turn lookup, a subtree recursive CTE, an `inArray` row fetch over every node id, and an active-path back-fill whose `NOT IN (...)` bound every node id again. Under `depth: -1` the back-fill can never find anything, because the subtree already contains the active path and its children. Binding roughly two parameters per message made the read throw `SqliteError: too many SQL variables` once a topic passed SQLite's bound-variable limit.

`collectNodes` also recursed once per tree level. A linear conversation is one level per message, so the canvas threw `RangeError: Maximum call stack size exceeded` at roughly 4-5k messages.

## Decision

`getTree(topicId)` loads the topic's live rows in one `topicId`-scoped select ordered by `createdAt, id` (served by `message_topic_created_idx`), finds the virtual root (the single `parentId IS NULL` row) in memory, and treats its children as the logical roots. No id list is bound, so topic size no longer meets the variable limit. A topic-scoped select returns the same nodes as the old root-reachable walk: cross-topic parents are rejected on write, and the descent starts at the virtual root, so unreachable rows are never emitted.

`collectNodes` became an explicit-stack loop that pushes children in reverse, keeping the previous pre-order output.

`TreeQuerySchema` and the `depth`, `rootId`, and `nodeId` options were removed from the shared schema, the handler, and the service.

## Alternatives considered

- Chunk the two unbounded `IN` lists: rejected because it keeps the back-fill queries that cannot return rows under the only live shape, and still runs about seven queries per read.
- Keep `depth` and add a fast path for `-1`: rejected because it preserves an option nobody calls, together with code that would stay untested.
- Select only skeleton columns, as LobeChat's `queryTopicMessageTree` does: not adopted because `preview`, `isContextBoundary`, and `isAwaitingInput` all derive from `data.parts`, and moving `extractPreview` into SQL would duplicate its rules.
- Load the whole topic in the renderer and build the tree there, as LibreChat and Open WebUI do: rejected because it reverses the server-paged DataApi design for the conversation view.

## Consequences

The canvas receives the same nodes, sibling groups, `activeNodeId`, and `rootId`. Non-grouped children are now ordered by `createdAt, id` instead of whatever order the `IN` fetch returned. Partial expansion (`depth`) and explicit subtree roots (`rootId`) no longer exist. Reintroducing either needs a design that does not bind per-node parameter lists.

## Verification

- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts` (`returns every node of a topic larger than the SQLite bound-variable limit`): a 33k-message topic threw `too many SQL variables` before the change and now returns every node.
- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts` (`returns a linear conversation deeper than the JS call stack in path order`): a 20k-message chain threw `RangeError` before the change and now returns every node in path order.
- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts src/main/data/api/handlers/__tests__/temporaryChats.integration.test.ts` and `pnpm test:renderer src/renderer/pages/home/components/__tests__/TopicBranchPanel.test.tsx`: the existing multi-root, sibling-group, clear-context, awaiting-input, and virtual-root contract tests pass unchanged apart from dropping the removed options.
