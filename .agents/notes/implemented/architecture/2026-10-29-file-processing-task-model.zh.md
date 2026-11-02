# Agent Note: 让 FileProcessing 有自己的任务模型，不再对外暴露 JobManager 的 job

Status: implemented

[English](2026-10-29-file-processing-task-model.md) | 中文

## 问题

`FileProcessingService` 原先没有自己的异步任务模型。它对外暴露的就是执行转换的那个 JobManager job，所以两个使用方都要经过 JobManager 才能用上文件处理：

- `startJob` 的参数是 `Pick<EnqueueOptions, 'parentId' | 'recovery'>`，返回 `JobHandle`。IPC 路由 `file_processing.start_job` 返回 `JobSnapshot`。
- 结果是 `JobSnapshot.output: unknown`。Knowledge 通过 `jobManager.get` 读，翻译页通过 `useJob` 读，各自解析 `FileProcessingJobOutput`。`getFileProcessingFailureMessage` 和 `getFileProcessingMarkdownArtifactPath` 的参数都是 `JobSnapshot`。
- Knowledge 从 `jobs.progress.${jobId}` 读进度，按 job id 通过 JobManager 取消转换。
- Knowledge 列出 FileProcessing 内部的三种 job 类型来校验快照。它还把自己的 job 作为转换的 `parentId` 传进去，并把转换的 job id 当作自己结果检查 job 和索引 job 的父 job。

于是使用方要依赖 FileProcessing 怎么调度它的工作。FileProcessing 也表达不了 JobManager 没有的状态。#20167 需要 Knowledge 区分"在等处理器槽位"和"正在转换"的文件，而当时只有 job 的状态里有这个区别，JobManager 又只在入队和结束时发布 `jobs.state.*`。

重启行为也是用 JobManager 的说法表达的。三个 handler 声明 `recovery: 'retry'`，Knowledge 再用 `abandon` 覆盖。重启后没有哪个使用方能用上结果：Knowledge 在内存里等，翻译页把任务 id 存在组件状态里。启动时重跑一个 `background` 转换，只会让云端处理器白白再扣一次费。

目标（#22987）：依赖 FileProcessing 的服务看不到 JobManager，除非这个服务自己还用 JobManager 做文件处理以外的工作。

## 决定

- **任务模型。** `src/shared/data/types/fileProcessing.ts` 定义 `FileProcessingTaskId`（branded 字符串）和 `FileProcessingTask`。后者是以 `status` 区分的联合类型，每个分支都带 `id`、`feature` 和 `processorId`：
  - `queued`；
  - `processing`，带 0 到 100 的 `progress`；
  - `completed`，带类型明确的 `artifact`；
  - `failed` 和 `cancelled`，都带 `error`，即原因消息。

  ```text
    startTask
        │
        ▼
     queued ───(1)───► processing ───(3)───► completed
        │                │   ▲  │
        │                │   └──┘ (2)
        │                │
        │                ├───────(4)───────► failed
        │                │
        └────────────────┴───────(5)───────► cancelled
  ```

  1. handler 的 `execute` 开始执行。
  2. 处理器上报进度。
  3. 产物写入完成。
  4. 处理器出错，或 job 超时。
  5. 调用 `cancelTask`，或下次启动时取消上次启动没跑完的任务。

  `completed`、`failed` 和 `cancelled` 都是终态。`done` 只 resolve 一次，`onDidChangeTask` 只报告一次终态；任务结束后仍在停止中的转换再上报进度，会被丢弃。重试就开一个新任务。
- **`FileProcessingService` 的主进程 API。** 取代 `startJob`：
  - `startTask(input)` resolve 为 `{ task, done }`。`task` 是刚入队时的任务，`done` resolve 为它的终态 `FileProcessingTask`。
  - `getTask(id)` 返回任务的当前状态；id 不是文件处理任务时返回 `null`。
  - `cancelTask(id, reason?)` resolve 为 `cancelled`；任务已读作 `cancelled` 但转换没能及时停下时为 `timed-out`；任务已经结束或不存在时为 `not-cancellable`。
  - `onDidChangeTask: Event<FileProcessingTask>`：任何任务的每次状态变化和每次进度上报都会触发。
- **实现仍然用 JobManager，但藏在边界后面。**
  - 任务 id 在内部就是 job id，使用方不依赖这一点。
  - `startTask` 发出 `queued`。每个 handler 都由 `withTaskUpdates` 包一层：`execute` 开始时和每次上报进度时发出 `processing`（开始时为 0），handler 的 `onSettled` 发出终态。每次变化都会触发 `onDidChangeTask`，并写入共享缓存 key `file_processing.task.${taskId}`。终态条目 60 秒后过期。
  - `getTask` 转换 job 行：`pending` 和 `delayed` 读作 `queued`，`running` 读作 `processing`，进度取缓存条目里最近的值。job 输出的 schema 是 FileProcessing 私有的。
  - 不新增任何持久化，JobManager 也没有改。
- **渲染进程。**
  - IPC `file_processing.start_task` 返回 `FileProcessingTask`，`file_processing.get_task` 读取一个任务，或返回 `null`。
  - `useFileProcessingTask(id)` 读缓存 key，条目为空时退回 `get_task`。
  - 翻译页改用它们，不再用 `useJob`。
- **重启：所有任务都不跨重启，但保留续跑的能力。**
  - 三种 job 类型都声明 `recovery: 'abandon'`。FileProcessing 注册 handler 时，JobManager 会取消上次启动留下的每个未结束任务，不续跑也不重跑。`startTask` 不接受重启相关的选项。
  - `remote-poll` 仍然把服务商的任务 id 记进 job 的 metadata。拿到记录的 id 时，它仍然轮询那个远端任务，而不是重新提交。以后有了持久的使用方（#22706 的 Problem B），不用重建就能重新打开续跑。
- **Knowledge。** 做文件处理时只用这套 API：
  - `scheduleItem` 用 `startTask` 启动转换并等待 `done`，然后入队一个 `knowledge.check-file-processing-result`，它的 payload 用 `fileProcessingTaskId` 指明任务。结果检查通过 `getTask` 读任务。
  - 条目的进度来自 `onDidChangeTask`：处理中任务的进度会复制到条目上，转换开始时为 0；排队中的任务不显示进度。
  - 删除、替换和删除知识库时，通过 `cancelTask` 取消条目在等的任务。
  - Knowledge 不传 `parentId`，也不传重启相关的选项，不提 FileProcessing 的任何 job 类型。直接添加时，由检查 job 自己的 id 来限定索引的 idempotency key。
- **导出。** 删除了 `startJob`、`getFileProcessingFailureMessage`、`getFileProcessingMarkdownArtifactPath`、`FileProcessingJobPayload` 和 `FileProcessingJobOutput`。IPC 路由 `file_processing.start_job` 由 `file_processing.start_task` 取代。

这条 note 部分取代了 [Knowledge 完成回调的 note](../../proposed/architecture/2026-10-25-knowledge-file-processing-completion-callback.md)。那里的等待登记表和单个检查 job 保持不变；条目现在等待任务的 `done` 而不是 `JobHandle`，从 `onDidChangeTask` 取进度而不是每 5 秒轮询一次，并通过 `cancelTask` 取消。

## 考虑过的替代方案

- **JobManager 认领 job 时发布 `running`，使用方继续读 `jobs.state.*`。** 这样能看出转换何时开始，但所有使用方都还停留在 JobManager 的词汇上，达不到目标。
- **FileProcessing 自己建一张任务表。** 和 job 行重复。没有跨重启的任务时，表里没有什么是 job 行里没有的。
- **现在就做跨重启的任务：保留 `retry`，提供 `survivesRestart` 选项。** 重启后没有使用方能读结果。续跑只会让 `background` 处理器再扣一次费，或者轮询一个结果没人读的远端任务。
- **既然还没人用续跑，就把它删掉。** 以后为持久的使用方重建，比现在保留并测着它代价更大。
- **用同一个 id 重试失败或已取消的任务。** 没有使用方需要：Knowledge 重新索引、翻译页重新 OCR，都是从头开始。`done` 和终态事件会触发不止一次，任务还需要一份落库的"任务对应哪些 job"的映射。以后可以给 `startTask` 加一个 `retryOf` 选项，让重试复用原任务的远端状态，比如本地超时后远端仍在排队的任务（#22761）。这只会在这套 API 上新增内容。
- **只在句柄上提供变化通知。** 只拿着 id 回来的使用方跟踪不了任务。以后持久的使用方在重启后就是这种情况。

## 后果

- 翻译页在重启时的行为变了。被退出打断的 OCR 会在下次启动时被取消；以前它会再跑一遍，但结果没人读。
- Knowledge 发起的云端转换在重启时仍然会被丢掉，#22662 之后一直如此。在出现持久的使用方之前都会这样。
- 续跑路径不再在生产环境里运行，只靠 AC6 的测试保证它能用。
- 上一版本写下的行会在各自 handler 注册时被取消：文件处理的行是因为它们的类型现在都 abandon，Knowledge 结果检查的行是因为本来就 abandon。旧的检查行不会读到改名后的 `fileProcessingTaskId` 字段，所以检查 handler 不再处理缺少 `processedRelativePath` 的 payload。
- `cancelled` 和 `failed` 一样带 `error`，所以无论哪种情况，Knowledge 都能带着原因把条目标记为失败。Spec 里只给 `failed` 写了它。
- Knowledge 条目在转换开始后就显示 0%；以前要等第一次进度上报才显示百分比。
- 仍不在范围内：Knowledge 条目的 `queued` 状态（#20167）；跨重启的任务和持久化的 Knowledge 等待（#22706）；#22761 要的服务商侧状态；删除 JobManager 的单个 job `recovery` 覆盖和 `job.recovery` 列，它们在这里失去了唯一的调用方（#22706）；修正 `useJob` 的注释。

## 验证

- AC1 — `src/main/features/fileProcessing/__tests__/FileProcessingService.tasks.test.ts`（9 个用例，使用真实的 JobManager 和基于文件的数据库）：事件依次为 `queued` → `processing 0` → `processing 40` → 带产物的 `completed`，缓存条目也是同样的状态；失败时带上消息；取消排队中和处理中的任务；已取消的任务在转换仍上报进度时保持 `cancelled`，去掉 `withTaskUpdates` 里的 abort 判断后这条会失败。
- AC2 — `src/renderer/pages/translate/__tests__/TranslatePage.test.tsx` 用真实的 `useFileProcessingTask` 对接 `file_processing.start_task`、`file_processing.get_task` 和共享缓存，包括"reads a settled OCR task over IPC once its cache entry has expired"；`FileProcessingService.tasks.test.ts` 在缓存条目过期后从 job 读到已结束的任务；`pnpm test:renderer src/renderer/pages/translate/__tests__/TranslatePage.test.tsx src/renderer/pages/knowledge/panels/dataSource` 通过（8 个文件，181 个测试）；代码搜索在 `src/renderer/pages/translate` 里找不到 `useJob`、`/jobs/` 或任何 `jobs.*` key。
- AC3 — `pnpm typecheck` 通过；代码搜索在 `src/main/features/fileProcessing/index.ts`、`src/main/features/fileProcessing/types.ts`、`src/shared/ipc/schemas/fileProcessing.ts` 和 `src/shared/data/types/fileProcessing.ts` 里找不到 JobManager 的类型、状态、入队选项或缓存 key；除迁移 0029 的回填测试（它构造的是已经落盘的行）外，`src/main/features/fileProcessing` 之外找不到 FileProcessing 的 job 类型名。
- AC4 — `checkFileProcessingResultJobHandler.test.ts`（14 个用例：已完成的任务在检查 job 或重新索引父 job 下被索引；失败和已取消的任务让条目带着原因失败；任务不存在；产物不是 markdown）、`FileProcessingWaitManager.test.ts`（5 个）、`cancel.test.ts`（12 个，包括 `throw` 模式下任务取消超时）、`deleteSubtreeJobHandler.test.ts`，以及 `KnowledgeService.test.ts` 里与文件处理相关的用例（`done` 之后才检查、进度来自 `onDidChangeTask`、删除知识库时取消在等的任务）；`pnpm test:main src/main/features/fileProcessing src/main/features/knowledge src/main/ipc` 通过（132 个文件，1407 个测试，13 个跳过）。
- AC5 — `FileProcessingService.tasks.test.ts` 的"cancels every task the previous launch left unfinished, without converting it"：三种 job 类型遗留的 running 和 pending 行在服务初始化后都读作 `cancelled`，且没有任何转换开始。
- AC6 — `src/main/features/fileProcessing/tasks/__tests__/remotePollJobHandler.test.ts` 的"first launch"在轮询前通过 `patchMetadata` 记录白名单内的服务商状态；"resume from metadata"跳过 `startRemote`，轮询已记录的远端任务。
