# 知识库后端当前实现说明

本文档只记录当前分支中 `src/main/services/knowledge` 已经落地的后端分层、调用边界和 workflow 行为。

`v2-refactor-temp` 下的文档是临时工作笔记。当前 canonical 文档是：

- [Knowledge Service](../../../docs/references/knowledge/knowledge-service.md)
- [Knowledge Workflow Architecture](../../../docs/references/knowledge/workflow-architecture.md)
- [Knowledge Operation Guards](../../../docs/references/knowledge/operation-guards.md)

本文不覆盖旧的 `src/main/knowledge` / `knowledge-base:*` 通道。

## 1. 当前架构图

```text
UI / preload IPC / main-side workflow
  -> KnowledgeOrchestrationService
     -> KnowledgeWorkflowService
        -> JobManager
           -> knowledge.prepare-root
           -> knowledge.index-documents
           -> knowledge.delete-subtree
           -> knowledge.reindex-subtree
              -> KnowledgeLockManager
                 -> KnowledgeBaseService / KnowledgeItemService
                 -> KnowledgeVectorStoreService / FileManager

UI Data API reads / patch
  -> Data API knowledge handlers
     -> KnowledgeBaseService / KnowledgeItemService
```

当前没有 `KnowledgeRuntimeService`，也没有 Knowledge 自己维护的 in-memory queue。持久化调度、retry、timeout、cancel 和 startup recovery 由 `JobManager` 负责。

## 2. 当前职责边界

`KnowledgeBaseService` / `KnowledgeItemService`：

1. 负责 SQLite 业务表读写。
2. 负责 `knowledge_item.status` / `error` 的持久化更新。
3. 负责 `knowledge_item.data` 与 `type` 的一致性校验。
4. 负责 container item 的子项状态向上聚合。
5. 不负责 reader、embedding、向量库写入、JobManager 调度或 caller-facing IPC。

Data API knowledge handlers：

1. 只暴露数据库可直接满足的读和 base metadata/config 更新。
2. 不负责 runtime mutation，不创建或删除 vector store artifacts。

`KnowledgeOrchestrationService`：

1. 负责 caller-facing `knowledge-runtime:*` IPC。
2. 负责 create/delete/restore base workflow。
3. 注册 Knowledge JobManager handlers。
4. 持有 `KnowledgeWorkflowService` 和 `KnowledgeLockManager`。
5. 对 delete / reindex / chunk 操作做入口 guard。
6. 不直接执行 reader / chunk / embed / vector write。

`KnowledgeWorkflowService`：

1. 负责 `addItems` / `deleteItems` / `reindexItems` 的 workflow 分支。
2. 负责 `scheduleItem(baseId, itemId)`。
3. 将 `directory` 分派为 `knowledge.prepare-root`。
4. 将 `file` / `note` / `url` 分派为 `knowledge.index-documents`。
5. 负责 add/reindex 调度失败后的状态补偿。

`KnowledgeLockManager`：

1. 负责同一 base 下的进程内 mutation 串行化。
2. 保护 vector replace/delete、FileRef cleanup、item status writes 和 destructive cleanup/reset。
3. 不能替代 `DbService.withWriteTx`；主 SQLite 写事务仍必须走 `DbService.withWriteTx`。

## 3. 当前调用边界与调用方契约

UI / preload 当前调用模型：

```text
UI
 |
 +--> Data API
 |     -> list/get knowledge bases
 |     -> patch base metadata/config
 |     -> list/get knowledge items
 |
 \--> preload knowledgeRuntime IPC
       -> create/delete/restore base
       -> add/delete/reindex items
       -> search
       -> list/delete chunks
```

添加 file / url / note / directory 时，调用方直接走：

```text
caller
 -> preload IPC add-items(item payloads)
```

调用方不应先通过 Data API 创建 item，再把 created item ids 传给 runtime `addItems`。

Leaf item 当前链路：

```text
add-items(leaf payloads)
 -> create leaf item rows
 -> status = processing
 -> enqueue knowledge.index-documents
```

Container item 当前链路：

```text
add-items(directory payloads)
 -> create root item rows
 -> status = preparing
 -> enqueue knowledge.prepare-root
 -> prepare-root expands owner
 -> prepare-root creates child rows
 -> workflowService.scheduleItem(child)
```

`prepare-root` 创建出的 child 可以继续是 `directory`，由 workflow service 再次分派为 `knowledge.prepare-root`。递归展开不由 reader 或 leaf indexing 分支处理。

## 4. JobManager 模型

当前 Knowledge job types：

1. `knowledge.prepare-root`
2. `knowledge.index-documents`
3. `knowledge.delete-subtree`
4. `knowledge.reindex-subtree`

每个 base 使用独立队列：

```text
base.${baseId}
```

JobManager 负责：

1. job 持久化。
2. dispatch。
3. retry / timeout。
4. cancel。
5. startup recovery。

Knowledge 不再维护 `entries` map、`controller`、`runPromise`、`interruptError` 或其他 in-memory queue 状态。

## 5. 当前索引执行链路

`knowledge.index-documents` 当前流程：

```text
handler.execute
 -> load base and item
 -> skip missing / deleting / already completed item
 -> under base mutation lock:
      rebuild source file refs
      status = reading
 -> read documents
 -> chunk documents
 -> under base mutation lock:
      status = embedding
 -> embed chunks
 -> under base mutation lock:
      re-read item
      skip vector write if item is deleting
      vectorStore.replaceByExternalId(itemId, nodes)
      status = completed
```

如果 reader 返回空 documents，或 chunk 后没有可索引 chunks，`index-documents` 仍视为成功：写入 `replaceByExternalId(itemId, [])` 清空该 item 的旧 chunks，然后把 item 标记为 `completed`。

非中断错误由 JobManager retry。Retry 耗尽或 job cancel 时，handler `onSettled` 把对应 item 标记为 `failed`，但如果 item 已经是 `deleting` 则跳过失败回写。

## 6. Delete / Reindex 当前链路

`delete-items` 当前流程：

```text
delete-items(baseId, itemIds)
 -> collapse to top-level roots
 -> under base mutation lock:
      mark selected root subtrees deleting
 -> enqueue knowledge.delete-subtree
```

`knowledge.delete-subtree`：

```text
 -> resolve still-deleting subtree
 -> cancel active jobs touching subtree
 -> under base mutation lock:
      delete vectors for leaf items
      clear Knowledge FileRef rows for full subtree
      delete knowledge_item rows
```

`file_ref.sourceId` 是 polymorphic，没有 FK 指向 `knowledge_item`。因此最终 hard delete 必须先展开完整 subtree 清理 Knowledge FileRef，再删除 rows；仅删除显式 root id 对应 refs 会留下 descendant orphan refs。

`reindex-items` 当前流程：

```text
reindex-items(baseId, itemIds)
 -> collapse to top-level roots
 -> reject unless every selected subtree item is completed or failed
 -> enqueue knowledge.reindex-subtree
```

`knowledge.reindex-subtree`：

```text
 -> skip if delete already marked any subtree item deleting
 -> under base mutation lock:
      re-check deleting guard
      delete old vectors
      delete expanded descendants for selected container roots
      reset selected roots to preparing / processing
 -> workflowService.scheduleItem(root)
```

Reindex 不是 cancellation primitive。Active subtree 只能 delete，不能 reindex。

## 7. `knowledge_item.status` 当前边界

当前 `status` 表达业务生命周期和粗粒度运行进度：

1. `idle`
2. `preparing`
3. `processing`
4. `reading`
5. `embedding`
6. `completed`
7. `failed`
8. `deleting`

当前不再保留单独 `phase` 字段。`status` 是持久业务状态，不由 JobManager progress 反推。

状态语义：

1. `preparing`：`directory` 正在 expand / create children。
2. `processing`：leaf 已接受但尚未进入 reading，或 container 仍有 active children。
3. `reading`：leaf 正在读取 source documents。
4. `embedding`：leaf 正在 embedding。
5. `completed`：leaf indexing 完成，或 container 没有 active children。
6. `failed`：index/preparation/scheduling compensation 失败。
7. `deleting`：用户不可见，等待后台 cleanup。

## 8. Base workflow

`createBase(dto)` 当前流程：

```text
IPC create-base(CreateKnowledgeBaseDto)
 -> KnowledgeBaseService.create(dto)
 -> KnowledgeVectorStoreService.createStore(base)
 -> return created base
```

如果 vector store 初始化失败，orchestration 会调用 `KnowledgeBaseService.delete(base.id)` 回滚刚创建的 SQLite base，然后把原始错误抛给调用方。

`deleteBase(baseId)` 当前流程：

```text
IPC delete-base(baseId)
 -> cancel active Knowledge jobs in base queue
 -> under base mutation lock:
      KnowledgeVectorStoreService.deleteStore(baseId)
      KnowledgeBaseService.delete(baseId)
```

Artifact 删除失败时 SQLite 行保留，用户可从 UI 重试。SQLite 删除失败时已删除 artifacts 不会恢复，orchestration 抛出 `invalidOperation`。

`restoreBase(dto)` 当前流程：

```text
IPC restore-base(sourceBaseId, embeddingModelId, dimensions)
 -> load source base
 -> load source root items
 -> create new base with source config and requested embedding contract
 -> add source root item payloads to restored base
```

Restore 允许 failed base，也允许 completed base；即使 completed source base 的 `embeddingModelId` 和 `dimensions` 未变化，也允许创建同配置 clone/rebuild。

## 9. Search / Chunk 当前边界

`search(baseId, query)` 当前流程：

1. 拒绝 failed base。
2. 拒绝没有 searchable token 的 query。
3. 使用 base embedding model 生成 query embedding。
4. 查询 libSQL vector store。
5. 过滤 missing / other-base / deleting source item 的结果。
6. 如果配置了 rerank model，执行 rerank。
7. 应用 threshold 并写入 rank。

`list-item-chunks` / `delete-item-chunk` 当前规则：

1. 拒绝 failed base。
2. 要求目标 item 自身为 `completed`。
3. 对 completed `directory` list 请求，如果 subtree 仍含 `deleting` descendant，则拒绝。

## 10. 当前明确不做的内容

1. 不使用旧 `KnowledgeRuntimeService`。
2. 不维护 Knowledge 自己的 in-memory queue。
3. 不使用 `index-leaf` job type；当前 leaf indexing job 是 `knowledge.index-documents`。
4. 不保留单独 `phase` 字段。
5. 不把 restore same embedding config 视为 no-op 并拒绝。
6. 不主动 permanent-delete detached `FileEntry` rows。
7. Round 1 不接入 FileProcessing；`knowledge_base.fileProcessorId` 当前对 indexing inert。

## 11. 后续更新本文档时的原则

1. 如果 canonical 文档已经覆盖事实，优先更新 canonical 文档，再在本文保留短摘要或链接。
2. 不再新增大段逐实现复制，避免 `v2-refactor-temp` 与 canonical docs 漂移。
3. 如果当前实现与 RFC 目标不同，必须明确写“当前实现”还是“目标设计”。
