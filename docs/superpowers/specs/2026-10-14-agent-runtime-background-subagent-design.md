# Agent runtime 后台子代理与续接 设计

状态：已评审 · 2026-10-14（同日按用户意见：并发上限 20、一期加入前台转后台与指定模型；按实施计划的探针结果修订 7 处，见第 18 节） · 基于 L5 goal（PR #21607，分支 `feature/agent-runtime-goal` tip `2a32858406`）· 分支 `feature/agent-runtime-background-subagent`

相关：L4 前台子代理（PR #21578）、L5 goal 设计（`2026-10-11-agent-runtime-goal-design.md`）。调研原稿在 explore 工作树的 `research_notes/subagents/`（未提交，可能被清理），本文第 17 节摘录了用到的结论和出处。

## 1. 背景与目标

L4 给 Pi 运行时加了前台子代理：`subagent({ description, prompt, fork? })` 阻塞到子代理结束，结果作为工具结果返回。L6 在此基础上补三件事：

1. **后台子代理**：派出后立即返回，父代理继续工作；子代理结束后，结果作为通知送回父会话，父会话空闲时自动开一轮处理它。
2. **续接**：模型能给运行中的子代理发消息，也能让已结束（包括被应用退出打断）的子代理带着新消息接着做，重启前后行为一致。
3. **与 goal 配合**：goal 等后台子代理回来再继续，子代理用量计入 goal 预算。

成功标准：

- 模型派出后台子代理后能继续做别的事，子代理一结束父代理就能处理结果，不需要用户催。
- 模型能给运行中或已结束的子代理发后续指示，消息不丢。
- 停止、审批、压缩、重启、goal 这几条路径下，行为可预期，状态对用户和父代理都可见。
- L4 前台行为不变（`background` 默认 false）。

一期按"够用"做，范围外的见第 2 节。

## 2. 范围

做：

- `subagent` 加 `background?` 和 `model?`；新工具 `message_subagent`、`stop_subagent`。
- 用户把运行中的前台子代理转到后台（同一次运行接着跑，不重跑）。
- 包内的后台运行表、通知队列、投递时机（settle 时并入、空闲时开轮）。
- 子代理 transcript 的完整交付（含起始条目）与从宿主取回后重建。
- 停止（模型、用户、预算）、父会话销毁时的收尾、重建后的状态恢复。
- goal 等待后台子代理、用量计入、预算用完时停子代理。
- 压缩后、重启后把子代理状态告诉模型。

一期不做（以后需要再加）：

- "全部停止"（包里是单个停止的循环，宿主以后加按钮即可）。
- 给模型读中间输出、列出子代理、等待子代理的工具（用状态注入代替）。
- 按名字寻址、子代理类型（`subagent_type`）。
- 子代理空闲超时；goal 长时间等待时的主动提醒。
- 重启后自动重跑被打断的子代理（只能由模型续接）。
- 子代理之间的写冲突隔离（L7 worktree + 沙箱）。

## 3. 已定决策

| # | 决策 | 理由（调研依据见第 17 节） |
|---|---|---|
| D1 | 后台子代理结束后，结果作为通知送回父会话；父会话空闲时自动开一轮。通知在父会话一轮结束（settle）时送入，不在轮中插入；有用户消息排队时先处理用户的；忙时陆续结束的合并成一条；压缩中等压缩完 | 与 Claude Code 一致；Codex 不唤醒空闲父代理被用户当成 bug（#15723） |
| D2 | 用户中止父代理的一轮，不停后台子代理；单个停止用宿主现有的停止按钮；"全部停止"以后再做 | Claude Code、Cursor（从"停"改成"不停"）都这样；"停本轮"和"停子代理"要分开 |
| D3 | 后台子代理的审批交给用户，显示在父会话，标明哪个子代理在请求，子代理等待；拒绝只拒那一次调用；无人值守的会话拒绝 | Claude Code、Codex、Goose、Gemini 都是从别的做法改到这里 |
| D4 | 已结束（含被应用退出打断）的子代理可以跨重启续接；宿主持久化子代理 transcript，包交出起始条目并能从宿主取回的 transcript 重建 | Claude Code、OpenCode、Codex、Cursor 都能；不给 id 的产品都不能续接 |
| D5 | goal 等后台子代理回来再继续；goal 轮派出的后台子代理用量计入 goal 预算 | Claude Code `/goal`、Codex root goal（#41183）；不计入子代理花费的产品都有投诉 |
| D6 | 三个工具：`subagent({ description, prompt, fork?, background?, model? })`、`message_subagent({ id, message })`、`stop_subagent({ id })`；不提供 wait、list、读输出 | 各家收敛到"派出 + 发消息/续接 + 停止"，等待和轮询工具在被删 |
| D7 | 一个标识：子会话 id 就是 `randomUUID()`；宿主 API 叫 `sessionId`，模型参数叫 `id` | L4 的 `父 id.UUID` 前缀不可靠：Cherry 的 Pi 会话 id 会变（resume token、fork checkpoint） |
| D8 | 架构：包负责运行表、通知队列、投递时机；宿主负责持久化、取回、界面、停止按钮 | 投递规则都依赖 settle，只有包看得到；包内测试能端到端覆盖 |
| D9 | 用户可以把运行中的前台子代理转到后台：父代理的这次调用立即返回，子代理在同一个会话里接着跑，结束后走通知 | Claude Code（Ctrl+B，2.1.178 起不再重跑）、OpenCode（ctrl+b）、Cursor SDK 都有；统一的运行器让它只是"换一个结果接收方" |
| D10 | 子代理的模型：默认用智能体设置里的"子代理模型"（不设就跟随主模型）；用户口头点名时，模型把名字填进 `model`，在用户已启用、支持工具调用的模型里解析；只有唯一候选才直接用，多个候选（同一模型在多个 provider 下）就让用户选一次；fork 不能换模型；续接沿用首次的模型 | Cherry 是聚合平台，模型可能有几百个、同名模型分属多个 provider，不能列进工具描述；Cursor 内置 agent 靠口头指定、自定义 agent 在定义里写模型；Codex 有 `default_subagent_model`；各家都要求只在用户要求时才设模型（Codex #41165、OpenCode "NEVER set this unless the user explicitly asks"） |

产品默认（用户未反对即采用）：

- goal 运行中，后台子代理的审批照常等用户，不因 goal 自动拒绝。
- goal 预算用完：拒绝新的后台派出，并停掉正在跑的后台子代理。
- 同一父会话最多同时运行 20 个后台子代理（与 Claude Code 一致，宿主可改），超出时 `subagent` 报错。
- 用户停掉的子代理：不唤醒父代理，只在下一次送给父代理的消息里提一句；模型不能续接它。
- 通知触发的自动轮不算人类回合，也不算 goal 轮。

本文另定的默认（第 7.6 节）：父代理一轮被用户中止后，到下一个人类回合之前不自动开轮，期间结束的子代理结果随用户下一条消息一起送达。

## 4. 结构

### 4.1 文件

L4 的 `subagent.ts`（313 行）拆成四个，各管一件事：

| 文件 | 职责 |
|---|---|
| `subagent.ts` | 对外接口：三个工具、`SubagentPort` 等类型、`isSubagentSession` |
| `subagentRun.ts` | 一次运行：建子会话 → `prompt` → 收集回复、用量、每次运行 200 次请求上限、outcome → 结束处理。前台、后台、续接共用（由 L4 的 `run()` 抽出） |
| `subagentRegistry.ts` | 父会话的子代理表：状态、发给运行中子代理的收件箱、停止、并发上限、结束后待送的通知、从 transcript 恢复 |
| `subagentDelivery.ts` | 投递：settle 时并入、空闲时开轮（带锁）、压缩后与重建后的状态消息 |

### 4.2 子代理记录（父会话扩展的内存里）

```ts
interface SubagentRecord {
  sessionId: string               // 子会话 id = 模型看到的 id，randomUUID()
  parentToolCallId: string        // 创建它的那次 `subagent` 调用
  description: string
  fork: boolean
  background: boolean             // 最近一次运行是否在后台（续接总在后台）
  modelKey: string                // 实际用的模型 key（`model` 解析出的、宿主默认的子代理模型或父会话当前模型），续接时交给宿主还原
  run: number                     // 第几次运行，从 1 起；每次续接 +1
  status: 'running' | 'awaiting_approval' | 'finished'
  outcome?: SubagentOutcome       // finished 时有
  stoppedBy?: 'model' | 'user' | 'budget'
  delivered: boolean              // 本次运行的结果是否已送到父代理
}

type SubagentOutcome =
  | 'completed' | 'failed' | 'truncated' | 'limit_reached'
  | 'aborted'      // 前台：父代理这一轮被中止（L4 原义）
  | 'stopped'      // stop_subagent、用户停止、预算停止，见 stoppedBy
  | 'interrupted'  // 持有它的会话被销毁或应用退出、崩溃
```

`aborted` 与 `interrupted` 都可以续接；`stopped` 只有 `stoppedBy: 'user'` 不可续接。

### 4.3 transcript 条目

| 条目 | 位置 | 发给模型 | 内容 |
|---|---|---|---|
| `subagent` 工具结果 | 父 | 是 | 前台：最终报告；后台：已启动。`details` 见 4.4 |
| `cherry.subagent-state`（state） | 父 | 否 | 每次状态变化一条快照：开始运行、结束（含结果文本和用量）、停止 |
| `cherry.subagent-notification`（custom message） | 父 | 是（user 角色） | 一条或多条子代理的结果，`details` 带结构化数据 |
| `cherry.subagent-status`（custom message） | 父 | 是（user 角色） | 压缩后的子代理状态列表 |
| `cherry.subagent-origin`（state） | 子 | 否 | 派出配置：`{ parentToolCallId, fork, description, modelKey }`，续接时重放 |
| `cherry.subagent-message`（custom message） | 子 | 是（user 角色） | 父代理通过 `message_subagent` 发来的消息 |

`awaiting_approval` 是临时状态，不写快照。

**从父 transcript 恢复子代理表**（父会话重建、`session_start` 时）：每个 `sessionId` 取最后一条 `cherry.subagent-state`：

- 还是"开始运行"，说明已经没有活着的运行，按 `interrupted` 处理（应用退出和崩溃都一样）。
- 已结束且没有任何 `cherry.subagent-notification` 的 `details` 记录过它的 `(sessionId, run)`，就是"未送达"。
- 一直在前台、从未续接的子代理没有快照：它的存在由 `subagent` 工具结果的 `details.sessionId` 证明，`description`、`fork`、`model` 取自那次调用的参数，`modelKey` 缺省时取父会话当时的模型（transcript 里 assistant 消息的 `modelKey`）。

"送达"不另写快照：通知消息本身就是送达的记录，`(sessionId, run)` 是去重键。

### 4.4 类型（对外，新增为主）

```ts
interface SubagentPort {
  configure(subagent: Subagent): SubagentSessionOptions | Promise<SubagentSessionOptions>
  /** 取回已结束子代理的 transcript（含起始条目），用于续接。不提供则已结束的子代理不能续接。 */
  load?(sessionId: string): Promise<readonly TranscriptEntry[] | undefined>
  /** 子代理工具调用的审批事件，形状同 GoalPort.onApproval。 */
  onApproval?(listener: (event: ToolApprovalEvent) => void): () => void
  /** 同一父会话同时运行的后台子代理上限，默认 20（Claude Code 的默认值）。 */
  maxBackground?: number
  /**
   * 按用户说的名字找模型：只返回已启用且支持工具调用的模型。不提供则 `subagent` 没有 `model` 参数。
   * 选择规则在包里（6.7），宿主只负责匹配。
   */
  findModels?(query: string): Promise<readonly SubagentModelCandidate[]>
}

interface SubagentModelCandidate {
  key: string          // 唯一：一个 provider 下的一个模型，也是 transcript 里 modelKey 的取值
  provider: string     // 显示名，例如 "OpenRouter"
  model: string        // 显示名，例如 "Claude Sonnet 4.5"
  exact: boolean       // query 与 provider + 模型名、或模型名完全相同
}

interface Subagent {
  parentToolCallId: string     // 创建它的 `subagent` 调用
  continuedBy?: string         // 续接时：这次运行对应的 `message_subagent` 调用
  sessionId: string
  description: string
  fork: boolean
  background: boolean
  /** 首次：`model` 参数解析出的 key，没给就不设（由宿主用默认子代理模型）；续接：origin 里记的 key。 */
  modelKey?: string
}

interface SubagentSessionOptions {
  extensionFactories?: ExtensionFactory[]
  onEvent?: (event: AgentRuntimeEvent) => void
  onSessionCreated?: (session: AgentSession) => void
  /**
   * 子代理用的模型。设了 Subagent.modelKey 就必须给这个 key 的模型，否则这次派出或续接失败，
   * 只有一个例外：modelKey 正是父会话当前模型的 key 时，不给就用父会话的模型；
   * 没设时宿主可给智能体设置里的默认子代理模型，不给就跟随父会话当前模型。实际用的 key 记进 origin。
   */
  model?: AgentRuntimeModel
}

type SubagentDetails =
  | { sessionId: string; fork: boolean; background: false; outcome: SubagentOutcome }
  | { sessionId: string; fork: boolean; background: true }   // 已启动

interface SubagentNotificationDetails {
  subagents: Array<{ sessionId: string; run: number; outcome: SubagentOutcome; stoppedBy?: 'model' | 'user' | 'budget'; usage: Usage }>
}

/** 父会话 onEvent 新增：后台子代理状态快照，宿主映射到 background-tasks / background-work-state。 */
type AgentRuntimeEvent = /* L2 已有 */ | { type: 'subagents'; subagents: SubagentView[] }

interface SubagentView {
  sessionId: string
  parentToolCallId: string
  description: string
  status: 'running' | 'awaiting_approval' | 'finished'
  outcome?: SubagentOutcome
}

interface AgentRuntimeSession {
  session: AgentSession
  dispose(): Promise<void>
  /** 宿主发起用户回合必须走这里，以便与后台投递串行（7.4）。 */
  prompt(text: string, options?: PromptOptions): Promise<void>
  /** 宿主手动压缩必须走这里，理由同上。 */
  compact(customInstructions?: string): Promise<void>
  /** 用户停止一个后台子代理；不在运行返回 false。 */
  stopSubagent(sessionId: string): boolean
  /** 用户把一个运行中的前台子代理转到后台；不是运行中的前台子代理返回 false。 */
  backgroundSubagent(sessionId: string): boolean
}
```

改名与删除（L5 未合并，直接改）：

- `GoalApprovalEvent` 改名 `ToolApprovalEvent`，移到 `ports.ts`，goal 与子代理共用。
- 删除 `GoalPort.hasRunningSubagents`：goal 通过包内接口问子代理表（第 11 节）。

## 5. 工具面

### 5.1 `subagent`

参数在 L4 基础上加两个：

- `background?: boolean`，默认 false。工具描述补充用法：需要结果才能往下走就用前台；确实有独立的事可做才用后台。
- `model?: string`，只在宿主提供了 `SubagentPort.findModels` 时出现，自由文本，工具描述里不列模型。描述写明：只在用户（或智能体指令）点名了模型时才填，照用户说的写，可以带 provider，例如 `OpenRouter Claude Sonnet 4.5`；没点名就不填。解析规则见 6.7。与 `fork: true` 同时出现时报错 `A fork shares this conversation's prompt cache and must use the current model; drop model or fork.`（换模型会让 fork 共享的前缀缓存失效）。

返回给模型：

- **前台**：最终报告，末尾加一行 `(id: <sessionId> — continue this subagent with message_subagent.)`。失败、截断等照 L4 的 `isError` 结果，末尾同样带 id。
- **后台**：立即返回 `Subagent started in the background (id: <sessionId>). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`
- **前台被用户转到后台**（6.6）：立即返回 `The user moved this subagent to the background (id: <sessionId>); it keeps working. You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work. Continue with what the user asks next.`，`details` 与后台派出相同。

后台派出超过上限时报错：`<n> background subagents are already running; wait for one to finish before starting another.`

### 5.2 `message_subagent({ id, message })`

先确认 `id` 属于当前父会话（第 8.5 节），再按状态处理，返回文本写明是哪一种：

| 状态 | 处理 | 返回 |
|---|---|---|
| 正在跑（含等审批） | 进它的收件箱，在它当前这批工具结束后送进去；它 settle 时收件箱还有消息就接着跑 | `Message queued for subagent <id>; it reads it after its current step.` |
| 已结束：`completed`、`failed`、`truncated`、`limit_reached`、`aborted`、`interrupted`、`stopped`（model/budget） | 续接：取回 transcript，重建，以这条消息开始新一次运行，总在后台；结束时照常发通知 | `Subagent <id> resumed in the background with your message; you will be notified when it finishes.` |
| 已结束，`stopped` 且 `stoppedBy: 'user'` | 拒绝 | `Subagent <id> was stopped by the user and cannot be continued. Start a new subagent if the work is still needed.` |
| 宿主没有提供 `load` 且子代理已结束 | 拒绝 | `Subagent <id> has finished and this app cannot continue finished subagents. Start a new subagent instead.` |
| id 不属于当前父会话 | 报错 | `No subagent with id <id> in this conversation. Subagents you can address: <id — description — status，逐行>` |

### 5.3 `stop_subagent({ id })`

- 正在跑：中止，`outcome: 'stopped'`、`stoppedBy: 'model'`，返回 `Stopped subagent <id>.` 加部分输出（最后一段非空回复）。这次运行**不再发通知**（模型已经知道结果，再通知只会重复唤醒）。以后仍可用 `message_subagent` 续接。
- 不在运行：返回 `Subagent <id> is not running (<status/outcome>).`，不算错误。

### 5.4 共同规则

- 子代理的会话里调用这三个工具都会失败：普通子代理没有这三个工具（与 L4 一样不挂载）；fork 子代理为保持与父代理一致的工具列表会挂载，但调用时报 `Subagents cannot start or manage subagents.`。
- 前台、后台、续接用同一份工具集。
- 状态消息与错误里的 id 列表最多列 20 个，按最近活动排序。

## 6. 派出与运行

### 6.1 共用运行（`subagentRun.ts`）

L4 的 `run()` 抽成 `runSubagent(child, prompt, options)`，保留：从 `message_end` 收集回复（不读 `session.messages`）、每次运行最多 200 次模型请求（在 `turn_start` 检查）、运行前已中止时在 `agent_start` 重发中止、outcome 分类、用量求和。新增：

- 运行结束前检查收件箱（6.4），有消息就以它开始下一段，不结束。
- 结束时交给调用方：前台调用方把它变成工具结果；后台调用方把它写成"结束"快照并排进通知队列。

### 6.2 前台

行为与 L4 相同，差别只有：子会话 id 改为 `randomUUID()`；`Subagent` 多了 `description`、`background: false`、`modelKey?`；起始条目先经 `onEvent` 发出（8.1）；结果末尾带 id。前台结束后子会话照旧销毁；以后续接时从宿主取回重建。

### 6.3 后台

1. 校验参数、并发上限（只数后台运行中的）。
2. 生成 `sessionId`，构造起始 transcript（fork 前缀 + origin 条目），`await port.configure(subagent)`，建子会话，起始条目经子会话 `onEvent` 发出。
3. 写"开始运行"快照，发 `subagents` 事件，立即返回已启动结果。
4. 子会话在后台跑 `runSubagent`，**不挂父工具调用的 signal**：父代理这一轮结束或被中止都不影响它（D2）。
5. 结束：写"结束"快照（outcome、结果文本、用量），发 `subagents` 事件，进通知队列（第 7 节），销毁子会话。

子会话在运行期间常驻内存；结束后销毁，续接时再重建。

### 6.4 收件箱（发给运行中子代理的消息）

每个运行中的子代理有一个收件箱，消息按到达顺序保存：

- 子会话正在跑：立即以 `cherry.subagent-message` 自定义消息、`triggerTurn: true` 送进子会话。Pi 在运行中把它当 steer，等当前这批工具结束后、下一次请求前送入，并为它续跑。
- 从子会话自己的 `agent_before_settle` 起，收件箱不再 steer 新消息，而是先存着：Pi 判定不续跑之后几个微任务内送进去的 steer 会滞留在 Pi 的队列里，没有任何 settle 处理器看得到（实施计划探针 d2）。
- `runSubagent` 的运行返回时收件箱里有存着的消息：在同一个子会话上用它们开下一段运行（`sendCustomMessage(…, { triggerTurn: true })`）。收件箱在最后一次检查的同一个 tick 内关闭；关闭之后到达的消息按"已结束"续接（5.2）。
- 收件箱清空之前，子代理不会进入 `finished`。

这样，任何被 `message_subagent` 接受的消息都不会丢（Claude Code 在 2.1.178、2.1.280 两次修过子代理快结束时消息丢失）。

### 6.5 fork

沿用 L4：截到持有本次调用的 assistant 消息，给这条消息里每个调用补同一条占位结果，工具列表与父代理完全相同。后台 fork 与前台 fork 构造方式相同。fork 前缀会作为起始条目整段交给宿主（8.1），每个 fork 子代理各存一份；体积问题见第 16 节。

### 6.6 前台转后台

用户在宿主界面上把一个运行中的前台子代理转到后台（宿主调 `AgentRuntimeSession.backgroundSubagent(sessionId)`），模型不能触发。

- 前台调用的 `execute` 同时等两件事：运行结束，或转后台信号。信号先到时，`execute` 立即返回 5.1 的"被用户转到后台"结果，父代理这一轮可以继续。
- 运行**不重跑**，同一个子会话接着跑（Claude Code 本地旧版是用原始 prompt 重跑一遍，2.1.178 改掉了）。为此前台运行不直接用父工具调用的 `signal`，而是由调用方持有的一个中止控制器：前台时把父 `signal` 接到它上面；转后台时断开，此后父代理这一轮结束或被中止都不影响它（D2）。
- 交给子代理表：写"开始运行"快照（`background: true`、`run` 不变），发 `subagents` 事件，结束后照常进通知队列。子会话由子代理表在运行结束时销毁，不再由前台调用的 `finally` 销毁。
- 并发上限不阻止转后台（子代理本来就在跑），但计入之后的上限判断。
- 宿主可以选择在用户于前台子代理运行期间发消息时自动转后台（Cursor SDK 的做法），否则用户消息要等这批工具结束才进来；是否这样做由宿主决定，包只提供方法。

### 6.7 子代理的模型

**默认**：宿主在 `configure` 里给出智能体设置的"子代理模型"；没设就跟随父会话当前模型。用户在设置里选的是某个 provider 下的具体模型，没有歧义。

**口头指定**：用户在对话里或智能体指令里点名模型，主模型把名字填进 `model`。派出前（后台也一样，先定模型再派出），包调 `port.findModels(model)` 并按下面的规则选：

1. 没有候选：报错 `No enabled model with tool support matches "<model>". Similar: <最多 5 个相近的 provider / model>`。
2. 恰好一个候选：用它。用户把 provider 和模型都说准时，自然只剩一个。
3. 多个候选（例如同一个模型在多个 provider 下各有一个）：不替用户挑，报错并列出候选 `Several models match "<model>": <provider / model，逐行>. Ask the user which one to use, then call subagent again with the provider and model name.`。主模型用 `AskUserQuestion` 问用户一次，再带上准确的 provider 和模型名重新派出。

选中的候选 `key` 作为 `Subagent.modelKey` 交给 `configure`，宿主必须为它返回 `model`，否则派出失败。

**续接**：`modelKey` 取 origin 里记的值（首次实际用的模型），宿主据此返回同一个模型（Claude Code 2.1.211 修过续接丢模型）。

用量照常按子代理实际用的模型记账，通知 `details` 里的 `usage` 已含费用。Task 卡片显示子代理实际用的 provider 和模型。

## 7. 通知与自动轮

### 7.1 通知队列

子代理（后台运行，或任何续接运行）结束时，生成一条待送项 `(sessionId, run, outcome, stoppedBy?, 结果文本, usage)`，按结束顺序进父会话的通知队列。队列内容同时已写在"结束"快照里，所以重建后能恢复（4.3）。

以下不进队列：`stop_subagent` 停掉的运行（5.3）。用户停止的运行进队列但标为"静默"：不触发自动轮，只随下一条送给父代理的消息带上（7.5）。

### 7.2 通知消息

多条待送项合成一条 `cherry.subagent-notification` 自定义消息，内容形如：

```
Background subagent update (automatic message, not from the user):

- "补 auth 模块测试" (id: 7c1e9d52-…（完整 UUID）) completed:
  <结果文本>
- "补 billing 测试" (id: 9a02…) failed: <原因>
  Partial output before it stopped: <部分输出>
- "补 search 测试" (id: 31bd…) was stopped by the user.

2 other background subagents are still running.
```

- 开头写明是自动消息、不是用户输入（Claude Code 在通知里加"no human input has occurred"，2.1.277 加"子代理输出"头）。
- 每行带完整 id（模型要用它调 `message_subagent`）。各结局的行文：`completed:` 加缩进的报告；`failed: <原因>`；`hit its output limit before finishing.`；`was stopped after 200 model requests.`；`was aborted.`；`was stopped because the goal's budget is used up.`；以上几种有部分输出时再加 `Partial output before it stopped:` 和缩进的部分输出；`was stopped by the user.`；`was interrupted (the app closed while it was running). Continue it with message_subagent if the work is still needed.`；结尾 `<n> other background subagent(s) is/are still running.`
- 结果文本过长时：宿主提供了 offload（`ToolOutputStore`）就把全文存进去，通知里给开头预览和路径；没有 offload 就保留开头和结尾、注明中间已省略。阈值沿用 offload 的 `thresholdChars`，没有 offload 时为 20,000 字符。
- `details`：`SubagentNotificationDetails`，给宿主渲染和 goal 记账，不发给模型。
- 对模型是 user 角色（Pi 的 `convertToLlm` 把自定义消息转成 user），transcript 里是自定义消息条目，宿主不渲染成用户气泡。

### 7.3 父会话正在跑：settle 时并入

包的投递处理器注册在 goal 等宿主扩展之前，在 `agent_before_settle` 里：

1. `event.context.pendingMessages` 里有 user 消息（用户在这一轮期间发的）：这次不送，留到下一个 settle（用户优先）。
2. 否则队列里有非静默的待送项：把队列（含静默项）合成一条通知，返回 `{ entries: [...event.entries, notification], continue: true }`，同一个运行接着处理它。条目一返回即提交，所以此时就算送达。
3. 否则不干预。

不在轮中插入：Pi 的 steer 要等当前一整批工具结束才进来，与 settle 时并入的延迟差别不大，而 settle 时并入能和 goal、用户消息统一排序。

### 7.4 父会话空闲：自动开一轮

触发检查的时机：子代理结束、父会话 `agent_settled`、压缩结束、`AgentRuntimeSession.prompt` / `compact` 返回。条件全部满足才开轮：

- 父会话 `isIdle`（无运行、无压缩）；
- 没有经 `AgentRuntimeSession.prompt` 或 `compact` 发起、尚未返回的调用（Pi 的 `prompt()` 准备阶段 `isIdle` 仍为 true，直接开轮会和它撞车，Pi 本身没有这把锁）；
- 不在 7.6 的抑制期；
- 队列里有非静默的待送项。

开轮方式：`pi.sendMessage(notification, { triggerTurn: true })`，通知本身就是这一轮的开头；它在 `message_end` 落盘，此时算送达。宿主据此把这一轮渲染为自主轮，来源 `background-work`（shared `AutonomousTurnOrigin` 已有，Claude Code 运行时也这样发）。

`agent_settled` 派发期间调用会被 Pi 推迟到派发之后，不需要另外处理。

### 7.5 静默项

用户停止的运行只是让父代理"知道一下"，不值得为它开一轮。静默项留在队列里，随下一条通知（7.3/7.4）或下一个用户回合一起送达；送进用户回合时由父会话的 `before_agent_start` 返回为 `message`，排在用户消息之后。不用 `deliverAs: 'nextTurn'`：它只随真正的 `session.prompt()` 送出，命令（如 `/goal resume`）开出的轮不带它，消息会滞留在 Pi 的队列里（实施计划探针 c）。在用户回合真正开始之前，这些项留在包的队列里，也会在下一个 settle 并入。

### 7.6 中止后的抑制期

父代理一轮被用户中止后，到下一个人类回合开始之前不自动开轮。两种中止都算：`session.abort()`（`agent_settled { aborted: true }`），以及宿主经自己的请求 signal 中止（`agent_before_settle` 的 `outcome: 'aborted'`，`agent_settled` 报 `aborted: false`，见 L5 的 I1）。用户按停止往往是想插话，立刻开一轮会和用户抢。期间结束的子代理照常进队列，随用户下一条消息一起送达（父会话 `before_agent_start` 返回的 `message`，见 7.5），之后恢复自动开轮。

### 7.7 重建后的未送达通知

父会话重建（含重启）时，未送达的结束项，以及被打断的运行（作为 outcome 为 `interrupted`、用量为 0 的条目），恢复进队列，但**不自动开轮**，而是合成一条 `cherry.subagent-notification` 随用户下一条消息送达（7.5 的方式）。用通知而不是状态消息，是因为通知的 `(sessionId, run)` 去重键能保证每一项只说一次；状态消息每次重建都会再说一遍。Claude Code 在 2.1.280 明确改成"恢复会话时不再自行开回合"。

## 8. 续接与持久化

### 8.1 起始条目交给宿主

新建子代理时，起始 transcript（fork 前缀 + `cherry.subagent-origin`）在 `configure` 之后、子会话建好之前，经子会话的 `onEvent` 以 `transcript-append` 发出一次；这样子会话的扩展在 `session_start` 里追加的条目，在宿主只追加的副本里排在它们后面。之后的条目照 L2 规则发出。宿主按 `sessionId` 存下这些条目，就得到了完整的子代理 transcript。续接重建时不再发起始条目（宿主已经有了）。

### 8.2 续接流程

1. `message_subagent` 校验 id 与状态（5.2）。
2. `await port.load(sessionId)` 取回 transcript。取不到：返回错误 `Subagent <id> cannot be continued: its transcript is not available.`
3. 读 origin 条目，构造 `Subagent`（`continuedBy` = 本次 `message_subagent` 调用，`modelKey` 取 origin 里的），`await port.configure(subagent)`。宿主按 `modelKey` 返回 `model`，扩展与首次一致（Claude Code 修了 4 次续接后缓存失效、修过续接丢模型，原因都是续接时重新计算了配置）。
4. 修补 transcript（8.3），以它重建子会话。
5. 写"开始运行"快照（`run + 1`），在后台以这条消息跑 `runSubagent`，结束照常进通知队列。

续接运行同样受每次运行 200 次请求上限、并发上限约束。

### 8.3 被打断的运行

上一次运行是 `interrupted` 或 `aborted` 时，transcript 末尾可能有没有结果的工具调用。重建前为每个这样的调用补一条工具结果：`This tool call was interrupted (the app closed or the turn was stopped); its result is unknown. Check the current state before relying on it.`（不能说成"用户拒绝"，Claude Code 2.1.296 修过这一点）。只给最后一条可重放回复里的调用补：被中止或出错的 assistant 回复在重建时会被 Pi 丢掉，给它的调用补结果会变成孤立结果（实施计划探针 f）。补上的结果在子会话建好之前经 `onEvent` 交给宿主，否则宿主下次取回的 transcript 里，那个调用后面仍然没有结果。续接消息前加一句恢复提示：`Your previous run was interrupted. Check the current state of the workspace first and do not redo work that is already done.`（Cline Teams、OpenCode v2 都这样做）。

### 8.4 宿主的存储

- 子代理 transcript：按 `sessionId` 存，只追加。
- 父子关系：宿主在 `configure` 时就知道父会话是哪个，记 Cherry 自己的会话 id（不记 Pi 的会话 id，它会变）。
- 删除父会话时一并删除子代理的存储。

### 8.5 id 归属校验

`message_subagent`、`stop_subagent` 收到的 id 必须出现在当前父会话的 transcript 里：某条 `subagent` 工具结果的 `details.sessionId`，或某条 `cherry.subagent-state` 快照。不依赖任何前缀，父会话 id 变了也不影响。

## 9. 停止

| 谁停 | 入口 | outcome | 通知 | 可续接 |
|---|---|---|---|---|
| 模型 | `stop_subagent` | `stopped` / `model` | 不发，结果在工具返回里 | 是 |
| 用户 | 宿主停止按钮 → `AgentRuntimeSession.stopSubagent` | `stopped` / `user` | 静默项（7.5） | 否 |
| goal 预算用完 | goal 通过包内接口（11.4） | `stopped` / `budget` | 照常进队列（非静默） | 是 |
| 用户中止父代理的一轮 | `session.abort()` | 后台：不受影响；前台：`aborted`（L4） | 前台：工具结果 | 是 |
| 父会话销毁 | `dispose()` → `session_shutdown` | 包中止所有运行中的子代理；重建后按 `interrupted` 恢复 | 重建后随用户下一条消息送达 | 是 |

Pi 不会替扩展取消工具返回之后仍在跑的工作，父会话 dispose 后 `pi.*` 还会同步抛错，所以后台子代理的收尾必须在父会话的 `session_shutdown` 里做：中止每个子会话、等它们 settle、销毁。此时不再写快照（不保证还能写），重建时由"最后一条是开始运行"推断为 `interrupted`。

## 10. 审批

- 子代理的审批扩展由宿主在 `configure` 返回（L4 不变）。宿主用 `Subagent.description`、`background` 给审批卡打标签，审批卡显示在父会话里，与当前是否有进行中的一轮无关。
- **等审批状态**：宿主经 `SubagentPort.onApproval` 发出审批事件（与 `GoalPort.onApproval` 同形，`ToolApprovalEvent { kind: 'pending' | 'granted' | 'denied' | 'unavailable'; toolCallId }`）。包观察子会话的工具调用，把 `toolCallId` 对到子代理：`pending` 时置 `awaiting_approval`，其余回到 `running`，并发 `subagents` 事件。父代理在状态消息（第 12 节）和错误里的 id 列表中也能看到"等审批"（Claude Code #99887：父代理不知道子代理卡在审批上，无人值守时整晚停住）。
- 拒绝只拒那一次调用，子代理收到原因后继续（宿主审批扩展的现有行为）。
- 无人值守的会话（频道、定时任务）沿用宿主现有的 `unavailable` 路径直接拒绝。goal 运行中照常等用户（产品默认）。
- 宿主接入约定：
  - 审批请求以父会话为准汇总，生命周期跟着子代理走，父代理这一轮取消时不清掉（VS Code #337339、OpenCode #44747）。
  - 每条请求对应一个子代理，逐条确认，不提供"一次批准多条"（Cline 3.0.63 的教训）。
  - 拒绝时附的反馈发给发起请求的子代理。
  - 来源标签由运行时打，不读子代理自报的字段。

## 11. goal

### 11.1 等待

goal 在 settle 做决定时（L5 spec §6.2 的 decide），原来的 `hasRunningSubagents` → `blocked / waiting_subagents` 一条改为：

- 有后台子代理在运行（含等审批）且没有其他停止条件：**不续跑，也不停**，goal 保持 `active`、已武装，不写快照。`/goal` 状态显示 `Waiting for N background subagents`。
- 子代理结束、通知开出自动轮；那一轮 settle 时 goal 照常判断是否续跑。

`waiting_subagents` 停止码删除。

### 11.2 与通知在同一个 settle

投递处理器在 goal 之前运行。goal 在 `event.entries` 里看到本次 settle 已带上 `cherry.subagent-notification` 时让路：不追加 goal 轮、不停；通知轮跑完后的下一个 settle 再判断。这样一次请求里只有一种开头，模型不会同时收到通知和 goal 轮提示。

### 11.3 通知轮的身份

通知开出的轮（自动开轮或 settle 时并入的续跑）既不是人类回合，也不是 goal 轮：不计入 goal 轮数，不重置人类回合相关的计数，模型在这一轮里不能新建、修改、暂停或恢复 goal（L5 已有规则：这些动作只在人类回合）。L5 只给 goal 轮记用量；本文新增一条：goal 激活且已武装时，通知轮里父代理自己的用量也计入预算，因为这一轮是在为 goal 处理子代理的结果。

### 11.4 用量与预算

- goal 轮里派出的后台子代理，其每次运行的用量随通知 `details.subagents[].usage` 在送达时计入该 goal（续接运行同样计入）。goal 记下自己的轮里派出的 `sessionId`。
- 预算用完、goal 进入收尾或停止时：拒绝新的后台派出（`subagent` 返回 `The goal's budget is used up; background subagents cannot be started.`），并停掉这些 goal 派出的、正在跑的后台子代理（`stoppedBy: 'budget'`）。
- goal 与子代理表在同一个包里，goal 通过包内接口（不对外导出）查询运行中的后台子代理、停止它们。

### 11.5 审批事件归属

后台子代理的审批随时可能发生。goal 的 `onApproval` 监听只处理父会话自己 branch 上的工具调用，忽略子代理的调用：子代理的一次拒绝不会停掉父代理的 goal（L5 整体评审的不作评判项 6）。

## 12. 压缩

- **父会话压缩**：手动压缩期间不开自动轮（7.4 的条件），压缩结束后再检查投递；运行中的自动压缩发生在一轮之内，settle 时照常并入。
- **压缩后的状态消息**：压缩结束时，如果有运行中、等审批或已结束未送达的子代理，追加一条 `cherry.subagent-status` 自定义消息，列出它们（id、description、状态），并写明：运行中的会自动通知、不要重复派出、不要等待或轮询（Claude Code 2.1.83 修过压缩后看不到后台子代理导致重复派出；Codex #12774）。运行中用 `triggerTurn: false`（本 turn 结束时追加），空闲时直接追加，都不触发新的一轮。
- **重建后**：不发状态消息，被打断的运行和未送达的结果合成一条通知（7.7）。`cherry.subagent-status` 只用于压缩后。
- **子代理压缩**：沿用 L4，`CompactionSummaryRequest.sessionId` 区分主子会话。

## 13. 宿主接入约定

1. 用户回合走 `AgentRuntimeSession.prompt`，手动压缩走 `AgentRuntimeSession.compact`，不要直接调 `session.prompt` / `session.compact`（7.4）。
2. 有后台子代理在运行时，不销毁、不重建父会话。宿主现有逻辑在有后台工作时推迟重建（`AgentSessionRuntimeService.ts:1706`），把 `subagents` 事件映射到 `background-work-state` 即可沿用。
3. 把 `subagents` 事件映射到现有的 `background-tasks`（任务标签条）与 `background-work-state`；停止按钮（`ai.agent.session.stop_background_task`）调用 `stopSubagent(sessionId)`，`taskId` 即 `sessionId`。
4. 子代理 transcript 按 `sessionId` 持久化（含起始条目），实现 `SubagentPort.load`；父子关系用 Cherry 会话 id 记录；删父会话时一并删除。
5. `configure` 对同一个子代理（首次与续接）返回一致的扩展；设了 `modelKey` 时必须按它返回 `model`（`modelKey` 正是父会话当前模型时可以不返回）。
6. 审批：按第 10 节；实现 `SubagentPort.onApproval`，与 `GoalPort.onApproval` 接同一个审批注册表；goal 只收父会话自己的工具调用（11.5）。
7. 通知轮渲染为自主轮（`background-work`），通知消息不渲染成用户气泡；`details` 可用于在轮次头显示"子代理 X 已完成"。
8. 父会话界面显示子代理花费（`details.subagents[].usage`），不让子代理花费隐身（OpenCode #45417）。
9. 模型：智能体设置里加"子代理模型"（默认跟随主模型），`configure` 在 `modelKey` 未设时返回它；实现 `SubagentPort.findModels`，只在已启用、支持工具调用的模型里按 provider 名、模型名匹配，标出完全匹配；Task 卡片显示实际用的 provider 和模型。
10. 前台子代理运行时，在它的 Task 卡片上提供"转到后台"，调用 `backgroundSubagent(sessionId)`；可选：用户在此期间发消息时自动转后台。

## 14. 对 L4 / L5 的改动

| 层 | 改动 |
|---|---|
| L4 | `subagent` 加 `background?`、`model?`；前台转后台（6.6）；子会话 id 改为 `randomUUID()`（去掉父前缀）；`Subagent` 加 `description`、`background`、`modelKey?`、`continuedBy?`；`SubagentDetails` 改为前台/后台联合；`run()` 抽到 `subagentRun.ts`；起始条目经 `onEvent` 发出；前台结果末尾带 id；origin 条目加 `description`、`modelKey`（实际用的模型）；fork 子代理调用 `message_subagent` / `stop_subagent` 报错；README 子代理一节重写 |
| L5 | 删除 `GoalPort.hasRunningSubagents` 与 `waiting_subagents`，改为 11.1 的等待；`GoalApprovalEvent` 改名 `ToolApprovalEvent` 并移到 `ports.ts`；settle 时见到通知条目让路（11.2）；通知轮的身份（11.3）；子代理用量与预算（11.4）；审批事件只认父会话 branch 上的调用（11.5）；goal 激活且已武装时通知轮的用量计入预算（11.3）；`/goal` 状态显示等待中的子代理；README goal 一节相应更新 |
| L2 | `AgentRuntimeEvent` 加 `subagents`；`AgentRuntimeSession` 加 `prompt`、`compact`、`stopSubagent`、`backgroundSubagent` |

## 15. 测试计划

所有用例断言契约，并写明破坏什么时失败；后台用例需要新的测试助手：能单独挂住某个子代理的模型、让父会话先结束（`tests/subagentSupport.ts`）。

| 用例 | 破坏什么时失败 |
|---|---|
| 后台派出立即返回 id，父代理这一轮可以结束，子代理继续跑完 | 后台派出仍阻塞；子代理随父回合结束被中止 |
| 父会话空闲时子代理结束：自动开一轮，开头是 `cherry.subagent-notification` 自定义消息，模型收到 user 角色文本 | 不唤醒；通知写成用户消息 |
| 父会话正在跑时子代理结束：通知在 settle 时并入同一个运行，轮中请求里没有它 | 轮中插入；另开一轮 |
| settle 时有用户消息排队：先处理用户消息，通知在下一个 settle 送达 | 用户消息排在通知之后 |
| 忙时两个子代理先后结束：合成一条通知 | 每个各开一轮 |
| 手动压缩期间子代理结束：压缩结束后才开轮 | 压缩中开轮 |
| `AgentRuntimeSession.prompt` 准备阶段子代理结束：不开轮，用户回合正常进行，结束后再投递 | 两个运行撞车（"already processing"） |
| `message_subagent` 发给运行中的子代理：在它当前这批工具结束后送入；在它 settle 时到达的消息让它接着跑 | 消息丢失；运行中被打断 |
| `message_subagent` 发给已结束的子代理：经 `load` 重建、在后台续接、结束后发通知；`configure` 收到原来的 `modelKey` 和 `continuedBy` | 续接用了父会话当前模型；不通知 |
| 续接被打断的子代理：没有结果的工具调用补上"被打断"结果，消息前带恢复提示 | 孤立调用被说成用户拒绝；没有恢复提示 |
| `message_subagent` 发给被用户停止的子代理被拒绝；未知 id 报错并列出可用 id；别的父会话的 id 报错 | 用户停的被复活；越界续接 |
| `stop_subagent`：返回部分输出，之后没有通知，之后可以续接 | 停止后又发通知；停了不能续接 |
| 用户 `stopSubagent`：父代理空闲时不被唤醒，下一条送给父代理的消息里提到它 | 为用户停止开一轮；完全不告诉父代理 |
| 用户中止父代理一轮：后台子代理继续；到下一个人类回合前不自动开轮，期间结果随用户消息送达 | 中止停掉后台子代理；中止后立刻自动开轮 |
| 父会话 dispose：子代理被中止；重建后它们是 `interrupted`、可以续接，状态消息随用户下一条消息送达 | 泄漏运行中的子会话；重建后仍显示运行中；重建后自动开轮 |
| 重建时有未送达的结束项：随用户下一条消息送达，按 `(sessionId, run)` 只送一次 | 重复送达；丢失 |
| 第 21 个后台派出报错；前台不计入上限 | 无上限；前台也被限制 |
| 子代理工具调用等审批：`subagents` 事件与状态消息显示 `awaiting_approval`；批准后回到 `running` | 父代理看不到等审批 |
| 子代理一次调用被拒绝不会停掉父代理的 goal | 子代理的拒绝停了父 goal |
| goal：settle 时有后台子代理在跑，goal 保持 active、已武装、不写快照；通知轮 settle 后 goal 续跑 | 仍停成 blocked；通知轮后不续跑 |
| goal：同一 settle 已有通知条目时不追加 goal 轮 | 一次请求同时带通知和 goal 轮 |
| goal：通知轮里模型调用 `create_goal` 被拒绝（不是人类回合）；通知轮不计入 goal 轮数 | 通知轮被当成人类回合或 goal 轮 |
| goal：通知轮里父代理的用量在 goal 激活且已武装时计入预算，goal 未激活时不计 | 通知轮用量漏记或误记 |
| goal：goal 轮派出的后台子代理用量在通知送达时计入；预算用完时拒绝新派出并停掉它们（`stoppedBy: 'budget'`） | 后台用量不计入；超预算仍在跑 |
| 压缩后追加 `cherry.subagent-status`，列出运行中的子代理 | 压缩后模型不知道子代理在跑 |
| 新建子代理时起始条目经 `onEvent` 发出一次；续接重建时不再发 | 宿主存不到完整 transcript；重复存 |
| 结果超过阈值：有 offload 时给预览和路径，没有时保留首尾 | 超长结果整段塞进上下文 |
| 子代理会话里调用 `message_subagent` / `stop_subagent` 失败；fork 子代理工具列表仍与父代理一致 | 子代理能管理子代理；fork 工具列表与父代理不同（缓存失效） |
| `details.sessionId` 等于 `configure` 收到的 `sessionId`，是 UUID | id 形式回退 |
| `backgroundSubagent`：前台调用立即返回"被用户转到后台"，子代理在同一个会话里接着跑完（请求不重来），结束后发通知；之后中止父代理这一轮不影响它 | 转后台时重跑；转后台后仍随父回合中止；不发通知 |
| `backgroundSubagent` 对后台、已结束或不存在的子代理返回 false | 重复接管 |
| 指定 `model` 且只有一个候选：`configure` 收到该 `modelKey`；宿主没为它返回 `model` 时派出失败 | 用了父会话模型；静默回退 |
| 指定 `model` 有多个候选（同一模型在两个 provider 下）：不派出，报错列出两个候选；带上 provider 后只剩一个，派出成功 | 替用户挑了一个 provider |
| 指定 `model` 没有候选：报错并列出相近的名字 | 静默回退到父模型 |
| `model` 与 `fork: true` 同时出现报错 | fork 换模型破坏前缀缓存 |
| 未指定 `model`：宿主返回的默认子代理模型被采用，其 key 记进 origin；宿主不返回时跟随父会话模型 | 默认模型不生效；origin 没记实际模型 |
| 续接指定过模型的子代理：`configure` 收到首次的 `modelKey` | 续接换了模型 |
| 未提供 `SubagentPort.findModels` 时工具没有 `model` 参数 | 宿主不支持时模型仍能填模型 |

## 16. 风险与已知缺口

1. **fork 前缀体积**：每个 fork 子代理各存一份父会话前缀。Codex 全量 fork 时一棵会话树曾占到约 110 GiB（#34268）。一期接受，宿主可以按内容去重；以后可改为只记截断点、续接时从父 transcript 重建前缀（代价是父会话被编辑后可能重建不了）。
2. **settle 时并入的延迟**：父代理一轮很长时，结果要到 settle 才送达。Pi 的 steer 本来也要等一整批工具结束，差别有限；以后需要再改成轮中插入。
3. **宿主未按约定走 `prompt` / `compact`**：直接调 Pi 的 `session.prompt` 会重新暴露 7.4 的竞态。宿主接入评审时检查。
4. **`session_shutdown` 里写不了快照**：靠重建时推断 `interrupted`，正确但无法区分"正常退出"与"崩溃"；一期不需要区分。
5. **settle 期间中止留下的边界条目**：L5 已知缺口（被否决的续跑或 settle 期间中止，已提交的边界条目留在 branch 尾部）同样适用于通知：通知条目已提交即算送达，若随后被中止，模型下一次请求才看到它。
6. **审批界面依赖宿主**：父会话空闲时显示审批卡、按父会话汇总，都在宿主接入 PR 里做；包这边只保证状态和事件。

## 17. 调研摘录（2026-10-13/14）

基准版本：Claude Code 文档与 CHANGELOG 截至 v2.1.296；Codex `openai/codex` main `f6aca7dc` / rust-v0.162.1；OpenCode v1.19.0 / v2.0.28；Cline main `ed469c7`；Roo Code v3.54.0；Gemini CLI v0.63.0；VS Code 1.143；Kiro CLI 2.30.0；Cursor IDE 3.21 / SDK 1.0.35；Amp 0.0.1791878731；Goose v1.54.0 / main `89d732a0`。

- **工具面收敛**：Claude Code 2.1.77 把续接并进 `SendMessage`，2.1.277 删 `TaskOutput`；OpenCode 删 `task_status`（#29179）；Goose 删 `load`（#12729）。仍以 `wait_agent` 为核心的只有 Codex，也是唯一不唤醒空闲父代理的（#15723）。
- **id 与续接**：返回 id 的 Claude Code、Codex、OpenCode、Cursor 能续接；不返回的 Gemini（#17758）、VS Code Local、Cline `spawn_agent` 不能。Gemini 用 6 位随机串时并行同名子代理共享历史（#25533），v0.44 改 UUID。
- **通知与唤醒**：Claude Code 空闲时开新回合、轮中不注入（`'later'` 优先级）、压缩期间留在队列、一次合并取出、用户输入优先；OpenCode v2 持久 inbox、`${child}:${startedAt}` 去重；Cursor SDK 1.0.31 修"父回合结束时结果被丢掉"。
- **审批演变**：Claude Code 2.1.186 从自动拒绝改为主会话弹框、标明来源、Esc 只拒这一次；Codex v0.100 永不询问 → v0.105/v0.110 继承并加跨线程审批；Goose #12802 从强制 Auto 改为转发父回合；Gemini 从免确认白名单改为派生总线冒泡、v0.36 改软拒绝。Cline 3.0.63 改为"批准 spawn 即放行"，起因是并发子代理共用 stdin。审批路由 bug：OpenCode #13715、#32388、#44747、#52411；VS Code #337339；Claude Code #99887。
- **停止**：Claude Code 后台子代理不随 Esc 停（源码注释 "background agents should survive when the user presses ESC"），Ctrl+X Ctrl+K 全停；Cursor 2.5 "always stop" → 3.21.9 只停本轮 + Stop All；Claude Code 用户停的不被自动续接（2.1.191、2.1.211）；Codex 把 interrupted 设为非终态（#13850）。
- **续接的坑**（Claude Code）：缓存失效修 4 次（2.1.265、2.1.277、2.1.280、2.1.290）、丢模型（2.1.211）、状态仍显示 completed（2.1.205）、被停止的被复活（2.1.191、2.1.211）、transcript 超 5MB 失败（2.1.257）、关机打断被说成用户拒绝（2.1.296）；恢复会话不再自动开回合（2.1.280），告诉模型哪些可续接（2.1.292）。
- **压缩**：Claude Code 压缩后重新注入 `task_status`，2.1.83 修压缩后重复派出、2.1.280 修报告未读即被压缩；Codex 每回合渲染 `<subagents>`（#12774）。
- **计量**：Claude Code `maxBudgetUsd` 含子代理、预算到顶停后台子代理；Codex 子代理 token 计入 root goal（#41183）；OpenCode 不计入，有人实测约 84% 花费看不到（#45417）。
- **goal**：Claude Code `/goal` 在有后台工作时跳过本轮评估，等后台完成后作为新回合交给模型。
- **并发**：Claude Code 默认 20（2.1.217）；Codex V1 6、V2 4（含 root，可卸载空闲）。
- **Pi 1.1.0 事实**（`agent-session.js` 行号）：`sendMessage(..., { triggerTurn: true })` 空闲时开新运行、运行中转 steer（1795-1808）；`prompt()` 准备阶段 `isIdle` 仍为 true（1517-1630），并发开运行会抛 "Agent is already processing a prompt"；steer 在整批工具结束后才送入（`agent-loop.js` 179-190、453）；settle 时 `shouldContinue = result.continue || hasQueuedMessages()`（1464）；`abort()` 不清队列（1909-1920）；工具返回后 Pi 不跟踪它启动的工作；自定义消息经 `convertToLlm` 变 user（`messages.js` 89-96），`details` 不发给模型。

## 18. 修订记录

2026-10-14，实施计划（`docs/superpowers/plans/2026-10-14-agent-runtime-background-subagent.md`）用探针实测 Pi 1.1.0 后修订：

1. 6.4：子会话 settle 起收件箱改为暂存，运行返回后在同一会话开下一段（探针 d2：settle 判定后几个微任务内的 steer 会滞留）。
2. 7.5、7.6、7.7、12：`deliverAs: 'nextTurn'` 改为父会话 `before_agent_start` 返回的 `message`（探针 c：命令开出的轮不带 nextTurn）。
3. 4.3、7.7、12：重建后不发状态消息，被打断的运行和未送达的结果合成一条通知，靠 `(sessionId, run)` 去重；状态消息只用于压缩后。
4. 8.1、8.3：起始条目在建子会话之前交给宿主；补给被打断调用的结果也经 `onEvent` 交给宿主，且只补最后一条可重放回复里的调用（探针 f）。
5. 4.4、13.5：`modelKey` 正是父会话当前模型时，宿主可以不返回 `model`，否则不做模型选择的宿主永远续接不了。
6. 7.6：宿主经自己的请求 signal 中止（`outcome: 'aborted'`）也开启抑制期（探针 g）。
7. 7.2：通知每行带完整 id，并定下各结局的行文。
