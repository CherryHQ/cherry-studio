# RFC: Knowledge Workflow Architecture

> 定位：Knowledge runtime 架构评审 RFC。
>
> 目标是把 add / delete / reindex / file processing / indexing 的职责边界讲清楚，
> 不作为逐文件实施清单。

---

## 1. 核心结论

Knowledge 不再建模成简单 pipeline，而是一个轻量 workflow：

```text
用户动作 / API
    |
    v
KnowledgeWorkflowCoordinator
    |
    v
JobManager -> Knowledge job handlers
    |
    v
KnowledgeMutationCoordinator
    |
    v
SQLite / VectorStore / FileManager
```

架构主轴只保留三部分：

```text
1. KnowledgeWorkflowCoordinator
   决定下一步做什么。

2. KnowledgeMutationCoordinator
   保证同一 base 下状态、向量库、artifact、破坏性清理安全串行。

3. Knowledge job handlers
   执行当前阶段的短任务。
```

其他能力先作为 helpers/modules，不作为独立 service：

```text
source planning helpers
item lifecycle helpers
artifact helpers
file-processing adapter helpers
```

只有当 helper 需要持有长期状态、注册 IPC/event/timer、管理生命周期或长期资源时，
才升级为 service。

---

## 2. Coordinator API

`KnowledgeWorkflowCoordinator` 是唯一的流程决策 owner。

```ts
class KnowledgeWorkflowCoordinator {
  addItems(baseId, inputs): Promise<AddResult>
  deleteItem(baseId, itemId): Promise<JobHandle>
  reindexItem(baseId, itemId): Promise<JobHandle>

  scheduleItem(baseId, itemId): Promise<void>
  scheduleFileProcessingCheck(baseId, itemId, taskId, options): Promise<void>
  scheduleIndexing(baseId, itemId, source): Promise<void>
}
```

调用边界：

- `addItems` / `deleteItem` / `reindexItem` 给 API/service 层调用。
- `scheduleItem` / `scheduleFileProcessingCheck` / `scheduleIndexing` 给 job handlers 调用。
- handler 可以在本阶段完成后调用 coordinator，但不能自己决定 workflow 分支。
- 所有“下一步去哪”的判断都集中在 coordinator。

`scheduleItem(baseId, itemId)` 的决策：

```text
directory / sitemap
  -> enqueue knowledge.prepare-root

file / note / url
  -> source planning
       direct
         -> enqueue knowledge.index-documents
       needs file processing
         -> start FileProcessing
         -> enqueue knowledge.check-file-processing-result
       invalid
         -> mark item failed
```

---

## 3. Job Handlers

第一版 Knowledge job types：

```text
knowledge.prepare-root
knowledge.check-file-processing-result
knowledge.index-documents
knowledge.delete-subtree
knowledge.reindex-subtree
```

### `knowledge.prepare-root`

输入：

```text
baseId
itemId
```

职责：

- 展开 `directory` / `sitemap`。
- 创建或替换 leaf items。
- 对每个 leaf 调用 `coordinator.scheduleItem(baseId, leafId)`。

不负责 leaf source planning、reader、embedding、vector write。

### `knowledge.check-file-processing-result`

输入：

```text
baseId
itemId
fileProcessingJobId
sourceFileEntryId
checkCount? / firstScheduledAt?
```

职责：

- 读取 FileProcessing job snapshot。
- `pending` / `delayed` / `running`：调用 `scheduleFileProcessingCheck(...)` 延迟检查。
- `completed`：校验 markdown artifact，attach `processed_artifact` ref，再调用
  `scheduleIndexing(baseId, itemId, artifactSource)`。
- `failed` / `cancelled` / missing / invalid：标记 item failed。
- stale item/source：跳过，不写 vectors。

### `knowledge.index-documents`

输入：

```text
baseId
itemId
documentsSource
```

职责：

```text
reader -> chunk -> embed -> serialized vector write
```

`documentsSource` 可以是：

```text
direct knowledge item source
processed markdown artifact FileEntry
```

这个 job 是完整 indexing job。`aiCore embed` 不是独立 job。

### `knowledge.delete-subtree`

输入：

```text
baseId
itemId
```

职责：

```text
cancel/drain active subtree jobs
-> delete vectors
-> detach processed_artifact refs
-> ref-count cleanup internal artifacts
-> delete knowledge_item subtree rows
```

完成后流程结束。

### `knowledge.reindex-subtree`

输入：

```text
baseId
itemId
```

职责：

```text
cancel/drain active subtree jobs
-> delete vectors
-> detach processed_artifact refs
-> ref-count cleanup internal artifacts
-> reset knowledge_item subtree rows
-> coordinator.scheduleItem(baseId, itemId)
```

规则：

- reindex 不复用旧 processed artifact。
- 需要转换的 source 会重新启动 FileProcessing。
- handler 不判断 root/leaf/direct/FileProcessing 分支，分支由 coordinator 决定。

---

## 4. Workflows

### Add

```text
addItems(baseId, inputs)
-> preflight
-> create item rows
-> coordinator.scheduleItem(baseId, itemId)
```

预检只做便宜、同步、可快速失败的检查：

- base 存在。
- embedding 配置可用。
- item type / payload shape 合法。
- file/directory/source 基本存在。
- 必要时 fileProcessorId 可用。

job 执行时仍要做 runtime guard，因为 enqueue 后 base/item/source 可能已经变化。

### Delete

```text
deleteItem(baseId, itemId)
-> preflight
-> enqueue knowledge.delete-subtree
```

delete 是破坏性 workflow，统一走 durable job，不建议散落成同步删除。

### Reindex

```text
reindexItem(baseId, itemId)
-> preflight
-> enqueue knowledge.reindex-subtree
```

reindex 与 delete 的前半段保持一致：

```text
cancel/drain
-> delete vectors
-> detach refs
-> ref-count cleanup artifacts
```

区别只在最后：

```text
delete  -> delete knowledge_item subtree rows
reindex -> reset knowledge_item subtree rows -> scheduleItem
```

对 `directory` / `sitemap`，descendants 的重建发生在后续 `prepare-root` 阶段，不在
`reindex-subtree` 的 reset 阶段做。

---

## 5. Mutation Coordinator

`KnowledgeMutationCoordinator` 负责同一 base 下的安全写入和清理。

第一版实现使用 per-base mutex：

```ts
private readonly baseLocks = new Map<string, Mutex>()
```

具体 public API 暂不在本 RFC 中定死；实现时只要求所有同 base 的 mutation 进入同一把
`baseId` 锁。

职责：

- 同 base mutation 串行。
- 维护 deleting/reindexing barrier。
- cancel/drain active subtree jobs。
- 保护 vector replace/delete。
- 保护 item status writes。
- 保护 processed artifact attach/detach。
- 执行 ref-count cleanup。

规则：

- 同一 base 的 Knowledge mutation 必须串行。
- 不同 base 可以并行。
- drain timeout 是硬失败，不能继续 cleanup。
- active indexing/reindexing 时，manual chunk delete 应拒绝。
- 旧任务可能继续写入时，不能删除 vectors、SQLite rows 或 artifact refs。

---

## 6. Helpers

Helpers 只封装规则，不持有长期状态，不注册 IPC/timer/event，不进入 service registry。

### source planning helpers

用于 `KnowledgeWorkflowCoordinator.scheduleItem`。

输出：

```text
direct
needsFileProcessing
invalid
```

规则：

- FileProcessing 是 source preparation 策略，不是 embedding 策略。
- FileProcessing 失败时 item failed，不做 silent fallback。
- `base.fileProcessorId` 只影响未来索引，不自动 reindex 已有 vectors。

### item lifecycle helpers

集中封装 `status/phase/error` 写入，避免 handler 裸写 `updateStatus`。

保留 `status` 和 `phase`：

```text
status = item 的持久生命周期事实
phase = processing 内的 Knowledge 粗粒度阶段
JobManager state/progress = job 执行状态和实时进度
```

`phase` 不是 JobManager progress 的替代品，也不由 JobManager state 反推。

### artifact helpers

职责：

- 管理 source FileRef。
- attach/detach `processed_artifact` FileRef。
- cleanup internal FileEntry artifacts。

cleanup 规则：

```text
detach current Knowledge refs
-> count remaining refs for each artifact FileEntry
-> remaining refs == 0: FileManager.permanentDelete(entry)
-> remaining refs > 0: keep entry
```

目标模型不主动跨 item/base 共享 processed artifact，但 cleanup 必须做 ref-count 防御。

### file-processing adapter helpers

隔离 Knowledge 与 FileProcessing API：

```text
startTask() -> taskId
getSnapshot(taskId) -> JobSnapshot
completed output -> markdown artifact FileEntry
```

Knowledge 每次需要转换时都使用本次 taskId 绑定 continuation。

---

## 7. FileProcessing 规则

FileProcessing 只负责转换文件，Knowledge 负责转换后的继续索引。

规则：

- 一个 Knowledge item/run 需要转换时，启动一个新的 FileProcessing job。
- 同一个文件被用户添加两次，也产生不同 FileProcessing jobs。
- reindex 重新启动 FileProcessing，不复用旧 artifact。
- Knowledge 不把 completed FileProcessing result 当全局 cache。
- Knowledge 长期只引用 FileManager internal FileEntry，不依赖 FileProcessing staging path。

FileProcessing completed 后：

```text
check-file-processing-result
-> validate markdown artifact
-> attach processed_artifact ref
-> scheduleIndexing(..., artifactSource)
```

---

## 8. JobManager 规则

JobManager queue concurrency 已改为只统计 `running` jobs。

```text
pending / delayed = backlog
running = worker slot
```

因此 Knowledge 不需要为了避免 pending backlog 自锁实现准入控制。

大 fan-out 仍可能带来 DB rows、UI 刷新和日志压力，但这是性能/可运维性问题，不是
correctness 前置。第一版不引入复杂 capacity budget 或 backlog schema。

第一版也不依赖 JobManager completion subscription：

- `JobHandle.finished` 是 enqueue 调用方持有的内存 Promise。
- `handler.onSettled` 是 best-effort terminal hook，不承载必须成功的下一步调度。
- handler 在 `execute` 内完成本阶段动作后调用 coordinator，由 coordinator enqueue 下一步。

---

## 9. Stale Result 与失败边界

本 RFC 不新增 persisted attempt table，也不新增 generation token。

旧 FileProcessing / indexing result 回来时，用现有信息判断是否仍有效：

```text
item 是否仍存在
item.data.fileEntryId 是否仍等于 sourceFileEntryId
base/item 是否处于 deleting/reindexing barrier
旧 jobs 是否已 cancel/drain 成功
```

如果不满足：

```text
skip continuation
do not write vectors
do not mark completed
best-effort cleanup unclaimed artifact if possible
```

失败边界：

- delete/reindex 的 cancel/drain timeout 是 hard failure。
- reset 成功但重新调度失败时，必须把 item/subtree 标记 failed，不能留下永久 processing。
- 用户可以在 UI 上再次 reindex，不要求复杂自动恢复。

---

## 10. 非目标

本轮不做：

- 不新增 Knowledge schema。
- 不新增 persisted indexing attempt table。
- 不新增 `indexingGeneration` / owner token。
- 不引入 JobManager DAG executor。
- 不新增 JobManager backlog admission / `maxQueueDepth`。
- 不实现 `base.fileProcessorId` 变更后的自动 reindex。
- 不把所有实时进度迁移到 JobManager progress subscription。

---

## 11. 迁移方向

建议顺序：

1. 建立 `KnowledgeWorkflowCoordinator` 和 `KnowledgeMutationCoordinator` 边界。
2. 增加 helpers：source planning、item lifecycle、artifact、file-processing adapter。
3. 将 source strategy 从 `index-leaf` 收口到 `scheduleItem`。
4. 用 `check-file-processing-result` 替换 long-running `await-file-processing`。
5. 增加 `delete-subtree` / `reindex-subtree` handlers。
6. 将 delete/reindex 的 cancel/drain/cleanup 收口到 workflow + mutation coordinators。

保持不变：

- 公开 IPC/DataApi contract 不变。
- `knowledge_item.status/phase/error` schema 不变。
- `base.fileProcessorId` 只影响未来索引。
- Knowledge 每次转换只消费本次 FileProcessing task result。
- processed artifact cleanup 使用 ref-counted cleanup。

---

## 12. 评审问题

- `check-file-processing-result` 是否需要最大等待时间？
- 5 秒固定 delay 是否足够，还是需要 capped backoff？
- 大 fan-out 是否需要 batching/backpressure，触发阈值如何定义？
- artifact cleanup 失败是否需要 durable cleanup queue？
- ref-counted cleanup 留在 Knowledge helpers，还是下沉为 FileRef/FileManager 通用 helper？
- manual chunk delete 的 active indexing 检测按 item、subtree 还是 base？

---

## 13. 接受标准

- 架构主轴是 `KnowledgeWorkflowCoordinator`、`KnowledgeMutationCoordinator` 和
  Knowledge job handlers。
- helpers/modules 不作为独立 service。
- 第一版 job types 是 `prepare-root`、`check-file-processing-result`、
  `index-documents`、`delete-subtree`、`reindex-subtree`。
- job handler 只做当前阶段动作，下一步由 coordinator 决定。
- FileProcessing continuation 使用短任务 delayed check。
- indexing job 完整执行 reader -> chunk -> embed -> vector write。
- delete/reindex 使用 cancel/drain hard failure。
- reindex 重新启动 FileProcessing，不复用旧 artifact。
- processed artifact internal FileEntry 只有在没有任何剩余 refs 时才会被删除。
