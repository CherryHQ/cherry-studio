# Agent Note: 运行时契约中的子智能体工作状态

Status: proposed

[English](2026-11-19-agent-subagent-work-state.md) | 中文

## Problem

[子线程驻留](2026-11-19-agent-child-residency.md)会在子线程的原生工作结束后释放它，并且在父线程恢复已释放的子线程时需要重新加载它。但[运行时契约](2026-10-17-agent-runtime-contract.md)没有给 Main 提供表达这两点的通用事实：`Activity` 只描述线程的前台循环，`Subagent` 关系不带任何状态。没有这样的事实，Main 只能按运行时分别判断「已结束」，各自依赖运行时专有的通道：

- Pi Durable：通过 `handle.durable.facts()` 读取原生 facts，再加上输入结果。
- Pi：Main 根据 Pi behavior 事件构建的子任务状态，再加上输入结果。后台请求仍在进行时，Pi 子线程的 activity 也可能显示为 idle。
- Claude Code：任务 activity；它在 `task_started` 之前、以及对只从归档中得知的子线程，都显示为 `unknown`。

Claude 的 owner 每次读取归档还会重放所有关系。关系不带状态时，Main 无法区分重放和重新开始工作的子线程，所以父线程恢复一个已释放的 Claude 子线程时（例如通过 `SendMessage`），要等有查看者打开它才会被观察。只有 Pi Durable 会把恢复的子线程通告给最近的已加载祖先。

各 adapter 其实已经掌握原生证据。Claude 的 owner 跟踪每个任务，从 `background_tasks_changed` 或 `task_started` 一直到终止通知。Pi 和 Pi Durable 为每个会话保留 agent-behavior 的 live facts（`idle`、`runEnd`）。

## Proposal

### 契约

`packages/agent-runtime/src/contracts.ts` 中的 `Subagent` 增加一个可选的工作状态：

```ts
export interface Subagent {
  // id, parent, child, origin as before
  /** The owner's evidence for the child's native work; absent when the owner has none. */
  readonly work?: 'running' | 'idle'
}
```

- `running`：子线程有运行正在进行，或者有已接纳的输入在等待运行。刚创建、首次运行尚未开始的子线程也属于这一种。
- `idle`：子线程运行过，当前没有运行，也没有已接纳的输入在等待。owner 只有在拿到正面的原生证据时才报告 `idle`。
- 工作状态描述的是子线程，而不是某项委派。关系仍然不携带委派结果，空闲的子线程以后也可以再次工作。

暴露关系的 adapter 需要：

- 在快照的 `subagents`、`subagent.upsert` 以及类型化的 `relation()` 和 `openChild()` 结果中带上 `work`；
- 子线程的工作状态每次变化时，在父线程的 observation 上发布 `subagent.upsert`；
- 重放关系时报告当前证据，因此对没有在工作的子线程，重放永远不会显示 `running`。

各 adapter 的证据：

- Claude Code：owner 的任务表。任务从 `background_tasks_changed` 或 `task_started` 开始为 `running`，直到 `task_notification` 或终止状态的 `task_updated`。只从归档中得知的子线程为 `idle`，因为后台任务会随运行它的 CLI 进程一起结束。
- Pi：子会话的 live facts（已有运行结束记录，且没有进行中的运行，也没有排队输入）。adapter 从 behavior 层已经在调用的运行开始与结束钩子发布这些状态。未在本进程中加载的子线程为 `idle`。
- Pi Durable：子会话的原生 facts（`live.idle` 和 `runEnd`）。子线程的 live 状态变化时，adapter 从提交观察器发布它们。现有的恢复输入通告带上 `running`。

### 宿主

`ChildResidency` 消费关系：

- 每个连接把观察到的每条关系交给 residency。已加载的子线程，当且仅当它最新的关系为 `idle` 时才算已结束。
- 已释放的子线程在关系报告为 `idle` 以外的状态时重新加载，因此父线程恢复它时会被观察到。遇到 `idle` 的重放时保持释放。
- 已加载的嵌套子线程会让它的父子线程保持加载，这样父线程的 observation 会继续传来嵌套子线程的关系。
- 命令（`messageChild`）会让子线程保持加载，直到命令之后到达的关系报告 `idle`。

没有任何连接再计算按运行时区分的结束证据，Claude 重新打开时也不再根据已保存的 context 行恢复子线程。面向 UI 的后台任务事件保持不变。

## Alternatives considered

- **扩展 `Activity`，让它覆盖后台和已接纳的工作。** 子线程被释放后，它自己的 observation 就停止了，无法报告父线程恢复了它，Main 仍然需要区分重放和实时启动。根线程的 activity 还驱动 Main 的轮次跟踪，扩展它会改变根线程轮次的开始时机。
- **给每个 `subagent.upsert` 标记实时或重放。** 这能告诉 Main 何时重新加载子线程，但不能告诉它子线程何时结束，「已结束」的证据仍然按运行时区分。
- **在关系上加入委派结果（`completed`、`failed` 等）。** [子智能体控制 note](2026-10-18-agent-runtime-subagent-control.md) 把委派结果和关系分开，而驻留只需要知道是否还有工作。

## Acceptance criteria

- AC1 — Claude Code、Pi 和 Pi Durable 的关系在子线程运行进行中或有输入等待时为 `running`，运行结束后为 `idle`，父线程快照和父线程 observation 上的 upsert 都是如此（verification: unit）
- AC2 — 对没有在工作的子线程，重放的关系为 `idle`：包括 Claude 归档读取、Pi 根线程重开和 Pi Durable 重开（verification: unit）
- AC3 — Main 只根据关系的工作状态释放已结束的子线程；没有任何连接再计算按运行时区分的结束证据（verification: unit）
- AC4 — 在 Claude Code、Pi 和 Pi Durable 中，父线程恢复的已释放子线程无需查看者即可重新加载并被观察（verification: unit）
- AC5 — 运行中的嵌套子线程会让它的父子线程保持加载，嵌套子线程结束后两者都会释放（verification: unit）
- AC6 — 在 Electron 复现中（17 个 Claude Code 子智能体，每个读取 40 张图片），实时运行结束后每个子线程仍然会 settle，下一次冷启动重开不加载其中任何一个（verification: Electron）

## Risks

- adapter 漏掉一次状态变化，要么子线程一直保持加载到根线程关闭（漏掉 `idle`），要么恢复的子线程得不到观察（漏掉 `running`）。没有 `work` 时子线程保持加载。
- Pi Durable 在改变子线程 live 状态的提交上读取子线程 facts，读取量与已加载父线程的子线程数量成正比。
- 父线程已释放、且在父线程没有运行的情况下恢复的嵌套子线程，仍然只有在查看者或命令打开它时才会被观察；Pi Durable 例外，它会通告给最近的已加载祖先。
