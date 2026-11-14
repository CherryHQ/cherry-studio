# Agent Note: 文件处理任务结束后再检查结果，不再轮询

Status: proposed

[English](2026-10-25-knowledge-file-processing-completion-callback.md) | 中文

已被 [FileProcessing 任务模型](../../implemented/architecture/2026-10-29-file-processing-task-model.md) 部分取代：条目现在等待任务的 `done` 而不是 `JobHandle`，从 `onDidChangeTask` 取进度而不是每 5 秒轮询一次，并通过 `cancelTask` 取消。

## 问题

需要转换的文件通过 `knowledge.check-file-processing-result` 等待它的 FileProcessing 任务：这个任务每 5 秒排一次下一轮，直到 FileProcessing 任务结束。每一轮都是一行新的任务记录，而这条链还兼做三件事：

- 进度：每一轮把 FileProcessing 任务的进度复制到 `knowledge.item.file_processing_progress.${itemId}`。条目上的百分比最多滞后 5 秒，数值没变也会重新广播。
- 取消：删除、替换和删除知识库时，通过进行中的检查任务行找到要取消的 FileProcessing 任务（`getLinkedFileProcessingJobIds`）。
- 重建索引失败的处理：`reindex-subtree` 失败时，把检查任务行当作进行中的后续任务，不会把对应的根条目标成失败。

#22089 去掉 20 个文件的上限之后，一批文件可能要在一次只处理一个文件的本地处理器后面排更久。[#22636](https://github.com/CherryHQ/cherry-studio/pull/22636) 让排队时间不再计入 30 分钟上限，但任务行仍随排队时间增长：150 个文件排队一小时，会留下约 108,000 行，要等 7 天的 GC 才清掉。轮询链最初是因为检查任务在重启后会恢复执行（`recovery: 'retry'`，#15470）。#16296 把它改成了 `abandon`，所以这条链在重启后也不会保留。

## 提议

- `FileProcessingService.startJob` 改为返回 `JobHandle`，不再只返回快照。IPC 路由仍然返回快照。
- `scheduleItem` 把条目登记到 `FileProcessingWaitManager`（由 `KnowledgeService` 持有），并等待 `handle.finished`。任务结束时，删除登记项，再排一次 `check-file-processing-result`，不延迟，也没有 `pollRound`。这个任务照旧校验结果并排入索引。
- `KnowledgeService` 上的一个 `registerInterval` 每 5 秒把每个等待中任务的进度复制到条目的 key，只写入变化了的值。删除登记项时清掉这个 key，所以它不再需要 TTL。
- `cancelActiveKnowledgeJobs` 同时取消被移除条目在等待的 FileProcessing 任务。它在知识库任务的取消都结束之后才读取登记表。`reindex-subtree` 失败时，不会把仍在等待的根条目标成失败。
- 去掉知识库这边的 30 分钟上限。正在运行的任务由 FileProcessing 处理器自己的超时约束（后台任务 15 分钟，远程轮询 30 分钟）。

不在本次范围内：在界面上区分排队中和处理中的文件；重启后保留转换任务已完成的工作，而不是取消它。

## 考虑过的替代方案

- 让渲染进程订阅 `jobs.progress.${jobId}`。已否决：知识库条目不能绕过知识库服务直接接触 JobManager 的任务，而且每个条目都要多一个订阅。
- 保留一行持久化的占位检查任务，再给 JobManager 加一个立即执行延迟任务的 API。删除和重建索引可以继续沿用这行记录，但这是为一种等待新增核心 API，而这种等待和 `finished` 一样，重启后本来就结束了。
- 列出进行中的 FileProcessing 任务，按 `context.dataId` 匹配要取消的任务。这种做法重启后仍然有效，但每次删除都要多一次查询，进度定时器仍然需要内存里的映射表。

## 验收标准

- AC1 — 需要转换的文件只会得到一个 `check-file-processing-result` 任务，在它的 FileProcessing 任务结束后才排入，等待期间一个都没有。(verification: unit)
- AC2 — 条目等待期间，它的行显示 FileProcessing 任务的最新进度，数值变化时才广播；任务结束后百分比消失。(verification: unit)
- AC3 — 删除条目、替换条目或删除它所在的知识库时，会取消它在等待的 FileProcessing 任务，包括提交后才被取消的复制任务启动的那个。(verification: unit)
- AC4 — `reindex-subtree` 失败时，不会把仍在等待文件处理的根条目标成失败。(verification: unit)

## 风险

- 等待关系只存在内存里。重启后条目交给启动恢复标成失败。下面一层以 `recovery: 'abandon'` 启动 FileProcessing 任务，所以启动恢复会取消它，而不是在没人等待的情况下恢复执行。那一层的迁移也给升级前知识库已经启动的转换加上了同样的设置。
- 如果 FileProcessing 任务结束后检查任务排不进去，只会记录错误，条目会停在 `processing`，直到下次启动恢复把它标成失败。
