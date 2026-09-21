# External Knowledge 手动同步修复设计

## 状态与范围

本规格修复 Issue #15970 Layer 4 在 PR #20856 中暴露的四个问题：外部知识同步的物理清理不具备持久恢复能力、`KnowledgeService` 停止顺序错误、任务超时被记录为取消、创建来源依赖 SQLite 约束表达业务校验。

修复保持现有领域边界：

- `KnowledgeService` 继续拥有 External Knowledge runtime、同步 admission 和同步 handler 注册。
- `KnowledgeIngestionService` 继续拥有 Knowledge 删除工作流及启动恢复。
- `ExternalKnowledgeSourceService` 继续拥有来源身份唯一性和来源行写入。
- `JobManager` 继续提供持久任务、重试、取消和恢复；不修改其通用契约。

本规格不新增数据库表、迁移、生命周期服务、通用清理框架或 JobManager API，也不改变普通 Knowledge 项目的 best-effort 文件清理语义。

## 设计结论

复用现有 `KnowledgeItem.status = 'deleting'` 和 `knowledge.delete-subtree` 任务，把每一份可能需要回收的外部快照及向量材料先绑定到可恢复的 KnowledgeItem 行，再执行文件或向量副作用。同步发布事务只负责切换可见所有权、将旧项目标记为 `deleting`，并原子接纳清理任务。同步成功的含义变为“新内容已发布，旧内容已立即隐藏且其持久清理已被接纳”，而不是“旧物理字节已经删除”。

应用停止时，`KnowledgeService` 先关闭新的同步 admission，再逐个取消并等待所有活动的外部同步任务结算，最后停止 External Knowledge runtime。这样任务观察到的是 JobManager 的取消信号，而不是 runtime 提前中止造成的扫描或文档错误。

## 备选方案与取舍

### 采用：`deleting` 行加现有删除任务

该方案复用已经实现的隐藏语义、每个知识库的 mutation lock、幂等任务键、`recovery: 'retry'` 和启动恢复。它既覆盖已发布旧版本，也覆盖发布前的 staging 产物，不需要新的持久模型。

代价是外部项目在删除路径上需要比普通项目更严格：快照删除失败时必须保留 `deleting` 行并让任务失败重试，不能继续硬删数据库行。

### 不采用：专用 artifact-cleanup ledger

独立清理表可以更直接地描述 artifact 类型和重试次数，但需要新 schema、迁移、owner service、恢复扫描及清理状态机。现有 `deleting` 行已经保存 item id、base id 和 relative path，足以定位本次所需的向量及快照，因此新增 ledger 没有独立价值。

### 不采用：在发布事务前清理旧产物

先删除旧向量和快照可以避免异步清理，但事务 CAS 或提交随后失败时，数据库仍可能把已经失去物理材料的旧项目视为 active。该顺序破坏当前内容的可用性，不能接受。

### 不采用：新增 lifecycle service 或改变 JobManager 全局停止顺序

资源 owner 已经是 `KnowledgeService`，问题是 owner 内部的 admission 和停止顺序，而不是缺少 owner。新增服务会分裂同步 facade、runtime 和 handler 的所有权；修改 JobManager 全局停止则会影响无关任务。生命周期结论为“不新增 lifecycle service”，置信度高。

## 持久清理协议

### Staging 项目

每次需要重建一个外部文档时，先在 SQLite 中创建隐藏的 external KnowledgeItem：

- id 和最终发布项目相同；
- `status` 为 `deleting`；
- data 已包含 source、title 和最终 `relativePath`；
- 尚未被 `ExternalKnowledgeDocument.knowledgeItemId` 引用。

只有该行提交后，才允许写入快照文件或构建向量材料。进程在任意后续位置退出时，启动恢复都能从该行重新定位并回收已完成、部分完成或尚未开始的副作用。

`KnowledgeItemService` 提供两个窄事务操作：创建 deleting external 项目，以及以 item id、base id 和当前 `deleting` 状态为 fence 将其提升为 `completed`。提升失败表示发布竞争或数据已改变，调用方不得发布 document ownership。

### 发布事务

在持有知识库 mutation lock、向量材料已 staging 后，单个 `withWriteTx` 完成以下操作：

1. 重新校验 source fence 和 document version fence。
2. CAS 提升 staging item 为 `completed`。
3. 创建或更新 `ExternalKnowledgeDocument`，将 ownership 指向新 item。
4. 如果存在旧 owner，将旧 item 标记为 `deleting`。
5. 对旧 item 通过 `enqueueKnowledgeSubtreeDeletionTx` 原子 enqueue `knowledge.delete-subtree`。

任何一步失败都会回滚整个事务。新 staging item 仍为 `deleting`；当前进程在错误路径尝试为它接纳删除任务，若进程在接纳前退出，启动恢复负责补齐。

### Missing 与 permission-denied reconciliation

远端缺失或无权读取时，单个事务必须同时：

1. 把 document 标记为 unavailable 并清空 active ownership；
2. 把原 owner item 标记为 `deleting`；
3. enqueue 对应的 `knowledge.delete-subtree`。

事务完成后，该内容立刻从列表、搜索和 RAG 中隐藏。物理回收由持久任务完成，不再作为同步 summary 的 best-effort cleanup warning。

### 删除任务的严格边界

`purgeKnowledgeSubtreeWithinLock` 保持“向量 -> 文件 -> DB 行”的顺序，并按项目类型拆分文件清理：

- external 项目调用严格的 `deleteKnowledgeItemFiles`；失败时抛错，保留全部 `deleting` 行供任务重试；
- 其他项目继续调用 `deleteKnowledgeItemFilesBestEffort`，保持现有行为；
- 只有严格 external 清理成功后才能删除对应数据库行。

重试时重复删除向量和不存在的文件必须保持幂等。现有 active external owner guard 保留；只有已经清除 ownership 或从未发布的 deleting external 项目能进入 purge。

### 接纳与恢复复用

删除任务的 idempotency key、queue 和 payload 构造收敛到 feature-local helper：

- `enqueueKnowledgeSubtreeDeletionTx(tx, baseId, rootItemIds)` 用于与业务写入原子接纳；
- `recoverDeletingKnowledgeItems(baseId?)` 扫描 deleting roots 并通过同一构造逻辑补接任务。

普通 `deleteItems`、外部同步发布/reconciliation 和启动恢复都使用这些 helper。`KnowledgeService.onAllReady` 继续执行全库恢复；每次外部来源同步开始时额外执行该 base 的恢复，使已经耗尽重试但仍保留 deleting 行的清理能在同一进程的后续同步中再次接纳。活动任务由现有 idempotency key 合并，不产生并行重复清理。

现有 staged/old/missing/permission cleanup failure warning code 和同步服务中的直接物理清理 helper 删除。同步 summary 只报告远端读取、解析、单文档同步和 reconciliation 的业务结果；物理清理由删除任务自己的终态和日志表达。

## 生命周期与停止协议

`KnowledgeService` 增加 owner-local admission gate。gate 仅在 `externalKnowledgeRuntime.start()` 成功后打开；停止开始时同步关闭，停止完成后保持关闭。

创建来源和手动同步在两个位置检查 gate：

1. 命令入口，快速拒绝停止期间的新请求；
2. 所有异步 scope resolution 完成后、进入写事务前，再次拒绝已经跨过停止边界的请求。

`KnowledgeService.onStop` 固定执行：

1. 关闭 admission gate。
2. 通过 `JobManager.list` 获取所有 status 为 `pending`、`delayed` 或 `running` 且 type 为 `knowledge.sync-external-source` 的任务。
3. 对快照中的每个任务并发调用并等待 `JobManager.cancel(job.id, 'knowledge-service-stop')`。不得使用 `cancelMany`，因为停止 runtime 前必须让 JobManager 先完成正常取消或 cancel-timeout 强制终态，并运行 `onSettled`；cancel-timeout 后 handler 可能仍在内存中收尾，但 source 已稳定记录为 cancelled，不会被 runtime stop 改写为业务失败。
4. 在 `finally` 中调用并等待 `externalKnowledgeRuntime.stop()`，保证任务取消发生异常时 runtime 仍被释放。
5. 如果取消或 runtime stop 失败，在两类清理均已尝试后向 lifecycle 抛出错误；多个错误聚合，不能让前一个错误跳过后一个清理。

该顺序适用于 running、pending 和 delayed 任务。取消结算必须触发 handler `onSettled`，清空匹配 source 的 `activeJobId` 并记录 cancelled。手动同步 IPC 使用 external admission error mapper，使 gate 的 stopped 错误稳定映射为 `KNOWLEDGE_EXTERNAL_RUNTIME_STOPPED`。

## 超时终态

`syncExternalSourceJobHandler.onSettled` 对非 completed 任务按以下优先级生成 `lastErrorSummary`：

1. `event.status === 'cancelled'` -> `cancelled`；
2. `event.error?.code === JOB_ERROR_CODES.HANDLER_TIMEOUT` -> `timeout`；
3. 合法的 external sync metadata code；
4. `failed`。

超时仍由 JobManager 按现有 retry policy 重试；只有最后一次尝试耗尽并以 `JOB_HANDLER_TIMEOUT` 失败时，source 才记录 `lastOutcome = 'failed'`、`lastErrorSummary = 'timeout'`。不得根据 error message 字符串推断超时。

## 来源创建校验与 IPC 语义

远端 scope resolution 仍在事务外执行，因为它包含网络 IO。resolution 返回后，创建事务使用同一 tx snapshot 重新校验：

- Knowledge base 仍存在且允许 runtime operation；
- connection 仍存在、provider 为 Feishu、authorization status 为 `connected`，且其当前 tenant identity 与 resolution 的 `tenantId` 一致；
- `(baseId, provider, tenantId, spaceId)` 身份仍未被其他 source 占用。

`KnowledgeBaseService` 和 `ExternalKnowledgeConnectionService` 增加显式 `getByIdTx`，非事务 `getById` 委托给它们。`ExternalKnowledgeSourceService.createTx` 在 insert 前使用调用方 tx 查询 identity 冲突并抛出稳定、无复合标识符的 conflict；SQLite UNIQUE/FK handling 仅保留为两个 writer 竞争时的兜底，并转换为相同安全语义。

IPC 增加并映射两个 Knowledge domain error code：

- `KNOWLEDGE_EXTERNAL_SOURCE_CONFLICT`：同一 base 已存在相同 provider identity；
- `KNOWLEDGE_EXTERNAL_SOURCE_TARGET_UNAVAILABLE`：resolution 后 base 或 connection 已删除、base 已不可运行，或 connection 已不再 connected。

`KNOWLEDGE_EXTERNAL_RUNTIME_STOPPED` 继续表达 admission 已关闭。上述路径不得退化为 `INTERNAL`，不得向 renderer 暴露由 base、provider、tenant 和 space 拼接的唯一键文本。

## 数据流与崩溃点

```text
resolve/read remote
  -> create deleting staging item (durable locator)
  -> write snapshot and build vectors
  -> base mutation lock
     -> rebuild staged vector material
     -> publication transaction
        -> promote staging item
        -> publish document ownership
        -> mark old owner deleting
        -> enqueue delete-subtree
  -> return published result

failure before publication commit
  -> staging item remains deleting
  -> enqueue cleanup now, or recover on boot/next sync

missing / permission denied
  -> reconciliation transaction
     -> clear ownership and mark unavailable
     -> mark old owner deleting
     -> enqueue delete-subtree
```

关键崩溃不变量：只要物理副作用可能存在，就有 committed deleting 行能够定位它；只要 active ownership 被清除，就在同一事务内存在持久清理接纳。不存在“只记录 warning 后永久丢失清理身份”的状态。

## 测试策略

### 持久清理

- staging 行提交后快照写入、material prepare、vector rebuild、publication CAS 和事务提交分别失败时，项目保持 `deleting`，删除任务被当前进程或恢复路径接纳。
- 成功替换、远端 missing 和 permission-denied 时，ownership 变更、`deleting` 标记与 delete job 在同一事务可见。
- external 快照删除失败时 delete job 失败且行保留；重试成功后向量、快照和行全部删除。
- 普通知识项目的文件删除失败仍为 best-effort，不改变既有契约。
- 启动恢复和同 base 后续同步都能重新接纳 stranded deleting roots；已有 active cleanup 时 idempotency key 不产生第二个活动任务。

### 生命周期

- gate 在 runtime start 成功前关闭，start 成功后打开，stop 一开始关闭。
- running、pending 和 delayed 外部同步任务均在 runtime stop 前被逐个 cancel 并等待。
- cancel 抛错时 runtime stop 仍执行；runtime stop 抛错时已完成任务取消。
- scope resolution 跨过 stop 边界后，创建事务不执行。
- 停止时并发创建和手动同步都返回 stopped domain error；任务结算后 source `activeJobId` 清空。

### 超时与创建校验

- 最后一次 handler timeout 记录 `failed/timeout`；普通 cancellation 仍记录 `cancelled/cancelled`；domain failure 保留 metadata code。
- scope resolution 期间删除 base、删除 connection、把 connection 置为非 connected，创建均在事务内拒绝且不产生 source/job。
- 预查询命中的重复 identity 和 UNIQUE 竞争兜底都返回同一 source-conflict IPC code，消息不包含复合唯一键。

数据库相关测试使用 `setupTestDatabase()` 和生产迁移，不手写表结构或 stub Drizzle chain。验证以相关 main-process Vitest 文件为主，完成实现后运行 `pnpm lint`；由于修改跨越生命周期、持久任务和数据边界，最终再运行 `pnpm build:check`。

## 预期修改面

- External sync：`ExternalKnowledgeSyncService.ts`、`ExternalKnowledgeSyncAdmission.ts` 及其测试。
- Lifecycle owner：`KnowledgeService.ts` 及其测试。
- Durable deletion：`KnowledgeIngestionService.ts`、`subtreePurge.ts`、delete-subtree handler、KnowledgeItem service 及其测试；可新增一个 ingestion 内的删除接纳 helper 文件。
- Job projection：`syncExternalSourceJobHandler.ts` 及其测试。
- Data validation：ExternalKnowledgeSource、KnowledgeBase、ExternalKnowledgeConnection services 及真实数据库测试。
- IPC：Knowledge handler、Knowledge error constants 及 handler 测试。
- Documentation：Knowledge feature README、workflow architecture 和 knowledge service reference。

## 验收条件

1. 任何外部同步产生的旧或 staging 物理产物，都能由 committed deleting item 在重启或后续同步后继续清理。
2. 外部快照删除失败不会硬删其定位行；普通 Knowledge 清理行为不回归。
3. `KnowledgeService` 停止期间不接纳新同步，并在 runtime stop 前等待所有外部同步任务取消结算。
4. 最终 handler timeout、用户取消和业务失败在 source projection 中可稳定区分。
5. 来源创建在同一事务快照中校验 target 与 identity，预期冲突不再成为 IPC `INTERNAL`，也不泄露复合标识符。
6. 不新增 schema/migration、lifecycle service 或 JobManager 通用能力，所有变更都能直接追溯到本规格的四个问题。
