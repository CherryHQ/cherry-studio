# Agent Note: Pi 后台子智能体与续接

Status: proposed

[English](2026-10-14-agent-runtime-background-subagent.md) | 中文

## Problem

前台子智能体通过阻塞的工具调用返回报告。独立任务还需要跨越父会话当前轮次继续运行、无需轮询即可汇报，并接收后续指令。如果只把这类工作当作普通工具结果，调用返回后就失去了生命周期控制；如果把每条子会话回复都当作父会话输入，又会造成重复投递、意外唤醒和错误的 goal 计量。

本文维护 Pi 专属的执行与投递行为。包内实现已存在于当前栈，但桌面接入与完整验收尚未完成，因此继续保持 proposed。迁移设计文档不代表获得新的批准或完成验证。[子智能体控制提案](../architecture/2026-10-18-agent-runtime-subagent-control.md)维护可选公共控制与跨 harness 组合；[harness 边界](../architecture/2026-10-17-agent-harness-boundaries.md)与[运行时契约](../architecture/2026-10-17-agent-runtime-contract.md)维护公共抽象。

## Proposal

### 所有权与范围

保留 `packages/agent-runtime-pi` 中的子智能体扩展。Cherry 选择自研实现，避免让自己的 UI 与社区插件的 TUI、终端交互假设耦合。这不表示所有社区插件都需要 TUI；可复用的执行 API 可以单独评估。Pi 继续拥有原生会话、智能体循环、工具、分支和存储；扩展负责自己的子运行、控制路由与结果投递。宿主提供模型、审批、存储关联和展示；`AgentSessionDeliveryService` 不是这里的控制者。

模型侧只提供三个 `model-only` 工具：`subagent({ description, prompt, fork?, background?, model? })`、`message_subagent({ id, message })` 和 `stop_subagent({ id })`。默认前台运行。子会话使用随机 UUID，独立于提供商的工具调用 ID 和父会话 ID；每次续接递增 `run`。创建时的 `parentToolCallId` 和续接时的 `continuedBy` 标识触发调用，不代表子会话生命周期。

当前公共 Pi 适配器可以观察子上下文，并经父所有者路由中断，但对子会话 `submit` 返回 `managed-child`。原生 `message_subagent` 已可用；通过公共契约暴露它仍属于单独的控制提案。发现事件或流式输出句柄都不赋予绕过扩展、直接向子会话调用 prompt 的权力。

本范围不包含模型侧 wait、list 或中间输出读取工具、子智能体之间的编排、嵌套子智能体、命名的子类型、空闲超时、中断工作自动重启、全部停止 UI，以及文件写冲突隔离。状态消息代替模型轮询；UI 仍可通过原生观察获取流式输出。工作树或沙箱隔离需要单独设计。

### 创建、模型与限制

子会话在进程内运行，继承父会话的工具、提示词、压缩、offload、recall 和设置等会话选项。`SubagentPort.configure` 提供子会话自己的扩展、事件监听器、活跃会话回调，以及可选的模型/runtime。父会话的 `extensionFactories` 和 `onEvent` 不继承；选定的借用 `ModelRuntime` 上绑定的会话要求仍然生效。`onSessionCreated` 在第一次请求前执行，可读取已经创建的原生分支。配置或回调失败只使对应调用失败；已创建的子会话会在回调失败时被释放。

新子会话从空上下文开始，不提供子智能体管理工具。fork 使用包含当前调用的原生 assistant 条目，为该条目里的所有工具调用补齐相同的占位结果，不修改父分支。宿主必须为 fork 提供相同的工具定义与顺序；fork 保持父会话的模型/runtime，并为保留前缀而保留子智能体工具，但在子会话里执行这些工具会失败。当前子会话提示词和 `AskUserQuestion` 扩展禁止直接询问用户；审批仍经宿主处理。这是 Pi 接入策略，不是所有 harness 的共同约束。

未点名模型时，宿主可以选择默认子模型，否则使用父会话模型。只有提供 `findModels` 才暴露 `model` 参数，且仅应在用户或智能体指令点名时填写。宿主搜索已启用且支持工具调用的模型。包只选择唯一标为 `exact` 的候选：没有精确匹配时失败并列出最多五个相近名称；多个精确匹配时失败，要求明确提供商/模型。包不会静默替用户选择提供商。点名模型不能与 `fork: true` 同时使用。

实际使用的原生 `provider/id` key 写入 `cherry.subagent-origin`。续接必须还原该模型，必要时同时提供其借用 runtime。只有记录的 key 与父会话当前模型相同，宿主才可不返回模型。新 fork 会忽略 `configure` 返回的其他模型/runtime。

每次运行最多允许 200 次模型请求，包括普通轮次以及原生或宿主提供的压缩摘要请求；第 201 次请求在发出前被拒绝。子会话关闭缓存保温，因为这条请求路径会绕过计数器。回复用量从原生事件累加，压缩不会抹掉已经计入的回复。这个回复总和不是第二份账单：Cherry 的模型调用路径已经记录请求费用。

同一父会话最多同时运行 `maxBackground` 个后台子智能体，默认 20，计入尚未完成创建的预留名额和等待审批的子会话。创建失败释放名额；前台工作不占用后台名额。已在运行的前台子智能体即使达到上限也允许转后台，并计入之后的派出限制；转后台不会启动另一轮运行。

### 消息与原生存储

| 子会话状态 | `message_subagent` 行为 |
| --- | --- |
| 正在运行或等待审批 | 消息进入队列，由 Pi 在当前工具批次结束后接收；子会话开始 settle 后，暂存新消息，在同一会话里启动下一段。 |
| 正在停止或续接 | 等停止结果落盘或另一续接完成，再按得到的状态处理；并发消息不会开启相互竞争的续接。 |
| 已结束，包括 interrupted 或 aborted | 加载原生 manager，配置同一个子会话/模型，递增 `run`，在后台续接。 |
| 被用户停止 | 拒绝续接，即使随后模型或预算停止也作用于正在收尾的同一次运行。 |
| 未知 ID、缺少 loader/存储、原生 ID 错误或缺少 origin | 拒绝，不创建替代上下文，也不访问其他父会话的子智能体。 |

归属来自父会话原生工具结果和状态条目，不依赖 ID 前缀。`load(id)` 返回原生 `SessionManager`，续接前必须确认其会话 ID 和 origin。子会话保持原 ID。interrupted 或 aborted 运行会先收到恢复提示，要求检查已经完成的工作。最后一条可重放 assistant 回复中未得到结果的调用，会补充“被中断、结果未知”的工具响应；被 Pi 排除出重放的 error 或 aborted 回复不会因此产生孤立结果。重开历史不会自动重复未完成的工具。

被接受的消息会跨越子会话 settle 边界排空后才结束该次运行。但随后显式停止或关闭可能丢弃已经排队的消息；接受不保证取消后还会执行。续接以 `cherry.subagent-message` 开始，因此 `before_agent_start` 看到的是 `messageType: 'custom'`；只针对人类提示词的处理器必须检查消息类型。

文件持久化父会话在同一会话目录创建原生子文件，并记录原生父会话关联；内存父会话创建内存子会话。fork 将前缀保存在子会话原生分支中。Pi 负责文件写入，并在扩展启动前写入 origin。`session-append` 观察后续条目，不是宿主 transcript 持久化协议。宿主记录产品会话、原生会话和文件的关联，并明确删除父会话时如何删除关联子存储。

| 原生条目 | 所有者与用途 |
| --- | --- |
| `cherry.subagent-origin` | 子会话状态：创建调用、描述、fork 和实际模型 key；不作为模型输入。 |
| `cherry.subagent-state` | 父会话状态：后台运行开始、结束和已接受的用户停止；已知时包含结果与用量，不作为模型输入。 |
| `cherry.subagent-notification` | 父会话自定义消息：已结束/被打断的运行、完整子会话 ID、结果类型和结构化的逐次运行用量。 |
| `cherry.subagent-status` | 父会话压缩后的自定义消息：正在运行/等审批的子会话和未投递结果。 |
| `cherry.subagent-message` | 携带追加指令的子会话自定义消息。 |

恢复时，从最新记录得到子会话当前状态，但按每个 `(sessionId, run)` 恢复未投递结果，包括子会话已续接后仍未投递的早期运行。已提交的通知就是投递记录，不另以 delivered 标记或快照为准。已经通过 `stop_subagent` 返回的运行单独标为 `modelStopped`，不再通知。始终只在前台运行的子会话可由原工具结果发现；续接的实际模型仍从子会话 origin 获取。

### 投递与生命周期

后台结果按结束顺序到达。父会话运行时，在 outcome 为 completed 的 `agent_before_settle` 中将排队结果合成一条通知，并继续该次运行，但已经排队的用户消息优先；只有静默结果时不会延长正在 settle 的运行。父会话空闲时，允许唤醒的结果只有在宿主 prompt/compaction 的 hold 释放后，才能启动自主通知运行。每次新运行的 `before_agent_start` 都带走全部排队结果，包括 `/goal resume` 等命令启动的运行；Pi 1.3.0 对自定义消息也执行这一行为。

宿主必须调用 `AgentRuntimeSession.prompt`、`compact` 和 `abort`。包装入口阻止通知在 prompt 准备、命令/input 处理或手动压缩期间启动。settle 期间请求的 prompt 或 compaction 等待该 settle 以及 Pi 在其中启动的运行结束，再执行实际操作并如实 resolve 或 reject。仅靠原生 idle 状态无法保护这些准备窗口；直接调用原生入口会绕过协调。

| 操作 | 效果与汇报 |
| --- | --- |
| 前台完成 | 阻塞调用返回最终报告、子会话 ID、结果类型和回复用量；失败时返回原因及最后的部分输出。 |
| `backgroundSubagent(id)` | 立即返回前台调用，断开父轮次取消关联，保持同一个会话、请求和运行；结束后通知。未知、已结束或已在后台的子会话返回 false。 |
| 模型 `stop_subagent` | 停止运行，返回部分输出与该次运行用量，不再另发通知；若用户没有同时停止该次运行，仍可续接。 |
| 用户 `stopSubagent(id)` | 停止正在运行的后台子会话，在收尾前立即持久化用户意图；随下一运行开头或另一条唤醒通知静默汇报，拒绝后续续接。 |
| 用户中止父轮次 | 停止前台子会话，后台子会话继续；在另一运行开始前，禁止自动唤醒父会话。 |
| 父会话释放 | 中止并释放活跃子会话；重开后把被切断的运行恢复为 interrupted，保留关闭开始前已经结束的结果。 |

用户停止优先于重叠的模型/预算停止。`modelStopped` 另行记录模型是否已经拿到该次运行结果，既避免重复通知，也不削弱用户停止的效力。公共 Pi 子会话句柄服从这一所有者：中断后台子会话等同于用户不可续接的停止；中断前台子会话则中止其父轮次。不能把这些语义宣称为任意历史委派的精确取消。

用户中止父轮次后，后台结果继续积累，但不能立即抢占一个新轮次。下一次运行（包括用户命令启动的运行）结束抑制期并带走队列。goal 撤回过期预留轮次时将中止标为内部操作，不抑制投递；若显式包装入口 `abort()` 落在同一次撤回中，仍以用户停止为准。宿主请求被中止也视为用户停止。

重开不会仅因恢复工作而唤醒父会话。最后一条 `running` 快照恢复为 `interrupted`；若已持久化用户停止，则恢复为 `stopped/user`。恢复的结果与中断通知保持静默，直到下一次运行或一条唤醒结果一起带走它们。关闭不会为其切断的运行写终态快照；若运行已结束、仅子会话释放仍在进行，则仍记录其真实结果。临时的 `awaiting_approval` 状态不持久化。

通知是原生自定义消息，交给模型时为 user 角色文本，并明确标为自动消息；宿主不能把它渲染成人类消息气泡。结构化 details 支持渲染和预算，不进入模型文本。超过 offload 阈值的报告经宿主存储卸载；没有存储时，超过 20,000 字符的报告保留首尾。offload 失败沿用现有 offload 策略，不声称存在可读的已保存文件。压缩追加状态但不启动轮次，使模型记得进行中的工作，避免重复派出。在 settle 已提交的通知即算送达，即使运行随后被中止，也留在历史中供下一请求读取。

### 审批与 goal 协作

宿主通过 `configure` 安装审批处理，并用子会话真实的 session 与 tool-call ID 标识请求。待审批时子会话标为 `awaiting_approval`，审批结束或调用完成后恢复 `running`。应提供 `ToolApprovalEvent.sessionId`，因为不同会话的调用 ID 可能冲突。父会话审批 UI 必须在父会话空闲时仍可用，把反馈路由到请求子会话，并在父轮次结束后保留后台子会话的请求。拒绝只影响该工具调用；无人值守时使用宿主的 unavailable/拒绝路径。批准委派不等于批准子会话的所有工具。

后台子会话的审批交给用户，这是其他产品试过别的做法之后都落到的方案（见 Alternatives considered）。请求显示在父会话中，标明是哪个子会话在请求，该子会话同时等待；每条请求对应一个子会话、逐条确认，不提供一次批准多条。拒绝只拒那一次调用，子会话收到原因后继续。父会话必须看得到 `awaiting_approval`：否则它分不清卡在审批上的子会话和仍在工作的子会话，无人值守的运行会整晚停在那里。goal 运行期间，子会话的审批照常等用户处理；goal 不会自动拒绝或放行它。

[goal 文档](2026-10-11-agent-runtime-goal.md)维护 goal 状态机。没有更高优先级的停止条件时，active 且已武装的 goal 等待后台工作，不变成 blocked，也不写停止快照；进展仍可落盘。投递先于 goal 的 settle 决定执行；该 settle 已选中通知时，不再添加竞争的 goal 轮次提示。

独立通知轮既不是人类回合，也不是 goal 轮。它结束之前轮次的进展边界，不增加 goal 轮数，也不能授权仅人类回合可做的 goal 修改。随人类或 goal 轮开头附带的通知则属于该轮。active 且已武装的 goal 会计入独立通知轮里父会话请求的预算用量。

用量和归属从原生分支重建，不依赖可变累计值。发起、转后台或续接调用所在的请求计入某个 goal，该后台运行才属于该 goal；之后人类回合发起的续接不继承早期运行的归属。按 `(sessionId, run)` 对上报用量只计一次，无论通过通知还是重叠停止结果送达，也无论送达时 goal 是否已经 paused、disarmed 或 stopped。重开和 `/goal resume` 看到相同预算；宿主计费不能再收取一次这份上报用量。

active 且已武装的 goal 用完预算后，拒绝新的后台派出和续接。独立于此，每个原生 `turn_end` 和每次 settle 开始的预算检查都会停止仍属于该 goal 的后台工作，不依赖 goal 阶段或随后选择的 settle 分支。每轮确认后的暂停、让路给排队用户输入，都不能跳过检查。预算内的 pause、abort 和其他停止仍让后台工作继续。子会话审批不会停掉父 goal；审批监听器按所属会话和当前执行调用过滤。

### 尚待宿主验收

桌面接入必须在后台子会话运行时保留父会话，提供模型选择和原生存储加载，显示子会话流式进展、模型、费用及审批来源，连接单个停止与前台转后台控制，并把通知轮显示为自主 `background-work`。提议的子模型设置和 UI 操作属于宿主工作，并非包已经交付的桌面功能。用户发送新消息时自动转后台是可选宿主策略，不是包的默认行为。

## Alternatives considered

- 现在替换为社区子智能体插件：未选择，因为 TUI/展示和控制接入需要独立评估；原生 Pi 执行与存储仍然复用。
- 增加 wait、轮询和输出读取工具：本范围不选择。推送结果与压缩后状态避免忙等和重复工作，宿主仍可独立观察流式输出。
- 把后台工作绑到父工具 signal，或转后台时重启：拒绝，因为父轮次结束与用户插话不应取消后台工作，也不应重复其副作用。
- 在当前工具批次中注入结果，或因原生状态显示 idle 而绕过包装入口：拒绝，因为它会改变顺序，并与 prompt 准备、压缩和 settle 回调竞争。
- 存储宿主自有 transcript，或每个子会话只保留最新结果：拒绝，因为原生条目携带重放上下文，而较早的未投递运行也必须跨续接和重启保留。
- 一视同仁处理所有停止，或允许后来的停止覆盖用户意图：拒绝，因为模型停止允许续接、用户停止禁止续接，而关闭中断不等于用户拒绝。
- 仅在内存累计 goal 费用、只按子会话 ID 计量，或只在继续轮次时检查预算：拒绝，因为重启、多次运行、重复停止结果、暂停与排队用户输入会导致错误归属，或让超预算工作继续。
- 从父会话指针重建 fork 历史：暂缓。它能减少重复存储，但会让续接依赖可能已编辑或删除的父分支。
- 自动拒绝后台子会话的审批、让子会话永不询问或强制自动模式、只允许子会话使用无需确认的工具，或把批准委派当作批准子会话运行的所有工具：拒绝，因为 Claude Code、Codex、Goose 和 Gemini CLI 都放弃过前四种之一，而 Cline 改用最后一种只是因为并发子会话共用一个终端提示，逐条确认每个请求就能避免这一点。

最初的 2026-10-13/14 对比保留了具体故障证据：[Codex #15723](https://github.com/openai/codex/issues/15723) 区分收到结果和唤醒空闲所有者；[Codex #34268](https://github.com/openai/codex/issues/34268) 记录完整历史 fork 导致的存储膨胀；[VS Code #337339](https://github.com/microsoft/vscode/issues/337339) 记录父会话取消后子审批失去路由；[OpenCode #45417](https://github.com/anomalyco/opencode/issues/45417) 记录子会话费用被遗漏。这些证据支撑上述唤醒策略、存储取舍、审批生命周期和费用展示，不代表对上游当前实现的断言。

历史上的 [Claude Code 2.1.178 更新记录](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21178) 记录了子会话结束时丢消息、转后台重跑工作的修复；[2.1.191](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21191) 和 [2.1.211](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21211) 处理用户停止后复活和模型保留；[2.1.280](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21280) 处理迟到消息、压缩导致未读报告丢失，以及重开后自行发起轮次；[2.1.296](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21296) 区分关闭中断和用户拒绝。[Codex #13850](https://github.com/openai/codex/pull/13850) 与 [#41183](https://github.com/openai/codex/pull/41183) 保留另外两项曾考虑的选择：中断不作为终态，以及子会话用量归入根 goal。当前设计把这些故障类型转为本地约束和回归标准，而非复制其他产品的控制接口。

同一份对比还记录了子会话审批的演变。[Claude Code 2.1.186](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21186) 把后台 agent 工具的自动拒绝改为在主会话弹出提示并标明请求的 agent，Esc 只拒绝那一次工具调用。[Codex #11464](https://github.com/openai/codex/pull/11464)（v0.100）让子会话永不询问；[#12767](https://github.com/openai/codex/pull/12767)（v0.105）恢复继承父会话的审批策略，并列出等待审批的线程，[#12995](https://github.com/openai/codex/pull/12995)（v0.110）支持在其他线程中审批子会话的请求。[Goose #12802](https://github.com/aaif-goose/goose/pull/12802) 把强制 Auto 模式改为把审批转发给父回合。Gemini CLI 从[只允许无需确认的工具白名单](https://github.com/google-gemini/gemini-cli/blob/v0.10.0/packages/core/src/agents/executor.ts#L698-L728)改为[把确认冒泡到主界面](https://github.com/google-gemini/gemini-cli/blob/51617c1bcbcb038291125b092501b4342f4e7f77/packages/core/src/agents/local-executor.ts#L170-L216)。[Cline 3.0.63](https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/apps/cli/CHANGELOG.md#L99) 走了另一条路：委派获批后不再询问已配置子智能体的工具，原因是并发子会话共用一个终端提示，按一次 `y` 可能批准多项操作；Cherry 改为逐条确认每个子会话的请求。[Claude Code #99887](https://github.com/anthropics/claude-code/issues/99887) 记录了父会话看不到子会话卡在审批上，导致无人值守的运行整晚停住。

## Acceptance criteria

以下结果描述完整功能；现有源码测试是证据位置，不表示本次迁移重跑过测试或已经验收。

- AC1 — 新建与 fork 子会话具有独立原生身份；fork 保留正确前缀/工具顺序，不改变父会话，也不启用嵌套管理。 (verification: unit — Pi adapter owner, `aiSdkSubagent.test.ts` and `aiSdkSubagentFork.test.ts`)
- AC2 — 点名模型时拒绝零个或多个精确匹配；fork 保持父模型/runtime，续接保留记录的模型与 binding。 (verification: unit — Pi adapter owner, `aiSdkSubagentModel.test.ts` and `aiSdkSubagentBinding.test.ts`)
- AC3 — 子会话第 201 次模型请求（包含压缩请求）在发出前被拒绝；后台名额预留遵守配置上限，失败时释放。 (verification: unit — Pi adapter owner, `aiSdkSubagentStops.test.ts` and `aiSdkSubagentBackground.test.ts`)
- AC4 — 前台转后台使父调用立即返回，不重放子请求，并断开之后的父轮次取消关联。 (verification: unit — Pi adapter owner, `aiSdkSubagentMove.test.ts`)
- AC5 — 在子会话 settle 边界接受的消息到达同一会话；并发续接只打开一次运行，原生存储缺失或不属于该子会话时不会创建替代会话。 (verification: unit — Pi adapter owner, `aiSdkSubagentMessage.test.ts` and `aiSdkSubagentContinue.test.ts`)
- AC6 — 结果投递保留用户优先、结束顺序、compaction/prompt hold 和命令开轮投递；用户中止抑制期内不由通知开轮。 (verification: unit — Pi adapter owner, `aiSdkSubagentDelivery.test.ts` and `subagentDelivery.test.ts`)
- AC7 — 用户停止意图跨重叠停止和收尾期间关闭保留；模型停止的运行只汇报一次，公共子会话中断到达正确原生所有者。 (verification: unit — Pi adapter owner, `aiSdkSubagentStop.test.ts`)
- AC8 — 重开后每次未投递运行只汇报一次，不自动执行；保留关闭期间已经结束的结果，并以结果未知标记恢复中断上下文。 (verification: unit — Pi adapter owner, `aiSdkSubagentRebuild.test.ts` and `aiSdkSubagentContinue.test.ts`)
- AC9 — 子会话审批状态可观察；含会话身份的事件不影响其他会话，子会话拒绝审批不会停止父 goal。 (verification: unit — Pi adapter owner, `aiSdkSubagentApproval.test.ts` and `aiSdkGoalSubagents.test.ts`)
- AC10 — goal 等待时不变成 blocked；独立通知结束前一轮进展但不增加 goal 轮数，随轮次开头附带的通知保留该轮身份。 (verification: unit — goal owner, `aiSdkGoalSubagents.test.ts` and `goalState.test.ts`)
- AC11 — goal 用量和逐次运行归属跨重启保留，每次投递只计一次；暂停或排队输入不跳过预算停止，也不停止之后无关的运行。 (verification: unit — goal owner, `aiSdkGoalSubagents.test.ts`)
- AC12 — 桌面展示独立子会话进展、审批来源、模型和用量；停止与转后台控制保持包语义，自主通知不显示成人类气泡。 (verification: Electron — Cherry runtime integration owner)
- AC13 — 桌面持久化会话重开相同的原生子 ID/文件，无需事件重放即可加载，并按产品删除策略清理关联存储。 (verification: Electron — Cherry storage integration owner)

## Risks

每个 fork 都复制原生历史，增加存储；宿主按子会话 ID 划分缓存时，共享提示词文本不保证命中父会话缓存。繁忙父会话只有在 settle 才收到结果。宿主入口必须使用 hold 包装，包无法阻止直接原生调用绕过它们。

关闭切断的工作无法区分正常退出与崩溃；没有已结束运行记录时，恢复通知的用量可能为零。逐次运行回复总量和延迟送达的结果不能构成严格的实时费用上限。已经排队的消息可能被后续停止丢弃。停止被接受不代表已结束，通知被提交也不证明模型在中止前已经消费它。

审批事件缺少会话身份且调用 ID 冲突时无法区分来源。共享工作目录没有写冲突隔离。等待用户的审批是接受的代价：goal 运行期间，子会话待处理的审批会让该子会话，以及等待它的 goal，一直停到有人处理；无人值守的运行无法使用需要审批的工具。当前禁止子会话直接提问、缺少全部停止 UI，以及关闭缓存保温，都是本次接入接受的限制。维护自有扩展仍需持续跟进 Pi 兼容性。

## Current evidence

[包 README](../../../../packages/agent-runtime-pi/README.md)说明当前入口。[子智能体控制](../../../../packages/agent-runtime-pi/src/subagent.ts)、[原生子存储](../../../../packages/agent-runtime-pi/src/subagentSession.ts)、[运行执行](../../../../packages/agent-runtime-pi/src/subagentRun.ts)、[注册表/恢复](../../../../packages/agent-runtime-pi/src/subagentRegistry.ts)和[投递](../../../../packages/agent-runtime-pi/src/subagentDelivery.ts)实现上述 Pi 专属行为。[Goal 状态](../../../../packages/agent-runtime-pi/src/goalState.ts)和[goal 执行](../../../../packages/agent-runtime-pi/src/goalExtension.ts)拥有计量与预算转换。

列出的 `aiSdk*.test.ts` 位于 `src/main/ai/runtime/pi/`，包测试位于 `packages/agent-runtime-pi/tests/`。这些测试通过测试提供商和受控时序覆盖原生 Pi 与 Cherry 模型 binding。[接入 README](../../../../src/main/ai/runtime/pi/README.md)明确说明桌面连接仍使用原有路径。源码覆盖、真实提供商验收、Electron 行为和打包加载属于不同证据层级，见 [harness 证据](../testing/2026-10-17-agent-harness-evidence.md)。本次文档迁移未重跑这些执行测试。
