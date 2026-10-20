# Agent Note: Runtime 访问、输入、观察与生命周期契约

Status: proposed

[English](2026-10-17-agent-runtime-contract.md) | 中文

## Problem

Cherry 需要跨 harness 打开原生上下文、提交输入、独立于某次提交观察工作，并释放资源。要求所有 harness 采用 Cherry 的会话引擎，会重复实现原生调度和恢复；庞大的能力矩阵则会迫使每个消费者自行解释差异。

本文接替栈中的 Runtime 所有权与行为设计，记录已实现的 v0 访问边界及其理由，以及接入时仍需履行的宿主责任。[公共类型](../../../../packages/agent-runtime/src/contracts.ts)、[Pi 适配器](../../../../packages/agent-runtime-pi/src/runtime.ts)和 [Pi Durable 适配器](../../../../packages/agent-runtime-pi-durable/src/runtime.ts)维护精确签名。包代码已存在；桌面接入及下述完整验收尚未完成。[Harness 边界](2026-10-17-agent-harness-boundaries.md)维护更上层的职责划分。

## Proposal

### 保持公共入口精简

当前公共形状如下：

```typescript
interface AgentRuntime {
  open(ref: Thread): Promise<OperationResult<ThreadHandle>>
  shutdown(): Promise<OperationResult<ShutdownReceipt>>
}

interface ThreadInput {
  readonly policies: readonly BusyPolicy[]
  submit(input: InputDraft): Promise<SubmitResult>
}

interface ThreadHandle {
  readonly thread: Thread
  readonly input?: ThreadInput
  observe(sink: ObservationSink): Promise<OperationResult<Observation>>
  interrupt?: () => Promise<OperationResult<InterruptReceipt>>
  release(): Promise<void>
}

interface Observation {
  stop(): Promise<void>
}
```

| 入口 | 单独存在的原因 |
| --- | --- |
| `open` | 访问已知上下文，不创建替代品，也不覆写其配置。 |
| `input?.submit` | 在访问支持输入时交给原生接纳；回执与观察到的输出分开，不拥有唯一专属响应流。 |
| `observe` | 重新观察已有工作，包括没有新提交仍在继续的 child 工作。 |
| `interrupt?` | 仅在存在原生中断能力时提供入口，并保留实际作用范围。 |
| `release` / `stop` | 结束调用方的访问或观察，不取消其他所有者的工作。 |
| `shutdown` | 由资源所有者关闭整个已配置 Runtime 实例。 |
| `thread` / `input.policies` | 保存可寻址上下文并选择支持的输入安排，无需解释通用能力语言。 |

异步工厂与 `create` 保留在具体适配器。Pi 接收 `AgentRuntimeSessionOptions`，包含原生 `ModelRuntime`、`Model` 和 `SessionManager`；Pi Durable 接收原生 `HarnessOptions`、独占存储工厂和 `ConversationCreateOptions`。这些都是强类型配置，不是任意 options 袋。初始化失败时清理已取得的资源；宿主共享模型服务仍是借用资源。

Pi Durable 还提供 Runtime 级 `resume`、具体句柄上的 `lookupInput` 和 `retractInput`，以及 `input.submit` 的去重能力。原生命令发现、配置变更、上下文编辑和 fork 不属于公共强制方法。工具、审批和模型桥保留在现有适配器与宿主边界；只有消费者需要跨实现相同语义时才提取公共行为。

接口没有通用 `spawn`、精确任务取消、交互响应、历史分页或重放游标。可选的 `ThreadHandle.input` 表达只读访问，可选的 `Subagent.child` 表达没有可访问上下文的关系。当前 Pi 和 Durable 的具体句柄均提供输入。Pi 托管 child 的输入经过扩展所有者，只暴露 `steer`。[子智能体控制文档](2026-10-18-agent-runtime-subagent-control.md)记录本轮已实现部分及剩余控制方案。

### 把提交定义为原生输入接纳

`InputDraft` 包含宿主的 `inputId`、`text` 和 `whenBusy: 'reject' | 'steer' | 'follow-up'`。具体访问入口决定原生输入路径。普通 Pi 根会话 prompt 可能在到达模型接纳前触发命令或钩子：

```text
Input -> native command/input hooks -> locally handled
                                  -> model admission applies whenBusy
```

| 到达原生模型接纳点时 | `reject` | `steer` | `follow-up` |
| --- | --- | --- | --- |
| 前台空闲 | 可以开始工作。 | 可以开始工作。 | 可以开始工作。 |
| 前台忙碌 | 拒绝这次模型输入，不排队。 | 在原生支持的边界安排干预。 | 按原生规则安排后续输入。 |

这不是针对指定执行的原子条件，也不证明所有后台工作和队列均为空。不支持的策略在原生派发前拒绝；配置或已关闭资源仍可能阻止本来允许的输入。先前处理的命令或钩子不受 busy 策略约束：Pi 的 `/goal pause` 在忙碌且选择 `reject` 时仍可处理。`locally-handled` 标识处理路径，不证明命令成功。跳过 Pi prompt-template 展开不能跳过所有输入 handler，因此不能实现无副作用的 idle-only 操作。这类保证需要原生原子接纳或受约束的扩展，不能靠前置 `isIdle` 检查实现。

Pi 托管 child 输入使用所有者的 `messageSubagent`：运行中的 child 接收排队消息，已结束的 child 则加载上下文并启动新的后台 run。它仅接受 `steer`，不把斜杠文本解释为根会话命令，也不模拟其他策略。续接保留控制器对 loader 的要求、用户停止后的拒绝规则和原生结果交付。这不保证消息不会唤醒执行。

提交回执报告证据：`accepted`、`queued`、`dispatch-started`、`locally-handled` 和 `placed` 是事实集合，不是线性状态机。排队、派发和放置均不证明模型已消费。确认接纳不证明执行完成或目标成功。通用操作返回 `confirmed`、`rejected`、`unsupported` 或 `unknown`；提交使用 `acknowledged` 表示已确认交接。预期失败通过结果表达；编程错误仍可抛出。v0 的错误码是字符串，不是穷尽的公共枚举。诊断消息不能携带密钥或原生对象；宿主把注入的错误回调接到 `loggerService`。

只有明确未接纳时才能返回拒绝。未知结果必须保留未知；后续查询失败不能推翻已确认的接纳。宿主在提交前保存逻辑输入与传输尝试，窗口停止等待后继续持有 Promise，并记录迟到回执。`input.changed` 可以确认逻辑输入，而不证明哪一次结果未知的传输成功。Runtime 不提供持久的宿主投递日志。

同一 `InputId` 的文本和 busy 策略不可变。新内容属于新逻辑输入。Pi 没有持久的原生输入去重，未知结果不能触发自动重试。Durable 的原生去重键与查询允许采用不同的投递政策；宿主保存它们与 `InputId` 的关系，并重放原草稿。原生同类型去重不会校验 payload 相等。查询未找到不证明没有副作用。撤回区分 `withdrawn`、`already-placed` 和 `already-settled`；撤回单个输入不是中断会话。

### 只公开消费者需要引用的身份

| 公共身份 | 用途 |
| --- | --- |
| `Thread { backendId, id }` | 定位已配置 backend 内的原生上下文；持久性取决于原生存储。 |
| `InputId` | 宿主逻辑输入身份，至少在目标上下文内唯一，独立于传输尝试。 |
| `ItemRef { session, id }` | 标识可更新内容与工具关联。 |
| `SubagentId` | 在父 Thread 内标识跨 child 输入和运行保留的关系，不建立任务身份，也不要求存在可访问的子上下文。 |
| `NativeInputRef { session, id }` | 在支持时定位真实原生输入，供查询或撤回。 |

ID 使用不同的 branded 字符串类型。消费者可以序列化它们，但不能互换、解析前缀或从格式推断生命周期。宿主提供 `InputId`；适配器返回原生、上下文和内容引用。恢复 branded ID 前应校验存储和传输数据。宿主配置稳定的 `backendId` 命名空间并保证唯一写入者；v0 不增加跨进程锁。

`SourceRef`、epoch、revision 和 sequence 留在来源映射与排序内部。传输 `attemptId`、跨进程投影版本和订阅替换标记属于宿主。不提供把停止本地等待、中断原生工作和结束观察混成同一含义的通用调用上下文或取消信号。

适配器在共享来源处统一归一化内容。重新观察同一实时来源保持 Item 身份。当前 Pi 分配实时消息身份，并在重新绑定或压缩时重置映射；这些不是持久历史键。Durable 可以从原生 entry 派生已保存内容的身份，但预览使用临时 epoch。有确定映射时可发送 `replaces`；否则通过 `gap` 和替换快照明确断点。Runtime 重建后不能猜测丢失映射中的 ID 与新 ID 等价。

### 观察提供可读的来源视图

公共内容包含 text/reasoning 消息 parts、参数可能尚不完整的 `argumentsText` 工具调用，以及可选携带可序列化 `JsonValue` 的工具结果。它不导出 SDK 对象、UI chunk 或原生重放格式。`complete` 表示内容完整，不表示目标达成。前台 `Activity` 不代表所有后台任务或等待中的 preflight。

父快照可以暴露 `Subagent { id, parent, child? }` 记录。当前两个适配器从原生所有权证据发现 child，以父方范围内的原生 child ID 标识关系，并通过同一 Runtime 路由可访问的子 Thread；宿主创建的跨 harness 路由是另一项职责。关系跨 child 续接保留，不携带任务完成状态。缺少 `subagents` 表示不提供发现能力；空数组表示当前没有可见关系，不表示从未存在 child。缺少 `child` 表示未提供可独立访问的上下文。父观察既不递归混入 child 内容，也不向父方交付结果。

快照只替换该来源的当前视图，不删除宿主归档、其他 Thread 或 child 视图。当前适配器提供 `current-view`；协议也允许 `live-only` 和 `retained-view`，均不承诺包含所有历史分支。观察先发送 snapshot，再使用 `item.upsert`、`item.remove`、`input.changed`、`activity.changed`、`subagent.upsert`、`diagnostic`、`gap` 和 `closed`。Upsert 携带累计值，不是任意 token chunk；移除 Item 不等于删除原生上下文。v0 没有为 execution 或 interaction 事件预留未定义的变体。

[ThreadFeed](../../../../packages/agent-runtime/src/observation.ts) 复制视图与事件，在每个 sink 内串行交付，并隔离观察者。Sink 可能在 `observe` Promise 返回前执行，必须预先捕获 Thread 和订阅上下文。注册确认不等于消费者已保存首帧。等待 sink Promise 仅对该观察者施加背压，不阻塞同步原生派发或其他 sink。

待交付队列有界。当前 feed 在待处理帧超过 100 时合并为明确的 `gap` 与替换快照，并保持首帧必须是快照的要求。这恢复的是当前视图，不是全部丢失的历史事件。映射丢失和断线也通过 gap 表达；来源无法恢复时关闭观察。快照接入不能静默遗漏注册边界的变化。

`stop` 或访问释放后，不再开始新的 sink 调用；已进入的异步消费者可以完成。Stop 幂等，其完成本身就是确认，不强制再发终态回调。Shutdown 或来源丢失尽力发送 `closed`。Sink 抛错时解除该订阅，并在 sink 之外报告，不能把异常传入原生派发。宿主负责投影 flush，并在替换观察前封闭旧订阅的写入。单 sink 顺序不解决跨进程重放，也不解决独立观察流合并。

### 协调访问，不接管执行

同一 Runtime 内并发打开相同上下文，共享加载过程与原生所有者。`open` 校验 backend 和原生身份，缺失时返回 `not-found`，不回退到 `create`。Pi 的宿主 loader 必须返回准确的已保存 manager 和配置，不能把空文件或缺失文件转成新会话。新 Runtime 重新打开已保存 Thread 时，需要新的访问和观察对象；未保存上下文不会仅因有 ID 就变得可恢复。

当前没有单 Thread 驱逐，也不在最后一个访问释放时自动 dispose。资源和当前归一化视图保留到 Runtime shutdown，因此某个访问释放不会干扰其他调用方或不可见的原生工作。随着打开 Thread 增多，内存会持续驻留；宿主需要驻留政策。为回收一个 conversation 而关闭共享 Durable Harness，会关闭整个组。独立驱逐需要后续经过原生验证的契约。

每个上下文串行处理公共提交的接纳，直到取得确认或拒绝证据，或原生调用结束；不等待整次模型运行完成。等待中的调用只是本地协调，不是额外的已接纳或持久队列。原生扩展与其他进程不受这个顺序约束。Pi preflight 挂起会阻塞该上下文后续公共接纳，其他上下文仍独立。适配器不能超时后猜测失败。

Interrupt 绕过接纳屏障。它不取消本地尚未派发的尝试，也不保证待决 preflight 后续不能启动。Release 封闭该访问，阻止其排队尝试派发，已派发操作继续结算；宿主仍收集结果。已取消的产品动作若迟到取得访问或观察，应 release/stop 该资源，不删除已创建的上下文。严格的“停止后保持静止”还需要封闭宿主投递，并协调待决接纳和原生队列；v0 不承诺这个原子操作。

### 明确适配器的控制范围

| 操作 | Pi | Pi Durable |
| --- | --- | --- |
| 初始化 / open | 加载并校验原生上下文；扩展初始化可能产生效果。不承诺恢复在途调用或内存队列。 | `Harness.open` 协调已保存的原生状态；打开 conversation 不开启调度。 |
| observe / lookup | 不发 prompt，只观察已知上下文；没有原生输入查询扩展。 | 使用 watch/status/submission 查询，不调用会开启调度的 wait。 |
| submit | 根会话使用原生 prompt 与 preflight 证据；空闲时的 steering 不直接映射到原生 steer 调用。托管 child 使用所有者的消息／续接路径，仅支持 `steer`。 | 原生事务接纳；即使本次输入被拒绝，submit 仍可能开启共享调度器。 |
| interrupt | 自有访问调用会话所有者；托管后台 child 经父控制器停止，仍在 streaming 的前台 child 可能需要中断父轮。 | 默认 `Conversation.abort` 撤回 queued input 并中断 owned nonbackground 工作；会开启调度，不覆盖 queued write 和 background 工作。 |
| resume / retract | Pi 不提供这些原生设施的公共实现。 | 开启整个 Runtime 的调度器；另有原生输入撤回，回报放置或结算状态。 |
| shutdown | 封闭访问、跟踪接纳与原生调用，按生命周期 abort/dispose 所有者，最后关闭观察。 | 关闭共享 Harness、在途操作、投影和独占存储。关闭不等于持久任务取消。 |

对于 Pi，普通父会话中断不会停止全部后台 child。扩展记录用户停止并抑制自动唤醒父会话；前台取消遵循原生所有权。显式 child 中断使用 child 级控制。后台 child 的 `requested` 回执不证明终止；即使是 `native-scope-idle`，也不证明队列、preflight、所有扩展或后续工作均已停止。仅凭 `interrupt` 方法存在，无法推断这些区别。

资源所有者必须先接受 Durable 的 Harness 级调度影响，才能使用 submit/interrupt/resume。原生恢复不承诺外部工具副作用恰好一次。更严格、更窄的控制需要具体适配器能力或上游增强，不能靠通用能力矩阵假装所有效果等价。

### 关闭 Runtime，而非产品历史

`shutdown` 让当前已配置适配器实例退出服务，释放其全部上下文的接入资源。它不关闭其他 Runtime 实例，不删除产品或原生历史，不撤销工具效果，也不统一把所有任务标成取消。Shutdown 后不能复用该实例及旧句柄；需要新建 Runtime 才能重新打开已保存上下文。

Shutdown 封闭新的 open/create/submit/resume/control 调用，拒绝未派发工作，跟踪已开始的操作并释放自有资源。重复调用共享同一次关闭尝试。清理结果未知时，Runtime 继续拒绝新工作，不能返回 confirmed `closed`。Pi 可能需要等待无法取消的 preflight，因此不保证停机时间有界。宿主取消等待不会取消清理 Promise。宿主协调进程退出前的投影 flush，不能仅为排空观察而调用会开启调度的 native wait。

Pi 可以重新打开已持久化的上下文，但不恢复被中断的执行或未保存队列。Pi Durable 在重新打开适当的持久存储后，可以按原生恢复规则继续未终结任务；内存存储无法跨进程退出保存。因此 shutdown 不是通用的保存后暂停操作。

| 宿主动作 | 对应访问操作 |
| --- | --- |
| 关闭窗口 | 停止窗口订阅，不再需要时释放访问；宿主投影可以继续观察。 |
| 停止生成 | 在支持时中断目标上下文，并按适配器原生范围解释结果。 |
| 退出应用或停用执行环境 | 关闭对应 Runtime，协调宿主持久化与 flush。 |
| 打开已有工作 | 打开已保存 Thread，开始观察，再在访问支持相应策略时提交输入。 |
| 父结束后继续关注 child | 打开发现的 child，独立于父消息观察它。 |

### 桌面接入实现方案

本节是四个边界的实现目标：原生 child 所有权、继续输入、独立投影，以及持久化与恢复。它把包契约延伸到 Cherry 宿主，不表示桌面已完成迁移。通用 spawn/stop 与宿主跨 harness 编排仍属于独立的[后续控制工作](2026-10-18-agent-runtime-subagent-control.md#keep-common-spawnstop-as-follow-up-work)。

#### 起点与改动归属

核对后的桌面路径仍是 `AgentChatContextProvider → AgentSessionRuntimeService → PiRuntimeDriver → PiRuntimeConnection → pi.createAgentSession`。三个包和 AI SDK 模型绑定已经存在，但桌面生产调用尚未使用其 Runtime 工厂。现有后台输出通过 `rootToolCallId` 找到父 assistant 行；没有该锚点就忽略输出，child parts 最终也写回父消息行。只替换工厂函数会保留这个所有权问题。

| 位置 | 计划改动 | 继续保留的职责 |
| --- | --- | --- |
| [公共契约](../../../../packages/agent-runtime/src/contracts.ts) | 优先使用已有 Thread、可选输入、关系和观察契约。只有原生证据与消费者都需要时才增加字段。 | 不放产品行、投递日志、调度器或 UI lane。 |
| [Pi Runtime](../../../../packages/agent-runtime-pi/src/runtime.ts)、[投影](../../../../packages/agent-runtime-pi/src/runtimeProjection.ts)和[子智能体所有者](../../../../packages/agent-runtime-pi/src/subagent.ts) | 增加可验证的输入关联，并通过原生所有者恢复 child 访问。 | 原生会话、child 执行、结果交付和强类型 Pi 扩展。 |
| [Durable Runtime](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) | 激活调度前，依据原生 submission/task 对账持久输入映射和 child 所有权。 | 原生 Harness/storage 所有权与恢复语义。 |
| [桌面 Pi 接入](../../../../src/main/ai/runtime/pi/README.md) | 复用宿主配置与装配，接好生产 AI SDK 模型 port，逐步替换执行和输出路由。 | Prompt、skills、MCP、审批、shell 环境、模型政策、用量和 tracing。 |
| [AgentSessionRuntimeService](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) 及其持久化模块 | 持有已配置 Runtime 实例、逻辑输入投递和每个 Thread 的投影。在现有模块内提取 `threadProjection.ts` 这样的实例辅助模块。 | 产品生命周期、授权、持久化屏障，以及与投递、fork 操作的集成。 |
| [数据 schema](../../../../src/main/data/db/schemas/agentSession.ts) 与[数据服务](../../../../src/main/data/services/README.md) | 用 `DbService` 增加上下文关联和输入投递记录，并追加 migration。 | 产品数据事务；不执行原生任务或解析 transcript。 |
| [useAgentSessionParts](../../../../src/renderer/hooks/useAgentSessionParts.ts) 与共享 IPC 契约 | 独立于父 assistant 消息寻址某个上下文的投影。 | 展示和订阅；Main 继续负责持久化。 |

辅助模块由现有生命周期服务持有，不增加单例或第二套执行引擎。原生路径通过 `application.getPath` 解析；跨进程 schema 放在 `src/shared`。持久业务数据查询走 DataApi；提交、观察、中断和恢复命令走 IpcApi。Renderer 输入必须针对关联的产品会话校验权限，不能因为携带了原生 ID 就被信任。

#### 边界一：child 生命周期归原生所有者

发现操作记录父子关系；打开 child 获取其上下文的访问。两者都不创建任务，也不报告结果。Pi 模型工具与宿主 child 输入必须到达同一个扩展控制器。Durable child 访问必须保留原生 conversation/task 关系；创建一个无关 conversation 再提交文本，并不等于实现原生子智能体。

Pi 冷启动重开时，先恢复父会话保存的 subagent registry 与交付状态，再经过该所有者及其 loader 解析 child。即使没有新的 `onSessionCreated` 回调，也要发布恢复出的关系。把 child 文件作为普通 root 加载，会绕过续接、停止和报告规则。如果无法恢复所有者，则保留历史关系，并让 child 打开失败；当前具体 Pi 句柄承诺提供输入，不能把它当作只读句柄。产品历史仍然可读。先补全 Pi 适配器的恢复路径，再让桌面依赖它。

结果报告继续由 Pi 扩展或 Durable 原生 reporter 机制负责。投影器绝不向父会话补发完成结果。直接向 Durable child 输入不会创建 reporter。用户停止父会话后，Pi 抑制自动唤醒父会话，这是接入 Durable 报告时需要保留的 Cherry 政策，并非上游示例已经保证的行为。

后续 spawn/stop 层再暴露工具与宿主共用的所有者方法。它必须区分 child 创建和首条输入接纳，并在接纳失败或未知时保留已创建 child 的身份。Stop 必须明确是否影响父会话、child 当前工作或后台后代，以及是否允许继续输入。本轮接入不需要因此增加公共强制 spawn/stop 接口。

#### 边界二：继续输入必须关联原生证据

每条新的用户消息取得新的 `InputId` 和不可变 `InputDraft`，目标仍是原来的 child 或 root Thread。重试投递同一草稿时保留该身份。派发前保存草稿和尝试；即使窗口或调用方停止等待，Main 仍收集结果。接纳、放置、回答归属和终态是不同的证据。

| Cherry 需要的证据 | Pi 实现门槛 | Durable 实现门槛 |
| --- | --- | --- |
| 接纳 | 保留 preflight 与所有者控制器回执，包括本地处理的命令和迟到确认。 | 保存逻辑输入、去重键和原生 Submission 身份。 |
| 放置与输出归属 | 让输入关联贯穿钩子、原生队列、历史插入和 child 续接。不按文本或排队位置匹配。 | 对账原生 submission 放置和 run 的输入集合；多个输入可以共同产生一个回答。 |
| 产品终态 | 把原生完成、错误、中止或截断关联到受影响的输入集合。仅会话 settled 或 assistant item complete 不足以证明。 | 映射原生 done/unanswered/abort 证据，不把接纳或前台空闲当作成功完成。 |
| 不确定尝试的恢复 | 没有持久去重就不自动重试；丢失关联时保留未知。 | 在原生去重规则下查询并使用原始不可变草稿；查询失败不能撤销已知接纳。 |

未打补丁的 Pi 1.3.0 `PromptOptions` 没有调用方关联 token，steering/follow-up 的内部记录使用文本。P0 的第一部分现已在原生层增加调用方关联，贯穿输入变换、队列、历史放置和由所有者管理的 child 续接。Cherry 通过固定版本的依赖补丁携带这项变更，关联的 Pi 工作区保留源码及回归测试；它尚不是上游发布版本。[证据记录](../testing/2026-10-17-agent-harness-evidence.md#p0-input-correlation-check--2026-10-19)列出验证及限制。token 不修改 transcript 内容，不提供去重，也不会自行跨重开保留。

P0 现在已有包级终态和多输入归属证据。Pi 补丁在原生请求准备时保存尚未回答且已放置的输入集合，并在最终回答或终态收束后通过 `input_settled` 返回实际响应 entry。工具／边界续接和重试会保留该集合；排队或稍后才放置的输入不能继承较早的响应。Pi 强类型 `input-settled` 事件保留原生 entry ID、输入 ID、停止原因和中止证据。这是原生响应归属，不证明任务语义上成功，也不证明任意上下文钩子处理后逐字消费了输入。桌面路径仍需满足 P1–P4 的接入门槛。

公共层仅增加可选的 `InputState.response: ItemRef`：多个输入可以共享同一个终态响应，无需创造执行 ID，也无需给 assistant 回答指定单个 `MessageItem.inputId`。Pi 提供原生输入集合证据，Durable 提供各 submission 的回答 entry。该引用遵循 current-view 身份与覆盖规则，不是通用持久历史键。正常最终回答映射为 `completed`，错误为 `failed`，中断为 `aborted`，截断或没有最终回答为 `unanswered`。Durable 原生 `done` 也包含截断／仅工具调用的回答，因此适配器读取实际回答后才声明成功。证据缺失时不设置 outcome。已处理命令可能失败而不产生 assistant 回答；迟到回执必须保留已确认终态。只有对应投影和终态证据完成持久化后，才结束产品投递。

`whenBusy` 仍只表达输入接纳政策。不唤醒通知、回答交互和修改模型/配置属于独立的所有者操作，不能都编码成另一种 `steer`。本方案不增加通用交互或工具接口。

#### 边界三：Main 按 Thread 独立投影

在已配置 Runtime 内，为每个 `(backendId, threadId)` 设置一个宿主投影所有者。它持有适配器句柄、观察、当前视图、来源到产品 Item 的映射，以及待持久化写入。Renderer 窗口订阅该视图；打开第二个窗口不创建竞争的原生投影或持久化写入者。

```text
Parent Thread observation -> parent projection -> parent display
          Subagent link ----------------------> child display link
Child Thread observation  -> child projection  -> child panel / tool card
                            |
                            +-> child context's product messages
```

Child 内容归其上下文，并拥有独立的产品消息身份。父工具卡片保存关系和展示入口，不再作为 child 唯一的持久存储位置。父回合结束、移除其实时 assistant accumulator，以及关闭父视图都不能停止 child 观察。如果 UI 需要 lane，它只是 Cherry 根据关联派生出的视图分组，不是 harness 执行身份。

附着前先让 sink 捕获订阅替换标记，因为初始快照可能早于 `observe` 返回。按 Thread 串行处理投影写入。替换观察前，封闭旧写入者、停止观察并排空已经进入的写入；之后只有当前标记可以提交。Renderer 附着或漏掉更新时，发送带宿主 revision 的完整视图。该 revision 不进入公共 Runtime 契约。

在有效映射内，累积 upsert 更新同一产品消息，不逐 token 插入行。`snapshot`、`item.remove` 和 `gap` 改变当前视图，不改变已保存的会话历史。压缩、重新绑定或重建后，只有原生证据支持时才能复用历史身份。不把恢复快照当作新的历史消息追加，也不按相同文本去重。映射不可用时保留归档、标记视图断点，并单独展示新的当前视图；完整原生历史导入不在本轮范围。

| 产品动作 | 宿主行为 |
| --- | --- |
| 窗口关闭或切换选择 | 移除该订阅者；继续保留活跃工作与持久化需要的 Main 观察。 |
| 父会话结束，child 继续 | 独立于父消息，继续持有 child 投影和原生所有者。 |
| 用户停止生成 | 封闭相关宿主投递，请求文档约定范围的原生中断，并跟踪结果；不能用 `release` 替代，也不宣称所有队列已清空。 |
| 最后一个视图释放 | 释放不再需要的访问，不假定已经驱逐原生资源。当前适配器保留已加载上下文直到 shutdown。 |
| 应用退出或执行环境退役 | 封闭接纳、收集进行中的回执、关闭自有 Runtime，随后在关闭数据库前排空并封闭最终投影写入。清理未知必须保留可见性。 |

首轮 Pi 接入把 Runtime 作用域限定为一个产品会话的原生 root 及其自有 child 树，全部句柄由该所有者管理。Durable 作用域遵循其独占原生 storage/Harness，其中可以有多个 conversation。不能把旧的逐消息、逐连接 idle TTL 套到任一所有者内部的单个会话上。首版政策是保留已配置所有者，直到明确退役或应用退出；内存增长是已知限制。逐 Thread 驱逐需要后续原生支持和单独验证。

#### 边界四：保存产品关联，恢复原生状态

Cherry SQLite 保存产品关联和投递事实；原生存储保存可续接的模型上下文、队列、task 和 reporter 状态。下列最小宿主记录是拟议数据形状，不是新增的公共 Runtime 类型。使用 `Context`、`Input` 命名，不再引入一个 `Ref` 实体。

| 记录 | 最少保存的事实 | 约束 |
| --- | --- | --- |
| `AgentSessionContext` | 产品上下文 ID、产品会话 ID、`backendId`，以及确认后的原生 Thread 身份/经验证的存储定位信息。 | 一个产品会话可关联多个上下文；按产品会话和原生 Thread 地址对已确认关联去重。尚未绑定的创建意图不是可打开的 Thread。Root 选择与 child 所有权分开保存。 |
| 已观察的子智能体关系 | 父上下文、原生关系 ID、可选 child 上下文，以及观察来源。 | 按父上下文与关系 ID 唯一标识；允许 child 不可访问。这是发现数据，不是控制授权或任务结果。 |
| `AgentSessionInput` | `inputId`、目标上下文、不可变文本/政策、产品用户消息关联、已知接纳事实、可选原生输入身份，以及有证据的终态。 | 改变文本、政策或目标必须创建新的逻辑输入。没有 outcome 不等于成功。 |
| 输入投递尝试 | 尝试身份、逻辑输入、派发意图、返回的回执/错误，以及结果是否仍未知。 | 每次原生调用都记录；超时或进程退出不证明拒绝。尝试信息留在宿主内部。 |
| 产品消息关联 | 消息 ID、上下文 ID，以及有证据时才保存的输入/原生 Item 关联。 | Child 消息独立成行；不要求一个回答恰好只属于一个输入。适配器实时 Item ID 不是永久历史键。 |

通过 `src/main/data/db/schemas/` 下的 Drizzle schema 和 `src/main/data/services/` 下的聚焦数据服务实现这些新记录，由现有 Runtime 服务协调。复用 `agent_session_message` 保存展示记录，并显式关联上下文。在验证原生关联期间，保持旧 v2 行可读；无法匹配的行仍是历史数据，不能变成新建原生上下文的理由。不把原生 JSONL 或 Durable commit 复制进这些表，也不逐流式 delta 写 SQLite。

`backendId` 标识稳定配置的存储/执行命名空间，不标识进程或 Runtime 对象。Pi 在 Cherry 自有存储内解析原生 session ID，并验证加载出的 header；私有相对定位信息可以避免扫描，但不是身份。Durable 把 backend 绑定到一个持久 store，并在其中解析原生 Conversation ID。凭据留在既有所有者内，不进入这些记录。路径与适配器配置仅在 Main 内部使用。

写入顺序分为三个独立边界：

1. 使用同步 `DbService.withWriteTx` 提交不可变输入、产品关联和派发意图。事务内绝不等待 harness 或文件操作。
2. 在 SQLite 事务外调用原生 create/open/submit。Main 持有进行中的操作，不依赖 Renderer 生命周期。
3. 提交已知原生身份/回执及后续观察事实。原生创建先记录意图，并在支持时使用可恢复的原生定位/关联。如果创建成功但关联提交失败，先对账已知上下文再重试。如果无法找回原生身份，则保留未解决意图，不自动创建副本。

DB 与原生存储不构成一个事务。恢复还需覆盖意图已提交但调用尚未开始、调用已发生但回执丢失两种情况；无法区分时保留未知。只有通过所属生命周期及明确的产品操作，才能退役或删除原生存储。备份/恢复在现有 write-quiesce 边界下保持数据库与关联原生存储一致；退役视图不删除文件。

重启顺序为 **加载关联 → 验证原生存储与所有权 → 打开并观察 → 对账输入和投影 → 决定是否调度**。Pi 可以恢复上下文和所有者记录，不能恢复被中断的调用或未保存队列。Durable open/observe/lookup 保持被动；宿主只在对账后，按整个 Harness 的作用域允许会启用调度的 submit/interrupt/resume。不确定的 Pi 输入保持未解决，不静默重放。保留的 Durable 输入通过原生身份/去重键对账，不额外制造 reporter 或父通知。

为已迁移上下文替换旧 crash-orphan 政策：不能在原生对账前清空全部 resume token，或把可恢复的 Durable 工作标为失败。原生存储缺失、为空、身份不匹配或不可读时，保留产品历史并报告访问不可用；`open` 从不创建替代品。现有编辑/fork 操作必须在其 checkpoint/文件事务流程中发布新的原生关联，不能只靠最新 assistant token 判断上下文身份。

#### 实现阶段与验证门槛

以下是实现工作单元，不表示工作已完成或已经创建新的 PR。P0 与 P1 的 schema 设计可以独立推进；生产切换需同时满足两项门槛。派发前为每个上下文选定唯一的执行和持久化路径。未迁移上下文保留既有路径；原生派发后，错误或未知回执不能触发回退到另一个 driver，也不能启动第二个写入者。

| 阶段 | 交付物 | 进入下一步前的门槛 |
| --- | --- | --- |
| P0 — 原生证据 | Pi 输入关联/上游改进与强类型终态映射；说明多输入共同回答的归属。 | 相同文本、文本变换/已处理/失败命令、排队及未送达输入、中止、截断、迟到确认和 child 续接都保留正确身份与终态。AC2、AC7。 |
| P1 — 关联与日志 | 上下文/输入/尝试持久化、稳定 backend 作用域、严格 loader，以及已有数据的数据库迁移。 | 读取旧产品历史、识别原生上下文缺失、对账部分创建/接纳，并拒绝重试时修改草稿。AC1、AC8。 |
| P2 — Pi root 接入 | 生产模型 port、root Thread 投影、产品持久化和生命周期映射。 | 通过桌面 create/open/submit/observe/stop/reopen 路径，保留权限、配置、用量、命令、编辑/fork 和投递完成行为。AC3、AC4、AC6、AC9、AC12。 |
| P3 — Pi child 独立接入 | 所有者恢复、child 投影，以及没有活跃父消息时的 child 输入。 | 父结束/窗口关闭不丢 child 输出；冷启动重开保留所有权；续接仅由所有者报告一次结果。AC5、AC9、AC10。 |
| P4 — Durable 宿主接入 | 复用宿主投影/日志，保留原生 task 调度、报告政策与恢复。 | 被动重开不执行模型/工具；强制进程退出后，新进程使用同一 store 对账未完成工作和输入回执。AC8、AC11、AC12。 |
| 后续 — 公共控制 | 在控制文档下推进可选 spawn/stop 与宿主跨 harness 委派。 | 两种适配器都证明创建/部分接纳、停止范围和继续输入语义后，才共享签名。不是 P0–P4 的门槛。 |

P2 切换前，把当前 `PiRuntimeConnection` 的各项职责逐一映射到替代实现。AI SDK port 必须经 Cherry provider 路径执行单次模型请求，不能重新进入 `AiService.streamText` 的 agent-session 分支，也不能增加第二套工具循环。明确唯一的用量记账方。保留审批与 MCP 行为、冻结/实时配置规则、身份 prompt、shell 装配、tracing、命令/压缩和原生编辑/fork checkpoint。在声称行为一致前，解决模型桥已记录的 thinking replay 元数据缺口，并说明如何表达不支持的内容/附件。

扩展现有 [Pi Runtime 测试](../../../../packages/agent-runtime-pi/tests/runtime.test.ts)、[Durable Runtime 测试](../../../../packages/agent-runtime-pi-durable/tests/runtime.test.ts)和[观察测试](../../../../packages/agent-runtime/tests/observation.test.ts)，走公共边界验证。宿主验证放在现有 Runtime、归档持久化、投递、消息 backend 与 `useAgentSessionParts` 测试旁；引入投影/日志组件时，再增加聚焦测试。SQLite 测试使用 `setupTestDatabase()` 和生产 migration。Durable 崩溃测试使用隔离 worker 进程与持久 store，在有证据的 checkpoint 后直接杀进程，不调用 `shutdown`，再用新进程验证恢复。不假定外部工具副作用恰好执行一次。

实现改动只运行显式指定的受影响测试文件，并检查 `docs:affected`；仅在代码路径改变后更新当前参考文档。包级测试和有序 close/reopen 不能满足 Electron 或崩溃恢复门槛。本次文档细化只运行文档、配对和限定文件的格式检查。

## Alternatives considered

- 让 `submit` 返回唯一输出流：不采用，因为排队输入、原生自发工作、重连和 child 流不共享该生命周期。
- 再增加 `Backend` 抽象或为每种原生效果建立字符串矩阵：不采用，因为已配置的 `AgentRuntime` 已负责访问，消费者仍需要明确的原生语义。
- 把创建、工具、历史编辑、fork、resume 和委派控制放进强制接口：不采用，因为当前原生能力与所有权不同。在证明公共用途前保留强类型适配器扩展。
- 公开内部 epoch、revision、attempt 或原始 SDK payload：不采用，因为来源映射属于适配器，投递和投影协调属于宿主；增加字段不会创造持久保证。
- 重试未知输入、最后一个访问释放时 dispose，或用本地标记模拟原子 idle 接纳：不采用，因为这些做法会丢失证据，或与适配器不拥有的工作竞争。

## Acceptance criteria

[证据文档](../testing/2026-10-17-agent-harness-evidence.md)区分当前适配器验证、历史探针和尚未执行的验收。包级验证不代表宿主接入已完成。

- AC1 — 重复和并发打开共享原生所有者、校验身份，且从不通过新建替代缺失上下文。 (verification: unit — Pi 与 Pi Durable Runtime 测试)
- AC2 — 输入回执在 busy 策略、钩子、未知结果、迟到确认、去重及 release 竞争中保留原生接纳证据。 (verification: unit — 适配器接纳与宿主投递测试)
- AC3 — 多观察者获得一致的来源身份和先快照后更新的有序交付；溢出、映射丢失、sink 失败和停止均明确且隔离。 (verification: unit — ThreadFeed 与适配器投影测试)
- AC4 — 释放一个访问不会停止其他访问或原生工作；shutdown 关闭整个自有实例，不宣称删除历史或支持未经保证的执行恢复。 (verification: unit — 适配器生命周期与持久存储重开测试)
- AC5 — Child 观察跨越父消息结束，托管 child 控制保留原生所有权，观察不会重复原生结果交付。 (verification: unit — 适配器 child 测试与宿主投影集成)
- AC6 — 桌面调用方保留逻辑输入回执与归档，封闭被替换观察的写入，flush 未完成写入，并准确呈现原生中断和调度范围。 (verification: Electron — 产品会话 Runtime 集成)
- AC7 — 相同或变换后的输入、批量 steering、本地命令失败、未送达输入、截断和迟到回执都保持有证据的归属，不按文本匹配，也不误报成功完成。 (verification: unit — 原生 Pi 关联探针与适配器/宿主输入测试)
- AC8 — 已有数据的数据库迁移保留历史；上下文关联和不可变输入尝试能处理原生/DB 部分成功，恢复不替换缺失上下文，也不盲目重试不确定输入。 (verification: unit — 使用生产 migration 与原生存储 fixture 的上下文/输入数据测试)
- AC9 — Child 内容独立于父 assistant 行持久化；快照替换和旧观察写入不能删除归档、重复恢复的历史或覆盖更新视图。 (verification: unit — 宿主 Thread 投影与归档持久化集成测试)
- AC10 — 新 Pi Runtime 在继续输入前恢复 child 的父所有者与关系，保留原生停止/报告政策，绝不把失去所有者的历史 child 升级为可写 root。 (verification: unit — 持久 Pi 父子会话重开测试)
- AC11 — 强制进程退出后用新进程重开 Durable，保留输入身份与原生所有权；被动对账不执行模型/工具，允许的 resume 遵循 Harness 作用域，宿主不额外报告结果。 (verification: unit — Durable worker 进程崩溃集成测试)
- AC12 — Root 与 child 桌面流程保留产品授权、模型/工具边界、单次用量记账、投递终态、编辑/fork 关联，以及约定的停止/恢复行为。 (verification: Electron — Pi 与 Durable 宿主接入场景)

## Risks

精确任务取消和宿主跨 harness 编排仍是方案。可选 child/input 字段让受限访问可以表达，但不代表已有每种 harness 的适配器，也不从恢复的历史授予控制权限。Pi child 续接需要所有者的 loader，并保留原生报告策略。上下文保留到 shutdown 会增加内存占用；无法取消的 preflight 可能无限推迟关闭。归一化视图省略原生数据，背压下还可能丢失中间事件。Durable 的逻辑输入映射不能替代宿主日志。把这些限制当作公共类型已经解决的问题，会让纸面抽象强于实际实现。
