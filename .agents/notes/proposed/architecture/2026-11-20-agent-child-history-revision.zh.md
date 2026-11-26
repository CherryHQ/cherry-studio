# Agent Note: 子线程历史修订号与串行子线程驻留

Status: proposed

[English](2026-11-20-agent-child-history-revision.md) | 中文

## Problem

[子线程驻留](2026-11-19-agent-child-residency.md)在最后一次 flush 之后，若子线程的[工作状态](2026-11-19-agent-subagent-work-state.md)读为 `idle`，就把已释放的子线程标记为 settled。这次采样是边沿触发的，而且会丢失信息：

- flush 或原生句柄释放仍在进行时，工作恢复后又结束，会让标记留在缺少新历史的行上。
- Pi 或 Pi Durable 的 feed 溢出可能把两个 `idle` 快照之间的 `running` 合并掉，host 因此再也看不到子线程重新工作。
- 冷重开时直接信任该标记，不与原生历史做任何核对。

驻留还会并发执行每个子线程的操作：关系、打开、释放、恢复、pin、命令和释放重试。它们靠每次 await 之后重新检查条目状态来协调。每轮评审都会找到新的交错，例如恢复与父线程释放竞争、工作恢复后仍被 settle、打开与冗余句柄释放竞争，以及并发的释放重试。继续加检查只会保留同样的结构，也就保留了同一类竞争。

## Proposal

### 契约

`packages/agent-runtime/src/contracts.ts` 中的 `Subagent` 增加可选的修订号：

```ts
export interface Subagent {
  // id, parent, child, origin, work as before
  /** A count that grows with the child's committed native history. */
  readonly revision?: number
}
```

- 之后对该子线程的归档读取报告的修订号，不小于此前关系携带的修订号，因此重新加载不会循环。
- owner 只要能在不加载子线程的情况下读到修订号，就在关系上带上它。每次子线程归档读取都报告它覆盖的修订号。

各适配器的证据：

- **Claude Code：**owner 最近一次归档读取时子线程原始 transcript 的条目数；transcript 只会追加。在那次读取之后收到实时帧的子线程，直到下一次读取前都不报告修订号，因为实时 SDK 帧与 transcript 条目并非一一对应。
- **Pi：**子会话分支的长度；子线程的分支只会增长。已加载的子线程在每次工作状态变化时报告它。根线程重开时重放的关系不带修订号，因为这些子线程没有加载。
- **Pi Durable：**子会话可见的最新条目 ID（`latestEntryId`，即归档已经读取的 head）；条目 ID 只会增长。每次读取关系和每次工作状态变化都会报告它。

### Host

- settled 标记记录 `checkpointMapping.child.settledRevision`：最后一次 flush 时归档读取的修订号。
- 已释放的子线程在以下任一情况重新加载：关系报告的工作状态不是 `idle`，或在两边修订号都已知时，关系报告的修订号比 `settledRevision` 新。修订号相等或未知时保持释放。重新加载的子线程会 flush，并按新的修订号 settle。
- 每个子线程有一个串行 reconciler（`createLatestReconciler`）。关系、pin、命令和打开只更新子线程的期望状态（工作证据、pin，以及如何打开它），然后请求一轮 reconcile。只有 reconciler 会打开、释放，以及重试失败的释放，一次一步，并且每一步都按当时的状态决定。
- 未见过或已过时的空闲子线程仍然逐个恢复。每次恢复都会等待被恢复子线程的释放，以及该释放引发的父线程释放。

## Alternatives considered

- **在每次 await 之后继续重新检查状态。**每轮评审都会找到新的交错；每个子线程只有一个写入者，才能消除这一类问题。
- **只比较归档读取得到的修订号。**冷重开时就必须加载每个子线程才能比较，而这正是子线程驻留要省掉的开销。
- **使用 Pi Durable 的提交序号（`Seq`）。**把条目对应到它的提交，每次读取都要额外查询一次。归档已经读取最新的条目 ID，用条目 ID 就能达到同样目的。
- **把 Claude 实时帧的数量当作修订号。**实时帧与 transcript 条目并非一一对应，计数会偏离归档读取报告的值，下一次重放就会重新加载所有子线程。

## Acceptance criteria

- AC1 — Claude Code、Pi 和 Pi Durable 的子线程归档读取报告修订号；owner 能在不加载子线程的情况下读到修订号时，关系会带上它（verification: unit）
- AC2 — 关系报告的修订号比已保存行新的已释放子线程会重新加载，并按该修订号 settle；修订号相等时保持释放（verification: unit）
- AC3 — 冷重开时，已 settle 的子线程保持未加载，除非其原生修订号比保存的新（verification: unit）
- AC4 — 在最近一次归档读取之后收到实时帧的 Claude Code 子线程不报告修订号，因此在实时运行后 settle 的子线程不会被之后的归档重放恢复（verification: unit）
- AC5 — 每个子线程的打开、释放和释放重试都经由它的 reconciler 一次一个地执行，此前评审得出的驻留竞争测试仍然通过（verification: unit）

## Risks

- 如果 owner 在关系上报告的修订号高于它自己的归档读取，每次重放该关系都会重新加载子线程。
- 实时运行过的 Claude Code 子线程，以及根线程重开时的 Pi 子线程，仍然只依赖工作状态。如果子线程提交了恢复后的工作，而 host 还没来得及清除标记时发生崩溃，过时的行会一直保留到子线程被打开。
- Pi Durable 在每次子线程工作状态变化时都要读取最新条目 ID。
