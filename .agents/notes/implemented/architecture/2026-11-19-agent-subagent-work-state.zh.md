# Agent Note: 运行时契约中的子智能体工作状态

Status: implemented

[English](2026-11-19-agent-subagent-work-state.md) | 中文

## Problem

[子线程驻留](2026-11-19-agent-child-residency.md)会在子线程的原生工作结束后释放它，并且在父线程恢复已释放的子线程时需要重新加载它。但[运行时契约](../../proposed/architecture/2026-10-17-agent-runtime-contract.md)没有给 Main 提供表达这两点的通用事实：`Activity` 只描述线程的前台循环，`Subagent` 关系不带任何状态。没有这样的事实，Main 只能按运行时分别判断「已结束」，各自依赖运行时专有的通道：

- Pi Durable：通过 `handle.durable.facts()` 读取原生 facts，再加上输入结果。
- Pi：Main 根据 Pi behavior 事件构建的子任务状态，再加上输入结果。后台请求仍在进行时，Pi 子线程的 activity 也可能显示为 idle。
- Claude Code：任务 activity；它在 `task_started` 之前、以及对只从归档中得知的子线程，都显示为 `unknown`。

Claude 的 owner 每次读取归档还会重放所有关系。关系不带状态时，Main 无法区分重放和重新开始工作的子线程，所以父线程恢复一个已释放的 Claude 子线程时（例如通过 `SendMessage`），要等有查看者打开它才会被观察。只有 Pi Durable 会把恢复的子线程通告给最近的已加载祖先。

## Decision

### 契约

`packages/agent-runtime/src/contracts.ts` 中的 `Subagent` 有一个可选的 `work?: 'running' | 'idle'`，表示 owner 对子线程原生工作的证据：

- `running`：子线程有运行正在进行，或者有已接纳的输入在等待运行。刚创建、首次运行尚未开始的子线程也属于这一种。
- `idle`：子线程运行过，当前没有运行，也没有已接纳的输入在等待。owner 只有在拿到正面的原生证据时才报告 `idle`。
- 工作状态描述的是子线程，而不是某项委派。关系仍然不携带委派结果，空闲的子线程以后也可以再次工作。

adapter 在快照的 `subagents`、`subagent.upsert` 以及类型化的 `relation()` 和 `openChild()` 结果中带上 `work`。子线程的工作状态每次变化时，它们在父线程的 observation 上发布 `subagent.upsert`；重放关系时报告当前证据。

各 adapter 的证据：

- Claude Code：`owner.ts` 中 owner 的任务表。任务从 `background_tasks_changed` 或 `task_started` 开始为 `running`（包括已结束的任务在两者之一中以更新的 run 出现），直到 `task_notification` 或终止状态的 `task_updated`，每次变化都会发布它的关系。只从归档中得知的子线程为 `idle`，因为后台任务会随运行它的 CLI 进程一起结束。归档恢复先从记录的父 agent 取得子线程的父线程，其次从包含其创建 Agent/Task 调用的 transcript 取得，否则按根线程的直接子线程处理，因为 SDK 对第一层的父线程报告为 null。因此冷读取归档会重放每条子线程关系。
- Pi：每当 behavior 层刷新结果时（每次运行开始和结束都会刷新），`PiBehaviorOptions.onWork` 报告线程的 live 状态（没有进行中的运行、没有排队输入、Pi 空闲）。runtime 在列出该子线程的父线程上发布变化。新创建的子线程列为 `running`，重新打开的子线程保持已知的工作状态；根线程打开时重放的关系为 `idle`。
- Pi Durable：提交观察跟踪每个子线程已提交的运行（`pi.live`）和排队输入（`pi.inbox`），并在最近的已加载祖先上发布变化；发布在提交观察器返回之后进行，因为观察器不能调用 Session。打开父线程和调用 `relation()` 时读取这两个文档。本进程中创建的子线程在首次运行结束前为 `running`。恢复输入通告带上 `running`，如果子线程期间已结束，再发布它的当前状态。

### 宿主

`ChildResidency.relate(relation, open)` 消费连接观察到的每条关系：

- 已挂载的子线程接收关系；当它为 `idle` 且没有被查看者、命令或已加载的嵌套子线程 pin 住时释放。
- 关系不是 `idle` 的子线程会被打开，包括已释放的子线程，因此父线程恢复的子线程无需查看者即可被观察。
- residency 尚未见过、也未 settle 的空闲子线程会一次一个地恢复；下一个恢复会等它 flush 并释放之后才开始。
- 嵌套子线程从挂载之前起就 pin 住它已挂载的父子线程，直到嵌套子线程被释放。
- `messageChild` 使用的 `command()` 会清除子线程的工作证据并 pin 住它，因此只有命令之后到达的关系才能释放它。子线程拒绝该输入时，如果期间没有更新的关系到达，被清除的证据会恢复。

没有任何连接再计算按运行时区分的结束证据，Claude 重新打开时也不再根据已保存的 context 行恢复子线程。面向 UI 的后台任务事件保持不变。

## Alternatives considered

- **扩展 `Activity`，让它覆盖后台和已接纳的工作。** 子线程被释放后，它自己的 observation 就停止了，无法报告父线程恢复了它，Main 仍然需要区分重放和实时启动。根线程的 activity 还驱动 Main 的轮次跟踪，扩展它会改变根线程轮次的开始时机。
- **给每个 `subagent.upsert` 标记实时或重放。** 这能告诉 Main 何时重新加载子线程，但不能告诉它子线程何时结束，「已结束」的证据仍然按运行时区分。
- **在关系上加入委派结果（`completed`、`failed` 等）。** [子智能体控制 note](../../proposed/architecture/2026-10-18-agent-runtime-subagent-control.md) 把委派结果和关系分开，而驻留只需要知道是否还有工作。

## Consequences

- adapter 漏掉一次状态变化，要么子线程一直保持加载到根线程关闭（漏掉 `idle`），要么恢复的子线程得不到观察（漏掉 `running`）。没有 `work` 时子线程保持加载。
- Pi Durable 每次子线程工作状态变化时沿会话记录向上读取，直到最近的已加载祖先，打开父线程时读取每个子线程的 live 和 inbox 文档。
- Claude 重新打开时，根据归档的关系重放恢复未 settle 的子线程，而不是根据已保存的 context 行。归档中已不再列出的已保存子线程，只有在查看者或命令打开它时才会挂载。
- 父线程已释放、且在父线程没有运行时恢复的嵌套子线程，仍然只有在查看者或命令打开它时才会被观察；Pi Durable 例外，它会通告给最近的已加载祖先。

## Verification

- AC1 — `packages/agent-runtime-claude-code/tests/runtime.test.ts`「continues the same child with a new native run (cold=%s)」、`packages/agent-runtime-pi/tests/behaviorRuntime.test.ts`「continues the discovered child in place, streams to shared handles and delivers its next run once」、`packages/agent-runtime-pi/tests/runtimeLifecycle.test.ts`「keeps child observations and native identity across continuation」和 `packages/agent-runtime-pi-durable/tests/runtime.test.ts`「discovers native forks and archives only child-owned output independently of the parent」从父线程的 upsert 和快照读到：子线程工作时为 `running`，每次运行结束后为 `idle`；各包测试全部通过（Claude Code 124 个测试，Pi 224 个、5 个跳过，Pi Durable 181 个、6 个跳过）。
- AC2 — Claude 测试在 `claude.archive()` 重放关系后读到 `idle`，冷、热两种情况都是如此；Pi「restores child relations on reopen and refuses a child without its live owner」重放出 `work: 'idle'`；Durable 测试从恢复后的父线程快照、`relation()` 和冷重开的事件中读到 `idle`。
- AC3 — `src/main/ai/agentSession/__tests__/ChildResidency.test.ts` 只通过关系驱动真实的 `ChildThreadProjection`：`idle` 重放让已释放的子线程保持释放，未见过的空闲子线程一次一个地恢复，收到命令的子线程保持加载，直到命令之后到达 `idle` 关系；没有任何连接再计算按运行时区分的结束证据，`pnpm typecheck:node` 通过，`pnpm test:main` 运行覆盖 residency 和三个连接的 24 个测试文件，全部通过（706 个测试，2 个跳过）。
- AC4 — `PiRuntimeConnection.test.ts` 和 `PiDurableRuntimeConnection.test.ts`「reloads a released child that its parent continues and saves its continued answer without a viewer」，以及 `desktopRuntime.integration.test.ts`「reloads a settled child that its parent resumes and saves its continued answer without a viewer」（真实 Claude CLI，通过 `SendMessage`）；没有 `onWork` upsert 时 Pi 测试失败，沿用此前跳过已释放子线程的行为时 Claude 测试失败。
- AC5 — `ChildResidency.test.ts`「keeps a parent child loaded while its nested child works and releases both after it ends」：嵌套子线程不 pin 住父子线程时该测试失败。
- AC6 — 在独立 profile 的 Electron 开发实例中：17 个 Claude Code 子智能体各读取 40 张图片并全部结束后，17 个子 context 全部 settle，堆快照里 `ChildThreadProjection` 为 0，Main GC 后堆为 515 MB；退出并冷启动、重新打开该会话后，`ChildThreadProjection` 为 0，17 个 context 仍全部 settle、没有恢复失败，GC 后堆为 223 MB。
