# Agent Note: 流程画布的消息树读取在大话题或深链上失败

Status: implemented

[English](2026-10-28-message-tree-topic-query.md) | 中文

## 问题

`MessageService.getTree` 为 `GET /topics/:topicId/tree` 提供 `depth`、`rootId`、`nodeId` 三个选项，但它唯一的调用方 `TopicBranchPanel` 始终传 `depth: -1`；`rootId` 和 `nodeId` 只有测试在用。

对这唯一的实际用法来说，这套通用逻辑全是成本。服务端大约要跑七次查询：active path 递归 CTE、查虚拟根、查第一轮消息、子树递归 CTE、对所有节点 id 做 `inArray` 取行，以及一段 active path 补查，其 `NOT IN (...)` 又把所有节点 id 绑定一遍。在 `depth: -1` 下补查不可能查到任何东西，因为子树已经包含 active path 及其子节点。每条消息约绑定两个参数，话题一旦超过 SQLite 的参数上限，读取就抛出 `SqliteError: too many SQL variables`。

`collectNodes` 还按树的每一层递归一次。线性对话每条消息就是一层，所以画布在大约 4–5 千条消息时抛出 `RangeError: Maximum call stack size exceeded`。

## 决策

`getTree(topicId)` 用一次按 `topicId` 过滤、按 `createdAt, id` 排序的查询读取话题的全部有效行（走 `message_topic_created_idx`），在内存中找到虚拟根（唯一一条 `parentId IS NULL` 的行），并把它的子节点作为逻辑根。查询不再绑定 id 列表，话题规模不会再触及参数上限。按话题过滤与旧的“从根可达”遍历返回相同的节点：跨话题挂父节点在写入时已被拒绝，而遍历从虚拟根出发，不可达的行永远不会被输出。

`collectNodes` 改为显式栈循环，子节点倒序入栈，保持原有的先序输出。

共享 schema、handler 和服务中的 `TreeQuerySchema` 以及 `depth`、`rootId`、`nodeId` 选项全部删除。

## 备选方案

- 给两处不受限的 `IN` 列表分块：不采用，因为它保留了在唯一实际用法下不可能返回行的补查，每次读取仍约七次查询。
- 保留 `depth` 并为 `-1` 加快速路径：不采用，因为它保留了没人调用的选项，以及会一直没有测试的代码。
- 像 LobeChat 的 `queryTopicMessageTree` 那样只查骨架列：未采用，因为 `preview`、`isContextBoundary`、`isAwaitingInput` 都来自 `data.parts`，把 `extractPreview` 搬进 SQL 会重复它的规则。
- 像 LibreChat 和 Open WebUI 那样在渲染进程加载整个话题再组树：不采用，因为这会推翻对话视图由服务端分页的 DataApi 设计。

## 影响

画布收到的节点、sibling group、`activeNodeId`、`rootId` 不变。非分组的子节点改为按 `createdAt, id` 排序，而不是 `IN` 取行时碰巧返回的顺序。部分展开（`depth`）和显式子树根（`rootId`）不再存在；要重新引入其中任何一个，都需要一个不按节点绑定参数列表的设计。

## 验证

- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts`（`returns every node of a topic larger than the SQLite bound-variable limit`）：3.3 万条消息的话题在修改前抛出 `too many SQL variables`，现在返回全部节点。
- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts`（`returns a linear conversation deeper than the JS call stack in path order`）：2 万条消息的链在修改前抛出 `RangeError`，现在按路径顺序返回全部节点。
- Regression — `pnpm test:main src/main/data/services/__tests__/MessageService.test.ts src/main/data/api/handlers/__tests__/temporaryChats.integration.test.ts` 与 `pnpm test:renderer src/renderer/pages/home/components/__tests__/TopicBranchPanel.test.tsx`：既有的多根、sibling group、清除上下文、awaiting-input、虚拟根契约测试除去掉已删除的选项外均不变并通过。
