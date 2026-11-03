# Agent Note: 子智能体所有权与可选运行时控制

Status: proposed

[English](2026-10-18-agent-runtime-subagent-control.md) | 中文

## Problem

Cherry 需要观察子智能体、管理委派工作，并在 harness 支持时继续与子智能体对话。有些 harness 只暴露任务结果，有些则提供可独立访问的会话。发现、观察、输入和取消是相互独立的能力。

此前运行时契约要求 `Delegation.child` 和 `ThreadHandle.submit` 必须存在，无法直接表达没有公开子会话的关系，或只能观察的 child 访问。[当前契约](2026-10-17-agent-runtime-contract.md)已实现可选子上下文与输入入口，并通过所有者接通 Pi child 输入。本文记录已实现部分及剩余控制方案，不表示已经接入桌面应用。

[跨 harness 补充调研](../testing/2026-10-17-agent-harness-evidence.md#subagent-comparison-and-design-consequences)发现，此前 `Delegation` 观察并不一致地标识一次任务。Pi 用触发工具调用与 child 组合身份；Durable 用会话的 owner task 与 child 组合身份。在 Durable 后台示例中，这个 owner 是长期保留的 anchor，不是每条消息的 reporter。两个适配器现在都暴露稳定的父子关系，不再将其当作任务身份。

[AgentSessionDeliveryService](../../../../src/main/ai/agentSession/AgentSessionDeliveryService.ts) 负责 Cherry 产品会话之间的消息投递。创建会话并投递第一条消息，不会因此建立子智能体的所有权、取消传播和资源清理语义。它不是子智能体控制器。

## Proposal

### 将通用 spawn/stop 留作后续工作

当前接入主线是三个 runtime 包的访问、输入、独立观察和资源边界。子智能体发现、观察与可选输入属于这条主线。通用 spawn/stop 是独立的后续控制扩展，不阻塞现有契约的接入；先在本文记录方向，保持 proposed 且尚未实现。跨 harness 编排也留在后续工作中。

[桌面实现方案](2026-10-17-agent-runtime-contract.md#desktop-integration-implementation-plan)维护 P0–P4 顺序、输入关联门槛、上下文/输入持久化、独立 child 投影和冷启动恢复验收。本文继续维护后续控制契约。[社区编排样本](../testing/2026-10-17-agent-harness-evidence.md#community-orchestration-sample-pi-durable-subagents)为边界提供参考，不替换 Cherry 的 Pi 所有者，也不向公共包增加调度器。

### 保留我们自己的 Pi 子智能体扩展

继续使用 `packages/agent-runtime-pi` 中现有的子智能体实现。Cherry 有自己的 UI，当前选择不承担社区插件的 TUI 集成和终端交互假设带来的接入工作。这是一项集成决策，不表示所有社区插件都依赖 TUI 或无法无界面运行。社区实现仍可作为参考；若要改变该选择，需要针对具体可复用的执行接口，独立于其展示层进行评估。

[Pi 子智能体扩展](../../../../packages/agent-runtime-pi/src/subagent.ts)拥有子会话创建、续接、运行跟踪和结果交付职责，继续复用 Pi 原生会话、工具、执行循环和存储。Cherry 负责展示、权限和产品配置；扩展与公共运行时包不能依赖终端组件或 Cherry renderer 代码。[后台子智能体文档](../feature/2026-10-14-agent-runtime-background-subagent.md)维护 Pi 专属行为。

### 分开父子关系、上下文与分配的工作

此前的提案把每条 `Delegation` 观察都当作一次任务。现在以三种不同含义替代这个假设；这不要求新增三个公共实体。

| 含义 | 最小公共保证 | 边界 |
| --- | --- | --- |
| 观察到的子智能体关系 | 有证据的父方及相关子工作；存在可访问子 `Thread` 时提供关联。 | 关系可以跨越多次输入和运行。展示关联 ID 不是持久任务回执。 |
| 子上下文 | `Thread` 标识所属 backend 下可复用的原生上下文。 | 一次性工作可以没有公开上下文。上下文可访问，不等于支持输入或重启后再次打开。 |
| 一次任务或 activation | 只有所有者提供证据时，才保留相应边界和结果。宿主拥有的任务可由编排者分配身份。 | 原生 owner task、输入、工具调用与模型 turn 不能互换为任务身份。 |

已实现的 `Subagent { id, parent, child? }` 替代 `Delegation`。快照暴露 `subagents`，`subagent.upsert` 替代 `delegation.upsert`。关系 ID 限定在父方范围内，跨 child 输入和运行保持稳定；两个适配器使用各自原生 child 上下文 ID。Delegation 继续表示由明确所有者分配并跟踪的工作，不增加必需的 `Task` 或 `Run` 来承担这一角色。关系需要原生证据，不能从工具结果文本推断；空闲 child 可以再次工作，完成任务不结束父子关系，也不改变早先任务的结果。

- 支持输入的访问入口通过 `ThreadHandle.input` 同时提供 `submit` 和支持的 `policies`；只支持观察的访问入口不提供该字段。当前 Pi 与 Durable 的具体句柄均提供该组操作，公共契约不要求所有适配器都提供。
- 能力属于具体访问入口，不能只按 harness 名称判断。有输入操作仍可能因当前状态或权限而拒绝执行。不支持输入时，不能静默改成给父智能体发消息或新建会话。

`whenBusy` 只描述目标忙碌时如何接纳输入，不能同时表达消息是否唤醒空闲 child：Codex 内部协作工具区分只投递消息与触发新一轮执行的输入。在宿主消费者需要统一操作之前，这类消息能力保留在适配器中。重连时需要重新确认控制权限，历史关系记录不能授予输入或取消权限。

### 明确控制的目标

| 操作 | 目标 | 预期契约 |
| --- | --- | --- |
| `spawn` | 通过所有者创建的子工作 | 可选的所有者控制建立关系，报告创建与接纳证据。原生模型工具不自动成为宿主可调用的操作。 |
| `stop` | 通过所有者寻址的 child 当前工作 | 在明确范围内请求停止 child；不等于精确取消过去某次任务，也不删除子上下文。 |
| `submit` | 会话 | 按支持的忙碌策略接纳输入；接纳不证明完成。 |
| `cancel` | 一次已标识的任务或 activation | 只有所有者能精确控制该次工作、不影响后来复用同一 child 的任务时才暴露。不假设存在持久取消 ID。 |
| `interrupt` | 会话 | 请求打断文档说明的原生范围内的工作，不承诺取消所有后台后代。 |
| `release` | 本地访问句柄 | 释放订阅和访问资源，不取消执行中的工作。 |

拟议入口是父访问上的可选控制组，例如 `parent.subagents.spawn(...)` 和 `parent.subagents.stop(id)`。这些是设计示意，不是当前签名；每项操作仅在所有者支持时提供。`snapshot.subagents` 仍是关系数据，不授予控制权限。通过所有者寻址关系，也可以支持没有独立可打开 Thread 的 child。已有 child 输入仍使用 `child.input.submit(...)`，`child.release()` 仅释放访问。

创建、停止和精确任务取消是不同的可选控制。普通 stop 不依赖精确取消方案完成：同一 child 先执行 A、再执行 B 时，`stop(child)` 针对当前工作，`cancel(A)` 则不能影响 B。能观察 child 不代表获得任一种控制。只有能够保持目标和作用范围时，适配器才暴露相应操作；停止／取消请求的回执不等于终态。Pi 当前按子会话停止的操作，必须保留目标运行的身份，才能进一步映射为精确取消某次委派。

实现通用 stop 前，需要解决具体差异。Pi 当前托管前台 child 的 `interrupt` 可能中断父轮；用户停止后台 child 后，该次停止的运行不可续接。只停止 child 的契约不能直接给此行为换名。Durable 的 conversation abort、后台所有权边界和 reporter task 作用不同；spawn 需要建立原生所有权并完成初始接纳，不能仅用无关联的 `create` 加 `submit` 替代。支持的停止范围，以及停止后是否允许 child 继续输入，都需要明确决策和适配器证据。

DSH 通过存活的闭包提供精确 activation 控制；ACP 的实验 child 控制针对当前会话工作。两者都可以有用，无需声称它们具有相同取消身份或重启保证。原生 close/shutdown 也可能影响后代，都不能代替释放观察句柄。本轮调研不足以支持必需的公共 spawn/cancel 接口。

原生子智能体的控制经过原生所有者：我们自己的 Pi 扩展，或 Pi Durable 的任务／会话 API。公共包不维护与之竞争的队列、调度器或原生生命周期注册表。

### 由宿主拥有委派时组合多个运行时

对于宿主创建的子智能体，编排层通过选定 runtime 创建普通上下文，并拥有委派关系、控制策略和结果交付职责；目标 harness 负责执行。这既可以组合相同 harness，也可以组合不同 harness，前提是父方能调用委派入口，目标能提供所需的创建和输入能力。每个子智能体都按自己的 backend 路由，不能假设它可以通过父方的 runtime 打开。

已经由 harness 拥有的子智能体，不会被静默转换为宿主拥有。跨 harness 的子智能体接收明确的指令和材料，不假设原生上下文 fork 与在途执行恢复可以通用迁移。子智能体的存在本身不要求先创建 Cherry 产品会话记录。

观察子输出和向父方报告一次委派的结果是两条独立路径。原生委派结果继续由原生所有者交付，观察到完成不能再注入一次结果。宿主只为自己拥有的委派负责交付。用户后来与子智能体的对话，不自动成为原始父方任务的另一份结果。

### 保留当前实现事实

| 实现 | 已核对的源码行为 | 尚存边界 |
| --- | --- | --- |
| Pi 适配器 | [公共 child 输入](../../../../packages/agent-runtime-pi/src/runtime.ts)与模型的 `message_subagent` 共用所有者的 `messageSubagent` 接纳路径。 | 仅暴露 `steer`。已结束 child 需要 `SubagentPort.load`；用户停止后的拒绝规则和续接锁仍由所有者维护。 |
| Pi Durable 适配器 | [子会话访问入口](../../../../packages/agent-runtime-pi-durable/src/runtime.ts)已经暴露原生会话输入、观察和中断。 | 保留原生任务所有权、后台取消边界，以及 submit/interrupt 会启用整个 Harness 调度器的行为。 |
| 适配器覆盖范围 | [Pi](../../../../packages/agent-runtime-pi/tests/runtime.test.ts) 与 [Durable](../../../../packages/agent-runtime-pi-durable/tests/runtime.test.ts) 测试通过原生执行覆盖 child 发现、持续输入、steering、release 后独立观察和稳定的关系身份。 | 统一 spawn/cancel、跨 harness 编排、崩溃恢复和桌面验收不在本轮实现范围内。 |

Pi Durable 拥有的子上下文是原生会话。工具调用内的 `api.conversation()` 句柄随本次调用结束而失效，宿主访问使用 `harness.conversation(id)`。Pi Durable 1.3.0 的前台与后台子智能体示例展示了不同的所有权边界；能够继续输入，不等于已经安排了向父方报告结果。即使公共操作名称相同，这些原生差异仍然有效。

Pi 续接会启动新的后台 run，所有者按现有扩展策略报告该 run 的结果一次。宿主输入不伪造触发工具调用 ID。Durable 直接会话输入不创建 reporter，适配器测试验证父方输出保持不变。观察不会创建任何一种报告；后续工作不改写原始任务的结果。

### 验证已实现部分

[公共观察测试](../../../../packages/agent-runtime/tests/observation.test.ts)表达没有 child 访问的关系，并在后来补充 child 时保持关系身份。Pi 集成通过公共输入验证原生已保存 child 的续接和运行中 steering，在 child 重新绑定后继续观察，验证原生父方通知仅有一次，并确保 shutdown 在释放所有者前等待在途 child 加载。Durable 集成验证已完成 child 的复用、busy 拒绝、steering 和输入完成；父访问及第一个 child 访问释放后，另一个 child 句柄仍能观察。

这些测试覆盖 AC1–AC3 和 AC5 的输入桥接及关系部分；已有的所有者中断和被动观察测试覆盖 AC4 与 AC7 的部分行为。它们不证明精确任务取消、跨 harness 编排（AC6）或全部停止／恢复／报告组合。原生循环使用确定性的离线 provider，不宣称通过在线 provider 或 Electron 验收。

### 只在执行语义一致时共享 Pi 产品规则

Pi 与 Pi Durable 可以实现一致的 Cherry 子智能体行为，同时保留各自执行机制。明确三个边界：

| 边界 | 职责 |
| --- | --- |
| 公共运行时 | 关系与输出观察、可选输入，以及已证明目标和效果的控制；不拥有 child。 |
| Harness 适配器及其扩展 | 原生 child 创建、输入接纳、取消、结果结算、存储与恢复。Pi 使用会话与扩展控制器；Durable 使用 conversation、task 与 commit。 |
| Cherry 宿主 | 产品权限、模型选择、展示，以及自己跨 harness 创建的委派。原生 child 执行仍由其 harness 拥有。 |

只有两个实现都需要相同行为时，才提取纯请求校验或结果格式化规则。不要先把 Pi 的 registry、run 计数、inbox 和 delivery pump 搬进 `agent-runtime`。Durable 的 anchor、reporter、submission 去重与 answer entry 去重仍需使用原生 commit 和重放机制。多条输入可以共享一个答案，输入接纳或观察到该答案，都不能成为再次向父方报告的授权。

适配 Durable 时已有一项需要对齐的产品策略：[Cherry Pi 的交付实现](../../../../packages/agent-runtime-pi/src/subagentDelivery.ts)在用户停止父方后禁止自动唤醒，直到另一轮运行开始；上游 Durable 示例则允许停止之后到达的报告启动父方新一轮执行。适配这一行为时应保留 Cherry 现有停止策略，按需用原生持久状态实现，不能直接继承示例的时序。源码对照不代表已经实现这种行为一致性。

### 尚需明确的决策

关系观察和可选输入入口已经实现。后续控制工作启动时，先将 Pi spawn/stop 暴露为模型工具与宿主调用共用的所有者方法，再通过 Durable 原生 task/conversation 实现对应行为，对照可承诺的语义后定稿公共签名。公共包定义契约，适配器执行原生控制，宿主拥有跨 harness 编排。

尚需明确 spawn 配置、创建部分成功回执、停止范围及后续输入、精确取消目标、宿主拥有的工作在父方关闭时的策略，以及宿主委派关系恢复。在共享消费者证明需要公共契约之前，继续保留适配器专属的强类型配置。证据文档区分已完成的包级验证与剩余验收场景，包括 Durable 产品报告策略的一致性及恢复。

## Alternatives considered

- 现在用社区插件替换自研 Pi 子智能体扩展：本次集成不采用，终端展示与控制边界需要独立评估。这不否定其他场景下复用社区能力。
- 强制所有子智能体支持对话，或通过给父方发消息、创建另一子智能体模拟缺失输入能力：不采用，因为这会改变目标并虚构能力。
- 把 `AgentSessionDeliveryService` 扩展成子智能体所有者：不采用，因为消息投递不定义委派所有权和取消语义。
- 使用全局字符串能力矩阵，或在公共包复制原生调度：不采用，因为这会重复解释规则和执行所有权。由具体操作及其回执表达支持的行为。

## Acceptance criteria

以下是完整方案的验收目标。已实现的子集及测试边界见上文；剩余控制和宿主接入尚未明确，本文仍保持 proposed 状态。

- AC1 — Pi 子智能体扩展能通过不依赖 TUI 或 Cherry renderer 的宿主提供控制，公共输入路径使用同一个子智能体所有者。 (verification: unit — Pi 适配器集成测试)
- AC2 — 能表达没有可访问子会话的委派，以及不支持输入的子会话，不虚构 Thread，也不静默将输入路由到其他目标。 (verification: unit — 公共契约与适配器测试)
- AC3 — 复用 child 保持关系与上下文身份，不为每条消息虚构一次新任务；可独立标识的任务保留自己的结果。释放父观察不关闭保留的 child。 (verification: unit — 适配器生命周期测试)
- AC4 — 任何声称精确的取消都不能影响同一 child 的后续工作；会话级中断明确其范围，并保持文档说明的后台作用范围。不支持的精确控制不暴露，回执与终态保持区分。 (verification: unit — 适配器取消测试)
- AC5 — 观察子智能体完成不重复交付原生结果，后续子会话对话不隐式成为早先委派的另一份结果。 (verification: unit — Pi 扩展与宿主编排测试)
- AC6 — 宿主创建的子智能体可使用另一个已配置 runtime，在支持时接受后续输入，并由委派所有者控制，无需依赖产品会话消息投递。 (verification: unit — 宿主编排集成测试)
- AC7 — 被动观察 child 或恢复历史，不唤醒执行，也不授予不支持的控制。适配器测试区分输入触发的工作、暴露该能力时不唤醒的消息，以及停止或恢复后的父方结果报告。 (verification: unit — 适配器访问与交付测试)
- AC8 — Spawn 已创建 child，但初始输入失败或结果未知时，回执保留已知 child 身份，并区分创建与接纳；重试不盲目创建另一个 child。 (verification: unit — 经所有者执行的 spawn 集成测试)
- AC9 — 支持的 child stop 保持声明的范围，在承诺只控制 child 时不停止父方或兄弟 child；测试明确后续输入被接纳还是被拒绝，并区分停止回执与实际终止。 (verification: unit — Pi 与 Durable 所有者控制集成测试)

## Risks

保留自研 Pi 扩展需要承担维护成本。若适配器不验证公共操作承诺的行为，暴露的能力可能与原生控制器发生偏差。Durable 输入可能通过共享调度器启动其他会话，重新打开上下文也不等于恢复未完成执行。将本提案作为实现契约之前，必须先明确取消竞态、创建部分成功和结果归属等未定行为。
