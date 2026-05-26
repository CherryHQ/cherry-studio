# RFC: Knowledge Workflow Architecture

> 定位：Knowledge runtime 架构评审 RFC。
>
> 目标是把 add / delete / reindex / file processing / indexing 的职责边界讲清楚，
> 不作为逐文件实施清单。
>
> Canonical reference: [docs/references/knowledge/workflow-architecture.md](../../../docs/references/knowledge/workflow-architecture.md).
> `v2-refactor-temp` 下的文档会在 v2 收尾时移除。

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

当前实现状态：

- `knowledge_base.fileProcessorId` 已持久化，但当前 Knowledge indexing 不读取它；对 indexing 是 inert。
- 当前 file items 仍由 Knowledge reader 按 source/extension 直接读取和索引，未经过 FileProcessing。
- 当前 embedding runtime 仍是 Ollama-only wiring；本 RFC 不把多 embedding provider 接入作为本轮目标。

分轮范围：

- **Round 1（结构重构）：** coordinators、`index-documents`、`delete-subtree`、`reindex-subtree`。不接 FileProcessing。
- **Round 2（FileProcessing feature）：** `needsFileProcessing` source planning、`check-file-processing-result`、FileProcessing adapter。

---

## 2. Coordinator API

`KnowledgeWorkflowCoordinator` 是唯一的流程决策 owner。

```ts
class KnowledgeWorkflowCoordinator {
  addItems(baseId, inputs): Promise<AddResult>
  deleteItem(baseId, itemId): Promise<JobHandle>
  reindexItem(baseId, itemId): Promise<JobHandle>

  scheduleItem(baseId, itemId): Promise<void>
  // Round 2
  scheduleFileProcessingCheck(baseId, itemId, taskId, options): Promise<void>
  scheduleIndexing(baseId, itemId, source): Promise<void>
}
```

调用边界：

- `addItems` / `deleteItem` / `reindexItem` 给 API/service 层调用。
- `scheduleItem` / `scheduleFileProcessingCheck` / `scheduleIndexing` 给 job handlers 调用。
- handler 可以在本阶段完成后调用 coordinator，但不能自己决定 workflow 分支。
- 所有“下一步去哪”的判断都集中在 coordinator。
- `scheduleFileProcessingCheck` 和 `needs file processing` 分支属于 Round 2。

公开 API 语义：

- `addItems` / `deleteItem` / `reindexItem` 都是异步 workflow 入口。
- API resolve 只表示用户动作已经进入 durable workflow，不表示整条 workflow 已完成。
- `addItems` resolve：item rows 已创建，首批 Knowledge jobs 已入队。
- `reindexItem` resolve：`reindex-subtree` job 已入队。
- `deleteItem` resolve：subtree 已同步标记为 `deleting`，默认 UI 查询和检索不再返回这些 items，`delete-subtree` cleanup job 已入队。

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
Round 1:
knowledge.prepare-root
knowledge.index-documents
knowledge.delete-subtree
knowledge.reindex-subtree

Round 2:
knowledge.check-file-processing-result
```

### `knowledge.prepare-root`

输入：

```text
baseId
itemId
```

职责：

- 展开 `directory` / `sitemap`。
- 创建或替换 child items。
- 对每个 child 调用 `coordinator.scheduleItem(baseId, childId)`。
- child 仍可能是 `directory` / `sitemap`；此时由 coordinator 再次分派到 `knowledge.prepare-root`，形成递归展开。
- 只有 `file` / `note` / `url` child 会进入 source planning 和 indexing。

不负责 child type 分支、source planning、reader、embedding、vector write。

### `knowledge.check-file-processing-result`（Round 2）

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
reader -> chunk -> batched embed -> serialized vector write
```

`documentsSource` 可以是：

```text
direct knowledge item source
processed markdown artifact FileEntry
```

这个 job 是完整 indexing job。`aiCore embed` 不是独立 job。

执行策略：

- `EMBED_BATCH_SIZE = 32` chunks。
- `defaultTimeoutMs = 30min`。
- embed batches 串行执行，不做 batch 并发。
- 每个 embed batch 前后都检查 `AbortSignal`。
- 任一 batch 失败则整个 job attempt 失败，由 JobManager retry。
- 全部 batches embed 完成后，一次 `replaceByExternalId` 写入 vectors。
- vector write 必须在 `KnowledgeMutationCoordinator` 的 per-base lock 内执行，并在写入前做 final stale guard。
- 不做 incremental checkpoint、staging vectors 或 batch-level resume；retry 会重新 embed 已完成 batches。
- 可以保留粗粒度 `reportProgress` 用于诊断，但第一版不做用户可见实时进度 UI，也不新增 workflow/run 聚合进度。
- `knowledge_item.status` 承载 `reading` / `embedding` 等粗粒度阶段，不记录 batch 级进度。

final stale guard：

```text
under KnowledgeMutationCoordinator base lock:
  re-read item
  assert item exists
  assert item.status != deleting
  assert documentsSource still matches current item source
  assert base/item not under deleting/reindexing barrier
  replaceByExternalId(...)
  mark item completed
```

如果 final stale guard 不满足：

- skip vector write。
- do not mark completed。
- best-effort cleanup unclaimed processed artifact if possible。
- job 可以 completed/no-op，不因 stale continuation 消耗 retry。

### `knowledge.delete-subtree`

输入：

```text
baseId
itemId
```

前置条件：

- 目标 subtree 已在 API 边界同步标记为 `deleting`。
- 默认 item list / search / RAG hydration 已排除 `deleting` items。

职责：

```text
cancel/drain active subtree jobs
-> delete vectors
-> detach processed_artifact refs
-> ref-count cleanup internal artifacts
-> hard-delete knowledge_item subtree rows
```

幂等规则：

- `delete-subtree` 是 at-least-once cleanup job；任意步骤 crash 后重跑都必须收敛。
- 重跑时先重新 list active subtree jobs 并逐个 `JobManager.cancel()`；没有 active jobs 是 no-op。
- 重跑时只处理仍存在且 `status = deleting` 的 subtree rows；subtree 已不存在时视为 cleanup 已完成。
- vector delete 必须按 external item id 删除；目标 vectors 已不存在时视为成功。
- processed artifact ref detach 必须允许重复执行；目标 refs 已不存在时视为成功。
- artifact cleanup 每次执行前重新计算 ref count，只 permanent-delete 当前 ref count 为 0 且 FileEntry 仍存在的 internal artifacts。
- FileEntry 已不存在时视为已清理；物理文件 unlink 失败按 FileManager 语义 best-effort 记录，不阻塞 DB/vector/ref 收敛。
- hard-delete knowledge_item rows 必须放在最后；bulk delete 找不到 rows 时视为已完成，不能用 missing-row error 让 job 永久失败。

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
- Round 2：需要转换的 source 会重新启动 FileProcessing。
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
- Round 2：必要时 fileProcessorId 可用。

job 执行时仍要做 runtime guard，因为 enqueue 后 base/item/source 可能已经变化。

### Delete

```text
deleteItem(baseId, itemId)
-> preflight
-> in one durable write boundary:
     mark knowledge_item subtree status = deleting
     enqueue knowledge.delete-subtree
-> return JobHandle
```

delete 是破坏性 workflow，但用户可见删除必须在 API resolve 前完成。

规则：

- 第一版只新增 `deleting` status，不新增 `deleted` status、`deletedAt` 或 tombstone table。
- `deleting` 是用户不可见状态。
- 标记 `deleting` 时 `error = null`。
- 默认 item list、search、RAG hydration 必须排除 `deleting` items。
- `delete-subtree` 只负责物理 cleanup：cancel/drain、vectors、processed artifacts、ref-count cleanup、最终 hard-delete rows。
- 如果 `delete-subtree` 失败，items 保持 `deleting`，不重新出现在 UI；通过 job retry / 恢复机制继续 cleanup。
- 标记 `deleting` 与创建 `delete-subtree` job 必须在同一个 durable 写入边界内完成，避免“UI 已隐藏但 cleanup job 未落库”。

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
delete  -> mark deleting at API boundary -> cleanup job hard-deletes knowledge_item subtree rows
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
- `KnowledgeMutationCoordinator` 是进程内串行化机制，不是 crash-safety 机制；进程重启后的一致性依赖 durable item state、durable jobs、JobManager recovery 和 cleanup 幂等性。
- `KnowledgeMutationCoordinator` 不能替代 `DbService.withWriteTx`；前者串行同 base 的 Knowledge mutation，后者串行主 SQLite 的所有写事务，避免 Knowledge 写与 JobService 写竞争。
- `KnowledgeItemService` / `KnowledgeBaseService` 的写事务必须迁到 `DbService.withWriteTx`，不能继续使用 raw `db.transaction`。

---

## 6. Helpers

Helpers 只封装规则，不持有长期状态，不注册 IPC/timer/event，不进入 service registry。

### source planning helpers

用于 `KnowledgeWorkflowCoordinator.scheduleItem`。

输出：

```text
Round 1:
direct
invalid

Round 2:
needsFileProcessing
```

规则：

- FileProcessing 是 source preparation 策略，不是 embedding 策略。
- FileProcessing 失败时 item failed，不做 silent fallback。
- Round 1 中 `base.fileProcessorId` 对 indexing 仍是 inert。
- Round 2 后 `base.fileProcessorId` 只影响未来索引，不自动 reindex 已有 vectors。

### item lifecycle helpers

集中封装 `status/error` 写入，避免 handler 裸写 `updateStatus`。

只保留 `status` 和 `error`：

```text
status = item 的持久生命周期事实；reading/embedding/preparing 表示 Knowledge 粗粒度阶段；
         deleting 表示用户不可见、等待后台物理清理
JobManager state/progress = job 执行状态和实时进度
```

`status` 不是 JobManager progress 的替代品，也不由 JobManager state 反推。`deleting` 不能被
container reconcile 改回 `processing` / `completed` / `failed`。

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

### file-processing adapter helpers（Round 2）

隔离 Knowledge 与 FileProcessing API：

```text
startTask() -> taskId
getSnapshot(taskId) -> JobSnapshot
completed output -> markdown artifact FileEntry
```

Knowledge 每次需要转换时都使用本次 taskId 绑定 continuation。

---

## 7. FileProcessing 规则（Round 2）

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

handler 内调度下一步时必须使用 deterministic `idempotencyKey`，避免 `execute` retry 重复创建子任务。

规则：

- `idempotencyKey` 保留现有 `knowledge:` 前缀。
- key 必须按同一 item 的 workflow stage 区分。
- 不能让可能同时 non-terminal 的两个 jobs 共用同一个 key。
- JobManager 当前唯一约束是 `idempotencyKey` alone，不是 `(type, idempotencyKey)`；不同 job type 也会互相 dedup。

推荐 key 形态：

```text
knowledge:${baseId}:${itemId}:prepare
knowledge:${baseId}:${itemId}:fp-check
knowledge:${baseId}:${itemId}:index
knowledge:${baseId}:${itemId}:delete
knowledge:${baseId}:${itemId}:reindex
```

例如 `check-file-processing-result.execute` 里 enqueue `index-documents` 时，父 job 仍可能是
`running`。如果二者都用 `knowledge:${baseId}:${itemId}`，`index-documents` 会被父 job 的
non-terminal idempotency key 去重掉，导致下一步永远不会创建。

---

## 9. Stale Result 与失败边界

本 RFC 不新增 persisted attempt table，也不新增 generation token。

旧 FileProcessing / indexing result 回来时，用现有信息判断是否仍有效：

```text
item 是否仍存在
item.status 是否不是 deleting
item.data.fileEntryId 是否仍等于 sourceFileEntryId
base/item 是否处于 deleting/reindexing barrier
旧 jobs 是否已 cancel/drain 成功
```

这些检查必须至少执行两次：

- handler entry：便宜失败，避免明显 stale 的工作继续读文件/embedding。
- vector write 前：在 `KnowledgeMutationCoordinator` per-base lock 内重新检查，并与 `replaceByExternalId`
  和 `mark completed` 保持同一临界区。

如果不满足：

```text
skip continuation
do not write vectors
do not mark completed
best-effort cleanup unclaimed artifact if possible
```

final stale guard 只缩小 race window，并让 barrier 能拒绝 delete/reindex 中的写入。它不承诺阻止
已经超过 `cancelTimeoutMs` 且继续运行的 wedged handler；这种残余风险仍靠 durable delete/reindex
job 重跑、idempotent cleanup 和 whole-store cleanup 收敛。

失败边界：

- delete/reindex 的 cancel/drain timeout 是 hard failure。
- delete API 边界的 `deleting` 标记成功后，后续 cleanup 失败不回滚用户可见删除。
- reset 成功但重新调度失败时，必须把 item/subtree 标记 failed，不能留下永久 processing。
- 用户可以在 UI 上再次 reindex，不要求复杂自动恢复。

---

## 10. 非目标

本轮不做：

- 不新增 `deleted` status、`deletedAt` 或单独 tombstone table。
- 不新增 persisted indexing attempt table。
- 不新增 `indexingGeneration` / owner token。
- 不引入 JobManager DAG executor。
- 不新增 Knowledge workflow/run 聚合层。
- 不新增 JobManager backlog admission / `maxQueueDepth`。
- 不实现 `base.fileProcessorId` 变更后的自动 reindex。
- 不做用户可见实时进度 UI；JobManager progress 只作为诊断/开发辅助。

---

## 11. 迁移方向

建议顺序：

0. 迁移 `KnowledgeItemService` / `KnowledgeBaseService` 写事务到 `DbService.withWriteTx`。
1. 建立 `KnowledgeWorkflowCoordinator` 和 `KnowledgeMutationCoordinator` 边界。
2. 扩展 `knowledge_item.status = deleting`，并让默认 item list、search、RAG hydration 排除 `deleting` items。
3. 增加 helpers：source planning、item lifecycle、artifact、file-processing adapter。
4. 将 source strategy 从 `index-leaf` 收口到 `scheduleItem`。
5. 引入 `check-file-processing-result` 和 FileProcessing adapter（Round 2）。
6. 增加 `delete-subtree` / `reindex-subtree` handlers。
7. 将 delete/reindex 的 cancel/drain/cleanup 收口到 workflow + mutation coordinators。

保持不变：

- `addItems` / `deleteItem` / `reindexItem` 都是异步 workflow 入口；调用方不能把 API resolve 当作 indexing / reindex / cleanup 全部完成。
- `knowledge_item.phase` 移除；`status` 扩展为 `idle` / `preparing` / `processing` / `reading` /
  `embedding` / `completed` / `failed` / `deleting`。
- Round 1 中 `base.fileProcessorId` 对 indexing 仍是 inert；Round 2 后只影响未来索引。
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
- `KnowledgeItemService` / `KnowledgeBaseService` 写路径使用 `DbService.withWriteTx`，不使用 raw `db.transaction`。
- FileProcessing continuation 使用短任务 delayed check。
- indexing job 完整执行 reader -> chunk -> batched embed -> vector write。
- `index-documents` 使用固定 32 chunk batch、30min timeout、串行 batch、batch 间 cancellation check，写入仍是最终一次 `replaceByExternalId`。
- `index-documents` 的 final stale guard 与 vector write 必须在 `KnowledgeMutationCoordinator` lock 内同一临界区完成。
- `knowledge_item.status` 支持 `deleting`，默认 item list、search、RAG hydration 排除 `deleting` items。
- delete API resolve 前同步标记 subtree 为 `deleting` 并入队 `delete-subtree` cleanup job。
- `delete-subtree` cleanup steps 可重复执行；crash 后由 JobManager recovery 重跑并收敛。
- `KnowledgeMutationCoordinator` 只承诺进程内串行化，不承诺 crash-safety。
- delete/reindex cleanup 使用 cancel/drain hard failure。
- reindex 重新启动 FileProcessing，不复用旧 artifact。
- processed artifact internal FileEntry 只有在没有任何剩余 refs 时才会被删除。
