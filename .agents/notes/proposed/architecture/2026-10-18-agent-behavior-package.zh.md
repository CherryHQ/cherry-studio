# Agent Note: 与 harness 无关的智能体行为包

Status: proposed

[English](2026-10-18-agent-behavior-package.md) | 中文

## Problem

Cherry 的智能体产品规则目前写成 Pi coding-agent 扩展。子智能体（前台与后台运行、续接、投递、名额、模型选择）、goal（状态、轮、停止、预算、进展、验证器、`/goal`）、`AskUserQuestion`、`todo_write`、offload、recall 和摘要接受规则都在 [agent-runtime-pi](../../../../packages/agent-runtime-pi/README.md) 里；审批规则层在[宿主 Pi 接入](../../../../src/main/ai/runtime/pi/README.md)里；plan 模式只有设计。

Cherry 正在通过 [agent-runtime-pi-durable](../../../../packages/agent-runtime-pi-durable/README.md) 接入 Pi Durable，这个适配器由另一位维护者负责。Durable 是独立的执行系统，原语也不同：钩子不能提交，绑定在工具调用上的 handle 随调用结束失效，发给忙碌会话的输入按提交策略被拒绝、插入或排队，子会话的拥有者在创建时就固定。把每条规则再移植成第二套扩展，会留下两份逐渐分叉的副本，而且哪一份都离不开自己的 harness 才能测试。

这些规则需要一个归宿：不依赖任何 harness 就能测试，也经得起 harness 的变动。Durable 的 API 仍是实验性的，coding-agent 是否继续作为生产后端也还没定。范围内：子智能体（含计划中的 worktree 隔离）、goal、审批判定与 plan 模式、`AskUserQuestion` 与 `todo_write`、offload、recall 和摘要接受。范围外：存储与会话文件、AI SDK 模型桥、Durable 适配器本身、chat、沙箱、公共访问层的语义（契约、`ThreadFeed`、Lane 投影）、UI 和计费。

## Proposal

### 一个包：纯规则核心及其编排

新增 `@cherrystudio/agent-behavior`，位于 `packages/agent-behavior/`，由 PR-1 创建。完整 API 写在该包的 README 里；本文记录它背后的决定。

- 规则核心把事实映射为决策。它是同步的，没有 I/O、时钟和随机 id，也不访问运行环境，因此可以在 Durable 的一次提交里、读完之后写之前运行。
- 编排基于两组端口运行工具、作业、工具闸门和宿主入口。harness 侧端口由适配器实现：`agent-runtime-pi` 里的 coding-agent 适配器、`agent-runtime-pi-durable` 里的 Durable 适配器，以及随本包发布、作为常驻第二实现的内存 fake。宿主侧端口由 Cherry 实现。

```text
Cherry host -> adapters (coding-agent, Durable, fake) -> agent-behavior -> agent-runtime (types only)
inside agent-behavior: orchestration -> core, orchestration -> ports; core imports neither
```

- 依赖只有一个方向。本包不导入任何适配器、Pi 或宿主代码，适配器之间也互不依赖（[harness 边界](2026-10-17-agent-harness-boundaries.md) AC1）。
- 每个适配器在自己的包里同时实现公共的 `AgentRuntime` 访问和我们的 harness 端口。它翻译原生事实、执行决策给出的操作，从不重写规则。
- 与 `@cherrystudio/agent-runtime` 的关系是单向的。我们只导入类型：不透明 ID、`JsonValue` 和 `ContentPart`。`MessageItem` 和 `ToolCallItem` 是带 completeness、不带用量的观察协议，所以历史模型由我们定义。我们导出 `delegationStatus()` 和 `delegationTrigger()`；适配器投影 `Delegation` 时调用它们，替换两个适配器今天发布的 `unknown` 状态。子会话的一次运行对应一个 `DelegationId`。
- 模型侧的子智能体操作不走 `ThreadHandle.submit`，它对托管的子会话仍然拒绝。如果[子智能体控制](2026-10-18-agent-runtime-subagent-control.md)提议的 `spawn` 和 `cancel` 控制落地，由适配器接到我们的入口上，语义仍由本包定义。

### 事实、决策与记录

- 事实：核心读取一个会话有序、全血缘的历史（包括被压缩折叠或被 reset 隐去的条目）、它的实时事实（是否空闲、有无排队的用户输入、运行结束、是否重开）、各子会话的事实（是否在跑、是否在等审批、每次运行的用量，由子会话自己的条目求和），以及已经出现的键。每次调用的输入在决策之前从宿主端口取得：时钟、设置快照、审批结局、模型候选、验证器判定，以及当前 goal 轮的调用窗口。
- 决策：每个决策都是 JSON 值，因此可以 memo；所有决策都返回同一种形状，即「一步」：事务操作（追加记录、静默追加输入、创建子会话、确保作业存在）、提交之后执行的带键副作用（开始、撤回或停止回合；给子会话发消息或停止它；发出观察事件），以及给模型的结果或工具的 details。
- 记录就是历史条目。goal 快照、子智能体运行记录、plan 状态和用户停止记录，都是与消息排在同一序列里的自定义 kind 条目；轮标记和通知是自定义 kind 的 input 条目。现有 `cherry.*` kind 的名称不变，当前会话无需迁移；`cherry.plan` 和 `cherry.turn-stop` 是新增的。适配器可以在同一次提交里把记录镜像成文档，供 UI 和钩子读取，但以条目为准。
- 子会话的用量由它自己的条目求和；工具结果和通知不再携带用量，展示用的缓存除外。用户停止是宿主入口在 harness 停止回合之前写下的记录，因此停止后的抑制期能跨重启保留。

### 一步：事务里的纯决策，之后是带键的副作用

- `Ledger.transact(thread, decide)` 读取全部事实，同步调用核心，并在一次提交里执行它给出的操作；`decide` 抛错时什么都不写。必须与决策原子完成的事都是操作而不是副作用：名额预约、用户停止记录、抑制期检查及随后的静默追加，以及轮提交之后的复核。
- 副作用在提交之后按顺序执行，中间不做决策。之后的决策是新的一步，会重新读取事实；编排不保存模块或实例状态，没有计时器，只经端口等待。
- 键已经出现的操作会被去掉。副作用靠 harness 的请求 id、memo 或操作本身的幂等性去重。因此无论是重跑工具调用、重跑作业阶段，还是重放整段历史，每个副作用都至多发生一次。

### 从事实推出的键

- 不生成任何 id。每个 id 和键都是事实的纯函数：调用键（Durable 用工具任务的 taskId，coding-agent 用 `<sessionId>:<toolCallId>`）、`goal:call:<callKey>` 或宿主命令的 `goal:cmd:<requestKey>` 或宿主命令键、`subagent-spawn:<callKey>`、`subagent-msg:<child>:<n>`、`subagent-report:<runKey>`（spawn 或 message 的键，从不用子会话 id）、`idle-driver:<thread>:g<generation>`、对排好序的 `child:run` 列表取摘要得到的通知键，以及 memo 名 `cherry.approval:`、`cherry.ask:`、`cherry.verdict:` 和 `cherry.summary:`。子会话 id 由 harness 在创建时给出，并记录在同一次提交里。
- 轮键是 `goal-round:<goalId>:r<round>:v<revision>:a<armSeq>`，其中 `armSeq` 是这个 goal 被武装的次数，从记录里数出。重开时解除武装、再 `/goal resume`，这条路径不会 bump revision；没有 `armSeq`，resume 之后的轮会被去重成重开前那次已被撤回的提交。
- 在 Durable 上，会话忙时被拒绝的输入不留记录，所以它的键之后还能再用；被撤回或没被回答的提交会留下记录，重新预约就必须换键。上面各个键的组成部分保证了这一点。

### 空闲驱动

- 每个会话至多一个 `idle-driver` 作业，重启时放弃；它的键带一个代数，从 driver 的退出记录数出，driver 的最后一次决策在同一次提交里写下这条退出记录，所以与正在退出的 driver 撞上的 ensure 会建出下一个作业，而不是被去重掉。每次后台运行有一个 `subagent-report` 作业，重启时续跑；它给子会话发消息、等待答复，并记录这次运行的结束。
- 驱动每次醒来先等会话空闲，然后只做一个决策 `decideAtIdle`，顺序是：有排队的用户输入就等待；预算已越过时，先停掉 goal 名下仍在跑的后台子智能体；待送的结果在用户停止后的抑制期内静默追加，否则开一个通知回合，排在任何 goal 轮之前；接着 goal 等待（没有 active 且已武装的 goal、处在 plan 模式、有后台子智能体在跑）、开始一轮或停止；都不需要时作业退出。
- 在 Durable 上，轮和通知以 `whenBusy: 'reject'` 提交，所以用户输入在接纳时优先。提交之后再走一步：goal 已变的轮被撤回，已经开始的则被停止。该作业在 Durable 上是后台任务；前台的驱动会在 `waitForIdle` 里等它自己。

### 端口

| 组 | 端口 | 实现方 |
| --- | --- | --- |
| harness 侧，出站 | `Ledger`、`Turns`、`Helpers`、`Waits`、`Memory`、`Clock` | coding-agent 适配器、Durable 适配器、fake |
| harness 侧，入站 | `Tools`、`ToolGate`、`ContextFilter`、`RequestMeter`、`Lifecycle`、`Jobs` | coding-agent 适配器、Durable 适配器、fake |
| 宿主侧 | `Approvals`、`Questions`、`Models`、`Verifier`、`OutputStore`、`Summarizer`、`Observation`、`Settings`；`Workspaces` 随 worktree PR 加入 | Cherry 宿主；fake 里是脚本化实现 |

端口实例绑定在一次工具调用、一个作业或一次宿主入口上，随之失效，与 Durable 绑定调用的 handle 同形。在 Durable 上不安装 `ContextFilter`，请求上限由模型桥执行，这条需求交给模型桥的负责人。

### 所有权

- 本包由 MyPrototypeWhat 负责：规则核心、端口、编排、fake 和契约用例。`agent-runtime-pi` README 里现有的规则契约迁到本包的 README，公共层的 notes 改为链接到它，不再定义 goal 或子智能体的语义。
- 适配器实现 harness 侧端口；coding-agent 适配器只剩接线。Durable 适配器的负责人对照契约用例和一份需求清单实现 harness 侧端口，清单在 PR-1 稳定后交接：在一次提交里先做全血缘读取再写入、记录写成仅展示的条目、带请求 id 且忙时拒绝的输入、两种子会话所有权形状、续跑的 report 作业与放弃的 driver 作业、带前缀的 memo、恢复之前的停止（harness 恢复所有被打断的运行，由包的 `onOpen` 处理器用 `abortTask` 和 `abortSubmission` 在不开启调度的情况下结束规则点名的那些）、把压缩键交给包的入站压缩方法、以任务 id 作为调用键，以及由 `delegationStatus()` 得出的 `Delegation.status`。
- 适配器从不重写规则。产品常量和停止码只能从本包的输出得到。

### 负责人已定的事项

负责人于 2026-10-18 定下以下各项：

- 前台还是后台在派出时由 `background` 定下，默认前台；两种 harness 都不提供转后台，因此 coding-agent 去掉 `moveToBackground` 和宿主的 `backgroundSubagent` 入口。前台子智能体归发起调用的工具所有，由该工具等待答复；中止父回合只停下前台子智能体。`stop_subagent`、用户的停止控件和预算停止对两者都适用，前台子智能体不占后台名额；子智能体的 `interrupt()` 对后台子智能体是用户停止，对前台子智能体是停止父回合。
- 续接已结束的子智能体总在后台运行，并返回此后要用的 id。coding-agent 上 id 不变。在 Durable 上，已结束的后台子智能体原地续接；已结束的前台子智能体则 fork 成一个新的后台子智能体，id 是新的；之后对旧 id 的调用转给它，并以新 id 作答。
- 重开永远不续跑被打断的后台子智能体，也不续跑武装中 goal 的轮：harness 恢复所有被打断的运行，由包的 `onOpen` 处理器在任何恢复工作之前停掉它们；适配器从不判断哪些运行属于某个 goal。
- 后台子智能体的用量在发生时就计入 goal 预算，而不是送达时计一次；仍保留一轮 wrap-up。
- goal 轮由每个会话一个的空闲驱动推进，轮条目是自定义 kind，不用 `onYield`。
- 规则在工具和作业里运行，不在钩子里；钩子只问核心是否拦下调用、改写参数或替换结果。
- 规则契约放在本包的 README 里，公共层的 notes 链接过去。
- 包名是 `@cherrystudio/agent-behavior`。它不用 `agent-runtime-*` 前缀，因为它不实现 `AgentRuntime`。

实现 PR-1 期间记下的决定（2026-10-19 至 2026-10-20）：

- `Waits.untilDone(thread, key)` 取代等待 run 结束：driver 等的是自己提交的键，遗留输入不会让它空转。
- steer 只并入它点名的、正在跑的 run；该 run 先结束或发出它的工具调用中止时撤回，绝不开新 run。steer 键按 run 区分。
- fork 一律新建会话；占位结果只补给 fork 子代理自己的未答调用；任何 run 开始前，未答调用先补「被打断」结果。
- 闸门的 `before` 收到中止信号；被中止的问人不留 memo。
- 每次压缩前先问 `onCompacting`；拒绝则不压缩；适配器拒绝绕过它的压缩。
- 每个会话一个空闲驱动，负责人已确认；fork 出的子代理不自驱。
- YAGNI 审计找出的死字段已删除（`callWindow`、`GateFacts.lineage`、`LiveFacts.reopened`、工具结果的 `blocked`、`turn-stop.by`）。

### 受 harness 限制的能力

下表各行是 harness 之间仅有的预期行为差异。标注「推断」的项由 Durable 源码推出，它的例子和测试都没有覆盖。

| # | 设计的能力 | Durable 1.3.0 为什么做不到 | 降级 | 上游 | 升级能否解除 |
| --- | --- | --- | --- | --- | --- |
| 1 | 把运行中的前台子智能体转到后台 | 会话的拥有者和任务的 background 标志都不可变。 | 两种 harness 都不提供，模式在派出时定下。把所有子智能体挂在后台锚下、由编排模拟前台，可以换来这项能力；我们选择不模拟。 | 没找到 | 能，如果上游能把会话改挂到后台边界下 |
| 2 | 续接已结束的前台子智能体时 id 不变 | 工具任务拥有该子会话；在它里面开新运行，会落进父会话的中止与空闲遍历，还会拖住父会话的运行。 | fork 出带新 id 的后台子智能体，并转送旧 id；coding-agent 上 id 不变。 | 没找到 | 能，同第 1 行 |
| 3 | 在历史里认出 goal 续轮（`onYield`） | `onYield` 只能返回 `{ continue: UserInput }`，续轮写成普通的 `pi.user` 条目。 | 用空闲驱动作业加自定义 kind 的轮条目，代价是多一个后台任务和一次提交。 | 可以提：让 `continue` 支持 `entry: { kind, data }` | 能 |
| 4 | 在钩子里读历史、写记录 | `HookApi` 只提供 id、模型、memo 和文档读取；钩子不能提交。 | 规则在工具和作业里运行；钩子只问核心拦不拦。 | 可以提：在 `HookApi` 里加只读的条目扫描 | 能，第 5 行随之解除 |
| 5 | 重复调用的计数窗口跨重启保持连续 | 同第 4 行：`beforeTool` 看不到之前的调用。 | 通过延迟绑定的 Harness 引用，用宿主级的 `Conversation.entries()` 构造窗口（推断）；拿不到时用进程内窗口，重启后清零，最多多放过两次相同的调用。 | 同第 4 行 | 能 |
| 6 | 用户停止后绝不自动唤醒 | admission 没有先检查某个文档的入口，`admitSubmission` 不导出，Durable 自己的后台例子也会为 Esc 之后才到的报告开一个回合。 | 抑制期内的结果静默追加，检查和追加在同一次提交里（推断）。如果驱动已决定唤醒、提交尚未被接纳时用户按了停止，这一次通知仍会开一个回合。 | 可以提：条件提交或 admission 谓词 | 能 |
| 7 | 会话忙时，从任务里写一条进模型上下文、但不开回合的条目 | 任务的 handle 只收 input；会话忙时只有 Harness 能写模型上下文。 | 只在空闲且 inbox 为空时 raw 追加（推断）；忙时等到空闲再落下，不唤醒。 | 可以提：`ConversationHandle` 支持 `write` | 能 |
| 8 | 子智能体每次运行的请求上限 | 没有原语；`beforeRequest` 抛出的错误会被跳过。 | 模型桥按会话计数，第 201 次请求以不可重试的 `quota exceeded` 错误失败；适配器报告 `limit_reached`。 | 可以提：请求预算，或允许 `beforeRequest` 拒绝 | 能 |
| 9 | 交互的身份、有效期与迟到的回答；崩溃后不重复提问 | 没有交互原语；`beforeTool` 在 intent 之前等待，崩溃后会重跑。 | 宿主持久记录审批结局，`cherry.approval:` memo 记下每个答复；用户答复之前崩溃，就再问一次。 | 可以提：交互原语 | 部分能：memo 消除了「答过还问」；等待中崩溃仍会再问一次 |
| 10 | 在 harness 内拦下 `/goal` | 没有输入钩子；Durable spec 自己的 `/plan` 也由宿主路由。 | 宿主把 `/goal` 交给 goal 命令入口；被当成普通输入提交的 `/goal`，模型会当文本读到。 | 不需要，上游有意如此设计 | 不适用 |
| 11 | 把尚未接纳的 goal 轮对模型隐藏（`ContextFilter`） | 没有上下文钩子；Durable 的提交只有被接纳后才进入历史，未接纳的轮根本到不了模型 | Durable 上不安装 `ContextFilter`（已声明差异）；coding-agent 适配器安装它 | 不需要 | 不适用 |

## Alternatives considered

- 直接把规则写成 Durable 扩展：不采用，因为这会在 coding-agent 扩展旁边再留一份副本，把规则绑在实验性 API 上，而且只能通过 harness 测试；Durable 的钩子也不能读条目或提交。
- 不含编排的薄纯策略包（候选名 `agent-policy`）：负责人认为太薄而否决，因为每个适配器都要重写编排（事务、键、作业、等待），重新造出按 harness 分开的副本。在 Cherry 里这个名字也容易被读成审批与权限策略。
- 把规则放进公共访问包：不采用，因为 `@cherrystudio/agent-runtime` 承载与 harness 无关的访问契约、不透明 ID 和 `ThreadFeed`，没有执行循环和产品实体；把 goal 和子智能体语义放进去，会让访问层定义产品行为。
- 只保留后台子智能体：2026-10-18 早些时候采用，同日撤回。每次委派都会变成异步，失去「调用把子智能体的答复作为工具结果返回」这条路径；前台子智能体用原生所有权，父回合停止时它原生地停下，不必由编排模拟前台，也不依赖 Durable 上一个例子和测试都没覆盖的守卫任务组合。
- 用 `onYield` 推进 goal 轮：不采用，因为续轮写成普通的用户条目，历史里认不出轮，无法用于接纳、去重和回合来源判定。

## Acceptance criteria

AC1–AC5 是评审的五条守则，AC6 概括边界守卫，AC7–AC11 是测试结果。

- AC1 — `src/ports/` 里的每个端口和方法都以「动词 + 对象」命名，不出现 harness 名词（hook、commit、session、task、extension）；每个端口的 TSDoc 都写明 coding-agent、Durable 和 fake 三种实现，以及键和等待。 (verification: unit — 包负责人，针对 `src/ports/` 的端口命名测试：标识符不含 harness 名词，每个端口的 TSDoc 都带三种实现的说明)
- AC2 — 每个端口方法在 `src/orchestration/` 里都有调用点；harness 端口没有能力开关（`supports*`、`capabilities`），也没有可选方法，而模型的 `supportsTools` 仍是宿主端口上的领域事实；核心和编排从不按 harness 名字分支；新增能力与它的端口方法放在同一个 PR 里。 (verification: unit — 包负责人，端口用法检查与评审)
- AC3 — 编排的每次写入都是 `Ledger.transact` 的操作，每个带键的副作用的键都来自 `core/keys.ts`，不带键的副作用（停止回合、停止子代理、发出观察）都是幂等的；`src/orchestration/` 没有模块级 `let`、没有在构造函数之外改写的实例字段、没有 `new Promise` 和计时器，只经 `Waits`、`Helpers.awaitAnswer` 和宿主端口等待。 (verification: unit — 包负责人，lint 规则与 fake 上的编排测试)
- AC4 — 本包只从 `@cherrystudio/agent-runtime` 导入类型（ID、`JsonValue`、`ContentPart`）；两个适配器都用 `delegationStatus()` 设置 `Delegation.status`；公共层的 README 和 notes 链接到本包，不定义 goal 或子智能体语义。 (verification: unit — 包负责人负责导入，适配器负责人负责 `Delegation.status`；链接由 docs gate 检查)
- AC5 — 每个端口方法至少有一个契约用例覆盖，fake 和两个适配器跑通同一组用例；改动端口方法集合却没有相应修改 fake 和契约用例的 PR，CI 不通过。 (verification: unit — 包负责人负责 fake 与覆盖检查；coding-agent 与 Durable 适配器负责人在各自包里运行)
- AC6 — 本包在 `package.json` 及其 lockfile 依赖闭包里只依赖 `@cherrystudio/agent-runtime`；`src/**` 不能导入 Pi、Node、Electron、宿主、logger 或 AI SDK 模块；`src/core/**` 不导入其他层，不碰时钟、随机数、crypto、process、计时器、fetch 或 `globalThis`，也不含 `async`、`await`、`Promise` 或 `yield`；唯一导出是 `"."`；端口的键是 `core/keys.ts` 给出的品牌类型值；适配器里没有产品常量和停止码字面量。 (verification: unit — 包负责人，lint 与包检查；适配器负责人在评审中检查)
- AC7 — 核心决策是确定的，不修改输入，在 `Date.now`、`Math.random` 和 `crypto.randomUUID` 抛错时仍能完成，能经 JSON 往返，其中的每个 id 都能在输入里找到来处。 (verification: unit — 包负责人，核心纯度测试)
- AC8 — 每个场景夹具在正常跑完、在每个 await 点崩溃、把历史重放给核心这三种跑法下，都满足重放不变式 I1–I5。 (verification: unit — 包负责人，fake 上的夹具)
- AC9 — 同一个脚本化场景在 fake、coding-agent 和 Durable 上得到相同的事实序列和决策序列；每个适配器的「已声明差异」表只能引用受 harness 限制能力表的行、端口一节声明在该 harness 上不安装的端口，或 coding-agent 自身的重启限制。 (verification: unit — 包负责人与 coding-agent、Durable 适配器负责人，契约用例)
- AC10 — 在每种 harness 上，前台还是后台都在派出时定下；中止父回合只停下前台子智能体；续接已结束的子智能体在后台运行并返回此后要用的 id，对已转送的旧 id 的调用以新 id 作答。 (verification: unit — fake 和两个适配器上的契约用例)
- AC11 — 重开带有已武装 goal 或被打断的后台子智能体的会话，不开任何回合，也不续跑任何子智能体；后台子智能体的用量在发生时就计入 active goal 的预算。 (verification: unit — 包负责人，fake 上的重开与预算夹具；适配器负责人，契约用例)

### 验证计划

- 核心测试只用纯数据，不起任何 harness，每条用例都写明它能抓住的 bug。
- fake 有持久部分（条目与记录、按请求 id 索引的提交、memo、作业表）和易失部分（进行中的 Promise、进程内窗口）。它有脚本化模型、脚本化宿主端口和不用真实计时器的确定性调度；`crashAt(n)` 在第 n 个 await 点丢掉易失状态，续跑的作业从头重跑，放弃的作业直接丢弃。它与 Durable 同形：端口绑定调用、先读后写、忙时拒绝且不留记录、同键返回原来的提交。
- 十个夹具，各自写明能抓住的 bug：后台派出与送达；两个子智能体同时结束；用户停止之后才到的结果；连续三轮无进展；同一调用重复五次；goal 运行时审批被拒；重开武装中的 goal；resume 之后不能被去重的轮（`armSeq`）；名额满时并发派出；plan 模式的进入、拦截和被拒绝的退出。
- 重放不变式：I1 累积状态等于全量重算；I2 同样的事实在重启前后给出同样的决策；I3 增量缓存等于全量重算；I4 每个副作用都有幂等键，至多发生一次；I5 在任意 await 点崩溃再恢复，持久日志与未崩溃时等价，只容许已声明的行。
- 契约用例在 `src/contract/cases.ts`，用普通的 throw 断言，不依赖测试框架。它们在本包里跑在 fake 上；在 `packages/agent-runtime-pi/tests/` 里跑在 coding-agent 上，重启类用例按声明跳过，因为 Pi 不续跑运行；在 `packages/agent-runtime-pi-durable/tests/` 里跑在 Durable 上，用 faux provider 和内存或 Node SQLite 存储，以关闭再重开模拟崩溃。

### PR 切分

| PR | 内容 | 验证 |
| --- | --- | --- |
| PR-1 `feat(agent-behavior): add rule core, ports and fake harness` | 包骨架与守卫；带 TSDoc 的端口；从 `agent-runtime-pi` 和宿主审批扩展迁出的纯规则，迁出时已改成上述形状；编排；fake 与契约用例。`agent-runtime-pi` 不动。 | 核心纯度测试；夹具在 fake 上的三种跑法 |
| PR-2 `refactor(agent-runtime-pi): implement agent ports on coding-agent` | 适配器实现 harness 端口，扩展只剩接线；删除已迁出的规则，以及 `moveToBackground` 和宿主的 `backgroundSubagent` 入口；README 里的规则段迁到本包 README。 | 现有 `agent-runtime-pi` 测试，只钉住实现的测试删除或重写；coding-agent 上的契约用例 |
| PR-3a 至 PR-3e | 用户停止记录与抑制期内的静默投递；goal 计账与 plan 模式下的等待；把宿主的审批义务移进核心；plan 模式，排在基于 `main` 的权限模式 PR 之后；offload 与摘要器的重放。 | 对应的夹具和契约用例 |
| PR-4 `feat(agent-behavior): isolate subagents in worktrees` | 为非 fork 的子智能体提供可选的 worktree 隔离，并加入 `Workspaces` 端口。 | 新增的契约用例 |

这个栈叠在 `feature/agent-runtime-background-subagent` 之上；如果那个栈先合进 `main`，就改为基于 `main`。Durable 适配器的工作叠在 PR-1 上，与 PR-2 同时进行；两个适配器都通过契约用例之后才开始宿主接入，此后新增的每条契约用例同样约束 Durable 适配器，它只能按受 harness 限制能力表的行跳过。

## Risks

- Pi Durable 仍是实验性的：它的 README 说明 API 在版本之间会不经通知地变化，1.2.0 有多处破坏性变更，1.3.0 里 spec 的代码块已经落后于 `src`。适配器以 `src` 和类型声明为准，契约用例负责兼容性检查，版本锁定由谁负责尚未确定。
- 同一个栈里现在有两层抽象：公共访问层和我们的端口，每个适配器都要实现两者。它们保持单向（类型进来，`delegationStatus()` 出去）；如果访问层开始定义 goal 或子智能体语义，或适配器绕开我们的入口去操作子会话，就会开始分叉。
- 设计依赖的四项 Durable 行为由源码推断，上游的例子和测试都还没覆盖：在工具或作业的提交里 raw 追加仅展示的记录，效果等同被动条目；在空闲且 inbox 为空时 raw 追加进模型上下文的条目，并与检查在同一次提交里；用持久的 `waiting … allSettled` 等待替代内存里的 `waitForTask`；通过延迟绑定的 Harness 引用，用 `Conversation.entries()` 构造闸门的调用窗口。每一项都需要 Durable 适配器上的契约用例确认；只有调用窗口有声明过的退路（第 5 行）。
- 接受的代价：用户停止后残余的唤醒窗口（第 6 行）；拿不到延迟绑定引用时，调用窗口在重启后清零（第 5 行）；审批等待中崩溃会再问一次（第 9 行）；预算停止会比今天按送达计账更早到来；驱动多一个后台任务和一次提交；包名与 harness 边界文档用 behavior 一词描述 harness 职责的用法有重叠。
- coding-agent 是否继续作为生产后端，是团队尚未决定的问题。本设计两种情况下都成立：规则和编排只依赖端口，fake 让 harness 中立不依赖 coding-agent。

## Related notes

- [goal 文档](../feature/2026-10-11-agent-runtime-goal.md)和[后台子智能体文档](../feature/2026-10-14-agent-runtime-background-subagent.md)在 PR-3 系列更新它们之前，继续负责 Pi 专用行为。本文推翻了其中两项决定：把运行中的前台子智能体转到后台，以及后台用量在送达时计一次。
- [Harness 边界](2026-10-17-agent-harness-boundaries.md)、[Runtime 契约](2026-10-17-agent-runtime-contract.md)和[子智能体控制](2026-10-18-agent-runtime-subagent-control.md)负责本包所依托的公共访问层。
- 现有的规则契约在 [agent-runtime-pi README](../../../../packages/agent-runtime-pi/README.md) 里；本包本身 `packages/agent-behavior/` 由 PR-1 创建。
