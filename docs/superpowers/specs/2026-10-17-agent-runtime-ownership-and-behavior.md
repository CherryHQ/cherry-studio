# Agent Runtime 接口与行为契约

2026-10-17 · 首版公共契约与 Pi / Pi Durable 适配代码已落地，尚未接入桌面应用；实测与未验证边界分别记录。本文是公共签名与行为的唯一维护位置；定义与所有权见 [Harness 定义与边界](2026-10-17-agent-harness-definition.md)，原生事实及实测状态见 [样本与验证证据](2026-10-17-agent-harness-examples.md)。

## 1. 范围

公共接口覆盖会话访问、输入提交、事实观察、可选中断与资源释放。原生 Session 是上下文的权威；宿主保存产品数据、投递记录和展示投影。公共包不接管原生队列与执行循环。

以下不进入首版公共接口：精确 Execution 控制、Interaction 回答、通用 Task、配置热更新、fork、历史分页、递归观察、事件重放和跨 harness 迁移。原生已有功能可以通过适配器专用接口接入，不因未统一而删除。Interaction 接入仍需校验请求身份、有效期和回答类型；迟到回答不能路由到另一次等待，审批接纳也不证明工具已执行。

Lane、产品投影存储、多客户端同步和应用服务迁移由宿主设计，不在本契约中展开。

## 2. 接口与配置

### 2.1 公共接口

AgentRuntime 持有接入资源，ThreadHandle 提供会话操作，Observation 持有独立订阅。

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

type BusyPolicy = 'reject' | 'steer' | 'follow-up'

interface InputDraft {
  inputId: InputId
  text: string
  whenBusy: BusyPolicy
}
```

| 方法 / 字段 | 没有它，调用方缺少什么 |
| --- | --- |
| open | 无法按保存的引用找回已有上下文；不能用 create 代替 |
| submit | 无法把输入交给 harness；返回交接结果，不返回绑定该输入的唯一输出流 |
| observe | 无法重新观察既有工作，或在没有本次 submit 的情况下持续看子输出 |
| interrupt? | 无法请求停止原生前台工作；可选表示确实存在这个操作，不支持时不提供空实现 |
| release / stop | 无法独立释放某个访问者或观察者；不能因此停止其他窗口与后台工作 |
| shutdown | 无法由资源所有者明确关闭整个适配器实例；含义见第 5.4 节 |
| ref | 需要持久保存、关联产品会话，以及独立打开 child |
| inputPolicies | 输入框需要决定提供哪些安排选项；只有方法存在性无法区分 submit 支持哪些策略 |

ThreadHandle 与 Observation 是访问资源，不是原生执行实体。一个原生会话可以有多个访问者和观察者；提交与观察分离是行为要求，不强制未来实现使用某种类继承结构。

### 2.2 适配器接口与配置

| 行为 | 放置位置及原因 |
| --- | --- |
| 异步初始化、新建会话 | 具体适配器工厂和 create；模型、工作目录、工具、存储配置各不相同，宿主组合根负责选择 |
| resume | Pi Durable 等有原生恢复机制的适配器；作用于共享 Harness 时必须明确整个 Runtime 范围 |
| lookupInput / retractInput / 去重键 | 有原生可寻址输入和去重机制的适配器；先供宿主投递服务集成，不要求普通会话消费者理解它们 |
| 命令发现与调用、配置更新、fork、上下文编辑 | 原生专有接入；有真实的跨适配器消费者和相同语义后，再提取公共扩展 |
| 模型调用桥、TranscriptTap、工具和扩展注册 | Pi 等具体实现的配置边界；不变成公共 Runtime 的强制 port |

```typescript
declare function createPiRuntime(options: PiRuntimeOptions): Promise<OperationResult<PiRuntime>>
declare function createPiDurableRuntime(options: PiDurableRuntimeOptions): Promise<OperationResult<PiDurableRuntime>>

interface PiRuntime extends AgentRuntime {
  create(options: PiSessionOptions): Promise<OperationResult<ThreadHandle>>
}

interface PiDurableRuntime extends AgentRuntime {
  open(ref: Thread): Promise<OperationResult<PiDurableThreadHandle>>
  create(options: PiDurableSessionOptions): Promise<OperationResult<PiDurableThreadHandle>>
  resume(): Promise<OperationResult<ResumeReceipt>>
}

interface PiDurableThreadHandle extends ThreadHandle {
  submit(input: InputDraft & { deduplicationKey?: string }): Promise<SubmitResult>
  lookupInput(query: InputQuery): Promise<OperationResult<InputLookup>>
  retractInput(ref: NativeInputRef): Promise<OperationResult<RetractionReceipt>>
}
```

这些具体配置保持强类型，不接受任意键值 options 袋。Runtime 配置提供稳定 backendId、资源定位/存储连接、模型与工具实现、扩展工厂及诊断回调；Session 配置选择本次新建上下文的模型、工作目录等。open 不覆写已有会话配置。初始化失败清理已取得的资源；运行时只关闭自己拥有的资源，不销毁宿主共享模型服务。

公共调用不携带统一 CallContext 或 attemptId。首版不增加通用“取消本地等待”参数；宿主服务持有调用 Promise，窗口取消等待不取消服务的结果收集。需要中断原生工作使用 interrupt，需要结束观察使用 stop，不能把它们混成 AbortSignal 的一个含义。

### 2.3 能力发现

公共层不提供通用能力矩阵，避免宿主解释一套可任意组合的效果标签。

公共消费者只需要三种信息：

- interrupt 方法是否存在：能否提供请求中断的入口。
- inputPolicies：提交时允许选择哪些 busy 策略。
- 观察快照实际提供什么：覆盖哪段视图、是否暴露子会话关系；这些随快照返回，不在另一份 capability 对象中重复维护。

原生行为差异仍需明确。队列、后代、后台和 scheduler 的影响统一写在第 5.3 节的适配契约中；宿主组合根选择实现时必须评估这些效果。通用 interrupt 只承诺请求中断原生前台工作，不承诺清空所有输入、保持静止或后台不受影响。需要严格控制范围的产品操作暂时走明确的适配器接入，不通过可选方法的存在推断强保证。

同理，Durable submit 即使被拒绝也可能唤醒共享 scheduler，这一事实仍须被宿主资源策略接受。若产品要求动态协商这些效果，再为这个真实消费者增加明确协议；首版不预造通用策略解释器。

## 3. 输入接纳与 busy 策略

submit 接收的是**原生用户输入**，不是“保证直接进入模型的字面消息”。whenBusy 表达安排策略，不提供针对指定执行的原子条件。

```text
用户输入 → 原生命令 / 输入钩子（若存在）
                   ├─ 已处理：回报 locally-handled
                   └─ 继续模型输入路径：在原生判定点应用 whenBusy
```

| 到达原生模型输入判定点时 | reject | steer | follow-up |
| --- | --- | --- | --- |
| 前台没有活动工作 | 允许开始新工作 | 允许开始新工作 | 允许开始新工作 |
| 前台正在工作 | 拒绝本次模型输入，不排队 | 按原生支持的边界干预当前工作 | 按原生后续安排处理 |

这里的“允许”不是成功保证，仍可能因模型配置、资源关闭等原因拒绝。whenBusy 不约束前面的命令与钩子，不承诺目标是指定 Execution，也不保证所有后台工作或队列都为空。若输入已被钩子处理，不伪造模型输入被接纳或执行成功的回执。

例如 Pi 的 `/goal pause` 可能在前台忙时由命令处理，whenBusy: reject 并不禁止该命令。普通文本通过钩子后若仍忙，才可能按 reject 拒绝。宿主不能把这个选项展示为“忙时任何动作都不发生”。不支持的策略必须在进入原生路径之前返回 unsupported。

源码依据见 [Pi 接纳与控制证据](2026-10-17-agent-harness-examples.md#接纳与控制证据)：Pi prompt 先分派扩展命令、再运行 input handler，随后检查 streamingBehavior。`expandPromptTemplates: false` 可跳过命令/模板分派，但不能跳过所有 input handler，因此它不足以提供“无副作用的严格 idle-only 输入”。如果产品确实需要后者，需要原生原子接纳或受约束的扩展接入；这是应由上游解决的保证，不用先读 isIdle 的适配器补丁冒充实现。首版不新增这一强保证。

## 4. 数据与观察

### 4.1 只公开宿主需要引用的实体

| 类型 | 公共形状与用途 |
| --- | --- |
| Thread | `{ backendId: BackendId, id: ThreadId }`；保存原生上下文位置、打开已有会话或 child |
| InputId | 宿主的逻辑输入身份，至少在目标 Session 内唯一；关联投递记录与迟到接纳，不是一次传输尝试 |
| ItemRef | `{ session: Thread, id: ItemId }`；流式更新和工具关联所需的内容位置；类型在 ContentItem 上，不重复放进引用 |
| DelegationRef | `{ session: Thread, id: DelegationId }`；标识某次委派，不能用 child 或触发工具 ID 代替 |
| NativeInputRef | `{ session: Thread, id: NativeInputId }`；原生确有输入实体时才提供，供适配器查询和撤回 |

这些 ID 使用不同的 opaque / branded 类型，底层可序列化为字符串，但调用方不能互换、解析前缀或据格式判断生命周期。宿主生成 InputId；其余引用由适配器返回。存储和 IPC 边界校验后恢复对应类型。

| 内部机制 | 责任位置 | 保留的行为保证 |
| --- | --- | --- |
| SourceRef / epoch | 适配器内部的来源与映射世代，可编码在不透明 ItemId 内 | 同一来源的多个观察者看到相同内容 ID；映射丢失不能复用旧 ID 指向新内容 |
| revision / sequence | 适配器内部排序；跨进程投影版本属于宿主 | 单订阅按序交付、先快照后更新、无提示丢帧被禁止 |
| attemptId | 宿主投递服务的每次传输记录及 Promise 关联 | 接纳事实仍关联 InputId；同一逻辑输入的重试不产生新的用户输入身份 |
| observationId | 宿主创建回调时的订阅上下文 | 不靠某个全局“当前订阅”路由；订阅停止后拒绝旧消费者的迟到写入 |

适配器在共享来源上规范化内容，优先使用有证据的原生稳定身份；无原生 ID 时分配不与其他世代碰撞的 ItemId。重新订阅不重新分配身份；跨 Runtime 重建只有能够恢复原生映射时才保证同一 ItemId。

实时 Item 成为历史 entry 时，有确定映射才发送 replaces。无法确认时以 gap 和替换 snapshot 明示映射断点；新 ID 不与旧 ID 猜测合并，旧观察归档保留在宿主。重连边界通过观察事件表达，宿主不解析适配器的世代编号。

宿主用一个会话投影服务持有规范观察，多窗口订阅投影；公共协议不承诺将两个独立观察流按时间交错合并。需要替换观察时，宿主先封闭旧观察的投影写入并完成已进入写入的 flush，再消费新快照。这个订阅切换标记属于宿主，无需公共 revision。不能用仅有的 callback 顺序宣称已经解决跨进程重放。

### 4.2 操作结果与宿主投递记录

| 类型 | 定义 |
| --- | --- |
| RuntimeError | `{ operation: string, code: string, message: string }`；message 为可安全展示的诊断，不携带密钥或原生对象；code 至少区分 not-found、closed、cancelled、invalid-input、native-error |
| OperationResult<T> | `{ status: 'confirmed', value: T }`；或 `{ status: 'rejected' \| 'unsupported' \| 'unknown', error: RuntimeError }` |
| SubmitResult | `{ status: 'acknowledged', inputId: InputId, nativeInput?: NativeInputRef, facts: readonly InputFact[] }`；或 `{ status: 'rejected' \| 'unsupported' \| 'unknown', inputId: InputId, error: RuntimeError }` |
| InputFact | `'accepted' \| 'queued' \| 'dispatch-started' \| 'locally-handled' \| 'placed'`；至少一项原生确认才返回 acknowledged；是事实集合，不是递增状态机 |
| InputQuery | `{ by: 'native-ref', ref: NativeInputRef }` 或 `{ by: 'deduplication-key', key: string }`；查询限定当前 Session |
| InputLookup | `{ found: false }` 或 `{ found: true, input: InputState }`；未找到不证明先前尝试没有副作用 |
| InputState | `{ nativeInput?: NativeInputRef, inputId?: InputId, facts: readonly InputFact[], outcome?: 'completed' \| 'failed' \| 'aborted' \| 'unanswered', error?: RuntimeError }`；只报告原生可关联的结果，至少有 inputId 或 nativeInput |
| RetractionReceipt | `{ effect: 'withdrawn' \| 'already-placed' \| 'already-settled' }`；只撤回该原生输入，不自动中断会话 |
| InterruptReceipt | `{ effect: 'requested' \| 'native-scope-idle' }`；作用范围由第 5.3 节的适配契约说明；idle 不证明队列、preflight、后台或所有扩展已停止 |
| ResumeReceipt | `{ scope: 'runtime', effect: 'scheduling-enabled' }`；不证明任何任务已完成，也不承诺外部副作用恰好一次 |
| ShutdownReceipt | `{ effect: 'closed' }`；只有所有本实例负责关闭的资源已释放才返回 confirmed |

queued 只确认排队，dispatch-started 只确认派发，placed 只确认原生放置；这些都不证明模型已消费。locally-handled 确认处理路径，不证明命令成功。

预期运行错误用结果表达；编程错误可以抛出。能够证明未接纳才返回 rejected，无法确认则 unknown；已经有接纳证据时不能因为后续查询失败改成 rejected。没有通用 retryable 布尔值。

宿主服务在提交前保存 InputId 与本次尝试记录，持有对应 Promise；结果不需要再重复携带 attemptId。窗口停止等待不终止这个服务任务。迟到接纳通过 input.changed 关联 InputId：它确认该逻辑输入被接纳，不据此宣称某一个未知传输尝试已确定成功。

同一 InputId 的 payload 与 busy 策略不可变；新内容是新 InputId。原生不支持去重时，不自动重试未知结果。Durable 专有投递接口可以接收 deduplicationKey，使用原生查询/去重；宿主记录它与 InputId 的映射。原生不检查同类型 payload 冲突，宿主必须重放原草稿；不能在适配器另建一套持久化接纳队列。

上表的 InputQuery、InputLookup、RetractionReceipt、ResumeReceipt 用于描述对应适配器能力，不要求普通 ThreadHandle 提供这些方法。后续若提取公共扩展，沿用已验证的语义，不以“方法名相同”作为唯一依据。

release 或连接断开不撤回已派发操作。运行时继续结算已派发调用，宿主负责接收并持久化返回结果；无窗口观察者时，运行时仍保留当前归一化视图直到 shutdown，但不因此提供跨进程持久化。宿主取消产品动作后如果迟到取得 access / observation，负责 release / stop；不删除已经创建的原生会话。

### 4.3 内容与子来源

公共内容使用有限的值类型，不依赖 UIMessage、AI SDK chunk 或任意 SDK 对象。

| 类型 | 字段 |
| --- | --- |
| JsonValue | JSON 的 null、boolean、number、string、数组与字符串键对象；仅用于已确认可序列化的工具数据 |
| ContentPart | `{ type: 'text' \| 'reasoning', text: string }` |
| MessageItem | `{ ref: ItemRef, type: 'message', role: 'user' \| 'assistant' \| 'system', parts: readonly ContentPart[], completeness: 'partial' \| 'complete' \| 'unknown', inputId?: InputId }` |
| ToolCallItem | `{ ref: ItemRef, type: 'tool-call', name: string, argumentsText: string, completeness: 'partial' \| 'complete' \| 'unknown' }`；流式参数可以尚非合法 JSON |
| ToolResultItem | `{ ref: ItemRef, type: 'tool-result', call?: ItemRef, parts: readonly ContentPart[], data?: JsonValue, outcome: 'success' \| 'error' \| 'unknown' }` |
| ContentItem | MessageItem、ToolCallItem 或 ToolResultItem；complete 表示内容完整，不表示用户目标成功 |
| Delegation | `{ ref: DelegationRef, parent: Thread, child: Thread, trigger?: ItemRef, status: 'active' \| 'completed' \| 'unknown' }`；trigger 必须有原生关系证据；status 指该委派，不是 child 全生命周期 |
| Activity | `{ scope: 'foreground', state: 'active' \| 'idle' \| 'unknown' }`；不代表后台工作或所有 preflight |

父观察能够暴露子会话关系时，快照及 delegation.upsert 提供 **可通过同一 Runtime.open(child) 访问** 的引用。宿主自行建立 child 观察；父观察不递归混入后代内容。快照只列原生可见关系，不承诺全量历史子任务目录。再次委派同一 child 产生新的 DelegationRef，child Thread 保持不变。

首版不抽象“没有独立 Session 但假装可以 open 的子流”。原生只能提供父工具结果时，快照不提供 delegations 字段，仍正常展示结果；缺少 child 关系或独立观察 API 是原生/扩展接入缺口，不能靠 rootToolCallId 或父消息锚点补造。背景关系、child 控制与结果交付继续由原生机制负责；观察到完成不自动向父端再提交一次结果。

### 4.4 初始视图、流式顺序与丢帧

```typescript
type ObservationSink = (event: ObservationPayload) => void | Promise<void>
```

一次 observe 只观察其 Session；调用方创建 sink 时已知道 Thread，无需每个事件再重复一套观察者/来源 envelope。适配器仍在共享来源内完成规范化与排序，同一 sink 串行调用，快照与更新按实际先后交付。

| ObservationPayload 的 type | 其余字段与含义 |
| --- | --- |
| snapshot | `coverage: 'live-only' \| 'current-view' \| 'retained-view'`、`items: readonly ContentItem[]`、`inputs: readonly InputState[]`、`delegations?: readonly Delegation[]`、`activity: Activity`；总是替换该 Session 的当前来源视图，不删除宿主归档、其他 Session 或 child 视图 |
| item.upsert | `item: ContentItem`、`replaces?: readonly ItemRef[]`；完整累计值，替换关联必须有证据 |
| item.remove | `ref: ItemRef`；移出当前视图，不等于删除模型上下文 |
| input.changed | `input: InputState`；更新已知事实，不从 idle 推断输入完成 |
| activity.changed | `activity: Activity` |
| delegation.upsert | `delegation: Delegation`；父结束不隐式移除 child |
| diagnostic | `error: RuntimeError` |
| gap | `reason: 'overflow' \| 'disconnected' \| 'mapping-reset'`；不能继续将视图声称为完整 |
| closed | `reason: 'stopped' \| 'released' \| 'shutdown' \| 'source-lost' \| 'consumer-error'`；观察终态，不是模型终态 |

`ObservationPayload` 是此表的带 type 判别联合。v0 没有 execution.changed、interaction.changed、raw 或任意 payload 扩展口；不为未定义的数据结构留下类型占位。

observe 只订阅本 Session 的当前可提供视图，不提供分页历史、过滤、后代递归或 resume cursor。retained-view 仍是原生当时可访问的选定历史/分支，不是所有历史的完整备份。每个订阅首帧必须是 snapshot；live-only 用空集合和 unknown 活动说明不覆盖订阅前内容。delegations 缺席表示不提供独立子会话发现；空数组表示支持这一视图，但当前没有可见关系；不能从空数组推断历史上没有子任务。

sink 可能在 observe Promise 返回前运行；调用方预先绑定 Thread 和本地订阅上下文，不能依赖闭包中的 Observation 已赋值。observe confirmed 证明已完成注册及交付安排，不保证消费者已经持久化。每个 sink 串行调用，其 Promise 只施加该观察者的背压；不能阻塞原生同步派发或其他观察者。

适配器在共享来源处分配身份、累积内容及排序；订阅注册与取快照之间的变化需缓冲或采用原生原子 attach。无法无缝衔接时报告 gap。缓冲必须有界：溢出先报告 gap，再提供当前替换快照；无法重建则关闭 source-lost，不静默丢事件。快照可以恢复当前视图，但不能声称恢复已丢失的全部历史事件。

stop / release 完成后不再开始新的 sink 调用；已进入的异步消费者允许结束，宿主负责自己的存储 flush。显式 stop 的完成本身是关闭确认，不要求额外 closed 回调；原生断开、shutdown 等主动关闭则尽力发送 closed。sink 抛错时关闭该观察，不再调用该 sink 报错，也不让异常进入 Pi 原生分发；运行时通过注入诊断端报告，Cherry 将其接入 loggerService。断开影响执行与否由原生事实确认。

## 5. 生命周期与控制

### 5.1 一个运行所有者，多个访问者

同一 AgentRuntime 的并发 open 对同一 Session 必须复用一个创建/加载过程及原生运行所有者。失败不能留下可再次启动的半成品句柄；释放一个 access 不影响其他 access。backendId 由宿主按持久命名空间配置，不使用运行时随机 ID；宿主保证该命名空间的写入者唯一，v0 不提供跨进程锁。

open 只访问给定引用，缺失返回 not-found，不回退到 create；加载后必须核对原生身份。Pi 的缺失/空路径不能当作新建成功返回。会话定位由适配器解析，宿主不将可读历史灌回已存在原生上下文。Runtime 重建后，仍被原生保存的 Thread 可重新 open；旧 access、observation 不得复用；无法恢复的内部内容映射也不得冒充仍然有效。

**首版没有 evict，也没有最后访问者离开自动回收。** release 只封闭该 access 并停止它创建的观察，运行资源及归一化视图保留到 Runtime.shutdown。这样不在无法确认 preflight / 队列 / 扩展已停时偷偷 dispose。代价是长寿命 Runtime 随打开的 Session 增加而占用更多内存；宿主限制同时驻留的会话数量，允许整组关闭时显式 shutdown。Durable 共享 Harness 的关闭会影响整组 Conversation，不能为回收一条会话关闭它。

若后续产品需要无限会话浏览或独立驱逐，再增加经过原生可恢复性验证的 evict 契约；它不是当前首版验收的隐含能力。

### 5.2 提交、控制和释放的竞争

同一 Session 由适配器串行处理公共提交的接纳尝试；锁持有到取得接纳/拒绝证据或确认调用结束，不等待整次模型执行完成。调用进入顺序只规定本地派发顺序，不覆盖原生扩展、自发输入或跨进程竞争。尚未派发的等待是短期调用协调，不是已接纳的持久输入队列。

窗口不再等待后，已派发但未决的调用仍由 Runtime 跟踪，不能立刻释放接纳屏障再派发一个可能重复的 prompt。Pi preflight 挂起会阻塞该 Session 的后续公共派发；这是公开限制，不用超时猜测其失败。其他 Session 不因此被阻塞。

interrupt 不等待提交接纳锁，直接控制原生当时能控制的范围，避免 preflight 永久等待导致停止命令无法到达。它不取消本地尚未派发尝试，也不保证阻止尚在 preflight 的尝试日后启动。release 同步封闭本 access 的入口，取消其未派发尝试；已派发尝试继续结算并可由其他 access 观察。重复 release / stop 幂等。

需要“停止后保持静止”时，宿主先封闭自身投递，再协调在途尝试、原生中断与队列处理；首版不提供这个强原子操作。Pi 缺乏 preflight 取消保证，不能在适配器用布尔变量伪造；需要此保证时推动上游增强或调整扩展约束。

### 5.3 恢复与停机

| 操作 | Pi | Pi Durable |
| --- | --- | --- |
| 初始化 / open | 打开并校验上下文；扩展初始化效果明确披露；不承诺恢复在途模型/工具/队列 | Harness.open 协调遗留状态；Conversation open 不自动 resume |
| resume | 不暴露；恢复上下文不等于恢复执行 | Runtime 级显式开启 scheduler，可能推进多个 Conversation；不提供虚假的单 Session resume |
| observe / lookup | 读取已知视图；不发 prompt | watch/status 等只观察路径，不调用会 resume 的 wait |
| submit | prompt + 对应 preflight 证据；直接 idle steer 不作为基础映射 | 原生事务接纳；即使拒绝也可能 resume 整个 Harness，适配契约事先披露 |
| interrupt | abort 原生工作；队列保留，preflight 和扩展子工作不在停止保证内 | Conversation.abort 默认范围；会 resume，撤回 queued input、包含 owned nonbackground 工作，不覆盖 queued write 与 background |
| retractInput | 不暴露；无统一可寻址队列 ID | Submission.abort，区分 queued/placed/settled |
| shutdown | 封闭接纳、跟踪在途操作，按原生生命周期终止/释放；dispose 单独不证明 drain 完成 | close 共享 Harness 并关闭存储；停止调用不等于持久 Task 被取消 |

shutdown 一旦开始就封闭该 Runtime 的 open/create/submit/resume/控制入口，拒绝未派发尝试；重复 shutdown 加入同一次关闭。运行时负责完成在途尝试的跟踪与清理，最后结束观察和资源。窗口停止等待不影响宿主服务持有关闭 Promise，清理继续；不能重新开放运行时。关闭结果未知或失败时保持 closing，不能返回 confirmed/closed；可能需要等待无法取消的 Pi preflight，首版不承诺有界停机时间。

查询和观察只在资源尚可读取时维持；不得为了完成关闭调用 native wait 而意外开启调度。关闭期间产生的已确认输入事实仍按第 4 节处理；进程退出前由宿主协调投影 flush。外部工具副作用不随关闭撤销，持久恢复也不承诺外部副作用恰好执行一次。

### 5.4 关闭 Runtime 对调用方意味着什么

**关闭 Runtime 是让这个适配器实例退出服务，释放它持有的原生执行资源。** 影响范围是该实例管理的全部会话，而不是当前窗口或当前 Session；不影响其他独立 Runtime 实例。关闭完成后，原实例及其访问句柄不能继续使用，需要重新创建 Runtime。

关闭依次封闭新操作、按原生机制处理在途工作、结束观察并释放引擎、连接及存储句柄。它不是删除会话、统一取消全部任务或保存后暂停；关闭方法的名字不能代替这些行为约束。

| 实现 | 关闭对执行的影响 | 重新创建 Runtime 后 |
| --- | --- | --- |
| Pi | 请求中断当前原生工作并释放 AgentSession 等资源；异步输入钩子未必能立即停止 | 已持久保存的上下文可以重新加载；不保证恢复在途执行或内存队列 |
| Pi Durable | 停止共享 Harness 的任务推进，等待其调用退出并关闭存储；不把未终结任务全部标记为取消 | 使用持久存储且满足原生恢复条件时，可显式恢复未终结任务；内存存储不提供跨进程恢复 |

关闭不撤销已经发生的工具副作用。例如 agent 已经修改的文件不会因 Runtime 关闭而还原。产品历史、原生持久会话与运行资源分别管理；释放资源本身不要求删除前两者。

| 宿主场景 | 对应操作 |
| --- | --- |
| 窗口退出，不再展示输出 | 停止该窗口的订阅，必要时 release 其访问句柄；宿主后台投影可以继续观察 |
| 用户点击停止生成 | interrupt 指定 Session，按原生支持范围确认效果 |
| 应用退出、切换执行环境、明确释放整组资源 | shutdown 对应 Runtime，并协调宿主投影 flush |

这些是设计语义与源码映射，原生实测范围见 [验证记录](2026-10-17-agent-harness-examples.md#9-验证记录与验收清单)。

## 6. 使用场景与验收入口

| 场景 | 调用链 |
| --- | --- |
| 新建会话 | 组合根选择适配器 → typed create → 保存 Thread |
| 打开、发送、显示输出 | open(ref) → observe → submit；输出与回执分别处理 |
| 父结束后子继续输出 | 父观察给出 child Thread → open(child) → child.observe；不依赖父消息 |
| 停止生成 | 若支持则 interrupt；按适配契约理解影响，不等同清空全部工作 |
| 关闭窗口 | stop 窗口订阅 / release 窗口访问；投影服务可保留自己的访问 |
| 关闭整套执行资源 | shutdown；需要再次使用时重新创建 Runtime |

后续按 [剩余验收边界](2026-10-17-agent-harness-examples.md#93-剩余边界) 验证版本兼容、并发接纳、身份映射、关闭与恢复；公共类型存在不等于适配器已兑现保证。


## 原生模型与存储接入

公共 `Thread` 只表示 backend 内的持久上下文身份，`ThreadHandle` 表示当前访问。普通 Pi
的专用配置接收原生 `ModelRuntime`、`Model`、`SessionManager`；Pi 管理原生文件与分支，
宿主选择目录、记录产品会话和原生 thread 的关联。`load` 必须返回相同 ID，缺失不新建。

Cherry 的 AI SDK provider 桥位于 `src/main/ai/runtime/pi/`，只转换单次请求与流式响应。
`agent-runtime-pi` 不依赖 AI SDK，不把公共投影或宿主消息重新转换成原生存储。compaction、
goal verifier 和子任务继续使用原生消息及分支，子任务续接通过原生 manager 完成。

本次没有迁移桌面的 AgentSessionRuntimeService、数据库关联表或 Lane；这些仍是宿主接入任务。
