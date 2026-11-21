# Agent Note: 在后台归档 Agent Session 的系统 workspace

Status: implemented

[English](2026-11-13-background-system-workspace-archive.md) | 中文

## Problem

归档 Agent Session 时，请求要等系统 workspace 压缩完成才会返回。调用链是 `deleteSessionsInternal → finishDeletion → await archiveSystemWorkspaces`，而 `archiveSystemWorkspaces` 会按顺序、逐个 await `agentWorkspaceStorageService.archiveWorkspace`（`src/main/ai/agents/AgentLifecycleService.ts:391-411`、`:506-514`、`:547-575`）。

业务状态在这段等待开始前已经提交。即便如此，列表更新和撤销入口仍要等每个 `tar.gz` 打包完成。workspace 较大、文件较多或批量归档时，等待会很长。Issue #21645 跟踪的就是这个问题。

## Decision

把归档拆成前台提交和后台转换两部分。

- **前台。** 保留现有的运行中 session 检查。运行时关闭仍在前台，并保持现有顺序：先取消 fork，再关闭 runtime，然后恢复 fork。业务归档提交后请求即返回，列表和撤销入口无需等待压缩。
- **同一事务内的持久化任务。** 业务归档状态和每个被归档系统 workspace 的一条 `archive-system-workspace` JobManager 任务，通过 `JobManager.enqueueTx` 在同一个 SQLite 事务中提交。回滚时两者一起丢弃。提交后崩溃的任务，在重启后继续执行。
- **后台处理器。** 处理器获取现有的 per-workspace 存储互斥锁，重新读取 workspace 的业务状态，只有该 workspace 仍处于归档状态时才调用 `AgentWorkspaceStorageService.archiveWorkspace`。压缩、恢复记录和路径处理仍由 `AgentWorkspaceStorageService` 负责，处理器不重复实现。
- **撤销。** 恢复 workspace 会取消它排队中的归档任务。如果归档已在进行，恢复会等待同一把存储互斥锁。只有存储操作结束后，workspace 才变为可运行，因此过期任务无法再次归档已恢复的 workspace。
- **失败。** 运行时关闭或压缩失败时保留 workspace 目录、记录错误，并允许任务重试。归档待完成或失败的 workspace 不会接受指向正在转换目录的写入。
- **并发与关闭。** 批量归档受 JobManager 并发上限约束。应用关闭和备份协调会等待或排空进行中的归档任务。
- **范围。** 只压缩系统 workspace。用户 workspace 目录保持不变。原生 JSONL 路径和各 harness 的 resume 身份保持不变。永久删除后的原生日志清理仍由现有的 orphan sweep 负责。

## Alternatives considered

- **保留 await。** 拒绝。响应时间仍随 workspace 规模增长，撤销入口也仍然延迟。
- **不建任务，直接 `void archiveWorkspace()`。** 拒绝。提交后崩溃会丢失压缩，重启、撤销、清理和关闭都无法协调。
- **JobManager 之外另建归档队列。** 拒绝。这会引入第二套持久化与重试机制。JobManager 已提供 `enqueueTx`、重试和重启恢复。
- **像 Codex 那样用 rename 移动原生 JSONL。** 拒绝。Cherry Studio 的原生日志由各 harness 持有，并保留各自的 resume 路径。这里的压缩是打包系统 workspace，所有权和操作都不同。
- **把运行时关闭也放进后台任务。** 本 Spec 拒绝。关闭 runtime 会在打包前释放文件 writer。若放入任务，前台提交就要依赖一个可能仍打开的 writer，因此关闭保留在前台。

## Consequences

- `enqueueTx` 在事务之后执行提交后的副作用；副作用失败不会回滚业务归档。原子性测试覆盖回滚方向，入队路径有独立的失败覆盖。
- 撤销竞态横跨任务队列和存储预留；AC3 测试覆盖全部三种压缩状态（排队、进行中、已完成）。
- 退出时若有大型归档仍在进行，JobManager 的排空会让关闭变慢。
- 对归档仍在进行的 workspace 写入现在以错误失败，而不是损坏数据。目录转换期间 UI 不能把 session 显示为可用。

## Verification

- AC1 — 系统 workspace 的压缩被人为挂起时，归档请求仍能返回，列表和撤销入口在压缩结束前已反映已提交的归档。 验证证据：`AgentLifecycleService.workspace.test.ts` 用例 "archives only system files and restores them before making the session active"：`archiveSessions` 返回时目录仍完好、业务 `deletedAt` 已提交，且恰好只有一个 `agent.archive-system-workspace` 任务为系统 workspace 入队；目录仅在排队任务运行后才被打包。用例 "blocks overlapping registration throughout archive shutdown and releases the reservation afterward" 表明请求先于任务的 quiesce 持有存储预留而返回。
- AC2 — 业务归档状态与归档任务入队要么一起提交，要么一起回滚；提交后持久化的任务在重启后仍会完成。 验证证据：`AgentLifecycleService.workspace.test.ts` 用例 "rolls the business archive and the job row back together" 与 "persists the business archive and the job row together on commit"：生命周期层通过调用方的回收事务写入真实的 job 行，回滚会同时撤销回收状态与 job 行，提交则同时持久化两者。handler 声明 `recovery: 'retry'`，提交时持久化的任务由 JobManager 启动恢复重放（由 JobManager 自身测试覆盖）。
- AC3 — 对处于排队、进行中或已完成压缩状态的归档执行撤销后，workspace 保持可运行，过期的排队归档任务不会再次归档它。 验证证据：`AgentLifecycleService.workspace.test.ts` 用例 "cancels a queued archive task when the archive is undone"（排队：激活前调用 `JobManager.cancel`，过期重放跳过已恢复的 workspace）与 "waits for an in-flight archive task when the archive is undone"（进行中：恢复等待任务结束而不是中止打包）；压缩完成状态由既有的恢复用例覆盖（现在会先运行排队任务）。`agentArchiveWorkspaceJobHandler.test.ts` 用例 "skips a workspace restored after the task was queued" 覆盖 handler 的业务状态重读。
- AC4 — 运行时关闭失败或压缩失败时，workspace 目录保留，错误被记录，且允许重试；没有 writer 会继续写入正在转换的目录。 验证证据：`AgentLifecycleService.workspace.test.ts` 用例 "keeps the directory if runtime shutdown fails"（目录保留、错误记录、任务保持排队可重试）以及 "releases the storage reservation when strict runtime shutdown fails" 和 "sweep preserves pending restore intent..."（打包失败通过任务浮现并保留待处理记录供 sweep 重试）；`agentArchiveWorkspaceJobHandler.test.ts` 用例 "propagates a compression failure so the task retries" 且 `defaultRetryPolicy.maxAttempts` > 1。
- AC5 — 重启恢复、任务重复执行、归档后的永久删除，以及 orphan sweep 与归档任务交错执行时，既不丢失恢复源，也不会误激活 session。 验证证据：`agentArchiveWorkspaceJobHandler.test.ts` 用例 "skips when the workspace row is gone, e.g. permanently deleted"（重复执行或清除后执行）与恢复声明用例；`AgentLifecycleService.workspace.test.ts` 中既有的 orphan sweep 用例（purge/retention、保留已声明归档、恢复意图保留）在新任务流程下原样通过。
- AC6 — 批量归档遵守并发上限；归档与恢复之后，用户目录和原生 JSONL 路径保持不变。 验证证据：`agentArchiveWorkspaceJobHandler.test.ts` 用例 "declares restart recovery, a shared queue and a batch concurrency cap"（`defaultConcurrency: 2`，单一共享队列）；回收清扫将待打包任务路由到该队列而非内联打包（`AgentLifecycleService.workspace.test.ts` 用例 "routes sweep packs through the archive queue instead of packing inline"），且 handler 把瞬时的存储预留冲突视为可重试失败而非已完成的打包；"archives only system files..." 断言用户 workspace 目录从不被打包，且只有系统 workspace 会入队（root session 关联 `AGENT_WORKSPACE_TYPE.SYSTEM`），因此用户目录与原生 JSONL 路径不受影响。
