# Agent Note: 让 FileProcessing 有自己的任务模型，不再对外暴露 JobManager 的 job

Status: proposed

[English](2026-10-29-file-processing-task-model.md) | 中文

## 问题

`FileProcessingService` 没有自己的异步任务模型。它对外暴露的就是执行转换的那个 JobManager job，所以两个使用方都要经过 JobManager 才能用上文件处理：

- `startJob` 的参数是 `Pick<EnqueueOptions, 'parentId' | 'recovery'>`，返回 `JobHandle`。IPC 路由 `file_processing.start_job` 返回 `JobSnapshot`。
- 结果是 `JobSnapshot.output: unknown`。Knowledge 通过 `jobManager.get` 读，翻译页通过 `useJob` 读，各自解析 `FileProcessingJobOutput`。`getFileProcessingFailureMessage` 和 `getFileProcessingMarkdownArtifactPath` 的参数都是 `JobSnapshot`。
- Knowledge 从 `jobs.progress.${jobId}` 读进度，按 job id 通过 JobManager 取消转换。
- Knowledge 列出 FileProcessing 内部的三种 job 类型来校验快照。它还把自己的 job 作为转换的 `parentId` 传进去，并把转换的 job id 当作自己结果检查 job 和索引 job 的父 job。

于是使用方要依赖 FileProcessing 怎么调度它的工作。FileProcessing 也表达不了 JobManager 没有的状态。#20167 需要 Knowledge 区分"在等处理器槽位"和"正在转换"的文件，而目前只有 job 的状态里有这个区别，JobManager 又只在入队和结束时发布 `jobs.state.*`。

重启行为也是用 JobManager 的说法表达的。三个 handler 声明 `recovery: 'retry'`，Knowledge 再用 `abandon` 覆盖。重启后没有哪个使用方能用上结果：Knowledge 在内存里等，翻译页把 job id 存在组件状态里。启动时重跑一个 `background` 转换，只会让云端处理器白白再扣一次费。

目标（#22987）：依赖 FileProcessing 的服务看不到 JobManager，除非这个服务自己还用 JobManager 做文件处理以外的工作。

## 提议

- **任务模型。** 定义在 `src/shared/data/types/fileProcessing.ts`：
  - `FileProcessingTaskId`，branded 字符串；
  - `FileProcessingTaskStatus`：`queued`、`processing`、`completed`、`failed`、`cancelled`；
  - `FileProcessingTask`：`id`、`feature`、`processorId`、`status`，处理中时有 `progress`，完成时有 `artifact`，失败时有 `error`（一条消息）。

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

  `completed`、`failed` 和 `cancelled` 都是终态，所以 `done` 只 resolve 一次，`onDidChangeTask` 也只报告一次终态。重试就开一个新任务。JobManager 对失败尝试的重试留在任务内部，等待期间读作 `queued`，不过三种 job 类型目前都只允许一次尝试。
- **`FileProcessingService` 的主进程 API。** 取代 `startJob`：
  - `startTask(input)` resolve 为 `{ task, done }`。`task` 是刚入队时的任务，`done` resolve 为它的终态 `FileProcessingTask`。
  - `getTask(id)` 和 `cancelTask(id)`。
  - `onDidChangeTask: Event<FileProcessingTask>`：任何任务的每次状态变化和每次进度上报都会触发。它挂在服务上而不是句柄上，所以只拿着 id 的使用方也能跟踪任务。
- **实现仍然用 JobManager，但藏在边界后面。**
  - 任务 id 在内部就是 job id，使用方不依赖这一点。
  - `getTask` 转换 job 行：`pending` 和 `delayed` 读作 `queued`，`running` 读作 `processing`。
  - 变化由 FileProcessing 自己的代码发出：`startTask` 发出 `queued`；handler 在 `execute` 开始时和每次上报进度时发出 `processing`；handler 的 `onSettled` 发出终态。每次变化都会触发 `onDidChangeTask`，并写入共享缓存 key `file_processing.task.${taskId}`。
  - 不新增任何持久化，JobManager 也不用改。
- **渲染进程。**
  - IPC `file_processing.start_task` 返回 `FileProcessingTask`，`file_processing.get_task` 读取一个任务。
  - `useFileProcessingTask(id)` 读缓存 key，缓存条目过期后退回 `get_task`。
  - 翻译页改用它们，不再用 `useJob`。
- **重启：这一期所有任务都不跨重启，但保留续跑的能力。**
  - 三种 job 类型都声明 `recovery: 'abandon'`，启动时取消上次启动留下的任务，不续跑也不重跑。`startTask` 不再接受重启相关的选项。
  - `remote-poll` 仍然把服务商的任务 id 记进 job 的 metadata。拿到记录的 id 时，它仍然轮询那个远端任务，而不是重新提交。以后有了持久的使用方（#22706 的 Problem B），不用重建就能重新打开续跑。
- **Knowledge。** 做文件处理时只用这套 API：
  - 等待 `done`，从 `onDidChangeTask` 取进度，通过 `cancelTask` 取消，结果检查改读 `getTask`。
  - 去掉 job 类型列表和传进去的 `parentId`。结果检查 job 不再把转换的 id 当作父 job，所以直接添加时，由检查 job 自己的 id 来限定索引的 idempotency key。
- **导出。** `getFileProcessingFailureMessage`、`getFileProcessingMarkdownArtifactPath`，以及其他所有接收 `JobSnapshot` 的导出，要么删掉，要么改成接收 `FileProcessingTask`。

不在范围内：

- Knowledge 条目的 `queued` 状态（#20167），在这次改动之后做。
- 跨重启的任务，以及持久化的 Knowledge 等待（#22706）。
- #22761 要的服务商侧状态。
- 删除 JobManager 的单个 job `recovery` 覆盖和 `job.recovery` 列。它们在这里失去了唯一的调用方（#22706）。
- 修正 `useJob` 的注释。

## 考虑过的替代方案

- **JobManager 认领 job 时发布 `running`，使用方继续读 `jobs.state.*`。** 这样能看出转换何时开始，但所有使用方都还停留在 JobManager 的词汇上，达不到目标。
- **FileProcessing 自己建一张任务表。** 和 job 行重复。这一期没有跨重启的任务，表里没有什么是 job 行里没有的。
- **现在就做跨重启的任务：保留 `retry`，提供 `survivesRestart` 选项。** 重启后没有使用方能读结果。续跑只会让 `background` 处理器再扣一次费，或者轮询一个结果没人读的远端任务。
- **既然这一期没人用续跑，就把它删掉。** 以后为持久的使用方重建，比现在保留并测着它代价更大。
- **用同一个 id 重试失败或已取消的任务。** 没有使用方需要：Knowledge 重新索引、翻译页重新 OCR，都是从头开始。`done` 和终态事件会触发不止一次，任务还需要一份落库的"任务对应哪些 job"的映射。以后可以给 `startTask` 加一个 `retryOf` 选项，让重试复用原任务的远端状态，比如本地超时后远端仍在排队的任务（#22761）。这只会在这套 API 上新增内容。
- **只在句柄上提供变化通知。** 只拿着 id 回来的使用方跟踪不了任务。以后持久的使用方在重启后就是这种情况。

## 验收标准

- AC1 — 通过 `startTask` 启动的任务，在转换开始前读作 `queued`，然后是带进度的 `processing`，最后是带类型明确产物的 `completed`、带消息的 `failed` 或 `cancelled`，每次变化都由 `onDidChangeTask` 报告。进入终态的任务不会再变化。(verification: unit)
- AC2 — 渲染进程通过 IPC 启动任务，并一直跟踪到终态，不用 `useJob`、`/jobs/:id` 或任何 `jobs.*` 缓存 key，实时缓存条目过期后也能跟踪。(verification: unit + renderer)
- AC3 — FileProcessing 的公开 API、IPC schema 和共享类型不暴露任何 JobManager 的类型、状态、入队选项或缓存 key。Knowledge 的文件处理代码和翻译页只通过 FileProcessing 使用文件处理，FileProcessing 之外没有代码提到它的 job 类型。(verification: typecheck + code search)
- AC4 — Knowledge 在新 API 上行为不变：任务完成后转换好的文件会被索引；任务失败或被取消时，条目带着原因失败；条目显示任务的进度；删除或替换条目、删除它所在的知识库时，会取消任务。(verification: unit)
- AC5 — 启动时，上次启动留下的未结束任务对所有处理器都会被取消，没有任何任务被续跑、重跑或重新提交。(verification: unit)
- AC6 — `remote-poll` 转换会记录服务商的任务 id；运行时发现已有记录的 id，就轮询那个远端任务，而不是重新提交。(verification: unit)

## 风险

- 翻译页在重启时的行为会变。被退出打断的 OCR 会在下次启动时被取消；以前它会再跑一遍，但结果没人读。
- Knowledge 发起的云端转换在重启时仍然会被丢掉，#22662 之后一直如此。在出现持久的使用方之前都会这样。
- 续跑路径不再在生产环境里运行，只靠 AC6 的测试保证它能用。
- 上一版本写下的行会在各自 handler 注册时被取消：文件处理的行是因为它们的类型现在都 abandon，Knowledge 结果检查的行是因为本来就 abandon。所以两者中被改名的 payload 字段都不会被旧行读到。
