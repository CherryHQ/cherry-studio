# 知识库后端当前实现说明

本文档只记录当前分支中 `src/main/services/knowledge` 已经落地的后端分层、调用边界和 runtime 编排行为。

它的目标不是描述理想方案，而是把当前代码中的稳定事实说明清楚，方便后续 v2 重构继续收敛。本文不覆盖旧的 `src/main/knowledge` / `knowledge-base:*` 通道。

## 1. 当前架构图

```text
+----------------------------------------------------------------------------------+
|                                      Callers                                      |
|                                                                                  |
|   UI (Data API reads/patch)              UI / preload IPC / main-side workflow    |
+-----------------------------------+----------------------------------------------+
                                    |
                                    v
                    +-------------------------------+
                    |          Data API             |
                    |  knowledge read/update        |
                    +---------------+---------------+
                                    |
                                    v
                    +-------------------------------+
                    | KnowledgeBaseService /        |<-----------------------------+
                    | KnowledgeItemService          |                              |
                    | SQLite business data          |                              |
                    +---------------+---------------+                              |
                                    |                                              |
                                    v                                              |
                          +-------------------+                                    |
                          | SQLite / Drizzle  |                                    |
                          +-------------------+                                    |
                                                                                   |
       +----------------------------------------+                                  |
       | KnowledgeOrchestrationService          |----------------------------------+
       | caller-facing runtime workflow facade  |
       +-------------------+--------------------+
                           |
                           v
       +----------------------------------------+
       | KnowledgeRuntimeService                |
       | prepare/index/search/chunk runtime     |
       +-------------------+--------------------+
                           |
                           v
       +----------------------------------------+
       | reader / chunk / embed / rerank /      |
       | KnowledgeVectorStoreService            |
       +-------------------+--------------------+
                           |
                           v
                    +------------------+
                    | LibSQL vector DB |
                    +------------------+
```

当前知识库后端分为四个主要职责层：

1. `KnowledgeBaseService` / `KnowledgeItemService`
   - 负责 SQLite 中的知识库业务主数据读写
   - 负责 `knowledge_item.status` / `phase` / `error` 的持久化更新
   - 负责 `knowledge_item.data` 与 `type` 的一致性校验
   - 负责 container item 的子项状态向上聚合
2. Data API knowledge handlers
   - 只暴露数据库可直接满足的读和 base metadata/config 更新
   - 不负责 runtime mutation，不创建或删除 vector store artifacts
3. `KnowledgeOrchestrationService`
   - 负责 caller-facing runtime IPC 和 main-side workflow facade
   - 负责 create/delete base、delete/reindex item ids 归一化、chunk/search workflow 转发
   - 不直接执行 reader/chunk/embed/vector write，也不持有 queue
4. `KnowledgeRuntimeService`
   - 负责 runtime add item 创建、`prepare-root` / `index-leaf` 入队与执行
   - 负责 reader / chunk / embedding / vector store 调用串联
   - 负责 queue、中断、stop 清理、reindex 和检索执行

## 2. Data Service 与 Data API 的定位

`src/main/data/services/KnowledgeBaseService.ts` 和 `src/main/data/services/KnowledgeItemService.ts` 属于 data services。

它们负责：

1. SQLite 业务表读写
2. DTO 校验后的数据落库
3. `knowledge_item.data` 与 `type` 的一致性校验
4. item 状态、阶段和错误信息的持久化
5. leaf item 完成或失败后，向上更新 `directory` / `sitemap` container 的状态

它们不负责：

1. caller-facing runtime IPC
2. reader 调度
3. embedding 调用
4. 向量库写入与检索
5. runtime queue 管理

当前 Data API knowledge handlers 只暴露：

1. `GET /knowledge-bases`
2. `GET /knowledge-bases/:id`
3. `PATCH /knowledge-bases/:id`
4. `GET /knowledge-bases/:id/items`
5. `GET /knowledge-items/:id`

也就是说，当前 Data API 不暴露 knowledge base 创建、knowledge base 删除、knowledge item 创建、knowledge item 删除或 item 状态 mutation。这些带 runtime side effects 的操作由 `KnowledgeOrchestrationService` 统一处理。

## 3. `KnowledgeRuntimeService` 的定位

当前 runtime/vector 侧的底层执行 service 是 `KnowledgeRuntimeService`，不是旧文档中的 `KnowledgeService`。

对应实现：

- `src/main/services/knowledge/runtime/KnowledgeRuntimeService.ts`
- `src/main/core/application/serviceRegistry.ts`

它是一个 lifecycle service：

1. `@Injectable('KnowledgeRuntimeService')`
2. `@ServicePhase(Phase.WhenReady)`
3. `@DependsOn(['KnowledgeVectorStoreService'])`
4. 已注册到应用 service registry

它当前对内部调用方暴露的核心能力是：

1. `createBase(baseId)`
2. `deleteBase(baseId)`
3. `addItems(baseId, inputs)`
4. `deleteItems(baseId, rootItems)`
5. `reindexItems(baseId, rootItems)`
6. `search(baseId, query)`
7. `listItemChunks(baseId, itemId)`
8. `deleteItemChunk(baseId, itemId, chunkId)`

它负责：

1. 创建 runtime add 传入的 `knowledge_item`
2. `prepare-root` / `index-leaf` 任务入队与执行
3. `knowledge_item.status` / `phase` 的有限状态推进
4. 失败与中断原因写回数据库
5. 向量库实例的获取、删除和清理
6. 检索后的 rerank 串联
7. stop / delete / reindex 时的 queue 中断与向量清理补偿

它不负责：

1. `knowledge_base` 的主数据 CRUD
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
3. `@DependsOn(['KnowledgeRuntimeService'])`
4. 已注册到应用 service registry

它当前对外暴露的核心 IPC 能力是：

1. `createBase(base dto)`
2. `deleteBase(baseId)`
3. `addItems(baseId, item payloads)`
4. `deleteItems(baseId, itemIds)`
5. `reindexItems(baseId, itemIds)`
6. `search(baseId, query)`
7. `listItemChunks(baseId, itemId)`
8. `deleteItemChunk(baseId, itemId, chunkId)`

它负责：

1. 统一 caller-facing knowledge runtime IPC
2. create base 时协调 SQLite base 创建和 vector store 创建
3. delete base 时先 runtime cleanup，再删除 SQLite base
4. 对 delete / reindex / chunk 操作传入的 item ids 做主数据读取
5. 删除 / 重建时把传入 ids 归一化为 top-level roots
6. 在 runtime 清理完成后删除 SQLite root rows

它不负责：

1. 直接执行 reader / chunk / embed / vector write
2. 直接持有 queue
3. 直接持有 vector store 实例
4. 展开 `directory` / `sitemap`
5. 创建 expanded child items

## 4. 当前调用边界与调用方契约

### 4.1 UI / preload

当前 v2 runtime 调用模型是：

```text
UI
 |
 +--> Data API
 |     -> list/get knowledge bases
 |     -> patch base metadata/config
 |     -> list/get knowledge items
 |
 \--> preload knowledgeRuntime IPC
       -> create/delete base
       -> add/delete/reindex items
       -> search
       -> list/delete chunks
```

添加 file / url / note / directory / sitemap 时，调用方应直接走：

```text
caller
 -> preload IPC add-items(item payloads)
```

调用方不再需要先通过 Data API 创建 item，也不需要把 created item ids 再传给 runtime `addItems`。

### 4.1.1 Leaf item 的调用链

```text
caller
 -> preload IPC add-items(leaf item payloads)
    -> runtime creates leaf items
    -> leaf status = processing, phase = null
    -> enqueue index-leaf
```

### 4.1.2 Container item 的调用链

`directory` / `sitemap` 当前已经收口为与 leaf item 相同的 runtime 调用模型。

```text
caller
 -> preload IPC add-items(owner item payloads)
    -> runtime creates root item
    -> root status = processing, phase = preparing
    -> enqueue prepare-root(root id)
    -> prepare-root expands owner
    -> prepare-root creates child items
    -> prepare-root enqueues index-leaf(child leaf ids)
    -> clear root phase
    -> reconcile container status from children
```

这个边界是当前实现的硬约束：

1. expand 只发生在 runtime `prepare-root` task 内
2. child item 的持久化由 prepare helper 通过 `KnowledgeItemService.create()` 写入 SQLite
3. `KnowledgeRuntimeService` 同时负责 root preparation 和 leaf indexing 的 queue 生命周期
4. orchestration 只是 caller-facing workflow facade，不参与 preparation 细节
5. mixed batch 可包含 leaf 和 root container payload，但最终会拆成 `prepare-root` / `index-leaf` 两类 queue task

### 4.1.3 Nested container 约束

当前产品约束是：调用方不允许把 `directory` / `sitemap` 作为另一个 item 的用户输入子节点添加。

允许的 container 来源只有：

1. 用户通过 `addItems()` 添加的 top-level `directory` / `sitemap` root
2. directory expansion 内部为了保留目录层级而创建的 nested `directory` rows

不允许的来源是：

1. 用户显式创建 parent 为其他 item 的 `directory` / `sitemap`
2. 用户把 `sitemap` 放进另一个 `directory` / `sitemap` 下面作为可独立 preparation 的 descendant root

这个约束影响 delete / reindex 的 review 边界：

1. 当前 runtime 只需要中断传入 roots 以及 fresh 查询到的 descendants
2. 不需要为“descendant `prepare-root` 在 snapshot 之后继续发布新 leaf”的未来嵌套 container 场景加入 stable-loop interrupt
3. 如果未来开放用户添加 nested `directory` / `sitemap`，必须先重新设计 interrupt/reconcile 语义，再放开这个输入能力

### 4.1.4 删除链路的当前约束

item 删除时，调用方应理解为两件独立的事：

1. runtime IPC `delete-items`
   - 通过 orchestration 进入删除 workflow
   - 将传入 ids 归一化为 top-level roots
   - 中断 root `prepare-root` / `index-leaf`
   - fresh 查询 descendants
   - 中断 descendants 的 `prepare-root` / `index-leaf`
   - 删除 item 及其级联子项的向量
2. orchestration 在 runtime cleanup 后删除 SQLite root rows
   - 数据库 cascade 删除 grouped descendants

base 删除时会先中断并等待该 base 的 runtime work，然后删除 SQLite base 和关联 items。
SQLite 删除成功后，再 best-effort 删除该 base 的 vector artifacts；artifact 清理失败只记录日志，不回滚已完成的 SQLite 删除。

当前实现下，Data API 删除并不会替调用方清理向量库，也不会替调用方中断 runtime 任务。

### 4.2 Main 进程内部调用

主进程内部其他模块如果需要 caller-facing workflow 能力，应优先调用 `KnowledgeOrchestrationService`。

主进程内部如果只需要 SQLite 主数据读写能力，应直接调用 `KnowledgeBaseService` / `KnowledgeItemService`。

## 5. Base workflow

`createBase(dto)` 当前流程：

```text
IPC create-base(CreateKnowledgeBaseDto)
 -> KnowledgeBaseService.create(dto)
 -> KnowledgeRuntimeService.createBase(base.id)
 -> KnowledgeVectorStoreService.createStore(base)
 -> return created base
```

如果 vector store 初始化失败，orchestration 会调用 `KnowledgeBaseService.delete(base.id)` 回滚刚创建的 SQLite base，然后把原始错误抛给调用方。

`deleteBase(baseId)` 当前流程：

```text
IPC delete-base(baseId)
 -> KnowledgeRuntimeService.deleteBase(baseId)
 -> KnowledgeBaseService.delete(baseId)
 -> KnowledgeRuntimeService.deleteBaseArtifacts(baseId)
```

runtime 删除阶段会先中断该 base 下 pending / running runtime task，等待 running task settle，并返回被中断 item ids。
随后 data service 删除 SQLite base 和关联 items。
SQLite 删除成功后，orchestration 再调用 artifact cleanup 删除该 base 对应的 vector store；该 cleanup 失败只记录日志。
如果 SQLite 删除失败，orchestration 会把被中断 items 标记为 failed，然后把 SQLite 删除错误抛给调用方。

## 6. 当前 Queue 模型

当前实现使用一个进程内 runtime queue：

1. queue 持有者是 `KnowledgeRuntimeService`
2. queue 为单实例 in-memory queue
3. 默认 `concurrency = 5`
4. 所有 base 的 runtime task 共用这一条 queue
5. queue task 分为 `prepare-root` 和 `index-leaf`
6. delete / reindex 不进入 queue，而是先中断相关 runtime task，再直接删除向量

当前实现没有落地以下旧设计假设：

1. 不是“每个 knowledge base 一条串行 queue”
2. 不是 round-robin scheduler
3. 没有全局持久化任务表

queue 内部维护 `entries` map，entry 上记录：

1. `base`
2. `baseId`
3. `itemId`
4. `kind = prepare-root | index-leaf`
5. `status = pending | running | settled`
6. `controller`
7. `promise`
8. `runPromise`
9. `interruptError`

这些状态只用于：

1. 跟踪哪些 runtime task 仍在等待执行
2. 跟踪哪些 runtime task 正在运行
3. 在 delete / reindex / shutdown 时中断对应任务
4. 在 shutdown 时识别哪些 item 被中断并做失败补偿

它们不是对外数据模型的一部分。

## 7. 当前索引执行链路

一个 leaf `knowledge_item` 的一次索引流程，当前是：

```text
addItems
 -> create leaf item
 -> status = processing, phase = null
 -> queue task index-leaf
 -> phase = reading
 -> loadKnowledgeItemDocuments(item)
 -> chunkDocuments(base, item, documents)
 -> phase = embedding
 -> getEmbedModel(base)
 -> embedDocuments(model, chunks)
 -> runWithBaseWriteLock
    -> KnowledgeVectorStoreService.createStore(base)
    -> vectorStore.add(nodes)
 -> status = completed, phase = null
```

任意非中断错误抛出时：

```text
catch error
 -> logger.error(...)
 -> best-effort cleanup vectors
 -> status = failed, phase = null
 -> error = normalizedError.message
 -> 向上抛出异常
```

`directory` / `sitemap` 的一次 preparation 流程，当前是：

```text
addItems
 -> create root item
 -> root status = processing, phase = preparing
 -> queue task prepare-root
 -> expand directory/sitemap with queue AbortSignal
 -> create child items
 -> child leaf status = processing
 -> child directory status = processing, phase = preparing
 -> enqueue child leaf index-leaf
 -> root phase = null
 -> reconcile root/container statuses from children
```

preparation 被 interrupt 时：

1. queue signal 会在 expand I/O 前后、循环边界和 child create 边界被检查
2. prepare task 不再发布新的 stale leaf task
3. cleanup 由 runtime interrupt flow 统一处理
4. 已创建的 root / descendants 会被标记为 `failed` 或在 delete flow 中由 SQLite cascade 删除

`fileProcessorId` 已保留在 schema/config 中，但 runtime 处理链路尚未接入该配置。

## 8. `knowledge_item.status` / `phase` 的当前实现边界

当前 `status` 表达总体状态：

1. `idle`
2. `processing`
3. `completed`
4. `failed`

当前 `phase` 字段允许以下值：

1. `null`
2. `preparing`
3. `reading`
4. `embedding`

`KnowledgeRuntimeService` 当前写入的 active 状态是：

1. `processing, phase = preparing`：`directory` / `sitemap` root 或 nested directory 正在 expand / create children
2. `processing, phase = reading`：leaf 正在读取 source documents
3. `processing, phase = embedding`：leaf 正在 embedding / 写入 vector store
4. `completed, phase = null`：leaf indexing 完成，或 container 没有 active children
5. `failed, phase = null`：runtime task 失败、interrupt cleanup 失败，或 shutdown 中断补偿

也就是说：

1. `status` 不再承载 `read` / `embed` 这类阶段语义
2. `phase` 是 runtime 内部进度，不应由通用 Data API update DTO 对外暴露
3. container 的最终状态由自身 phase 和 children 状态自下而上 reconcile

这个拆分解决的核心问题是：`processing/read/embed` 不再同时表达总体状态和运行阶段，directory/sitemap 的 preparation 与 children indexing 也不会混在同一个字段里。

## 9. Lifecycle 行为

`KnowledgeRuntimeService` 和 `KnowledgeVectorStoreService` 已经接入 lifecycle system。

### 9.1 `KnowledgeRuntimeService.onInit`

当前做一件事：

1. 重新创建进程内 `KnowledgeQueueManager`

当前没有启动时“扫描中间状态并补偿失败”或“自动恢复索引任务”的逻辑。

### 9.2 `KnowledgeRuntimeService.onStop`

当前 stop 流程是：

1. 调用 `queue.interruptAll(SHUTDOWN_INTERRUPTED_REASON)`
2. 收集中断的 `prepare-root` / `index-leaf` entries
3. 等待相关 running task settle
4. 对 `index-leaf` 清理对应 leaf vectors
5. 对 `prepare-root` fresh 查询 descendants，并清理 root / descendants vectors
6. 将这些 item 批量写为 `failed`

这意味着：

1. 当前做了停止时的失败补偿
2. 当前会在 stop 时清理被中断 item 的向量残留
3. 但没有做重启后的自动恢复

### 9.3 `KnowledgeVectorStoreService.onStop`

当前 stop 流程是：

1. 遍历 cached vector stores
2. 对 `LibSQLVectorStore` 调用 `client().close()`
3. 清空 `instanceCache`

## 10. Reader / Chunk / Embed / Search 的当前边界

### 10.1 Reader

reader 由 `loadKnowledgeItemDocuments(item)` 按 leaf `item.type` 分派：

1. `file` -> `KnowledgeFileReader`
2. `url` -> `KnowledgeUrlReader`
3. `note` -> `KnowledgeNoteReader`

当前 runtime reader 不直接索引 `directory` / `sitemap`。这两类 item 必须先通过 `prepare-root` 展开成 `file` / `url` leaf items 后再进入 indexing。

当前各 reader 的实际行为：

1. `file`
   - 按扩展名选择 reader
   - 已支持 `.pdf` / `.csv` / `.docx` / `.epub` / `.json` / `.md` / `.draftsexport`
   - 其他扩展名回退到 `TextFileReader`
   - metadata 保留 `source`
2. `url`
   - 通过 `https://r.jina.ai/<url>` 抓取 markdown
   - 支持 `AbortSignal`
   - metadata 保留 `source`
3. `note`
   - 直接把 `content` 包成一个 `Document`
   - metadata 保留 `source`
4. `sitemap`
   - 当前已保留 `KnowledgeSitemapReader` 代码路径
   - 但 runtime 侧暂时不直接索引 `sitemap` item
5. `directory`
   - 当前只作为 container placeholder
   - reader 会记录 warning 并返回空数组

### 10.2 Chunk

`chunkDocuments(base, item, documents)` 当前做的事情：

1. 使用 `SentenceSplitter`
2. 读取 `base.chunkSize` 和 `base.chunkOverlap`
3. 为每个 chunk 写入元数据：
   - 原 document metadata
   - `itemId`
   - `itemType`
   - `chunkIndex`
   - `tokenCount`

当前 `KnowledgeChunkMetadataSchema` 要求 metadata 包含：

1. `itemId`
2. `itemType`
3. `source`
4. `chunkIndex`
5. `tokenCount`

### 10.3 Embed

`getEmbedModel(base)` 当前只支持：

1. 从 `embeddingModelId` 解析 `providerId::modelId`
2. 仅接受 `providerId === 'ollama'`
3. 通过 `createOllama().textEmbeddingModel(modelId)` 获取 embedding model

其他 provider 当前会直接抛错。`embeddingModelId` 为空时也会抛错。

`embedDocuments(model, documents, signal)` 当前会：

1. 用 `embedMany` 批量生成 embeddings
2. 支持把 `AbortSignal` 传给 AI SDK
3. 构造 `TextNode`
4. 在 `NodeRelationship.SOURCE` 上写回 `itemId` 和 metadata

### 10.4 Search

`search(baseId, query)` 当前链路是：

```text
getEmbedModel(base)
 -> embed query with embedMany
 -> KnowledgeVectorStoreService.createStore(base)
 -> vectorStore.query(...)
 -> map nodes into KnowledgeSearchResult[]
 -> optional rerankKnowledgeSearchResults(base, query, results)
```

查询参数来自 base：

1. `mode = base.searchMode ?? 'default'`
2. `similarityTopK = base.documentCount ?? 10`
3. `alpha = base.hybridAlpha`

如果 query embedding 为空，会抛出 `Failed to embed search query: model returned empty result`。

### 10.5 Rerank 的当前真实状态

当前 rerank 代码路径已经存在，但 runtime 配置解析尚未接通：

1. `base.rerankModelId` 为空时直接跳过
2. `resolveRerankRuntime(base)` 目前始终返回 `null`
3. 因此当前 search 实际上总是返回原始检索结果，不会真正发起 rerank 请求

换句话说，rerank 是“代码壳已存在，但还未真正启用”。

## 11. `KnowledgeVectorStoreService` 的边界

`KnowledgeVectorStoreService` 当前负责 runtime vector store 的最小缓存和生命周期管理。

它负责：

1. 按 `base.id` 创建或复用 store
2. 按需打开磁盘上已存在的 store
3. 删除单个 base 的 store 文件
4. shutdown 时关闭所有已缓存 store

它当前的重要约束是：

1. cache key 只有 `base.id`
2. 默认把 store shaping 配置视为不可变
3. 如果 `embeddingModelId` / `dimensions` 发生变化，调用方应迁移到新的 knowledge base，而不是原地修改同一个 base 对应的向量文件

当前实际 provider 是 `LibSqlVectorStoreProvider`：

1. 向量文件路径位于 `application.getPath('feature.knowledgebase.data', sanitizeFilename(baseId, '_'))`
2. collection 使用 `base.id`
3. dimensions 使用 `base.dimensions`
4. 删除 base 时会删除对应文件

## 12. 当前明确不做的内容

当前实现没有做：

1. 每个 base 一条串行 queue
2. round-robin scheduler
3. 独立的 `KnowledgeTaskService`
4. 独立的 `KnowledgeExecutionService`
5. 持久化任务队列
6. 自动恢复索引继续执行
7. 自动重试
8. chunk 级 queue
9. 用户添加 nested `directory` / `sitemap`
10. 真正可用的 rerank runtime 配置接入
11. 非 `ollama` embedding provider 支持
12. `fileProcessorId` 驱动的文件处理链路

## 13. 后续更新本文档时的原则

后续只有在以下行为真正落地之后，才应更新本文档：

1. runtime queue 从单队列改成 per-base queue
2. rerank runtime 配置真正接通
3. `fileProcessorId` 开始参与 runtime 执行链路
4. 用户添加 nested `directory` / `sitemap`
5. queue interrupt 从当前 root + fresh descendants 模型改成 stable-loop 或 generation/runId 模型

在这些行为落地之前，文档应继续以“当前已实现”为准，不提前写成目标设计。
