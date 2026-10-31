# Agent Note: 对话翻页会读取整条路径上的每条消息

Status: implemented

[English](2026-10-28-branch-paging-ids-first.md) | 中文

## 问题

`getBranchMessages` 返回从根到当前节点这条路径上的一页消息（默认 20 条）。它调用 `getPathRowsToNodeTx`：先用递归 CTE 走完整条路径，再用一次 `inArray(messageTable.id, ancestorIds)` 读出路径上每条消息的完整行（包括 `data` JSON），最后才在内存里切出一页。于是每翻一页都要付出整条路径的代价；路径一旦超过 SQLite 的参数上限，对话视图和 `getPathToNode` 都会抛出 `SqliteError: too many SQL variables`。

## 决策

`MessageService` 中的路径读取拆成两个私有步骤：

- `getPathIdsToNodeTx` 运行同样的递归 CTE，但只返回 `id, parent_id`，按从根到节点排序，并去掉虚拟根。
- `getRowsInOrderTx` 按 `SQLITE_INARRAY_CHUNK` 分块读取给定 id 列表的完整行，并按该顺序返回。

`getBranchMessages` 在 id 列表上计算翻页窗口和 `nextCursor`，只为当前页读取完整行。`delete` 判断“是否在当前路径上”时直接使用 id 列表。需要全部行的调用方（`getPathToNode`、复制话题、构建聊天上下文）继续使用 `getPathRowsToNodeTx`，其契约不变。

`getRowsInOrderTx` 有意不带 `topic_id` 条件。id 已由 CTE 限定在话题内；带上这个条件后，SQLite 会让每个分块都走 `message_topic_created_idx`，每块扫一遍整个话题，使长路径的耗时呈平方增长（实测 3.3 万条路径：带条件 685 ms，不带 110 ms）。

## 备选方案

- 只给原来的整行读取加分块：不采用，因为它修好了参数上限，却仍然每页读取路径上的全部行；分块上保留 `topic_id` 条件还会让耗时变成平方增长。
- 给递归 CTE 加 `LIMIT`，每页只从游标往上走一页：暂不采用，因为服务端无法再便宜地确认游标在当前路径上，游标不在路径上时会静默翻到另一条分支，而不是返回 `NOT_FOUND`。如果路径常态达到 10 万级、id 遍历本身成为瓶颈，值得重新考虑。
- 像 LibreChat 和 Open WebUI 那样在渲染进程加载整段对话：不采用，因为这会推翻服务端分页的 DataApi 设计。

## 影响

每页的代价是一次只查 id 的路径 CTE 加一次当前页的取行，翻页不再受消息大小影响。分页契约不变：游标语义、`nextCursor`、游标不在当前路径上时返回 `NOT_FOUND`。读取整条路径的调用方不再因长路径失败，但耗时仍随路径长度增长，因为它们确实需要每一行。

## 验证

- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts`（`loads a path longer than the SQLite bound-variable limit`）：3.3 万条消息的路径在修改前由 `getPathToNode` 抛出 `too many SQL variables`；现在返回完整路径，`getBranchMessages` 返回最新一页。
- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts`（`pages older history through nextCursor and rejects a cursor off the active path`）：固定各页内容、`nextCursor`、最后一页的空游标，以及游标不在路径上时的 `NOT_FOUND`；`nextCursor` 取错下标时该测试会失败。
- Regression — `pnpm test:main` 覆盖 `MessageService.test.ts`、`MessageService.compaction.test.ts`、`TopicService.test.ts`、`PersistentChatContextProvider.test.ts`、`PersistentChatContextProvider.compaction.test.ts`、`temporaryChats.integration.test.ts`：涵盖 `getPathRowsToNodeTx` 的每个调用方。
