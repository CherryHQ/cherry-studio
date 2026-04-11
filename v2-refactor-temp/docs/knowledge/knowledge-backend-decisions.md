# 知识库后端当前实现说明

本文档只记录 `src/main/services/knowledge` 当前已经落地的后端分层、调用边界和 runtime 编排行为。

它的目标不是描述理想方案，而是把当前代码中的稳定事实说明清楚，方便后续 v2 重构继续收敛。

## 1. 当前架构图

```text
+----------------------------------------------------------------------------------+
|                                   Callers                                        |
|                                                                                  |
|   UI (Data API)                    UI / preload IPC / main-side calls            |
+------------------------------------------+---------------------------------------+
                                           |
                    +--------------------------+     +-----------------------------------+
                    |       Data API           |     |  KnowledgeOrchestrationService    |
                    |  knowledge handlers      |     |  caller-facing workflow facade    |
                    +-------------+------------+     +-----------------+-----------------+
                                  |                                    |
                                  v                                    v
                    +--------------------------+          +---------------------------+
                    |   KnowledgeBaseService   |<---------|   KnowledgeItemService    |
                    |   base data logic        |          |   item data + status      |
                    +-------------+------------+          +-------------+-------------+
                                  |                                    |
                                  v                                    v
                        +----------------------+          +---------------------------+
                        |   SQLite / Drizzle   |          |   KnowledgeRuntimeService |
                        +----------------------+          | runtime execution / queue  |
                                                          +-------------+-------------+
                                                                        |
                                                                        v
                                                          +---------------------------+
                                                          | reader / chunk / embed / |
                                                          | rerank / vectorstore      |
                                                          +-------------+-------------+
                                                                        |
                                                                        v
                                                          +------------------------+
                                                          |  LibSQL vector store   |
                                                          +------------------------+
```

当前知识库后端已经分成三层：

1. `KnowledgeBaseService` / `KnowledgeItemService`
   - 负责 SQLite 中的知识库业务主数据 CRUD
   - 负责 `knowledge_item.status` / `error` 的持久化更新
2. `KnowledgeOrchestrationService`
   - 负责对外 workflow 编排
   - 负责统一 caller-facing IPC
   - 负责把 expand / create / add / delete / search 串成单次调用入口
3. `KnowledgeRuntimeService`
   - 负责 runtime 执行
   - 负责 reader / chunk / embedding / vector store 调用串联
   - 负责队列、中断、stop 清理和检索执行

## 2. Data Service 的定位

`src/main/data/services/KnowledgeBaseService.ts` 和 `src/main/data/services/KnowledgeItemService.ts` 属于 data services。

它们负责：

1. SQLite 业务表读写
2. DTO 校验后的数据落库
3. `knowledge_item.data` 与 `type` 的一致性校验
4. item 状态与错误信息的持久化

它们不负责：

1. reader 调度
2. embedding 调用
3. 向量库写入与检索
4. runtime queue 管理

## 3. `KnowledgeRuntimeService` 的定位

当前 runtime/vector 侧的底层执行 service 是 `KnowledgeRuntimeService`，不是旧文档中的 `KnowledgeService`。

对应实现：

- `src/main/services/knowledge/runtime/KnowledgeRuntimeService.ts`
- `src/main/core/application/serviceRegistry.ts`

它是一个 lifecycle service：

1. `@Injectable('KnowledgeRuntimeService')`
2. `@ServicePhase(Phase.WhenReady)`
3. 已注册到应用 service registry

它当前对内部调用方暴露的核心能力是：

1. `createBase(base)`
2. `deleteBase(baseId)`
3. `addItems(base, items)`
4. `deleteItems(base, items)`
5. `search(base, query)`

它负责：

1. item 级索引任务入队与执行
2. `knowledge_item.status` 的有限状态推进
3. 失败与中断原因写回数据库
4. 向量库实例的获取、删除和清理
5. 检索后的 rerank 串联
6. stop / delete 时的 queue 中断与向量清理补偿

它不负责：

1. `knowledge_base` / `knowledge_item` 的主数据 CRUD
2. caller-facing IPC workflow 编排
3. `directory` / `sitemap` owner item 的对外展开入口
4. 持久化任务队列
5. 自动重试
6. 恢复未完成索引任务继续执行
7. 暴露调度器内部概念给调用方

## 3.1 `KnowledgeOrchestrationService` 的定位

当前对外 workflow facade 是 `KnowledgeOrchestrationService`。

对应实现：

- `src/main/services/knowledge/KnowledgeOrchestrationService.ts`
- `src/main/core/application/serviceRegistry.ts`

它是一个 lifecycle service：

1. `@Injectable('KnowledgeOrchestrationService')`
2. `@ServicePhase(Phase.WhenReady)`
3. 已注册到应用 service registry

它当前对外暴露的核心 IPC 能力是：

1. `createBase(baseId)`
2. `deleteBase(baseId)`
3. `addItems(baseId, itemIds)`
4. `deleteItems(baseId, itemIds)`
5. `search(baseId, query)`

它负责：

1. 统一 caller-facing knowledge runtime IPC
2. 对传入 item ids 做主数据读取
3. 对 `directory` / `sitemap` owner item 做内部 expand
4. 通过 `KnowledgeItemService.createMany()` 持久化 expanded child items
5. 过滤真正可索引的 leaf items，再交给 `KnowledgeRuntimeService.addItems()`
6. 协调 runtime 与 data service 的调用顺序

它不负责：

1. 直接执行 reader / chunk / embed / vector write
2. 直接持有 queue
3. 直接持有 vector store 实例

## 4. 当前调用边界与调用方契约

### 4.1 UI

```text
UI
 |
 +--> Data API -> knowledge handlers -> KnowledgeBaseService / KnowledgeItemService
 |
 \--> preload IPC -> KnowledgeOrchestrationService
                     -> KnowledgeRuntimeService
```

当前实现要求调用方明确区分两条调用路径：

1. Data API
   - 负责 `knowledge_base` / `knowledge_item` 的持久化 CRUD
   - 负责调用方显式创建的 owner item / leaf item 主数据创建
   - 负责 `knowledge_item.status` / `error` 的持久化读写
2. runtime IPC
   - 负责统一的 knowledge workflow 入口
   - 负责必要时在 main process 内部展开 `directory` / `sitemap`
   - 负责索引入队、向量写入和删除
   - 负责检索

当前 Data API 侧稳定接口是：

1. `GET /knowledge-bases`
2. `POST /knowledge-bases`
3. `GET /knowledge-bases/:id`
4. `PATCH /knowledge-bases/:id`
5. `DELETE /knowledge-bases/:id`
6. `GET /knowledge-bases/:id/items`
7. `POST /knowledge-bases/:id/items`
8. `GET /knowledge-items/:id`
9. `PATCH /knowledge-items/:id`
10. `DELETE /knowledge-items/:id`

preload 已暴露的 runtime IPC 通道是：

1. `knowledge-runtime:create-base`
2. `knowledge-runtime:delete-base`
3. `knowledge-runtime:add-items`
4. `knowledge-runtime:delete-items`
5. `knowledge-runtime:search`

### 4.1.1 Leaf item 的调用链

`file` / `url` / `note` 这类可直接索引的 leaf item，调用方应走：

```text
caller
 -> Data API create item(s)
 -> get created item ids
 -> preload IPC add-items(item ids)
```

也就是说：

1. 先通过 Data API 创建持久化 `knowledge_item`
2. 再把 Data API 返回的 item ids 传给 runtime `addItems`
3. runtime 不负责替调用方补建 leaf item 主数据
4. runtime `addItems` 的输入语义是“已经存在于 SQLite 中的 item ids”

批量添加 files 时，当前契约就是：

```text
caller
 -> Data API create file items
 -> get created file item ids
 -> preload IPC add-items(file item ids)
```

### 4.1.2 Container item 的调用链

`directory` / `sitemap` 当前已经收口为与 leaf item 相同的“两步调用模型”。

当前调用方应使用：

```text
caller
 -> Data API create owner item
 -> preload IPC add-items(owner item ids)
```

也就是说：

1. owner item 的主数据创建仍然走 Data API
2. 对外 IPC 不再暴露 `expand*`，而是由 `KnowledgeOrchestrationService.addItems()` 在内部判断 owner item 类型
3. 如果传入的是 `directory` / `sitemap` owner item，orchestration 会：
   - expand owner
   - 通过 `KnowledgeItemService.createMany()` 持久化 child items
   - 过滤出 indexable leaf items
   - 调用 `KnowledgeRuntimeService.addItems()` 入队索引
4. `groupId` / `groupRef` 的职责仍然是把 owner / child / nested child 的持久化关系写进 `knowledge_item`
5. 当前调用方不再需要自己显式执行 “expand -> create children -> filter -> add” 这四步

这个边界是当前实现的硬约束：

1. expand 仍然负责生成要创建的持久化 items
2. child item 的持久化仍然通过 `KnowledgeItemService.createMany()` 写入 SQLite
3. `KnowledgeRuntimeService` 仍然只负责编排可索引 items 的读取 / 切块 / embedding / vector write
4. orchestration 只是把上述步骤收口到一次 caller-facing IPC，不改变 data/runtime 的最终边界
5. mixed batch 可用于持久化树结构，但不等于 mixed batch 可直接进入 runtime 索引队列

这个调用链仍然符合“Data Service 负责主数据，Runtime 负责索引执行，Orchestration 负责 workflow 收口”的分层，不属于边界漂移。

`directory` / `sitemap` 的当前内部流程可以进一步写成：

```text
directory/sitemap
 -> Data API create owner
 -> IPC add-items(owner item ids)
    -> orchestration expand owner
    -> orchestration create expanded items
    -> orchestration filter indexable leaf items
    -> runtime add-items(indexable child items)
```

### 4.1.3 删除链路的当前约束

删除场景同样需要区分持久化删除与 runtime 删除。

item 删除时，调用方应理解为两件独立的事：

1. runtime IPC `delete-items`
   - 通过 orchestration 进入删除 workflow
   - 中断 pending / running add task
   - 删除 item 及其级联子项的向量
2. Data API `DELETE /knowledge-items/:id`
   - 删除 SQLite 中的 `knowledge_item`
   - 依赖数据库 cascade 删除 grouped descendants

base 删除时，调用方同样需要区分两步：

1. runtime IPC `delete-base`
   - 通过 orchestration 进入删除 workflow
   - 中断该 base 下相关 add task
   - 删除对应 vector store
2. Data API `DELETE /knowledge-bases/:id`
   - 删除 SQLite 中的 base 和关联 items

当前实现下，Data API 删除并不会替调用方清理向量库，也不会替调用方中断 runtime 任务。

### 4.2 Main 进程内部调用

主进程内部其他模块如果需要 caller-facing workflow 能力，应优先调用 `KnowledgeOrchestrationService`。

主进程内部如果已经明确持有 leaf items 且只需要底层索引执行能力，可以直接调用 `KnowledgeRuntimeService`。

主进程内部如果需要业务主数据能力，应直接调用 `KnowledgeBaseService` / `KnowledgeItemService`。

## 5. 当前 Queue 模型

### 5.1 已落地行为

当前实现使用一个进程内自定义 add queue：

1. queue 持有者是 `KnowledgeRuntimeService`
2. queue 为单实例 in-memory queue
3. 默认 `concurrency = 5`
4. 所有 base 的 add item 任务共用这一条 queue
5. delete 行为不会进入 queue，而是先中断相关 add 任务，再直接删除向量

当前实现没有落地以下旧设计假设：

1. 不是“每个 knowledge base 一条串行 queue”
2. 不是 round-robin scheduler
3. 没有全局持久化任务表

### 5.2 当前可观测状态

当前 queue 内部维护的是一份 `entries` map，entry 上记录：

1. `item.id`
2. `status = pending | running`
3. `controller`
4. `promise`
5. `interruptedBy`

它们的作用仅是：

1. 跟踪哪些 add 任务仍在等待执行
2. 跟踪哪些 add 任务正在运行
3. 在 delete / shutdown 时中断对应任务
4. 在 shutdown 时识别哪些 item 被中断并做失败补偿

这些状态都只是 runtime 内部实现细节，不是对外数据模型的一部分。

### 5.3 入队行为

`addItems(base, items)` 当前行为：

1. 对传入的每个 item 分别先写 `status = pending`
2. 同时清空该 item 的旧 `error`
3. 每个 item 在自己的状态写入成功后，立即作为一个 add task 入队
4. 如果同一个 item 已经在 pending 或 running 中，再次 enqueue 会直接复用已有 promise，不会重复入队
5. 当前实现不是“整批状态先全部落库，再统一开始 enqueue”的原子批次启动模型
6. 因此如果某个 item 在写 `pending` 或 enqueue 之前失败，其他已经成功启动的 item 仍可能继续执行

`deleteItems(base, items)` 当前行为：

1. 不更新 item 状态
2. 先对同 id 的 pending / running add task 做 interrupt
3. 等待相关 running add task settle
4. 直接删除这些 item 对应的向量

当前有：

1. item 级 add 去重保护
2. delete / stop 中断 add task 的机制

当前没有：

1. 优先级队列
2. 暂停 / 恢复 API
3. 自动重试

## 6. 当前索引执行链路

一个 `knowledge_item` 的一次索引流程，当前是：

```text
addItems
 -> status = pending
 -> queue task
 -> loadKnowledgeItemDocuments(item)
 -> chunkDocuments(base, item, documents)
 -> getEmbedModel(base)
 -> embedDocuments(model, chunks)
 -> vectorStore.add(nodes)
 -> status = completed
```

任意步骤抛错时：

```text
catch error
 -> status = failed
 -> error = normalizedError.message
 -> 向上抛出异常
```

当前还没有落地 `fileProcessorId` 的执行链路。代码中这一段仍然是 `// todo file processing`。

## 7. `knowledge_item.status` 的当前实现边界

### 7.1 枚举定义

schema 和共享类型仍然保留完整状态集合：

1. `idle`
2. `pending`
3. `file_processing`
4. `read`
5. `embed`
6. `completed`
7. `failed`

### 7.2 当前 runtime 实际写入

`KnowledgeRuntimeService` 当前真正写入的状态只有：

1. 入队前写 `pending`
2. 成功完成写 `completed`
3. 任意失败或 shutdown 中断写 `failed`

也就是说：

1. `file_processing` / `read` / `embed` 目前仍是预留状态
2. 它们已进入 schema，但当前 runtime 尚未推进到这些中间态

这部分必须在文档中明确，因为旧文档把这些状态当成“当前已经落地的推进链路”，但实现并非如此。

## 8. Lifecycle 行为

`KnowledgeRuntimeService` 已经接入 lifecycle system，当前行为如下。

### 8.1 `onInit`

当前做三件事：

1. `isStopping = false`
2. `addQueue.reset()`

当前没有启动时“扫描中间状态并补偿失败”的逻辑。

### 8.2 `onStop`

当前 stop 流程是：

1. `isStopping = true`
2. 调用 `addQueue.interruptAll('stop', SHUTDOWN_INTERRUPTED_REASON)`
3. 收集中断的 entries 和 itemIds
4. 等待相关 running add task settle
5. best-effort 删除这些被中断 item 已写入的向量
6. 将这些 item 批量写为 `failed`

这意味着：

1. 当前做了停止时的失败补偿
2. 当前会在 stop 时清理被中断 item 的向量残留
3. 但没有做重启后的自动恢复

## 9. Reader / Chunk / Embed / Search 的当前边界

### 9.1 Reader

reader 由 `loadKnowledgeItemDocuments(item)` 按 `item.type` 分派：

1. `file` -> `KnowledgeFileReader`
2. `url` -> `KnowledgeUrlReader`
3. `note` -> `KnowledgeNoteReader`
4. `sitemap` -> `KnowledgeSitemapReader`
5. `directory` -> `KnowledgeDirectoryReader`

当前各 reader 的实际行为：

1. `file`
   - 按扩展名选择 reader
   - 已支持 `pdf` / `csv` / `docx` / `epub` / `json` / `md` / `draftsexport`
   - 其他扩展名回退到 `TextFileReader`
2. `url`
   - 通过 `https://r.jina.ai/<url>` 抓取 markdown
   - 元数据中保留 `itemId` / `itemType` / `sourceUrl` / `name`
3. `note`
   - 直接把 `content` 包成一个 `Document`
4. `sitemap`
   - 当前已保留 `KnowledgeSitemapReader` 代码路径
   - 但 runtime 侧暂时不直接索引 `sitemap` item
   - 当前调用方会先创建 sitemap owner，再通过 runtime IPC 将其展开为具体 `url` item，再进入索引流程
5. `directory`
   - 当前只作为 container placeholder
   - reader 会记录 warning 并返回空数组
   - 也就是说它不会直接产出可索引文档，调用方需要先创建 directory owner，再通过 runtime IPC 将其展开为具体子 item

### 9.2 Chunk

`chunkDocuments(base, item, documents)` 当前做的事情：

1. 使用 `SentenceSplitter`
2. 读取 `base.chunkSize` 和 `base.chunkOverlap`
3. 为每个 chunk 写入元数据：
   - `itemId`
   - `itemType`
   - `sourceDocumentIndex`
   - `chunkIndex`
   - `chunkCount`

### 9.3 Embed

`getEmbedModel(base)` 当前只支持：

1. 从 `embeddingModelId` 解析 `providerId::modelId`
2. 仅接受 `providerId === 'ollama'`

其他 provider 当前会直接抛错。

`embedDocuments(model, documents)` 当前会：

1. 用 `embedMany` 批量生成 embeddings
2. 构造 `TextNode`
3. 在 `NodeRelationship.SOURCE` 上写回 `itemId`

### 9.4 Search

`search(base, query)` 当前链路是：

```text
embed query
 -> vectorStore.query(...)
 -> map nodes into KnowledgeSearchResult[]
 -> rerankKnowledgeSearchResults(base, query, results)
```

查询参数来自 base：

1. `mode = base.searchMode ?? 'default'`
2. `similarityTopK = base.documentCount ?? 10`
3. `alpha = base.hybridAlpha`

### 9.5 Rerank 的当前真实状态

当前 rerank 代码路径已经存在，但 runtime 配置解析尚未接通：

1. `base.rerankModelId` 为空时直接跳过
2. `resolveRerankRuntime(base)` 目前始终返回 `null`
3. 因此当前 search 实际上总是返回原始检索结果，不会真正发起 rerank 请求

换句话说，rerank 是“代码壳已存在，但还未真正启用”。

## 10. `KnowledgeVectorStoreService` 的边界

`KnowledgeVectorStoreService` 当前负责 runtime vector store 的最小缓存和生命周期管理。

它负责：

1. 按 `base.id` 创建或复用 store
2. 删除单个 base 的 store 文件
3. shutdown 时关闭所有已缓存 store

它当前的重要约束是：

1. cache key 只有 `base.id`
2. 默认把 store shaping 配置视为不可变
3. 如果 `embeddingModelId` / `dimensions` 发生变化，调用方应迁移到新的 knowledge base，而不是原地修改同一个 base 对应的向量文件

当前实际 provider 是 `LibSqlVectorStoreProvider`：

1. 向量文件路径位于 `application.getPath('feature.knowledgebase.data', <sanitizedBaseId>)`
2. 删除 base 时会删除对应文件

## 11. 当前明确不做的内容

当前实现没有做：

1. 每个 base 一条串行 queue
2. round-robin scheduler
3. 独立的 `KnowledgeTaskService`
4. 独立的 `KnowledgeExecutionService`
5. 持久化任务队列
6. 自动恢复索引继续执行
7. 自动重试
8. chunk 级 queue
9. runtime 在 `addItems` 内对 `directory` / `sitemap` item 做隐式自动展开
10. 真正可用的 rerank runtime 配置接入
11. 非 `ollama` embedding provider 支持
12. `fileProcessorId` 驱动的文件处理链路

## 12. 后续更新本文档时的原则

后续只有在以下行为真正落地之后，才应更新本文档：

1. runtime queue 从单队列改成 per-base queue
2. 中间状态 `file_processing` / `read` / `embed` 真的开始持久化写入
3. rerank runtime 配置真正接通
4. `fileProcessorId` 开始参与 runtime 执行链路
5. runtime 在 `addItems` 中原生接管 `directory` / `sitemap` item 的隐式展开与索引编排

在这些行为落地之前，文档应继续以“当前已实现”为准，不提前写成目标设计。
