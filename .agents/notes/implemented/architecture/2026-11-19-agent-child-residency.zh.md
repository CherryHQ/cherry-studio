# Agent Note: 由宿主管理的子线程驻留

Status: implemented

[English](2026-11-19-agent-child-residency.md) | 中文

## Problem

此前，打开一个智能体会话时，Main 会挂载每个已绑定的子线程。Claude Code 的 `restoreChildren` 逐个打开已保存的子线程；Pi 和 Pi Durable 打开根快照里列出的全部子线程。每次挂载都会把完整的原生归档读进一个 `ChildThreadProjection`，并一直保留到根连接关闭。只有 Pi Durable 会释放已结束的子线程，而且只在当前进程内有效。

在 Electron 复现中（17 个 Claude Code 子智能体，每个读取 40 张图片），全部子线程结束后 Main 堆仍停在约 974 MB。重新打开这个空闲会话、不做任何新工作，堆也会从 94 MB 涨到 877 MB。同一负载放大后，Main 在约四分钟时因 V8 内存不足崩溃。

[运行时契约](../../proposed/architecture/2026-10-17-agent-runtime-contract.md)（「协调访问，但不拥有执行」）把驻留留给宿主决定。但宿主里有三份子线程挂载状态机，其中只有一份会释放。

## Decision

- `src/main/ai/agentSession/ChildResidency.ts` 统一负责 Claude Code、Pi 和 Pi Durable 连接的子线程挂载，包括：opening、attached、releasing、failed 四种状态（每个子线程由一个串行 reconciler 推进，见[子线程历史修订号](2026-11-20-agent-child-history-revision.md)），合并并发打开，查看者和命令的 pin，在释放与重开之间保持不变的视图，drain（也会等待排队中的恢复、进行中的打开和释放 flush）以及 close。
- 连接把观察到的每条 `Subagent` 关系交给 `ChildResidency.relate`。子线程最新的关系报告 `work: 'idle'` 时即为已结束（[子智能体工作状态](2026-11-19-agent-subagent-work-state.md)）。对没有被查看者、命令或已加载的嵌套子线程 pin 住的已结束子线程，residency 会 flush、释放并记录下来。
- 释放时，在最后一次 flush 之后通过 `AgentSessionContextService.settleChild` 往子线程的 context 行写入 `checkpointMapping.child.settled`，前提是 flush 之后子线程仍然空闲，同时记录该次 flush 读取的修订号（`settledRevision`）。关系报告更新的修订号时，已释放的子线程会重新加载。已释放的子线程若被关系报告重新工作，会失去该标记和已释放记录，因此即使重新打开失败，下一次空闲关系也会恢复它。关闭时，为它停止的已结束子线程同样写入该标记。重新挂载一个已 settle 的子线程时清除标记。
- 重新打开时，整棵子树都已 settle 的后代先通过 `restoreReleased` 记为已释放；已 settle 但有未 settle 后代的子线程会被恢复，因为那个后代的关系由它的观察带出。关系重放会让已释放的子线程保持释放，并一次一个地恢复未 settle 的空闲子线程，每个子线程连同它引发的父线程释放都 flush 并释放后，才恢复下一个。已释放的子线程会在以下情况重新加载：查看者调用 `childProjection`、命令调用 `messageChild`、Pi 子线程完成或用量归属，以及关系报告它正在运行。
- 不需要 schema 迁移：`checkpointMapping` 是 JSON 列，`saveProjectionTx` 会把子线程的写入合并进已有的子线程 checkpoint。

## Alternatives considered

- **在各运行时 adapter 内部驱逐。** 契约规定每个运行时只有一个原生 owner，未经原生验证不做单线程驱逐。重复的投影在 Main 里，所以由宿主负责这项策略。
- **保留立即恢复，挂载后马上释放。** 重新打开时仍会在峰值一次性加载全部归档，而且每次重开都要重复完整读取。
- **根据已保存的产品消息行推断是否结束。** 崩溃后消息行可能看起来已完整，而原生归档里还有更多内容。标记只会在已结束子线程真正 flush 之后写入。
- **所有运行时都只看 activity。** Pi 的后台子线程在请求进行中会报告 idle，Claude 在 `task_started` 之前会报告 unknown，两者都会把仍在运行的子线程释放掉。

## Consequences

- 父线程恢复一个已释放的子线程时（例如 Claude 的 `SendMessage`），关系会报告它正在运行，宿主无需查看者即可观察它。子线程打开时，已保存的消息行会从归档对齐。父线程已释放、且在父线程没有运行时恢复的嵌套子线程，仍然只有在查看者或命令打开它时才会被观察；Pi Durable 例外，它会通告给最近的已加载祖先。
- 本次改动之前保存的会话里，子线程没有标记。三个运行时都会把它们恢复一次并 settle。
- 重新打开时不再为已 settle 的子线程发布后台任务事件，因为它们不会被挂载。
- 子线程释放后原生 owner 再交付的内容，会留在原生归档里，直到子线程再次被打开。
- 原生 Claude owner 仍会持有每个子线程解析后的记录，直到根连接关闭；它读取根归档时也会解析所有子线程。复现中，实时运行结束后这部分约有 276 MB 图片，settle 后重开约 122 MB。要在那一层按线程驱逐，需要运行时契约暂缓的原生契约。

## Verification

- AC1 — `pnpm typecheck:node` 通过；`pnpm test:main` 运行覆盖三个连接、`ChildThreadProjection` 和 `AgentSessionContextService` 的 23 个测试文件，全部通过（699 个测试，2 个跳过）；每个连接现在只通过 `ChildResidency` 完成子线程的挂载、pin、释放、drain 和关闭。
- AC2 — `PiDurableRuntimeConnection.test.ts`「releases a background child after its run ends and keeps its final answer」、`PiRuntimeConnection.test.ts`「releases a finished child, leaves it unloaded on reopen, and reloads it for a message」和 `desktopRuntime.integration.test.ts`「reopens a settled nested child on demand under its immediate parent after an attachment failure」都在根连接保持打开时等到 settled 标记，并从已保存的消息行读到最终回答。
- AC3 — `PiDurableRuntimeConnection.test.ts`「leaves a settled child unloaded on reopen until a viewer asks for it」以及上述 Pi、Claude 测试记录重开前后的 `ChildThreadProjection.attach` 调用：查看或发消息之前一次都没有，重新加载后得到已保存的历史；Claude 测试让第一次惰性挂载失败，重试后 context 行仍只有一条。
- AC4 — `PiRuntimeConnection.test.ts`「stops a running background child without cancelling a later parent turn」：请求进行中的后台子线程保持加载，`stopTask` 能停止它；改用任务状态规则之前，基于 activity 的 Pi 判断会让这个测试失败。
- AC5 — 在独立 profile 的 Electron 开发实例中：17 个 Claude Code 子智能体各读取 40 张图片并全部结束后，17 个 context 全部 settle，堆快照里 `ChildThreadProjection` 为 0，Main GC 后堆为 515 MB（此前 974 MB）；一个改动前保存的 40 子线程会话在第一次重开时完成 settle，下一次冷启动重开时 `ChildThreadProjection` 为 0、堆为 240 MB（此前 877 MB），剩余图片副本全部归 `ClaudeProjection.messages` 或 `ClaudeFeed.native` 所有。
