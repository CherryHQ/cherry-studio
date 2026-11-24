# Agent Note: 子线程历史修订号与串行子线程驻留

Status: implemented

[English](2026-11-20-agent-child-history-revision.md) | 中文

## Problem

[子线程驻留](2026-11-19-agent-child-residency.md)在最后一次 flush 之后，若子线程的[工作状态](2026-11-19-agent-subagent-work-state.md)读为 `idle`，就把已释放的子线程标记为 settled。这次采样是边沿触发的，而且会丢失信息：

- flush 或原生句柄释放仍在进行时，工作恢复后又结束，会让标记留在缺少新历史的行上。
- Pi 或 Pi Durable 的 feed 溢出可能把两个 `idle` 快照之间的 `running` 合并掉，host 因此再也看不到子线程重新工作。
- 冷重开时直接信任该标记，不与原生历史做任何核对。

驻留还会并发执行每个子线程的操作：关系、打开、释放、恢复、pin、命令和释放重试。它们靠每次 await 之后重新检查条目状态来协调。每轮评审都会找到新的交错，例如恢复与父线程释放竞争、工作恢复后仍被 settle、打开与冗余句柄释放竞争，以及并发的释放重试。继续加检查只会保留同样的结构，也就保留了同一类竞争。

## Decision

- `packages/agent-runtime/src/contracts.ts` 中的 `Subagent.revision?: number` 随子线程已提交的原生历史增长。之后对该子线程的归档读取报告的修订号，不小于此前关系携带的修订号。owner 只要能在不加载子线程的情况下读到修订号，就在关系上带上它；每次子线程归档读取都报告它覆盖的修订号（Main 中的 `CommittedHistory.revision`）。
- **Claude Code：**owner 最近一次归档读取时记录每个子线程原始 transcript 的条目数。若子线程的 projection 在那次读取之后收到实时帧（`ClaudeProjection.liveSinceRead`），在下一次读取之前，它在关系上和不刷新的归档读取上都不报告修订号。
- **Pi：**子会话分支的长度。`onWork` 在已加载子线程每次工作状态变化时发布它，子线程打开时也会在其关系上发布它。根线程重开时重放的关系不带修订号。
- **Pi Durable：**子会话的 `latestEntryId`，即归档读取已经使用的 head。读取关系（`readChildState`）、工作状态变化（`publishWork`）以及关闭时的归档缓存都会报告它。
- `ChildResidency` 为每个子线程保留一条记录：期望状态（工作证据、pin、如何打开它、已授予的句柄）和实际状态（阶段、已加载的资源、已保存的行）。每条记录有一个 `createLatestReconciler`。`relate`、`pin`、`command` 和 `open` 只修改期望状态并请求一轮 reconcile。只有 reconciler 会加载、释放，或重试失败的释放，每轮一步，并且每一步都按当时的状态决定。
- 释放时先 flush；若子线程仍然空闲，再写入 `settled` 和 `settledRevision`（最后一次 flush 读取的修订号，`ChildThreadProjection.revision`）。已释放的子线程在以下任一情况重新加载：关系报告的工作状态不是 `idle`，或在两边修订号都已知时，关系报告的修订号比已保存的新。未见过或已过时的空闲子线程逐个恢复；每次恢复都会等待被恢复子线程的释放，以及该释放引发的父线程释放。

## Alternatives considered

- **在每次 await 之后继续重新检查状态。**每轮评审都会找到新的交错；每个子线程只有一个写入者，才能消除这一类问题。
- **只比较归档读取得到的修订号。**冷重开时就必须加载每个子线程才能比较，而这正是子线程驻留要省掉的开销。
- **使用 Pi Durable 的提交序号（`Seq`）。**把条目对应到它的提交，每次读取都要额外查询一次。归档已经读取最新的条目 ID，用条目 ID 就能达到同样目的。
- **把 Claude 实时帧的数量当作修订号。**实时帧与 transcript 条目并非一一对应，计数会偏离归档读取报告的值，下一次重放就会重新加载所有子线程。

## Consequences

- 被恢复的子线程，以及关系带有修订号的子线程，会按准确的修订号 settle。它们之后新增的历史只凭关系就能发现，包括被丢失的 `running` 事件掩盖的历史。
- 实时运行过的 Claude Code 子线程 settle 时不带修订号，根线程重开时的 Pi 子线程也不报告修订号，二者仍然只依赖工作状态。如果子线程提交了恢复后的工作，而 host 还没来得及清除标记时发生崩溃，过时的行会一直保留到子线程被打开。
- Pi 和 Pi Durable 仍然只在工作状态变化时发布关系变化；修订号随这些变化一起发布。
- Pi Durable 在每次子线程工作状态变化时都要读取最新条目 ID。
- 调用 `open` 时传入的冗余已授予句柄，会在子线程待完成的步骤结束之后才释放，而不是之前。

## Verification

- AC1 — `pnpm test:agent-runtime-claude-code`、`pnpm test:agent-runtime-pi` 和 `pnpm test:agent-runtime-pi-durable` 通过。Claude 测试 "continues the same child with a new native run" 检查重放关系的修订号等于子线程归档读取的修订号。Pi 测试 "continues an observed child through its owner, keeps one relationship, and reports the new run once" 和 "restores child relations on reopen and refuses a child without its live owner" 检查已加载子线程报告的修订号会随续跑增长，并被其归档覆盖。Durable 测试 "discovers native forks and archives only child-owned output independently of the parent" 检查续跑之后的重放报告更大的修订号，且子线程归档覆盖它。
- AC2 — `ChildResidency.test.ts` "reloads a released child when a relationship reports a newer revision than its final flush read"：修订号相等时子线程保持释放，更新的修订号会让它重新加载并保存新修订号。
- AC3 — `ChildResidency.test.ts` "restores a settled child on reopen only when its native revision is newer than the saved one"。
- AC4 — Claude 测试 "continues the same child with a new native run" 检查实时续跑之后，关系和不刷新的归档读取都不报告修订号，下一次刷新则报告更大的修订号。
- AC5 — 此前 15 个 `ChildResidency.test.ts` 竞争测试在 reconciler 上通过。"returns the current child when it releases while a redundant handle closes" 现在会等待冗余句柄开始释放，因为该释放发生在子线程待完成的步骤之后。`pnpm typecheck:node` 通过，`pnpm test:main` 覆盖连接、projection 和 context service 的 24 个测试文件全部通过（719 个测试，2 个跳过）。
