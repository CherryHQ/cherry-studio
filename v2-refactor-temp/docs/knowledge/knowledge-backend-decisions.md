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
                    +--------------------------+     +-----------------------------+
                    |       Data API           |     |   KnowledgeRuntimeService   |
                    |  knowledge handlers      |     | runtime / vector facade     |
                    +-------------+------------+     +---------------+-------------+
                                  |                                  |
                                  v                                  v
                    +--------------------------+          +---------------------------+
                    |   KnowledgeBaseService   |          | reader / chunk / embed / |
                    |   base data logic        |          | rerank / vectorstore      |
                    +-------------+------------+          +-------------+-------------+
                                  |                                  |
                                  v                                  v
                    +--------------------------+          +---------------------------+
                    |   KnowledgeItemService   |          | in-memory p-queue runtime |
                    |   item data + status     |          | + store cache             |
                    +-------------+------------+          +-------------+-------------+
                                  |                                  |
                                  v                                  v
                        +----------------------+              +------------------------+
                        |   SQLite / Drizzle   |              |  LibSQL vector store   |
                        +----------------------+              +------------------------+
```

当前知识库后端已经分成两层：

1. `KnowledgeBaseService` / `KnowledgeItemService`
   - 负责 SQLite 中的知识库业务主数据 CRUD
   - 负责 `knowledge_item.status` / `error` 的持久化更新
2. `KnowledgeRuntimeService`
   - 负责 runtime 编排
   - 负责 reader / chunk / embedding / vector store 调用串联
   - 负责检索入口

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

当前 runtime/vector 侧的单一 facade 已经是 `KnowledgeRuntimeService`，不是旧文档中的 `KnowledgeService`。

对应实现：

- `src/main/services/knowledge/KnowledgeRuntimeService.ts`
- `src/main/core/application/serviceRegistry.ts`

它是一个 lifecycle service：

1. `@Injectable('KnowledgeRuntimeService')`
2. `@ServicePhase(Phase.Background)`
3. 已注册到应用 service registry

它当前对外暴露的核心能力是：

1. `createBase(base)`
2. `deleteBase(base)`
3. `addItems(base, items)`
4. `deleteItems(base, items)`
5. `search(base, query)`

它负责：

1. runtime 入口方法
2. item 级索引任务入队与执行
3. `knowledge_item.status` 的有限状态推进
4. 失败与中断原因写回数据库
5. 向量库实例的获取、删除和清理
6. 检索后的 rerank 串联

它不负责：

1. `knowledge_base` / `knowledge_item` 的主数据 CRUD
2. 持久化任务队列
3. 自动重试
4. 恢复未完成索引任务继续执行
5. 暴露调度器内部概念给调用方

## 4. 当前调用边界

### 4.1 UI

```text
UI
 |
 +--> Data API -> knowledge handlers -> KnowledgeBaseService / KnowledgeItemService
 |
 \--> preload IPC -> KnowledgeRuntimeService
```

当前 runtime 侧 IPC 通道已经固定为：

1. `knowledge-runtime:create-base`
2. `knowledge-runtime:delete-base`
3. `knowledge-runtime:add-items`
4. `knowledge-runtime:delete-items`
5. `knowledge-runtime:search`

### 4.2 Main 进程内部调用

主进程内部其他模块如果需要知识库 runtime 能力，应直接调用 `KnowledgeRuntimeService`，不需要绕回 Data API。

主进程内部如果需要业务主数据能力，应直接调用 `KnowledgeBaseService` / `KnowledgeItemService`。

## 5. 当前 Queue 模型

### 5.1 已落地行为

当前实现使用一个进程内 `PQueue`：

1. queue 持有者是 `KnowledgeRuntimeService`
2. queue 为单实例 in-memory queue
3. 默认 `concurrency = 5`
4. 所有 base 的 add/delete item 任务共用这一条 queue

当前实现没有落地以下旧设计假设：

1. 不是“每个 knowledge base 一条串行 queue”
2. 不是 round-robin scheduler
3. 没有全局持久化任务表

### 5.2 当前可观测状态

service 内部额外跟踪两组内存态集合：

1. `queuedItemIds`
2. `runningItemIds`

它们的作用仅是：

1. shutdown 时识别哪些 item 被中断
2. 将这些 item 回写为 `failed`

这些集合不是对外数据模型的一部分。

### 5.3 入队行为

`addItems(base, items)` 当前行为：

1. 先将所有 item 批量写成 `status = pending`
2. 清空旧 `error`
3. 再将每个 item 作为一个 queue task 入队

`deleteItems(base, items)` 当前行为：

1. 不更新 item 状态
2. 将每个 item 的向量删除任务入队

当前没有：

1. 去重入队保护
2. 优先级队列
3. 暂停 / 恢复 API
4. 自动重试

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

当前仅做两件事：

1. `isStopping = false`
2. 注册 runtime IPC handlers

当前没有启动时“扫描中间状态并补偿失败”的逻辑。

### 8.2 `onStop`

当前 stop 流程是：

1. `isStopping = true`
2. `queue.pause()`
3. 收集 `queuedItemIds` 和 `runningItemIds`
4. `queue.clear()`
5. 将未完成 item 批量写为 `failed`
6. 调用 `vectorStoreManager.clear()` 关闭并清空已缓存 store

这意味着：

1. 当前做了停止时的失败补偿
2. 但没有做重启后的自动恢复

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
   - 先抓 sitemap XML
   - 展开唯一 URL 集合
   - 再以内层 `PQueue({ concurrency: 3, intervalCap: 20, interval: 60000 })` 限流抓取网页
5. `directory`
   - 当前只作为 container placeholder
   - reader 会记录 warning 并返回空数组
   - 也就是说它不会直接产出可索引文档，调用方需要先把目录展开为具体子 item

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

## 10. `VectorStoreManager` 的边界

`VectorStoreManager` 当前负责 runtime vector store 的最小缓存和生命周期管理。

它负责：

1. 按 `base.id` 创建或复用 store
2. 删除单个 base 的 store 文件
3. shutdown 时关闭所有已缓存 store

它当前的重要约束是：

1. cache key 只有 `base.id`
2. 默认把 store shaping 配置视为不可变
3. 如果 `embeddingModelId` / `dimensions` 发生变化，调用方应迁移到新的 knowledge base，而不是原地修改同一个 base 对应的向量文件

当前实际 provider 是 `LibSqlVectorStoreProvider`：

1. 向量文件路径位于 `${getDataPath()}/KnowledgeBase/<sanitizedBaseId>`
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
9. item 去重入队
10. `directory` item 的自动展开
11. 真正可用的 rerank runtime 配置接入
12. 非 `ollama` embedding provider 支持
13. `fileProcessorId` 驱动的文件处理链路

## 12. 后续更新本文档时的原则

后续只有在以下行为真正落地之后，才应更新本文档：

1. runtime queue 从单队列改成 per-base queue
2. 中间状态 `file_processing` / `read` / `embed` 真的开始持久化写入
3. rerank runtime 配置真正接通
4. `fileProcessorId` 开始参与 runtime 执行链路
5. `directory` item 从占位符变成可自动展开的索引入口

在这些行为落地之前，文档应继续以“当前已实现”为准，不提前写成目标设计。
