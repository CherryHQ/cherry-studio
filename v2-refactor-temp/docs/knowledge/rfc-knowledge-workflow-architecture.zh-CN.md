# RFC: Knowledge Workflow Architecture

> 定位：Knowledge runtime 架构评审 RFC。
>
> 目标是把 add / delete / reindex / file processing / indexing 的职责边界讲清楚，
> 不作为逐文件实施清单。
>
> Canonical reference: [docs/references/knowledge/workflow-architecture.md](../../../docs/references/knowledge/workflow-architecture.md).
> Operation guard reference: [docs/references/knowledge/operation-guards.md](../../../docs/references/knowledge/operation-guards.md).
> `v2-refactor-temp` 下的文档会在 v2 收尾时移除。

---

## 1. 核心结论

Knowledge 不再建模成简单 pipeline，而是一个轻量 workflow：

```text
用户动作 / API
    |
    v
KnowledgeWorkflowService
    |
    v
JobManager -> Knowledge job handlers
    |
    v
KnowledgeLockManager
    |
    v
SQLite / VectorStore / FileManager
```

架构主轴只保留三部分：

```text
1. KnowledgeWorkflowService
   决定下一步做什么。

2. KnowledgeLockManager
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

- **Round 1（结构重构）：** workflow service / lock manager、`index-documents`、`delete-subtree`、`reindex-subtree`。不接 FileProcessing。
- **Round 2（FileProcessing feature）：** `needsFileProcessing` source planning、`check-file-processing-result`、FileProcessing adapter。

---

## 2. Workflow Service API

`KnowledgeWorkflowService` 是唯一的流程决策 owner。

```ts
class KnowledgeWorkflowService {
  addItems(baseId, inputs): Promise<AddResult>
  deleteItems(baseId, itemIds): Promise<JobHandle>
  reindexItems(baseId, itemIds): Promise<JobHandle>

  scheduleItem(baseId, itemId): Promise<void>
  // Round 2
  scheduleFileProcessingCheck(baseId, itemId, taskId, options): Promise<void>
  scheduleIndexing(baseId, itemId, source): Promise<void>
}
```

调用边界：

- `addItems` / `deleteItems` / `reindexItems` 给 API/service 层调用。
- `scheduleItem` / `scheduleFileProcessingCheck` / `scheduleIndexing` 给 job handlers 调用。
- handler 可以在本阶段完成后调用 workflow service，但不能自己决定 workflow 分支。
- 所有“下一步去哪”的判断都集中在 workflow service。
- `scheduleFileProcessingCheck` 和 `needs file processing` 分支属于 Round 2。

公开 API 语义：

- `addItems` / `deleteItems` / `reindexItems` 都是异步 workflow 入口。
- API resolve 只表示用户动作已经进入 durable workflow，不表示整条 workflow 已完成。
- `addItems` resolve：item rows 已创建，首批 Knowledge jobs 已入队。
- `reindexItems` resolve：目标 top-level subtree 已确认全为 `completed` / `failed`，且 `reindex-subtree` job 已入队。
- `deleteItems` resolve：subtree 已同步标记为 `deleting`，默认 UI 查询和检索不再返回这些 items，`delete-subtree` cleanup job 已入队。

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
- 对每个 child 调用 `workflowService.scheduleItem(baseId, childId)`。
- child 仍可能是 `directory` / `sitemap`；此时由 workflow service 再次分派到 `knowledge.prepare-root`，形成递归展开。
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
- item missing / deleting：跳过，不写 vectors。

### `knowledge.index-documents`

输入：

```text
baseId
itemId
parentJobId
```

职责：

```text
reader -> chunk -> batched embed -> serialized vector write
```

`index-documents` 不负责追踪外部源文件的最新状态。Knowledge item 的语义是：
用户添加或 reindex 时选择/生成一次输入，当前 workflow 消费这份输入；后续外部文件修改或
删除不会自动 invalidate 已启动的 indexing job。用户需要显式 reindex 才会重新取源。

这个 job 是完整 indexing job。`aiCore embed` 不是独立 job。

执行策略：

- `EMBED_BATCH_SIZE = 32` chunks。
- `defaultTimeoutMs = 30min`。
- embed batches 串行执行，不做 batch 并发。
- 每个 embed batch 前后都检查 `AbortSignal`。
- 任一 batch 失败则整个 job attempt 失败，由 JobManager retry。
- 全部 batches embed 完成后，一次 `replaceByExternalId` 写入 vectors。
- reader 返回空 documents 或 chunk 后没有 chunks 时，仍写入 `replaceByExternalId(itemId, [])` 并标记 item `completed`。
- vector write 必须在 `KnowledgeLockManager` 的 per-base lock 内执行，并在写入前做 final stale guard。
- 不做 incremental checkpoint、staging vectors 或 batch-level resume；retry 会重新 embed 已完成 batches。
- 可以保留粗粒度 `reportProgress` 用于诊断，但第一版不做用户可见实时进度 UI，也不新增 workflow/run 聚合进度。
- `knowledge_item.status` 承载 `reading` / `embedding` 等粗粒度阶段，不记录 batch 级进度。

final stale guard：

```text
under KnowledgeLockManager base lock:
  re-read item
  assert item exists
  assert item.status != deleting
  replaceByExternalId(...)
  mark item completed
```

不要求 source snapshot 对比，也不要求 `KnowledgeLockManager` 维护 delete/reindex
barrier。未来如果产品语义改为自动跟踪源文件最新内容，再引入 source generation/version
校验。

如果 final stale guard 不满足：

- skip vector write。
- do not mark completed。
- job 可以 completed/no-op，不因 stale continuation 消耗 retry。

### `knowledge.delete-subtree`

输入：

```text
baseId
rootItemIds
```

前置条件：

- 目标 subtree 已在 API 边界同步标记为 `deleting`。
- 默认 item list / search / RAG hydration 已排除 `deleting` items。

职责：

```text
cancel/drain active subtree jobs
-> delete vectors
-> detach processed_artifact refs
-> delete knowledge_item rows by resolved ids
```

幂等规则：

- `delete-subtree` 是 at-least-once cleanup job；DB rows、vectors 和 FileRef cleanup 在 crash 后重跑必须收敛。
- 重跑时先重新 list active subtree jobs 并逐个 `JobManager.cancel()`；没有 active jobs 是 no-op。
- 重跑时只处理仍存在且 `status = deleting` 的 subtree rows；subtree 已不存在时视为 cleanup 已完成。
- vector delete 必须按 external item id 删除；目标 vectors 已不存在时视为成功。
- processed artifact ref detach 必须允许重复执行；目标 refs 已不存在时视为成功。
- delete 和 container reindex 删除旧 descendants 时只 detach Knowledge FileRef，不主动 permanent-delete `FileEntry`；无引用 `FileEntry` 按 FileManager 默认策略保留，由文件管理界面或后续孤儿文件能力处理。
- `deleteItemsByIds` 必须放在最后；它先按调用方传入的 ids 展开完整 subtree 并清理 Knowledge FileRef，再删除传入 ids 对应 rows，descendants 由 `knowledge_item.groupId` cascade 删除；找不到 rows 时视为已完成，不能用 missing-row error 让 job 永久失败。

完成后流程结束。

### `knowledge.reindex-subtree`

输入：

```text
baseId
itemId
```

职责：

```text
delete vectors
-> delete stale container descendants when selected roots are containers
-> reset knowledge_item subtree rows
-> workflowService.scheduleItem(baseId, itemId)
```

规则：

- `reindex-subtree` 只处理入口已确认全为 `completed` / `failed` 的 terminal subtree。
- handler 不 cancel active subtree jobs；active work 期间用户只能 delete，不能 reindex。
- 如果入口 guard 之后 delete 先赢，handler 在 entry 和 mutation lock 内再次看到 `deleting` 后跳过。
- 这两个 `deleting` guard 是必要防御，不是重复校验；它们覆盖 enqueue 到 job reset 之间的竞态，并维持 delete 随时可用。
- reset 后 root 会先进入 `preparing` / `processing` 再调度后续 job；如果调度失败，必须补偿为 `failed`，避免没有 durable job 的 active 状态卡住。
- selected leaf root 的 source FileRef 不是 vector artifact，reindex reset 阶段不能 detach；后续 `index-documents` 会按 `knowledge_item.data` 对账并重建 Knowledge source FileRef。
- reindex 不复用旧 processed artifact。
- Round 2：需要转换的 source 会重新启动 FileProcessing。
- handler 不判断 root/leaf/direct/FileProcessing 分支，分支由 workflow service 决定。

---

## 4. Workflows

本节只描述入口 guard 和状态边界。三条入口不要强行抽成一个通用 validation pipeline：

```text
addItems    -> 新建 rows，先写 active 状态，再调度首批 jobs
deleteItems -> 先写 durable deleting intent，再调度 cleanup job，enqueue 失败后等待下次启动恢复扫描
reindexItems -> 只接受全 terminal subtree 的 durable job，不提前写 active 状态
```

共享 guard 应只覆盖语义完全一致的部分，例如 base 失败态拦截、item/base 归属检查、
嵌套选择归并、queue name 和 idempotency key。状态写入、enqueue 失败补偿和恢复策略必须保留在各自 workflow 中显式表达。

### Add

```text
addItems(baseId, inputs)
-> preflight
-> create item rows
-> workflowService.scheduleItem(baseId, itemId)
```

入口预检只做便宜、同步、属于入口职责的检查：

- base 存在，且不是需要 restore 的 `failed` base。
- IPC / schema 层保证 item type / payload shape 合法。
- Data service 在 create 时再次校验 type/data 一致性。

入口不做这些检查：

- 不要求 file/directory/url/source 在 API resolve 前一定仍可读取。
- 不要求 embedding runtime 在入口阶段可用。
- Round 2 不要求 FileProcessing provider 在入口阶段完成可用性校验。

这些检查放到 job/runtime guard 中处理，因为 enqueue 后 base/item/source/runtime 仍可能变化。
入口做过重 source preflight 会制造 TOCTOU 假安全，也会把可恢复的单 item indexing 失败放大成整批 add reject。

调度补偿规则：

- create/status update 阶段失败：删除本轮已创建 rows。
- job enqueue 阶段失败：把本轮已创建但尚未完成调度的 rows 标记为 `failed`，然后把原 enqueue 错误抛给调用方。
- 已完成调度的 rows 不回滚，避免删除已经被 durable job 引用的数据。

### Delete

```text
deleteItems(baseId, itemIds)
-> preflight
-> mark knowledge_item subtree status = deleting
-> enqueue knowledge.delete-subtree
-> return JobHandle
```

delete 是破坏性 workflow，但用户可见删除必须在 API resolve 前完成。

规则：

- 第一版只新增 `deleting` status，不新增 `deleted` status、`deletedAt` 或 tombstone table。
- `deleting` 是用户不可见状态。
- 标记 `deleting` 时 `error = null`。
- 默认 item list、search、RAG hydration 必须排除 `deleting` items。
- `delete-subtree` 只负责 cleanup：cancel/drain、vectors、Knowledge FileRef、最终按已解析 ids 删除 rows。
- 如果 `delete-subtree` 失败，items 保持 `deleting`，不重新出现在 UI；通过 job retry 继续 cleanup。
- `deleting` 是 durable delete intent marker。正常路径会立即创建 `delete-subtree` job；如果 enqueue 失败或进程在两步之间退出，下次启动恢复扫描会为残留 `deleting` roots best-effort 补 enqueue。
- 如果 enqueue 失败，当前 API call reject，但 items 保持 `deleting`，不回滚成用户可见状态。
- delete 不拒绝 failed base。失败知识库中的 item 仍应允许删除，以便用户清理迁移失败或恢复前的残留数据。
- `itemIds` 先去重并折叠为 top-level roots；如果同时选中目录和其 descendant，只保留目录，避免同一 subtree 被重复 cleanup。

### Reindex

```text
reindexItems(baseId, itemIds)
-> preflight
-> assert every selected subtree item is completed or failed
-> enqueue knowledge.reindex-subtree
```

reindex 不负责抢占 active work。只要 selected subtree 内还有 `idle` / `preparing` /
`processing` / `reading` / `embedding` / `deleting`，入口就拒绝。用户可以随时 delete；
只有全部完成或失败后才能 reindex。

reindex 与 delete 共享物理清理步骤，但不共享 active job cancellation：

```text
delete vectors
-> delete stale container descendants and their refs
```

区别只在最后：

```text
delete  -> mark deleting at API boundary -> cleanup job deletes resolved knowledge_item rows
reindex -> reset knowledge_item subtree rows -> scheduleItem
```

对 `directory` / `sitemap`，descendants 的重建发生在后续 `prepare-root` 阶段，不在
`reindex-subtree` 的 reset 阶段做。

规则：

- reindex 拒绝 failed base；failed base 必须先走 restore。
- `itemIds` 先去重并折叠为 top-level roots；如果同时选中目录和其 descendant，只保留目录，避免重复 reindex。
- 折叠后必须校验每个 selected root subtree 全部为 `completed` / `failed`；任何 active 或 `deleting` item 都拒绝整批 reindex。
- 入口不提前把 item 标记为 `preparing` / `processing`。状态 reset 和重新调度由 `reindex-subtree` job 负责。
- 因为入口未写 active 状态，enqueue 失败时只需把错误抛给调用方，不会留下卡住的 active rows。
- `reindex-subtree` 内部 reset 后的 follow-up job 调度失败必须把 reset roots 标记为 `failed`；这是 reset 已经写入 active 状态后的必要补偿。

---

## 5. Lock Manager

`KnowledgeLockManager` 负责同一 base 下的安全写入和清理。

第一版实现使用 per-base mutex：

```ts
private readonly baseLocks = new Map<string, Mutex>()
```

具体 public API 暂不在本 RFC 中定死；实现时只要求所有同 base 的 mutation 进入同一把
`baseId` 锁。

职责：

- 同 base mutation 串行。
- 保护 vector replace/delete。
- 保护 item status writes。
- 保护 processed artifact attach/detach。
- 保护 destructive cleanup/reset 临界区。

不维护 deleting/reindexing barrier。delete 通过 durable `deleting` status、active job
cancel/drain 和 cleanup job 幂等性保证收敛；reindex 通过入口 terminal-subtree guard
避免与 active indexing/expansion job 竞争。

规则：

- 同一 base 的 Knowledge mutation 必须串行。
- 不同 base 可以并行。
- manual chunk list/delete 只允许目标 item 为 `completed`；目录 list 还要拒绝包含 `deleting` descendant 的 subtree。
- 旧任务可能继续写入时，不能删除 vectors、SQLite rows 或 artifact refs。
- `KnowledgeLockManager` 是进程内串行化机制，不是 crash-safety 机制；进程重启后的一致性依赖 durable item state、durable jobs、JobManager recovery 和 cleanup 幂等性。无引用 FileEntry 的资源回收不属于 Knowledge workflow 的 crash-safety 承诺。
- `KnowledgeLockManager` 不能替代 `DbService.withWriteTx`；前者串行同 base 的 Knowledge mutation，后者串行主 SQLite 的所有写事务，避免 Knowledge 写与 JobService 写竞争。
- `KnowledgeItemService` / `KnowledgeBaseService` 的写事务必须迁到 `DbService.withWriteTx`，不能继续使用 raw `db.transaction`。

---

## 6. Helpers

Helpers 只封装规则，不持有长期状态，不注册 IPC/timer/event，不进入 service registry。

### source planning helpers

用于 `KnowledgeWorkflowService.scheduleItem`。

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
- 不主动删除 detached FileEntry；无引用 FileEntry 遵循 FileManager 默认保留策略。

cleanup 规则：

```text
detach current Knowledge refs
-> keep detached FileEntry rows
```

目标模型不主动跨 item/base 共享 processed artifact，但 Knowledge 仍只维护自己的 FileRef。
本轮不引入 durable artifact cleanup queue；无引用 FileEntry 由后续 FileManager/文件管理界面统一发现和清理。

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
- handler 在 `execute` 内完成本阶段动作后调用 workflow service，由 workflow service enqueue 下一步。

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

旧 indexing result 回来时，Round 1 用现有 durable state 判断是否仍有效：

```text
item 是否仍存在
item.status 是否不是 deleting
本 workflow 是否仍可继续写入
```

FileProcessing 接入后也沿用同一语义：每个 Knowledge workflow 消费本次 FileProcessing
task 产出的 artifact；后续外部文件修改/删除不 invalidate 已启动的 workflow。只有当未来
产品语义改为自动跟踪源文件最新内容时，才需要新增 source generation/version 校验。

这些检查必须至少执行两次：

- handler entry：便宜失败，避免明显 stale 的工作继续读文件/embedding。
- vector write 前：在 `KnowledgeLockManager` per-base lock 内重新检查，并与 `replaceByExternalId`
  和 `mark completed` 保持同一临界区。

如果不满足：

```text
skip continuation
do not write vectors
do not mark completed
```

Round 1 final stale guard 只缩小 race window。delete 的主要保护来自 cancel/drain 和
`deleting` durable state；reindex 的主要保护来自入口 terminal-subtree guard，不允许
active indexing/expansion job 与 cleanup/reset 并发。processed artifact FileEntry orphan
处理作为文件管理层的后续资源回收问题，不影响 Knowledge delete/reindex 的可见状态收敛。

失败边界：

- delete 的 cancel/drain timeout 是 hard failure。
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
1. 建立 `KnowledgeWorkflowService` 和 `KnowledgeLockManager` 边界。
2. 扩展 `knowledge_item.status = deleting`，并让默认 item list、search、RAG hydration 排除 `deleting` items。
3. 增加 helpers：source planning、item lifecycle、artifact、file-processing adapter。
4. 将 source strategy 从 `index-leaf` 收口到 `scheduleItem`。
5. 引入 `check-file-processing-result` 和 FileProcessing adapter（Round 2）。
6. 增加 `delete-subtree` / `reindex-subtree` handlers。
7. 将 delete 的 cancel/drain/cleanup 和 reindex 的 terminal-subtree cleanup/reset 收口到 workflow + lock managers。

保持不变：

- `addItems` / `deleteItems` / `reindexItems` 都是异步 workflow 入口；调用方不能把 API resolve 当作 indexing / reindex / cleanup 全部完成。
- `knowledge_item.phase` 移除；`status` 扩展为 `idle` / `preparing` / `processing` / `reading` /
  `embedding` / `completed` / `failed` / `deleting`。
- Round 1 中 `base.fileProcessorId` 对 indexing 仍是 inert；Round 2 后只影响未来索引。
- Knowledge 每次转换只消费本次 FileProcessing task result。
- processed artifact cleanup 只 detach Knowledge FileRef；本轮不引入 durable artifact cleanup queue。

---

## 12. 评审问题

- `check-file-processing-result` 是否需要最大等待时间？
- 5 秒固定 delay 是否足够，还是需要 capped backoff？
- 大 fan-out 是否需要 batching/backpressure，触发阈值如何定义？
- artifact cleanup 暂不引入 durable cleanup queue；是否需要 FileManager 侧孤儿文件扫描/管理？
- 无引用 FileEntry cleanup 是否需要下沉为 FileRef/FileManager 通用 helper？

---

## 13. 接受标准

- 架构主轴是 `KnowledgeWorkflowService`、`KnowledgeLockManager` 和
  Knowledge job handlers。
- helpers/modules 不作为独立 service。
- 第一版 job types 是 `prepare-root`、`check-file-processing-result`、
  `index-documents`、`delete-subtree`、`reindex-subtree`。
- job handler 只做当前阶段动作，下一步由 workflow service 决定。
- `KnowledgeItemService` / `KnowledgeBaseService` 写路径使用 `DbService.withWriteTx`，不使用 raw `db.transaction`。
- FileProcessing continuation 使用短任务 delayed check。
- indexing job 完整执行 reader -> chunk -> batched embed -> vector write。
- `index-documents` 使用固定 32 chunk batch、30min timeout、串行 batch、batch 间 cancellation check，写入仍是最终一次 `replaceByExternalId`。
- `index-documents` 的 final stale guard 与 vector write 必须在 `KnowledgeLockManager` lock 内同一临界区完成。
- `knowledge_item.status` 支持 `deleting`，默认 item list、search、RAG hydration 排除 `deleting` items。
- delete API resolve 前同步标记 subtree 为 `deleting` 并入队 `delete-subtree` cleanup job。
- `delete-subtree` 的 DB/vector/ref/row cleanup steps 可重复执行；crash 后由 JobManager recovery 重跑并收敛。
- `KnowledgeLockManager` 只承诺进程内串行化，不承诺 crash-safety。
- delete cleanup 使用 cancel/drain hard failure。
- reindex 只允许整棵 selected subtree 全部为 `completed` / `failed`；active 或 `deleting` subtree 必须拒绝。
- reindex 重新启动 FileProcessing，不复用旧 artifact。
- processed artifact internal FileEntry 在 ref detach 后默认保留；无引用 FileEntry 不作为本轮 Knowledge workflow 的 hard failure。
