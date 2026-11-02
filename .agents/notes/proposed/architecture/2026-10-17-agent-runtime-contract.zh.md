# Agent Note: Runtime 访问、输入、观察与生命周期契约

Status: proposed

[English](2026-10-17-agent-runtime-contract.md) | 中文

## Problem

Cherry 需要跨 harness 打开原生上下文、提交输入、独立于某次提交观察工作，并释放资源。要求所有 harness 采用 Cherry 的会话引擎，会重复实现原生调度和恢复；庞大的能力矩阵则会迫使每个消费者自行解释差异。

本文接替栈中的 Runtime 所有权与行为设计，记录已实现的 v0 访问边界及其理由，以及接入时仍需履行的宿主责任。[公共类型](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime/src/contracts.ts)、[Pi 适配器](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/runtime.ts)和 [Pi Durable 适配器](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/src/runtime.ts)维护精确签名。包代码已存在；桌面接入及下述完整验收尚未完成。[Harness 边界](2026-10-17-agent-harness-boundaries.md)维护更上层的职责划分。

本文的实现事实以累计 Runtime 栈 `bd6509eb5f71a9c6bbb57453f0a7ced25e92c766` 的检查结果为依据。由上层提供的行为在本层仍属于目标，不表示这些功能已存在于本层。源码链接指向该固定快照，尚未引入的文档链接到其所属 PR。

[SDK 内容协议方案](../simplification/2026-10-29-agent-runtime-content-protocol.md)现在维护替换 `ContentItem`、将 SDK 内容累积迁入共享观察来源的后续设计。下文的 item 事件和 Main reader 在迁移完成前仍是当前实现；访问、输入接纳、生命周期、原生恢复和产品所有权继续由本文维护。

## Proposal

### 保持公共入口精简

当前公共形状如下：

```typescript
interface AgentRuntime {
  open(ref: Thread): Promise<OperationResult<ThreadHandle>>
  shutdown(): Promise<OperationResult<ShutdownReceipt>>
}

interface ThreadHandle {
  readonly thread: Thread
  readonly inputPolicies: readonly BusyPolicy[]
  submit(input: InputDraft): Promise<SubmitResult>
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
| `submit` | 把输入交给原生接纳；回执与观察到的输出分开，不拥有唯一专属响应流。 |
| `observe` | 重新观察已有工作，包括没有新提交仍在继续的 child 工作。 |
| `interrupt?` | 仅在存在原生中断能力时提供入口，并保留实际作用范围。 |
| `release` / `stop` | 结束调用方的访问或观察，不取消其他所有者的工作。 |
| `shutdown` | 由资源所有者关闭整个已配置 Runtime 实例。 |
| `thread` / `inputPolicies` | 保存可寻址上下文并选择支持的输入安排，无需解释通用能力语言。 |

异步工厂与 `create` 保留在具体适配器。Pi 接收 `AgentRuntimeSessionOptions`，包含原生 `ModelRuntime`、`Model` 和 `SessionManager`；Pi Durable 接收原生 `HarnessOptions`、独占存储工厂和 `ConversationCreateOptions`。这些都是强类型配置，不是任意 options 袋。初始化失败时清理已取得的资源；宿主共享模型服务仍是借用资源。

Pi Durable 还在具体接口上提供 Runtime 级 `resume`，以及输入查询、撤回和去重。原生命令发现、配置变更、上下文编辑和 fork 不属于公共强制方法。工具、审批和模型桥保留在现有适配器与宿主边界；只有消费者需要跨实现相同语义时才提取公共行为。

v0 没有通用 `spawn`、精确委派取消、交互响应、历史分页或重放游标。必选的 `submit` 和 `Delegation.child` 无法完整表达只能观察或无法独立访问的 child。[可选子智能体控制](https://github.com/CherryHQ/cherry-studio/pull/21578) 是另一份方案，不是已实现签名。当前 Pi 的托管 child 句柄不暴露输入策略，提交返回 `unsupported`；不能绕过扩展所有者直接向 child prompt。

### 把提交定义为原生输入接纳

`InputDraft` 包含宿主的 `inputId`、`text` 和 `whenBusy: 'reject' | 'steer' | 'follow-up'`。这是原生用户输入，可能在到达模型接纳前触发命令或钩子。

```text
Input -> native command/input hooks -> locally handled
                                  -> model admission applies whenBusy
```

| 到达原生模型接纳点时 | `reject` | `steer` | `follow-up` |
| --- | --- | --- | --- |
| 前台空闲 | 可以开始工作。 | 可以开始工作。 | 可以开始工作。 |
| 前台忙碌 | 拒绝这次模型输入，不排队。 | 在原生支持的边界安排干预。 | 按原生规则安排后续输入。 |

这不是针对指定执行的原子条件，也不证明所有后台工作和队列均为空。不支持的策略在原生派发前拒绝；配置或已关闭资源仍可能阻止本来允许的输入。先前处理的命令或钩子不受 busy 策略约束：Pi 的 `/goal pause` 在忙碌且选择 `reject` 时仍可处理。`locally-handled` 标识处理路径，不证明命令成功。跳过 Pi prompt-template 展开不能跳过所有输入 handler，因此不能实现无副作用的 idle-only 操作。这类保证需要原生原子接纳或受约束的扩展，不能靠前置 `isIdle` 检查实现。

提交回执报告证据：`accepted`、`queued`、`dispatch-started`、`locally-handled` 和 `placed` 是事实集合，不是线性状态机。排队、派发和放置均不证明模型已消费。确认接纳不证明执行完成或目标成功。通用操作返回 `confirmed`、`rejected`、`unsupported` 或 `unknown`；提交使用 `acknowledged` 表示已确认交接。预期失败通过结果表达；编程错误仍可抛出。v0 的错误码是字符串，不是穷尽的公共枚举。诊断消息不能携带密钥或原生对象；宿主把注入的错误回调接到 `loggerService`。

只有明确未接纳时才能返回拒绝。未知结果必须保留未知；后续查询失败不能推翻已确认的接纳。宿主在提交前保存逻辑输入与传输尝试，窗口停止等待后继续持有 Promise，并记录迟到回执。`input.changed` 可以确认逻辑输入，而不证明哪一次结果未知的传输成功。Runtime 不提供持久的宿主投递日志。

同一 `InputId` 的文本和 busy 策略不可变。新内容属于新逻辑输入。Pi 没有持久的原生输入去重，未知结果不能触发自动重试。Durable 的原生去重键与查询允许采用不同的投递政策；宿主保存它们与 `InputId` 的关系，并重放原草稿。原生同类型去重不会校验 payload 相等。查询未找到不证明没有副作用。撤回区分 `withdrawn`、`already-placed` 和 `already-settled`；撤回单个输入不是中断会话。

### 只公开消费者需要引用的身份

| 公共身份 | 用途 |
| --- | --- |
| `Thread { backendId, id }` | 定位已配置 backend 内的原生上下文；持久性取决于原生存储。 |
| `InputId` | 宿主逻辑输入身份，至少在目标上下文内唯一，独立于传输尝试。 |
| `ItemRef { session, id }` | 标识可更新内容与工具关联。 |
| `DelegationRef { session, id }` | 标识一次委派的证据，独立于可复用的子上下文。 |
| `NativeInputRef { session, id }` | 在支持时定位真实原生输入，供查询或撤回。 |

ID 使用不同的 branded 字符串类型。消费者可以序列化它们，但不能互换、解析前缀或从格式推断生命周期。宿主提供 `InputId`；适配器返回原生、上下文和内容引用。恢复 branded ID 前应校验存储和传输数据。宿主配置稳定的 `backendId` 命名空间并保证唯一写入者；v0 不增加跨进程锁。

`SourceRef`、epoch、revision 和 sequence 留在来源映射与排序内部。传输 `attemptId`、跨进程投影版本和订阅替换标记属于宿主。不提供把停止本地等待、中断原生工作和结束观察混成同一含义的通用调用上下文或取消信号。

适配器在共享来源处统一归一化内容。重新观察同一实时来源保持 Item 身份。当前 Pi 分配实时消息身份，并在重新绑定或压缩时重置映射；这些不是持久历史键。Durable 可以从原生 entry 派生已保存内容的身份，但预览使用临时 epoch。有确定映射时可发送 `replaces`；否则通过 `gap` 和替换快照明确断点。Runtime 重建后不能猜测丢失映射中的 ID 与新 ID 等价。

### 观察提供可读的来源视图

公共内容包含 text/reasoning 消息 parts、参数可能尚不完整的 `argumentsText` 工具调用，以及可选携带可序列化 `JsonValue` 的工具结果。它不导出 SDK 对象、UI chunk 或原生重放格式。`complete` 表示内容完整，不表示目标达成。前台 `Activity` 不代表所有后台任务或等待中的 preflight。

父快照可以暴露带有独立可打开 child Thread 的 `Delegation` 记录。当前两个适配器通过同一 Runtime 路由发现的原生 child；宿主创建的跨 harness 路由是另一项职责。父观察不会递归混入 child 内容。缺少 `delegations` 表示不提供发现能力；空数组表示当前没有可见关系，不表示从未存在 child。当前适配器在缺少完成证据时报告 `unknown`。Pi 把 child 与创建或续接它的触发操作关联；Durable 使用原生 owner-task 关系。后续 child 输入本身不证明产生新委派或旧委派已完成。

快照只替换该来源的当前视图，不删除宿主归档、其他 Thread 或 child 视图。当前适配器提供 `current-view`；协议也允许 `live-only` 和 `retained-view`，均不承诺包含所有历史分支。观察先发送 snapshot，再使用 `item.upsert`、`item.remove`、`input.changed`、`activity.changed`、`delegation.upsert`、`diagnostic`、`gap` 和 `closed`。Upsert 携带累计值，不是任意 token chunk；移除 Item 不等于删除原生上下文。v0 没有为 execution 或 interaction 事件预留未定义的变体。

[ThreadFeed](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime/src/observation.ts) 复制视图与事件，在每个 sink 内串行交付，并隔离观察者。Sink 可能在 `observe` Promise 返回前执行，必须预先捕获 Thread 和订阅上下文。注册确认不等于消费者已保存首帧。等待 sink Promise 仅对该观察者施加背压，不阻塞同步原生派发或其他 sink。

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
| submit | 使用原生 prompt 与 preflight 证据；空闲时的 steering 不直接映射到原生 steer 调用。不支持托管 child 提交。 | 原生事务接纳；即使本次输入被拒绝，submit 仍可能开启共享调度器。 |
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

## Alternatives considered

- 让 `submit` 返回唯一输出流：不采用，因为排队输入、原生自发工作、重连和 child 流不共享该生命周期。
- 再增加 `Backend` 抽象或为每种原生效果建立字符串矩阵：不采用，因为已配置的 `AgentRuntime` 已负责访问，消费者仍需要明确的原生语义。
- 把创建、工具、历史编辑、fork、resume 和委派控制放进强制接口：不采用，因为当前原生能力与所有权不同。在证明公共用途前保留强类型适配器扩展。
- 公开内部 epoch、revision、attempt 或原始 SDK payload：不采用，因为来源映射属于适配器，投递和投影协调属于宿主；增加字段不会创造持久保证。
- 重试未知输入、最后一个访问释放时 dispose，或用本地标记模拟原子 idle 接纳：不采用，因为这些做法会丢失证据，或与适配器不拥有的工作竞争。

## Acceptance criteria

[证据文档](../testing/2026-10-17-agent-harness-evidence.md)区分已有测试、历史探针和尚未执行的验收。本次文档迁移不宣称重新执行这些测试，也不宣称宿主接入已完成。

- AC1 — 重复和并发打开共享原生所有者、校验身份，且从不通过新建替代缺失上下文。 (verification: unit — Pi 与 Pi Durable Runtime 测试)
- AC2 — 输入回执在 busy 策略、钩子、未知结果、迟到确认、去重及 release 竞争中保留原生接纳证据。 (verification: unit — 适配器接纳与宿主投递测试)
- AC3 — 多观察者获得一致的来源身份和先快照后更新的有序交付；溢出、映射丢失、sink 失败和停止均明确且隔离。 (verification: unit — ThreadFeed 与适配器投影测试)
- AC4 — 释放一个访问不会停止其他访问或原生工作；shutdown 关闭整个自有实例，不宣称删除历史或支持未经保证的执行恢复。 (verification: unit — 适配器生命周期与持久存储重开测试)
- AC5 — Child 观察跨越父消息结束，托管 child 控制保留原生所有权，观察不会重复原生结果交付。 (verification: unit — 适配器 child 测试与宿主投影集成)
- AC6 — 桌面调用方保留逻辑输入回执与归档，封闭被替换观察的写入，flush 未完成写入，并准确呈现原生中断和调度范围。 (verification: Electron — 产品会话 Runtime 集成)

## Risks

当前访问 API 明确保留缺口：Pi 托管 child 输入、无法独立访问的 child 关系、精确委派取消和宿主跨 harness 编排仍是方案。上下文保留到 shutdown 会增加内存占用；无法取消的 preflight 可能无限推迟关闭。归一化视图省略原生数据，背压下还可能丢失中间事件。Durable 的逻辑输入映射不能替代宿主日志。把这些限制当作公共类型已经解决的问题，会让纸面抽象强于实际实现。
