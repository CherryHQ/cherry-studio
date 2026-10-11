# Agent runtime 子代理（L4）设计

状态：待评审 · 2026-10-11 · 基于 L3（#21438）；L5 goal 随后 rebase 到本层之上

## 1. 背景与目标

Cherry 正把 Pi 做成唯一的 agent runtime（L1 #21436 桥接、L2 #21437 transcript、L3 #21438 todo / AskUserQuestion）。Cherry 现有的 Claude Code 和 DSH runtime 都能派子代理，Pi 没有子代理原语。本层在 `packages/agent-runtime` 里加**前台子代理**：父代理调一次工具，包在进程内建一个子 Pi 会话，跑完把结果交回这次调用。

两条约束决定了取舍：

1. **Cherry 接入所有模型，能力参差。** 工具形状要让弱模型也用得对；子代理的边界（不能再派子代理、不能问用户、不能失控）由运行时保证，不靠模型自觉。
2. **第一期按「够用」来做。** 能推迟的都推迟，但接口要能无破坏地加回来。

栈的调整（2026-10-11 定）：权限模式（五档 auto / manual / edit / plan / full）是宿主代码，单独基于 main 开 PR，不进本栈；本栈为 L4 子代理 → L5 goal → L6 worktree、沙箱、后台子代理。

### 1.1 非目标

- 后台子代理、可继续对话的子代理（`send_message`）——L6。
- worktree 隔离、沙箱——L6。
- 子代理类型（`subagent_type`）、自定义子代理定义、按子代理换模型——以后和「子代理模型」设置一起做。加类型只需给 `subagent` 加一个可选参数，不破坏本层接口。
- 多层嵌套（子代理再派子代理）。
- 子代理 transcript 的单独存储与恢复。
- fork 时复用父会话的 prompt 缓存路由键（`sessionId`）。
- 宿主接入：UI parts 的转换与保存、审批请求挂到子代理卡片下、plan 提醒的子代理版本（见第 8 节，由宿主接入层和权限 PR 实现）。

## 2. 术语

| 词 | 含义 |
|---|---|
| 父会话 | 调用 `subagent` 的会话 |
| 子会话 | 包为一次 `subagent` 调用新建的 Pi 会话，调用结束即销毁 |
| 普通子代理 | `fork` 为假：全新上下文，只看到任务消息 |
| fork 子代理 | `fork` 为真：继承父会话截至本次调用的全部上下文 |
| 任务消息 | 子会话的第一条消息，custom message 类型 `cherry.subagent-task`，内容是固定说明加上 `prompt` |
| 子代理标记 | 子会话 transcript 里的 `cherry.subagent` 状态条目，用来判断「当前是子代理」 |

## 3. 工具 `subagent`

```ts
subagent({
  description: string   // 3–5 个词，给界面当卡片标题
  prompt: string        // 交给子代理的任务
  fork?: boolean        // 默认 false
})
```

- 只有宿主传了 `subagents` 选项才注册（第 7 节）。
- `exposure: 'model-only'`：codemode 脚本不能调用，否则子代理的执行过程在界面上没有卡片可挂。
- 不延迟加载，不进 `tool_search`：和 Claude Code 的 Agent 工具一样第一轮就可见；fork 要共享缓存也要求它一直在工具池里。
- 一个工具加布尔参数，而不是两个工具。和 Claude Code 一致，少一份工具定义；用显式的 `fork: true`，不学 Claude Code「不填类型就是 fork」的隐式写法，弱模型更容易用对。
- 名字沿用 DSH 的 `subagent`：渲染端已把 cherry transport 的 `subagent` 映射到 Task 卡片（`src/renderer/components/chat/messages/tools/toolResponse.ts:33`），子代理过程带 `providerMetadata.cherry.parentToolCallId` 即挂到卡片下（`toolParentMetadata.ts`）。
- `description` 和 `prompt` 去掉首尾空白后不能为空，否则返回错误结果。
- 工具说明要讲清：普通子代理不共享对话，`prompt` 必须自足；fork 子代理看得到截至本次调用的对话；父代理只拿到子代理的最终报告，看不到中间步骤；彼此独立的子任务应在同一条消息里一起派出。
- 执行模式沿用 Pi 默认的 `parallel`：同一步里的多个调用并行运行，第一期不设并发上限。

## 4. 子会话的构建

### 4.1 从父会话继承

`port`、`requestOptions`、`sideChannel`、`model`、`cwd`、`agentDir`、系统提示词与追加提示词、context files、skills、内置工具、自定义工具、`compaction`、`offload`、`recall`、Pi 设置，以及 `subagents` 选项本身。扩展不继承，由宿主按子代理给（4.3）。

### 4.2 普通与 fork

| | 普通子代理 | fork 子代理 |
|---|---|---|
| 初始 transcript | 子代理标记 | 父会话 transcript，截到携带本次调用的 assistant 消息为止；再为该消息里的每个工具调用补一条占位结果；最后是子代理标记 |
| 第一条新消息 | 任务消息 | 任务消息（在占位结果之后） |
| 工具 | 宿主给的扩展；包不注册 `subagent` | 必须与父会话相同；包注册 `subagent`，调用时拒绝 |
| `tool_search` 激活的工具 | 无 | 随 `cherry.tool-loadout` 从 transcript 继承 |

fork 的几个细节，都是为了让同一步并行派出的多个 fork 共享 prompt 缓存（做法同 Claude Code 的 `forkSubagent.ts`）：

- **截断位置**：截到携带本次调用的 assistant 消息，而不是「已完成的轮次」。这样子代理看得到父代理当前的推理，各个兄弟 fork 的前缀也相同。并行执行时，兄弟调用的真实结果可能已经写进父会话，按 assistant 消息截断可以把它们排除在外。
- **占位结果**：该 assistant 消息里的每个工具调用（包括本次调用）都补一条文本完全相同的结果，例如 `This tool call was still running when the subagent started; its result is not available here.`
- **工具一致**：工具定义排在请求最前面，fork 子会话的工具列表必须和父会话逐项相同，顺序也相同。包在父、子会话里把 `subagent` 扩展放在同一位置；宿主在 fork 时返回与父会话相同的扩展列表。子代理不该用的工具照样挂着，调用时拒绝（第 5 节），这和 plan 模式「挂载但拦下」是同一原则。
- **宿主扩展的边界**：fork 子会话里，宿主扩展不能改系统提示词和工具声明；差异只能出现在任务消息之后（比如提醒消息）。
- **上下文过大**：继承的上下文接近窗口时，由子会话自己的压缩接手（压缩配置从父会话继承），不另做处理。

### 4.3 宿主回调

每创建一个子代理，包调用一次 `subagents.child(info)`，宿主返回这个子代理的扩展和监听（第 7 节）。回调可以是异步的；它抛错时这次 `subagent` 调用失败，父会话照常继续。

### 4.4 任务消息与启动

任务消息是 `display: false` 的 custom message，`details` 为 `{ parentToolCallId, fork }`。内容是一段固定的英文说明，加上 `prompt`：

> You are a subagent working for another agent, not for the user. Do the task below with your tools, then finish with one final message that reports the result in full — the other agent sees only that final message. You cannot ask the user questions and you cannot start subagents.

说明放在任务消息里，不放进系统提示词，fork 的前缀才能和父会话一致。子会话用 `session.sendCustomMessage(taskMessage, { triggerTurn: true })` 开跑。

### 4.5 子会话 id

`${父 sessionId}/${toolCallId}`，同时是子会话请求里的 `sessionId`。

## 5. 子代理识别

包在子会话的初始 transcript 末尾放一条状态条目 `cherry.subagent`（`{ parentToolCallId, fork }`）。判断「当前是子代理」就看当前分支上有没有这条状态条目。

- 用状态条目而不是任务消息：压缩只折叠消息，不动状态条目（L2），子代理压缩后仍能识别。
- 父会话不是子代理（只有一层），所以 fork 继承来的历史里不会有这条状态，判断不会混淆。
- 状态条目不发给模型，不影响请求前缀；它在初始 transcript 里，不经 `onEvent` 发出。

子代理里各工具的行为：

| 工具 | 子代理里 |
|---|---|
| `subagent` | fork 子代理：返回错误结果「Subagents cannot start subagents.」；普通子代理不注册 |
| `AskUserQuestion` | 不调 port，直接以 `unavailable` 结束（L3 已有的结果类型），模型据此自行判断并在报告里写明假设 |
| `todo_write` | 照常使用；fork 子代理从父会话的列表接着写，写入只进子会话 |
| goal 工具与续跑 | L5 实现，见第 9 节 |

识别函数留在包内，供 `AskUserQuestion` 和 L5 的 goal 扩展使用。宿主不需要它：宿主在 `child()` 回调里已经知道这是子代理。

## 6. 运行与结果

1. 调宿主的 `child(info)`，按 4.2 建子会话。
2. 在第一次模型请求前调 `onSession(session)`，让宿主订阅实时输出。
3. 子会话的 transcript 事件只交给 `onEvent`，不进父会话的 `onEvent`。
4. 发任务消息开跑，等子会话 settle。
5. 无论结果如何，最后都 dispose 子会话。

结果：

- **正常结束**（最后一条 assistant 消息的 `stopReason` 为 `stop`）：工具结果是这条消息的文本；没有文本时给一句固定说明。
- **失败**（`error`、`length`、`aborted`，或触到请求上限）：返回 `isError: true` 的结果，文本写明原因，再附上已有的部分输出（最后一条 assistant 文本）。用 `isError` 返回而不是抛错，是为了保留 `details`，让用量照样能被 L5 计入预算。
- `details`：

```ts
interface SubagentDetails {
  childSessionId: string
  fork: boolean
  stopReason: 'stop' | 'length' | 'error' | 'aborted' | 'request_limit'
  usage: { tokens: number; usd: number }   // 子会话所有回复的 usage.totalTokens 与 usage.cost.total 之和，口径同 goal
}
```

- **中止**：父会话这一轮中止时，工具的 `signal` 触发，子会话随之中止，结果 `stopReason` 为 `aborted`。
- **请求上限**：每个子代理最多 200 次模型请求（按 `turn_end` 计，压缩摘要请求不计），和 Claude Code 给 fork 设的 `maxTurns` 相同。到达后中止子会话，`stopReason` 为 `request_limit`。弱模型容易循环，这是一道兜底。
- **崩溃**：父会话 transcript 里留下没有结果的 `subagent` 调用，重建时 L2 按失败关闭它。子代理改过的文件留在磁盘上。

## 7. 宿主接口

```ts
interface AgentRuntimeSessionOptions {
  // ...已有字段
  subagents?: AgentRuntimeSubagents
}

interface AgentRuntimeSubagents {
  /** 每创建一个子代理调用一次。fork 时 extensionFactories 必须给出与父会话相同的工具。 */
  child(info: SubagentChildInfo): SubagentChildOptions | Promise<SubagentChildOptions>
}

interface SubagentChildInfo {
  parentToolCallId: string
  childSessionId: string
  fork: boolean
}

interface SubagentChildOptions {
  extensionFactories?: ExtensionFactory[]
  /** 子会话自己的 transcript 事件（不含初始 transcript），形状同父会话的 onEvent。 */
  onEvent?(event: AgentRuntimeEvent): void
  /** 第一次模型请求前调用，宿主在这里订阅实时输出。 */
  onSession?(session: AgentSession): void
}
```

导出 `SUBAGENT_TOOL_NAME`、`SubagentDetails` 和以上类型。

## 8. 宿主接入时要做的（不在本层）

- **渲染与保存**：把子代理的实时输出转成带 `providerMetadata.cherry.parentToolCallId` 的 UI parts，随父会话那一轮的消息保存（DSH、Claude Code 现有做法）。子代理 transcript 第一期不单独入库。
- **审批**：`subagent` 本身自动放行（子代理里的每个工具调用各自走审批），像 `AskUserQuestion`、`todo_write` 一样写进 README 的宿主须知。子代理的审批请求冒泡给用户（同 Claude Code 的 `bubble`）；无人值守的 run 里照父会话的规则拒绝。
- **权限模式与 plan**（依赖独立的权限 PR）：
  - 子代理拿到的是同一个审批扩展，权限模式自然继承；plan 的只读限制在子代理里照样生效，所以 plan 下可以派子代理。
  - fork 子代理挂着 `exit_plan_mode`，调用时拒绝；普通子代理不挂。
  - plan 提醒有子代理版本，不提退出 plan。
- **扩展列表**：普通子代理不需要 `exit_plan_mode`、goal 工具，宿主可以不给；fork 子代理必须给全。

## 9. 与 L5 goal 的衔接

L5 rebase 到本层后，goal spec 要相应修订：

1. **`hasRunningChildren`**：前台子代理在工具调用内跑完，`agent_before_settle` 时不可能有子代理在跑；这个注入到 L6 后台子代理才有意义，L5 保持不接。
2. **子代理用量计入预算**：goal 在 `turn_end` 记账时，把本轮 `subagent` 结果的 `details.usage` 一并计入。goal spec §1.1 的非目标「子 agent 的 token 用量归并到父 goal 预算」随之删除。
3. **轮次**：子代理内部的请求不算 goal 轮次，一轮仍是「父代理停下后被推一次」。
4. **子代理里 goal 不生效**：用第 5 节的识别函数，子代理里 goal 工具返回错误、不续跑、忽略 fork 继承来的 `cherry.goal` 状态。不这样做，fork 子代理会以为自己身上有个活跃的 goal 而不停续跑。
5. **权限模式名**：goal spec §3.3、§10 引用的 #19591 四档已作废，改为五档 auto / manual / edit / plan / full；plan 下不启动自主续跑轮。
6. `subagent` 是否算「有进展」的工具由 L5 决定（当前 `NON_PROGRESS_TOOLS` 不含它，即算进展）。

## 10. 测试计划

每个测试写明它在什么情况下会失败；写不出来的不写。全部用包内已有的 scripted model + 真实 `streamText` 驱动。

| 测试 | 破坏什么时失败 |
|---|---|
| 普通子代理在独立上下文里运行，第一次请求只含任务消息；结果是它最后一条回复的文本，`details` 带 `childSessionId` 和累加的 `usage` | 上下文串了父会话；取错消息；用量没累加 |
| fork 子代理的第一次请求 = 父会话截至本次调用的消息 + 占位结果 + 任务消息；同一步两个 fork 的请求只有最后一条消息不同 | 截断位置错；混入兄弟调用的真实结果；占位文本不一致 |
| fork 子代理的工具列表与父会话逐项相同，包括 `tool_search` 激活的工具 | 工具不一致，缓存失效 |
| fork 子代理调用 `subagent` 得到错误结果；普通子代理的工具里没有 `subagent` | 嵌套失控 |
| 子代理里 `AskUserQuestion` 以 `unavailable` 结束，port 未被调用 | 子代理向用户提问 |
| 子代理压缩后仍被识别为子代理 | 识别依赖会被折叠的消息 |
| 同一步两个 `subagent` 调用在时间上重叠 | 被串行执行 |
| 父会话中止 → 子会话中止并被 dispose，结果 `stopReason: 'aborted'` | 子代理在后台继续跑 |
| 子代理以 `error` 或 `length` 结束 → `isError` 结果，带部分输出和 `usage` | 失败被当成成功；用量丢失 |
| 第 200 次请求后中止，`stopReason: 'request_limit'` | 没有上限 |
| `child()` 抛错 → 本次调用失败，父会话继续 | 宿主错误击穿父会话 |
| 子会话的条目只进 `child().onEvent`；父会话 transcript 只多出这次调用和它的结果 | 子代理条目污染父 transcript |
| `onSession` 在子会话第一次模型请求之前被调用 | 宿主漏掉流式输出的开头 |
| 不传 `subagents` 时没有 `subagent` 工具 | 门控缺失 |

## 11. 决定记录

1. 一个 `subagent` 工具加 `fork` 布尔参数，不分两个工具，也不用「不填类型就是 fork」的隐式写法。
2. fork 截到本次调用（同 Claude Code），不截到已完成的轮次（DSH）：子代理看得到父代理当前的推理，兄弟 fork 共享缓存前缀。
3. 子会话由包来建，宿主通过 `child()` 回调按子代理提供扩展和监听；子代理的事件不走父会话的 `onEvent`。
4. fork 子代理工具与父会话完全一致，不该用的工具调用时拒绝，不从工具池里拿掉。
5. 子代理识别用状态条目，不用任务消息，以免被压缩折叠。
6. 每个子代理 200 次请求上限。
7. 子代理类型推迟，以后与「子代理模型」设置一起做。
8. `subagent` 不延迟加载。

## 12. 实施顺序

全部在包内完成，宿主接入另做。包 README 新增「Subagents」一节，并在宿主须知里写明 `subagent` 自动放行、fork 时扩展列表须与父会话相同。完成后 L5 goal 分支 rebase 到本层，并按第 9 节修订 goal spec 和计划。
