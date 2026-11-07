# Agent Note: 补齐运行时事实，收敛桌面层所有权

Status: proposed

[English](2026-11-05-agent-runtime-boundary-ownership.md) | 中文

## 问题

2026-11-05 基于 `48371df38d89a564aacffa86cd57177536518c1f` 的审计发现，已注册的 Claude Code、Pi 和 Pi Durable runtime 都存在同一种边界问题：所有者掌握完整关联，却只导出其中一部分，Main 再用额外索引重建关联。`Map`、`Set` 的数量不能衡量正确性或简化效果。真正的问题是同一事实有多个写入者，同一个生命周期需要分别维护多份记录。

生产路径如下：

| 边界 | 当前的重建行为 | 归属代码 |
| --- | --- | --- |
| 提交输入 | 每个 driver 都保留完整产品输入，以便之后通过原生 ID 把 `messageSnapshot`、`headless` 和原始消息交回 Main。 | [Main 输入契约](../../../../src/main/ai/runtime/types.ts)、[会话所有者](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) |
| 子线程访问 | 配置回调、工具结果、原生任务事件和关系事件分别填充来源、就绪、句柄和投影映射。 | [Pi 连接](../../../../src/main/ai/runtime/pi/PiRuntimeConnection.ts)、[Durable 连接](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts)、[Claude 连接](../../../../src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts) |
| 原生控制 | Main 再次解释 Claude 生命周期和任务回执；Durable 轮询待处理输入，弥补活动状态与输入事实独立交付的缺口。 | [Claude 状态](../../../../src/main/ai/runtime/claudeCode/ClaudeRuntimeState.ts)、[Durable adapter](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) |
| 内容证据 | Claude 展示装饰器保留消息并构造归档；观察别名及历史／实时来源通过额外通道传递。 | [Claude 元数据](../../../../src/main/ai/runtime/claudeCode/ClaudeMessageMetadata.ts)、[根投影](../../../../src/main/ai/agentSession/ThreadProjection.ts)、[子投影](../../../../src/main/ai/agentSession/ChildThreadProjection.ts) |
| 用量 | Main 先把原始 Claude SDK 流帧合并为调用，再应用产品价格和归属规则。 | [Claude 连接](../../../../src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts)、[用量归属](../../../../src/main/ai/agentSession/AgentSessionUsageAttribution.ts) |

维护者已于 2026-11-05 批准实施本后续方案，包括观察排空和跨连接输入保留契约。在完整验收证据记录前，本文保持 proposed。它部分替代[运行时契约](../architecture/2026-10-17-agent-runtime-contract.md)和 [Claude 迁移](../architecture/2026-10-27-agent-runtime-claude-code.md)中桌面输入往返、子线程访问衔接及原生控制的职责安排。[SDK 内容协议](2026-10-29-agent-runtime-content-protocol.md)继续负责消息表示、每个原生线程唯一的内容生产者和产品持久化。本文不重新打开其中已交付的修复，也不把既有验收证据重新标记为全部完成。

2026-11-06 的消费者收缩修订见第 11 节。本次仅编写修改方案，未实现其删除项；该节还明确收缩了[运行时契约](../architecture/2026-10-17-agent-runtime-contract.md)、[SDK 内容协议](2026-10-29-agent-runtime-content-protocol.md)和[上下文用量方案](https://github.com/CherryHQ/cherry-studio/pull/23146)中的指定公开能力，原生生命周期与持久化保证保留。

## 方案

### 1. 范围与所有权

复用现有所有者。不新增通用 `BaseRuntime`、第二个会话服务、持久化提交台账、能力矩阵或 migration。普通 AI SDK 对话及已退役 runtime 不在范围内；SDK 升级、提供商路由变更、schema 重设计和通用配置重构也不在范围内。

| 所有者 | 权威状态 | 可跨边界传递的内容 | 不得承担的职责 |
| --- | --- | --- | --- |
| `AgentSessionRuntimeService` 及其现有连接记录 | 产品输入上下文、回复预留、队列、连接代次、产品轮次切换 | 不可变的原生命令；按输入身份关联的回调 | 原生任务调度或 SDK 流帧解释 |
| 现有 runtime connection | 原生访问租约、产品上下文绑定、每个被观察子线程的一份资源记录 | 现有产品投影与计费实际需要的原生事实 | 第二份输入上下文或原生任务状态 |
| package 内的原生 runtime／behavior 所有者 | 接纳、放置、原生输入结果、子线程来源／就绪、原生任务、内容与归档证据 | 在原生边界捕获的类型化值；受支持的原生控制 | Cherry 数据库实体、窗口对象、价格或产品消息创建 |
| `ThreadMessageProjection` 及根／子产品投影 | 展示装饰、来源到产品消息的组合、保留的产品历史和归档写入 | 产品消息与挂接快照 | 原生执行或第二份原生归档 |
| Main 中的用量采集与归属 | 冻结的凭据／价格证据、持久化费用、原生响应到产品消息的归属 | 原生调用身份与计费结果 | SDK 流重建 |

“传完整对象”指在所有者范围内保持一个内聚、不可变的值完整：子线程访问结果一起携带关系和句柄；输入的产品属性一起保留在 Main。它不意味着让整个服务、数据库行对象图或可变会话对象穿过每一层，也不要求公开所有内部字段；每个外发成员都必须有当前消费者或明确保留的诊断职责。

### 2. 提交输入上下文在 Main 只有一个所有者

把待交接的产品输入关联放在现有 session 记录上，位于可被替换的 connected 状态变体之外。按 `InputId` 保存原始 `AgentRuntimeUserInput`，包括捕获的快照、headless 策略，以及原生上下文和来源连接代次。代次用于隔离回调，不决定输入存活时间。之后不得重新读取可变消息行来重建这些属性。原生 package 接收准备好的类型化命令，不接收产品实体。已经由现有 turn、queue 或 child projection 持有的输入继续由它们持有；待交接关联只覆盖 driver 往返，并转移所有权，不复制到第二份宿主台账。

Main driver 回调及 `steer-boundary`／`steer-undelivered` 事件改为携带输入 ID，不再回传完整产品输入。会话所有者解析一次 ID，把完整输入转交现有队列或 steer-transition 状态。这用一份必要的宿主关联替代三个 driver 实现，并不声称关联本身可以消失。

协议按以下顺序执行：

1. 在调用 `redirect` 或 `submit` 前捕获并登记产品输入；原生放置钩子可能同步触发。
2. 通过 `nativeSubmission` 准备并持久化现有原生绑定，保留确定拒绝、已确认接纳、接纳状态未知之间的区别。
3. Pi 或 Durable 确认放置后，在原生执行发起下一次提供商请求前，用 ID 调用现有同步宿主钩子。Main 根据保存的完整输入预留后续回复身份。不得用异步观察交付替代此钩子。
4. 随后向 Main 交付类型化输入事实。现有 reducer 完成可见回复切换，并把完整上下文移入切换记录。重复事实复用同一预留；多个输入可以共享一个响应。
5. 确认未接纳或确认未投递时，把原始上下文恰好一次交回相应产品路径。接纳状态未知时保留关联并核对原生事实；不得自动重发，也不得把查询失败解释为拒绝。
6. 终态交付后，或所有权转入现有队列／切换记录后，释放待交接记录。断连／替换时，未知接纳输入继续留在 session 记录上。后继连接按记录的原生上下文和绑定核对，再转交原始上下文或报告确定结果；不得再次派发该输入。原原生上下文不可用时保留未决输入并报告限制。隔离旧回调，防止它修改后继连接或处置后继连接的待交接输入。现有持久化绑定无法在进程退出后重建 snapshot／headless 属性；此保管保证覆盖存活进程，重启沿用现有恢复策略。

Claude 保留自己的原生区别：`command_lifecycle.started` 是接纳证据，不证明输入已放入模型上下文。adapter 联合命令和响应成员关系证据，报告有依据的边界；Main 不得为了与 Pi 一致而合成 `placed`。有原生证据且必须赶在下一次请求前执行的路径，需要同步钩子；Claude 计费继续使用有证据的响应身份，不虚构提前放置。

恢复出来的纯原生输入没有旧的内存产品上下文。有现成持久化原生绑定时解析它，否则按原生输入事实观察。不得制造产品输入，也不得仅因 Main 的待交接上下文映射为空就把连接标为完成。

### 产品回复交接

维护者同时批准完成产品回复所有权的收敛。在异步准备前分配完整回复身份并冻结输入上下文。交付、原生接纳／结束、排队控制信息和本地交付失败都归现有 reducer 中的这条回复持有。原生结束与产品准备失败是两个不同事实。只有 reducer 决定排队、steer、自主或延后回复的后继；service 回调只为捕获的回复执行 effect。

使用同一条准备路径完成占位落盘、trace 刷新和流挂接。保留 session 级未决输入关联、原生 response 到回复的用量关联以及 context 级投影；删除 `pendingResponseIds`、`pendingProjections`、`pendingDisplay` 和独立的 continuation／receive-only／deferred 启动方法。内容出现前，控制信息可通过连接已绑定的 `contextId` 归入回复。checkpoint 只能引用正文已经提交的其他回复。

已接纳回复的准备或最终保存失败后，事实仍归它持有。原生结束／释放有证据后重试它自己的准备；重复失败继续保管，不开启自动重试循环。只有原回复落盘且原生所有权释放后，才恢复延后的回复。恢复保留接纳状态、作者 snapshot 和 headless 属性，绝不重发已接纳输入。原生接纳前失败会将已创建的回复占位标为错误、终止等待中的流，并保留已保存的用户行供重新发送。

关闭保留 session 所有者并拒绝新输入，直到原生观察与流持久化排空，再执行最终投影 flush。失败保留可重试的数据，并出现在备份的 straggler 报告中。尚未开流的占位也必须结清；关闭期间拒绝迟到的开流请求。最终 flush 成功后才释放所有权；旧准备或终止回调不能推进新回复。这不增加未落盘产品上下文的进程崩溃恢复能力。

### 3. 子线程来源与就绪归原生所有者

为现有公共 `Subagent` 关系补充可选、有证据的创建来源。它仍是跨子线程运行保持稳定的关系，不是 task／run 记录：

```typescript
interface Subagent {
  readonly id: SubagentId
  readonly parent: Thread
  readonly child?: Thread
  readonly origin?: {
    readonly toolCallId: string
    readonly description?: string
  }
}
```

工具调用的作用域是 `parent`，含义是创建调用。后续续接调用不替换子线程身份或创建来源。实时创建与原生恢复应给出相同来源。原生证据无法确定来源时保持缺失；不得从展示文本或最近一次工具调用推测。

只补来源无法解决配置尚未完成时打开面板的问题。为具体的 `pi`、`durable`、`claude` facet 增加 `openChild(toolCallId)`，类型化结果同时包含已确认关系和具体子线程句柄。基础 `ThreadHandle` 访问契约保持精简。例如 Pi facet 返回以下形状：

```typescript
openChild(toolCallId: string): Promise<OperationResult<{
  readonly relation: Subagent & { readonly child: Thread }
  readonly handle: PiThreadHandle
}>>
```

此操作打开接收调用的父线程下已存在或正在创建的子线程访问。它不得启动任务、提交输入、恢复调度或创建替代子线程。查询限定在该父线程及创建调用内，续接保留原关系。原生证据无法确定唯一子线程时，明确返回不可用／不支持结果，不随意选取。原生所有者在原生工具接纳时登记创建尝试，早于等待子线程配置；因此即使还没有 child ID，也可以等待已知的进行中创建调用。并发打开共享该创建尝试，各自获得可独立释放的访问。已知尝试在子线程可观察时完成；未知调用返回类型化错误，不无限等待；创建失败、调用完成却未产生子线程、所有者关闭，都通过现有错误结果模型结束等待。缺失／不可用的原生证据必须如实报告，不能视为成功的空子线程，也不能成为重试原生工作的理由。

adapter 从现有权威来源取得 origin：Pi 的 behavior／session 创建记录、Durable 的 conversation owner 和 behavior lineage、Claude 的结构化 task／parent／tool 关联。Pi 为判断就绪而需要的工具结果解释移入这一所有者。`configureChild` 继续提供原生资源和策略，但不再额外写入 Main 关系状态。任务进度与结果保持为独立原生事实；非子线程后台任务继续受支持。

Main 仍可按 `Thread` 打开已知子线程，恢复其历史。按创建调用查询与直接打开子线程，必须归到同一个原生所有者和同一份 Main 子线程资源记录。释放访问只释放访问；停止一个子线程、中断父线程、关闭 runtime 保留各自不同的原生含义。

### 4. 每个子线程只有一份 Main 资源记录

用连接持有的一份记录替代并行的 `childHandles`、`childProjections` 及来源／就绪镜像，以完整子线程 `Thread` 身份为键。记录包含完整关系、访问句柄、产品上下文、投影及进行中的打开／关闭操作。明确区分打开中与已挂接状态，防止部分初始化资源被当成已就绪。

child ID 尚未产生前的等待归 adapter。访问返回后，Main 在异步设置上下文／投影前插入子线程记录。并发调用加入该记录；未被采用的重复访问必须释放。不另增一张永久的 Main 配置尝试映射。嵌套子线程根据返回关系解析真实父产品上下文，不默认归到根线程。

挂接失败时，释放本次尝试获取的资源并移除失败的打开记录，保留已有历史视图和可见诊断。下次挂接可以重试打开／观察，但不能重新提交工作。一旦记录持有尚未落盘的输出，flush 失败就必须保留记录和可重试关闭状态；删除记录会丢掉唯一写入者。这两种失败不能合并为一个缓存的 rejected promise。

面板持有订阅，不持有原生子线程。关闭面板或父回复完成，不关闭子线程记录。停止、备份／恢复、连接替换和 runtime 关闭继续走现有写入屏障。先封闭输入并按需停止／排空原生生产，再等待截至最后一批原生事实的全部观察交付和回调完成，之后才能读取最终归档并写入产品存储。最终 flush 后不得再执行回调或投影写入；最后才脱离观察并释放访问。原生执行 promise 或 `Observation.stop()` 本身不构成这一屏障：当前 `ThreadFeed.stop()` 会丢弃待交付队列，也不等待进行中的回调。等价交付屏障接管前，必须保留 Claude 现有 `observationEnds` 保证。备份／恢复必须维持同样的无写入边界，直到 resume。保留引擎各自的关闭语义，并让 flush 失败保持可见。

### 5. 原生事实完整、有序地交付

引擎专属控制事实留在具体 facet，不引入通用 run 状态机，也不暴露无类型事件字典。每个 package 只有一个所有者解释 SDK／原生事件。Main 把解释完成的事实转换成现有产品事件。

| Runtime | Package 职责 | 迁移后的 Main 职责 |
| --- | --- | --- |
| Pi | 联合工具调用创建、子线程可用性、behavior 任务状态、放置和结束证据，发布类型化 child／task 事实。 | 绑定产品上下文、同步预留回复身份、装饰工具并持有 tracing 资源。 |
| Durable | 报告结束前，核对已接纳及恢复出来的原生输入、已提交结果、前台工作和压缩。 | 消费完整事实集，执行产品轮次／持久化切换。 |
| Claude | 规范化命令／响应成员关系、会话身份变化、原生任务生命周期、自主工作、权限拒绝和 SDK 调用证据。 | 应用产品回复切换、交互策略、展示元数据和计费。 |

Durable 增加具体的观察批次，同时携带内容／输入事实，以及从同一权威原生修订计算出的前台结束结果。相关已接纳或纯原生输入仍无终态／本地结果，或前台执行／压缩尚未完成时，结束状态必须保持 pending；未知状态不能变为成功。adapter 在发布结束结果前核对原生提交记录。feed 在内部保留区分新结束与重放所需的原生身份／修订；Main 只接收其实际消费的结束事实，不要求公开修订号或 pending 副本。最终输入结果和内容先于相应终态事实发布。后台工作和 runtime 整体排空仍是独立概念。

维护者于 2026-11-05 另行批准最小 SDK 导出补丁：向仓库现有的 Pi Durable 1.4.0 patch 追加已有 `conversationViews`、`ConversationView` 和 `ViewObserver` 的导出。公开 `watch` 会合并修订，无法建立此契约。补丁只改变导出，保留锁定版本，让 adapter 在同一已提交存储／视图修订中规范化提交结果。

这样 Main 才能删除 `pendingInputs`、`refreshInputs` 和 `finishIfIdle` 中的原生轮询。不能用 `activity === idle` 或 `hostPending.size === 0` 替代。原生所有者仍可能需要输入索引；应并入现有原生输入记录，而不是再建一份提交台账。公共 `Activity` 类型继续只描述前台活动。

Claude 在现有 owner／feed 中规范化为可判别联合。每个迁移的控制事实一起携带其原生身份和有关 input／response／task 关联。标准内容由现有 SDK 消息投影处理。把原始 `command_lifecycle`、`result`、任务回执及权限拒绝解释移出 Main，包括任务解析器对 `ClaudeMessageMetadata` 的依赖。尚未映射的 SDK 变体，必须在 adapter 契约测试中明确归为内容、控制、诊断或有理由的不支持；不能静默强转为兜底对象。

观察来源内部必须区分首次挂接基线、后续原生更新、缺口后恢复、仅元数据刷新；这不要求在公开批次中保留 delivery 标签。别名、撤回和来源信息随交付批次一起捕获；不能在交付已经前进后再读取可变别名表。复用 Claude 的具体批次，为 Pi／Durable facet 提供等价的完整载荷。Main 投影入口改为接收这一完整值，替代快照、推测的 `liveSnapshot` 标记和另行读取的别名表。连接边界可以做纯类型化字段映射，不能再维护一个语义 reducer。

首次基线加载历史和当前状态，不重放历史轮次完成或费用。后续溢出恢复必须在相应正文更新之后交付之前未见的终态／控制事实。按原生事实身份，在现有原生 feed 中维护每次观察的交付位置／去重；按 feed 现有保留策略压缩已确认交付状态，不永久保留全部事件。这是访问生命周期状态，不是另一份持久化事件日志。慢观察者不能阻塞原生执行。如果 feed 无法恢复必需的控制事实，应报告缺口，不伪造完成。Main 持久化在重复事实下保持幂等；这不承诺跨进程崩溃的 exactly-once 效果。

### 6. 从展示装饰器移除 Claude 原生归档与语义

以 `handle.claude.archive()` 作为 `ChildThreadProjection.readCommitted` 的已提交原生内容来源。对单次捕获的归档结果做纯类型化转换，保留现有 Main 已提交历史消费形状。Pi、Durable 继续读取各自原生归档。不创建新归档服务，也不让展示装饰器成为归档提供者。

Claude adapter 把权限拒绝语义应用到受影响的 SDK 工具 part，保留明确的来源撤回，并把别名、旧来源关联与所属归档／观察一起暴露。即使所属调用已不在选定视图内，明确撤回仍应移除其输出。某项不在压缩后／当前视图内，不代表可以删除保留的产品历史。

消费者改用这些原生事实后，删除 `ClaudeMessageMetadata.messages`、`removed`、`legacy`、`denied` 和 `archive()`。剩余装饰器只负责 MCP 标签、产品 reminder 可见性等产品展示。宿主观察到的 reasoning 时间戳可以作为展示计时状态保留；明确并保持其当前含义，不把它替换为没有依据的原生思考时长。其他剩余原生内容解释也必须先移入 adapter，再删除 Main 副本。

保留 `ThreadMessageProjection` 的原始／装饰视图：元数据可以在内容未变化时改变。为协调原生当前视图和保留的产品历史，继续保留必要的 child composition、持久化产品／原生身份、tombstone 和 checkpoint 映射。它们属于不同所有权领域，不是重复的原生消息仓库。

### 7. 下移 SDK 用量聚合，计费保留在 Main

Claude adapter 把 SDK 消息／流用量合并为完整原生调用事实：稳定调用身份、原生 thread／response 身份、模型身份、有证据的 token 数、完成／错误状态及计时观察来源。部分流帧和最终 assistant 帧更新同一调用记录。复用原生所有者及其响应关联，不保留独立的 Main 聚合实现。

Main 仅在 `usageCapture.owner === 'agent-sdk'` 时消费这些事实，在现有调用边界冻结既有凭据／价格证据，并通过现有计费服务持久化。如果只报告终态会导致价格或归属冻结过晚，就不能只报告终态；必须以同一身份报告开始／关联证据和后续更新。SDK 会话累计用量不能被当成额外调用。

Gateway 路径继续以 `provider-calls` 为唯一采集所有者。`AgentSessionUsageAttribution.owners/pending` 仍有必要：提供商调用可能先完成，响应随后才归到产品消息。立即持久化已完成的用量，暂不关联消息，之后绑定已有记录，不改变费用。没有原生消息的调用保留在总账中。删除独立持久化的会话维度及其未使用的查询／索引，保留运行时会话校验。本提案不新增计费表或用量所有权 migration。

### 8. 明确删除与保留的状态

| 当前状态 | 目标处理方式 | 删除条件 |
| --- | --- | --- |
| Pi `pendingSteers`、Durable `steers`、Claude `pendingSteers` | 现有 Main session 记录上的一份待交接产品上下文关联，跨连接替换保留 | 三个 driver 的同步预留和上下文转交均使用输入 ID；未知接纳保留原始属性直到核对完成。 |
| Claude `startedSteers` | 现有 Claude owner 内的原生命令／响应关联 | Main 不再解释命令帧来重建边界。 |
| Main `childOrigins`、`childRelations`、Pi `childReadiness` | 原生关系／访问事实；一份 Main 子线程记录保存返回值 | 实时、配置未完成、嵌套及恢复访问满足同一契约。 |
| Main `childHandles` 和 `childProjections` | 每个子线程一份资源记录，保留必要句柄／投影所有权 | 打开失败重试与最终 flush 失败具有不同生命周期。 |
| Pi `childTaskStates`、Durable `childStates`、Claude 任务关联映射 | 原生／behavior 任务记录，加上从事实派生的产品展示 | 子线程及非子线程任务状态不再要求 Main 解析 SDK／工具结果。 |
| Durable `pendingInputs` 和刷新轮询 | 现有原生输入记录及修订一致的结束事实 | 存在待处理纯原生输入时，idle 不能完成产品轮次。 |
| Claude 元数据归档字段 | 现有 package archive／projection | 撤回、仅元数据拒绝、选定视图历史和最终 flush 契约通过验证。 |
| Claude `pendingInvocations`、lane 及已提交调用索引 | Claude owner 内的一份原生调用记录／索引 | 外部 CLI 用量保持幂等；Gateway 没有第二个写入者。 |
| Main `historical`／`seenNative` 观察重建与 Durable `baseline` | 原生 feed 中的初始／恢复来源及交付跟踪 | 首次基线不重放完成；溢出不丢失新终态事实。 |
| Pi `pendingBindings` | 可以考虑改为直接同步绑定，不是必需的架构变更 | 仅在保留失败／重试语义时删除，否则保留。 |

保留原生所有者注册表、产品／原生身份映射、用量归属关联、原始／装饰视图、原生队列与关闭屏障，以及 tracing span 所有权。工具 span／名称／完成字段若生命周期相同，可以共享一份工具资源记录；不能仅为减少字段数量就移除终态去重。配置授权、MCP 展示目录和模型绑定继续归各自所有者。

### 9. 交付顺序与审查边界

本文是 proposed Spec。按仓库 Agent Note 流程发布并批准其准确修订后，再开始实现。审计基线是源码参考，不授权重写所有旧 stack 层。开始实现时核对实时 stack，把每个原生生产者变更放到其所属层，再接上桌面消费者；可独立合并的父层必须保持自身有效。

| 阶段 | 聚焦变更 | 必需的退出证据 | AC 覆盖 |
| --- | --- | --- | --- |
| 1 | 为三个 adapter 增加有证据的子线程来源和具体子线程访问操作。 | 配置未完成、并发访问、嵌套、冷历史、失败和关闭的契约测试；恢复来源无需 Main 副作用。 | AC1, AC5 |
| 2 | 切换桌面子线程消费者并合并子线程资源记录，删除关系／就绪镜像。 | 独立子线程历史、挂接重试、最终 flush 重试、定向停止和备份／恢复屏障测试。 | AC6, AC7 |
| 3 | 集中产品输入上下文，把三个 driver 的回调／事件迁移为按 ID 关联。 | 下一次请求前预留、原始上下文保留、多输入共享响应、未知接纳和过期连接代次测试。 | AC2, AC3, AC4 |
| 4 | 补齐原生控制／观察事实，包括 Durable 结束事实和 Claude 交付来源，删除 Main 原生重建。 | 待处理纯原生输入、首次基线、慢观察者溢出、终态失败、自主工作和撤回测试。 | AC4, AC8, AC9 |
| 5 | 切换 Claude 归档／权限语义及原生调用聚合，再删除过时元数据／状态字段。 | 子线程归档协调、仅元数据更新、外部 CLI 用量及 Gateway 单写入者测试。 | AC10, AC11 |
| 6 | 执行受影响桌面验收，移除剩余迁移用桥接。 | 三个 runtime 的 Electron 流程及下述证据记录；没有并行的新旧生产者。 | AC12, AC13；累计审查 AC1–AC11 |

每次消费者切换，在同阶段删除其旧生产者。package 可以先增加契约、随后迁移调用方，但不得为已迁移事实保留兼容开关、双写或两个权威来源。不把整个方案合为一次大重写。发生回归时，回退受影响的消费者阶段及对应契约变更；不能让两套实现同时运行以掩盖不确定性。本方案不改变持久化 schema，因此不需要数据库回滚。

### 10. 验证方案

每个阶段先用契约测试暴露真实缺陷或所有权缺口，再修改生产者及受影响消费者。断言输入、内容、持久化状态和资源行为的结果；不能用 mock 调用次数、字段数量目标或当前行为快照来证明重构有效。数据库消费者使用 `setupTestDatabase()` 和生产 migration。

| 领域 | 应扩展／按明确文件过滤运行的现有测试归属 |
| --- | --- |
| 原生契约 | `packages/agent-runtime-pi/tests/runtime.test.ts`、`startupObservation.test.ts`、`runtimeLifecycle.test.ts`；`packages/agent-runtime-pi-durable/tests/runtime.test.ts`、`pendingObservation.test.ts`、`recoveryConfiguration.test.ts`；`packages/agent-runtime-claude-code/tests/runtime.test.ts`、`observation.test.ts`、`projection.test.ts` |
| 桌面桥接 | `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`；`src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`；`src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`、`desktopRuntime.integration.test.ts`、`ClaudeMessageMetadata.test.ts`、`ClaudeRuntimeState.test.ts` |
| 输入、写入屏障与持久化 | `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`、`agentSessionRuntimeState.test.ts`、`AgentSessionRuntimeService.child.test.ts`、`AgentSessionRuntimeService.handoff.test.ts`、`ChildThreadProjection.test.ts`、`AgentSessionArchivePersistence.integration.test.ts`、`AgentSessionUsageAttribution.test.ts` |
| 可观察的产品结果 | `src/renderer/services/aiTransport/__tests__/ExecutionStreamOverlayService.test.ts`、`MessageProjectionService.test.ts`；受影响 runtime 对脚本化本地端点执行的原生契约探针 |

每个代码阶段运行 `pnpm change:scope --base <verified-base>`，查看 `pnpm check --plan --base <verified-base>`，并检查 `pnpm docs:affected --base <verified-base>`。使用明确文件过滤的 package／Main／renderer 测试包装命令、变更文件格式化／lint，以及受影响 package build／typecheck。全项目测试和平台打包留给 CI。上表标出受影响消费者，并非要求每阶段重跑所有文件。

最终 Electron 验收使用隔离 profile，逐个 runtime 覆盖：配置完成前打开子线程；从两个窗口观察；父回复结束后继续子线程；重开保留历史；携带捕获的产品属性进行 steer；停止一个子线程而不停止其兄弟；备份／恢复暂停期间尝试子线程输入。还需人为控制挂接失败和归档 flush 失败。验证可见内容和持久化行，不能只验证 IPC 调用成功。脚本化原生探针与 Electron 渲染属于不同证据，也不证明真实模型质量。

实现已在 `48371df38d89a564aacffa86cd57177536518c1f` 的基础上完成验证。生产者／消费者切换、会话持有输入上下文、子线程资源合并、Durable 原子批次、Claude 控制／归档／用量和观察交付屏障已经实现。定向回归与下列 Electron 场景已完成。本文保持 proposed；现有证据不宣称完整备份文件恢复或已发布 stack 验收完成。

| 截至 2026-11-05 的证据 | 结果与限制 |
| --- | --- |
| 包构建／类型与 Main 类型 | 四个运行时包的构建和类型检查通过；`pnpm typecheck:node` 通过。 |
| 定向回归 | 输入保留／重连、同步放置、子线程访问、投影持久化、溢出恢复和用量套件已按显式测试文件筛选通过。最新 Durable 桌面套件 22 项通过，包括原生后台工作结束后仍被阻塞的观察回调，以及最终 flush 后无新增写入。 |
| Pi Electron | 使用隔离配置和本地脚本端点，验证双窗口子线程历史／实时观察、父回复结束而子线程仍活跃、子线程续接、定向停止且兄弟线程继续、暂停时拒绝子线程输入、阻塞观察排空及最终落盘。 |
| Durable Electron | 最终复测通过双窗口观察、续接、定向停止、暂停拒绝输入、阻塞观察排空、最终 flush 后无新增写入及保留历史。首轮发现的桌面连接缺少 `drainChildWrites` 已修复，并由 22 项桌面测试覆盖。 |
| Claude SDK 与最终排空 | 维护者于 2026-11-05 批准 SDK 0.3.311 的最小事件透传补丁。逐字节比较证明，它只删除 JavaScript 迭代器对已有 host-only `session_state_changed` 帧的 53 字节过滤语句。SDK 状态管理、依赖版本和 CLI 文件均不变。打补丁后通过 66 项原生测试和 25 项桌面测试，包括存活连接的备份排空，以及观察回调阻塞时的关闭。 |
| Claude Electron | 双窗口观察独立子线程完成，原生 SendMessage 续接同一子线程，定向停止不影响兄弟线程，暂停拒绝子线程输入；回调阻塞时备份排空保持等待，释放后由原生 idle 完成排空且没有后续写入，两个窗口均重开了保留历史。 |
| 失败与重试 | 受控 Electron 挂接失败保留可读历史。首次重试暴露了缺少已有绑定重试路径；嵌套子线程回归在修复前失败、修复后通过。受控归档失败阻止备份及关闭，保留写入者，恢复后重试成功且没有新增提供商请求。 |
| 验证边界 | Electron 验证了备份和恢复共用的 runtime pause／drain 屏障，没有执行 ZIP 导出、文件替换或恢复后重启。配置未完成和捕获的输入属性已在原生／桌面测试中验证，没有在 Electron 中独立控制其时序。隔离实例的 SQLite ABI 启动失败已通过获准的清理恢复，后续启动和正常退出均成功。 |
| CI 与平台范围 | 不宣称远端 CI、完整套件、平台打包、进程被杀恢复或真实供应商质量已经验证。不宣称性能或内存收益。 |

定向命令包括带上表显式文件参数的 `pnpm test:main`、`pnpm test:agent-runtime packages/agent-runtime/tests/observation.test.ts`（9 项通过），以及 `pnpm exec vitest run --project main src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`（22 项通过）。最终 Claude 桌面运行选择 `desktopRuntime.integration.test.ts` 和 `ClaudeCodeRuntimeDriver.test.ts`（25 项通过）；原生运行选择 `runtime.test.ts`、`observation.test.ts`、`control.test.ts` 和 `projection.test.ts`（66 项通过）。本地 Electron 证据与脚本端点保存在忽略的 `.context/cherry-electron-dev/` 目录。上述 AC12 的更广验收限制明确保留，本文保持 proposed。

回复交接后续实现通过 `AgentSessionRuntimeService.handoff.test.ts` 使用真实 SQLite 和生产 migration 验证。覆盖准备失败前后到达的内容与用量、已接纳和未接纳的延后输入、冻结的作者／headless 上下文、提前到达的 steer 审批、checkpoint 排除未提交回复、前驱保存期间的自主回复交接、提交前失败占位结清、嵌套暂停、阻塞 trace 完成、开流前关闭、阻塞原生关闭／流持久化，以及最终写入失败后不重发输入的重试。reducer 测试另行覆盖结束／释放换序和旧回调；stream manager 屏障测试覆盖替换期间仍等待捕获的持久化循环。这些是自动化 host 契约证据，不是新增 Electron、真实供应商或进程被杀验收证据。

### 11. 按实际消费者收缩运行时

2026-11-06 对 `46d76e46c03d1d1f19da4ccf03cea27e24c11180` 的字段和消费者审计发现，完成前述所有权迁移后，公开接口仍包含无人调用的方法、内部状态的外发副本，以及桌面已经不走的旧行为实现。维护者已于 2026-11-06 单独批准本修订，实施与本轮验证记录见第 11.6 节。此前批准和证据保留其原有范围。本文继续保持 proposed，等待更广的验收与 stack 发布复核；本地完成不代表已发布 CI 或平台打包验收完成。

目标是让当前产品行为由更少的协议、转换和执行路径支撑。保留四个 package 及其现有所有者；不通过移动目录、创建 manager、增加通用基类或再造状态机完成收敛。普通 AI SDK 对话不接入这个 registry。当前 `HostPorts` 的生产实现位于 Electron Main，供 Pi 与 Pi Durable 使用；Node 中的 `createScriptedHost` 用于契约测试。本修订按这些已有消费者收缩，不新增独立 Node 产品入口。

#### 11.1 保留的边界与接口

| 边界 | 保留的操作或数据 | 当前消费者与理由 |
| --- | --- | --- |
| 公共访问 | `Thread`、`AgentRuntime.open/shutdown`、`ThreadHandle` 的输入、观察、context usage、中断与释放 | 三个连接和子投影需要独立访问、原生身份及明确的资源生命周期；打开不创建替代历史，释放不停止执行。 |
| 输入结果 | `InputId`、`nativeInput`、接纳状态、facts、outcome、error | `nativeSubmission` 写入绑定，Main 保管未知接纳输入；原生 outcome 与产品回复身份仍分开。 |
| 内容与子关系 | SDK 消息、明确撤回、aliases、live provenance、child origin、具体 `openChild` | 根／子投影、历史恢复和定向控制实际使用；native response IDs 仍用于计费关联。 |
| 原生控制与资源 | 各 adapter 的具体控制、私有 capture／retention、`settled`、`drain`、`stop`、`release` | 原生停稳、观察回调排空和最终写入是不同阶段。具体 facet 允许不对称。 |
| 产品与诊断 | Main 输入上下文／回复 reducer／用量；`RuntimeError.operation/code`、Claude failure 的 `subtype/terminalReason` | 产品状态有实际持久化与交接义务；错误字段保留结构化诊断，删除它们不会消除一条独立执行路径。 |

`ThreadContextUsage.revision` 保留：完整结果比较会推进 child 的刷新代次。`reserved/free` 保留：renderer 通过动态键读取。`legacy[].parts` 在子线程归档中保留。不得用直接字段搜索的零命中推翻这些消费者。

#### 11.2 确定删除的协议与实现

以下是基于上述提交的逐项删除清单；每行同时修改声明、构造和直接消费者，不保留只删类型后的运行时副本。路径缩写：`C/` = `packages/agent-runtime/src/`，`P/` = `packages/agent-runtime-pi/src/`，`D/` = `packages/agent-runtime-pi-durable/src/`，`L/` = `packages/agent-runtime-claude-code/src/`，`M/` = `src/main/ai/runtime/`。第 11.3 节另列整文件删除。

| 项目与文件 | 明确删除的代码 | 删除后的边界 |
| --- | --- | --- |
| R1 — `M/types.ts`、`M/registry.ts` | `AiRuntimeCapability`、`AiRuntimeDriver`、`AgentSessionRuntimeDriver.listAvailableTools`；registry 的 `isAgentSessionRuntimeDriver`、通用 `register` overload、未调用的 `get()`、能力过滤分支 | `AgentSessionRuntimeDriver` 直接声明 `type`；registry 的 Map 直接存它，保留 `register/getAgentSessionDriver/getAgentSessionDrivers/clearForTest`。不把普通 AI SDK 对话纳入 registry。 |
| R2 — `M/registerDrivers.ts`、`M/pi/PiRuntimeDriver.ts`、`M/piDurable/PiDurableRuntimeDriver.ts`、`M/claudeCode/ClaudeCodeRuntimeDriver.ts` | 四处固定 `capabilities` 和四处 `listAvailableTools` 实现／lazy 转发；Pi 的整个 `listPiAvailableTools()` 及其专属 imports | driver 的 connect、validate、fork、回收和预热保留；真实工具 UI、MCP 构建与 Claude policy helper 保留。`M/pi/PiRuntimeDriver.test.ts` 当前只测死方法，整文件删除；注册测试去掉对应 fixture。 |
| R3 — `C/contracts.ts`、`C/index.ts`；三个 adapter 的 `runtime.ts`；`L/owner.ts`、`P/runtimeProjection.ts`、`D/projection.ts`、`L/observation.ts` | `ThreadInput.policies`、`Activity.scope`；整个 `InterruptReceipt/ResumeReceipt/ShutdownReceipt` 类型与根导出；所有专属 `scope/effect` 成功值构造；`claude.stopTask` 的固定 effect | interrupt、resume、shutdown、stopTask 成功返回 `OperationResult<void>`，保留 status/error、原生调用及 await。保留 `BusyPolicy/whenBusy` 的校验；confirmed 不改成全部后台工作已停止。 |
| R4 — `C/contracts.ts`、`P/runtimeProjection.ts`、`D/projection.ts`、`L/owner.ts`、`src/main/ai/agentSession/ThreadMessageProjection.ts` | `InputState.response`；Pi `input_settled` 的 response 构造；Durable `submissionState` 的 response 构造；`ClaudeOwner.response` 私有槽位及其重置、assistant/result 赋值、专用 `findLast` 和 terminal 传递；Main 的 response thread 校验和合并复制 | 原生 `entryId/answer` 仍用于 outcome/error 判定，输入 `nativeInput` 仍落库；responseIds、invocations 和计费 join 保留。不能删原生结果或按 outcome 推造产品回复 ID。 |
| R5 — `C/contracts.ts`；三个 adapter 的 snapshot 构造；`src/main/ai/agentSession/ThreadMessageProjection.ts` | 整个 `ThreadSnapshot.coverage`；`P/runtimeProjection.ts`、`D/projection.ts`、`L/observation.ts`、`L/projection.ts` 中该标签的构造；Main 投影状态中的 coverage 声明和赋值 | 删除全部三种标签的输出，不删 Claude restore 的 retained 内容合并、明确撤回和原生归档。`ThreadContextUsage.breakdown.coverage` 保留。 |
| R6 — `C/contracts.ts`、`D/contextUsage.ts`、`L/contextUsage.ts` | `ThreadContextUsage.inputLimit/compactionThreshold`；Durable 和 Claude 返回对象中的 compactionThreshold 赋值 | inputLimit 只有声明，Pi 当前没有对应输出，不为凑范围修改 Pi 计算。保留完整 contextWindow、原生压缩配置、reserved/free、revision 和精度。 |
| R7 — `P/runtimeProjection.ts`、`D/projection.ts` | `PiObservation.delivery`；`DurableObservation.delivery/revision/pending/completion.revision`；`observe()` 输出对象中的这些属性及 completion 的 revision 赋值 | `observeCaptured` 的 delivery 参数与分支、Durable 私有 `revision/pending/admitting/cycle` 和 `update()` 原子计算保留；公开 completion 只含 inputs。 |
| R8 — `L/types.ts`、`L/observation.ts`、`L/runtime.ts` | 公开 `ClaudeObservation.delivery`；公开 batch state 的 `active/backgroundTasks/backgroundWorkActive`；`claude.state().aborted`；公开 `claude.agentId`，以及相应返回属性 | batch state 只输出捕获时的 aborted，即时 state() 只输出 active。`ClaudeFeed` 的完整私有 controlState 不再借公开 state 类型；私有 delivery mode 继续驱动 baseline/recovery。保留 native agentId、baseline background controls 和 controls/native/invocations。 |
| R9 — `L/types.ts`、`L/index.ts`、`L/projection.ts` | `ClaudeSource` 及根导出；`ClaudeArchive.thread/coverage/sources/messages`；`committed()/restore()` 的相应返回属性；`upsertContent()` 的 sources 数组、逐块 ref/uuid/block 构造和 Map 值存储 | `sources: Map<string, ClaudeSource[]>` 收缩为 committed UUID Set，仍在相同时点记录空／native-only source。保留实际内容 `messages` Map、原生 `NativeArchive.messages`、restore 的 selected 解码和 `content/legacy/retracted`；Owner 的归档缓存只保存缩窄后的结果。 |
| R10 — `L/content.ts`、`L/control.ts`、`M/types.ts` | `ProjectedBlock` 的 result 分支 `type` 声明及 `projectBlock()` 的该属性构造；`ClaudeControlState.accept()` 未用返回值；`RuntimeMessageProjection.legacy` 值类型的 `parts` 要求 | accept 签名改为 void，`return message` 改为 `return`，保留原有提前退出和控制副作用；part.type、SDK 类型和 child archive 的 legacy.parts 保留。Main root DTO 只改类型，不创建额外 map/copy。 |
| R11 — `P/runtime.ts`、`D/runtime.ts`、`M/pi/piBehaviorHost.ts`、两个 Main connection | 两个外层 `configureChild` 的 parent/origin 参数及 Pi 的 toolCallId 参数；对应调用对象的这些属性；Durable `onInputPlaced` 的完整 InputState 临时对象 | configureChild 只传 `{ thread, modelKey }`，原生 lineage 和 nativeCallId 的内部用途保留；onInputPlaced 只传 `InputId \| undefined`，仍同步早于下一次模型请求。Pi callback 的返回面按第 11.3 节收窄。 |
| R12 — `D/runtime.ts`、`D/index.ts`、`C/contracts.ts`、`C/index.ts` | `PiDurableThreadInput` 及根导出；宿主 `deduplicationKey` 和向 SDK `requestId` 的传递；整个 `lookupInput()/retractInput()` 实现、`sameSession` 专用 helper 及专属 imports；`InputQuery/RetractionReceipt` 及根导出 | input 直接用 `ThreadInput`；behavior 的消息／goal key 直接用 inputId。保留 SDK 去重能力与提交记录，保留正常 submit 使用的 `readInputState/inputState`、logicalIds、inputs；保留 Main `InputLookup/lookupNativeInput` 的观察核对路径。 |
| R13 — `P/sessionEvents.ts`、`P/behavior/harness.ts` | AgentRuntimeEvent 的整个 `input-settled/subagents` 分支、`turn-complete.aborted`、`compaction-end.entryId`；SessionEvents 对应 emit 分支、`compacting/compactionEntryId` 及 flush 跟踪 | 保留原生 input_settled/agent_settled 的其他消费者、同步 input-placed/session-append、summaryFailure 和压缩结果。保留 harness.prompt、共享 submit helper 和 users 计数器。内部 submitUser 契约测试入口按下文的实际用途保留，不再从包根导出。 |

这些是私有 workspace API 的有意收缩，没有弃用适配器或兼容开关。若实施时出现审计基线之外的新生产消费者，先把实际场景及最小需要回写本节，再决定范围；不得静默增加兼容层或把整项标为完成。

#### 11.3 退出旧 Pi 行为路径

Pi `PiSessionOptions.behavior` 从迁移用可选项变为必需项，`createPiRuntime` 只走现有 `buildBehavior` 路径。删除不带 behavior 的 legacy 创建、旧 child controller 分支和冲突选项检查；不新增模式选择器。现有 Node 契约测试复用 `createScriptedHost`，验证同一 adapter 和 behavior，不伪造 application/service 对象。

**整文件删除清单。** 下表路径均相对 `packages/agent-runtime-pi/src/`，共 11 个源文件。它们的产品职责已经由 `agent-behavior` 和当前 `behavior/` adapter 承担，不再提供第二套实现。

| 文件 | 随文件删除的实现 |
| --- | --- |
| `askUserExtension.ts` | `createAskUserExtension`、旧 AskUserPort、问答参数／结果转换与等待控制。 |
| `goalExtension.ts`、`goalState.ts` | `createGoalExtension`、旧 GoalPort/GoalVerifier、goal 状态机、round 调度、旧预算与恢复算法。 |
| `todoExtension.ts` | `createTodoExtension`、旧 Todo 类型和专用工具状态处理。 |
| `offload.ts` | `toolOutputOffloadExtension/offloadText`、旧 ToolOutputOffload/ToolOutputStore 和专用结果裁剪。 |
| `approval.ts` | 仅服务旧 Goal/Subagent 扩展的 `ToolApprovalEvent`。 |
| `subagent.ts` | `createSubagentExtension`、SubagentPort、旧工具注册、配置／续接／停止入口；共享原生配置的处理见下文。 |
| `subagentRegistry.ts` | `SubagentRegistry`、旧 child 状态集合、审批状态、hold／userAbort／后台切换控制。 |
| `subagentDelivery.ts` | `SubagentDelivery`、PendingDelivery、旧通知排队／裁剪／投递与状态文本。 |
| `subagentRun.ts` | `SubagentInbox`、`RequestLimit`、startupRuns、旧 openChild/runSubagent、请求计数和用量聚合；唯一共享零用量字面量的处理见下文。 |
| `subagentSession.ts` | `createSubagentSessionManager/subagentForkPoint`，即旧执行器的原生 child 创建／fork 包装。 |

**为使上述文件真正消失，同一改动还必须删除这些局部代码：**

1. `P/runtime.ts`：删除 `build()` 中 `config.behavior` 之外的旧构建体、childRelations/publishChild、旧 configure/onSessionCreated 包装及 `Entry.parentSession`。删除 submit、compact、interrupt、permissionModeChanged、settled、shutdown 中按有无 behavior 选择旧实现的分支。`PiSessionOptions.behavior` 必需；其 compaction 输入不再暴露 `summarize`，由 behavior 内部提供，因此删除 `conflicting-behavior` 检查。
2. `P/runtime.ts` 的 `configureChild` 返回类型改为 `Partial<Pick<AgentRuntimeSessionOptions, 'model' | 'modelRuntime'>>`，保留原生模型／runtime 及继承语义；删除该 callback 返回的 `extensionFactories/onEvent/onSessionCreated` 槽位和对应特殊分支。这些槽位在当前 Main 没有消费者。保留根配置中的 extensionFactories/onEvent；子线程继承 extensionFactories，onEvent 仍只交付 root 事件，不能把 child placement 交给 root 回调。不把旧 `SubagentSessionOptions` 整个搬到新文件。
3. `P/session.ts`：删除 options 的 `offload/subagents`、createSubagentExtension 安装／递归 buildSession、offload extension 安装、`stopSubagent/messageSubagent/backgroundSubagent` 三个方法及返回实现、`USER_ABORT` 与旧 controls 通知、held 中的 subagents hold/release。删除仅供旧 child 请求计数的 beforeModelRequest hook、streamFunction 包装和对应 cacheWarming 分支；新 behavior 自己的 request meter 与关闭 cache warming 继续存在。保留内部 beforeStart，在原生 session_start 前挂接投影，原因见下文；合并失去用途的 buildSession 转发层，保留 createAgentRuntimeSession 内部构建、settling 等待、prompt/compact、abort/dispose。
4. `P/behavior/extension.ts`：删除从 `../subagentRun` 导入 `zeroUsage`，将现有原生 Usage 零值直接放在唯一调用位置。不新建公共工具函数，也不保留整个 subagentRun.ts。`P/compaction.ts`、behavior/runs、compactionSummarizer 校验、原生存储和权限／计费规则继续保留。
5. `P/index.ts`：删除上述 11 个文件的所有 re-export，以及 `createAgentRuntimeSession/AgentRuntimeSession/AgentRuntimeSessionOptions/AgentRuntimeModel/AgentRuntimeSettings`、`createPiBehavior/PiBehavior/PiBehaviorOptions/BehaviorSessionRequest`、compaction 内部类型的根导出。保留的根出口明确限定为下列清单；包内实现和包内测试可直接引用所属内部模块，Main 不改成深路径导入。

```text
createPiRuntime
PiRuntime
PiRuntimeOptions
PiRuntimeBehavior
PiSessionOptions
PiThreadHandle
PiObservation
AgentRuntimeEvent
CompactionReason
```

**测试的删除与迁移同属该改动，不能靠删除有效场景取得绿色结果。** 以下路径相对 `packages/agent-runtime-pi/tests/`，Main 路径另行标明。

| 文件或组 | 明确处理 |
| --- | --- |
| `askUser.test.ts`、`todo.test.ts`、`offload.test.ts`；`goal.test.ts`、`goalRebuild.test.ts`、`goalState.test.ts`、`goalStops.test.ts`、`goalSubagents.test.ts` | 旧执行器专属文件删除。先将仍有产品价值且尚未覆盖的取消问答、goal 停止／预算／恢复、Todo 恢复、输出保存失败场景落到现有 behaviorRuntime/behaviorAdapter 或 agent-behavior 对应测试，记录场景去向。 |
| `subagent.test.ts`、`subagentApproval.test.ts`、`subagentBackground.test.ts`、`subagentBinding.test.ts`、`subagentContinue.test.ts`、`subagentDelivery.test.ts`、`subagentDelivery.integration.test.ts`、`subagentFork.test.ts`、`subagentMessage.test.ts`、`subagentModel.test.ts`、`subagentMove.test.ts`、`subagentRebuild.test.ts`、`subagentStop.test.ts`、`subagentStops.test.ts` | 旧 controller 专属文件删除；配置阻塞／失败、停止竞态、前台／后台归属、续接、fork／重开和通知内容的有效场景由 behaviorRuntime/behaviorHistory/behaviorContract 或既有行为所有者测试承接。旧后台切换 API 本身的存在性断言退出。 |
| `goalSupport.ts`、`subagentSupport.ts` | goalSupport 整文件删除；subagentSupport 删除 recordingSubagentPort/storingSubagentPort 及旧 Subagent 类型、state/view 解析和等待 helper。保留新路径实际复用的 gate/subagentCall/toolCallPart，以及迁移后的 runtimeLifecycle 仍使用的纯 provider helper；不保留旧控制器 fake。 |
| `runtime.test.ts`、`runtimeLifecycle.test.ts`、`startupObservation.test.ts`、`streamObservation.test.ts`、`boundaryObservation.test.ts`、`boundaryCompaction.test.ts` | 文件保留，createPiRuntime 的配置统一安装现有 behavior；子线程场景去掉 legacy subagents 配置。保留 busy admission、启动事实、慢观察者、compaction、release/shutdown 与最终回调排空的断言。 |
| `behaviorHarness.ts`、`behaviorAdapter.test.ts`、`behaviorRuntime.test.ts` | sendUser 继续使用现有内部 adapter inbox，满足下述 H2/H5 契约；不能把接纳改成等待整轮结束。关闭后输入测试改测 prompt。child 历史故障场景通过保存的原生文件／现有模型配置制造，不再要求生产 callback 返回 onSessionCreated 或完整 origin。 |
| `src/main/ai/runtime/pi/gatewayIntegration.test.ts`、`src/main/ai/runtime/pi/piNativeTools.test.ts` | 现有跨包测试迁到 createPiRuntime＋behavior，通过 observation/archive/toolDefinition 验证 Gateway 与工具结果，移除对两个内部工厂的根导入；不新增测试专用公开入口。 |

`nativeSession.test.ts`、`session.test.ts`、`sessionStorage.test.ts`、`compaction.test.ts` 继续验证仍存在的原生构建／存储／压缩模块；仅把包内内部类型／工厂导入改到所属模块。`sessionEvents.test.ts` 去掉 R13 已退役字段断言，保留同步 placement 与持久化顺序。Durable `tests/runtime.test.ts` 把恢复／终态场景改用 observe 输入事实，删除仅测外部去重 key 和 retract/lookup API 的用例；其 Main unknown 重连测试保留。三个 adapter 的测试删除被裁字段的断言，继续验证原子内容／输入／结束、source-loss、计费与排空结果。

删除完成的证据是上述文件已从源树退出、对应符号没有生产／测试 import 或调用、Pi 根出口符合清单，并且保留行为的定向测试通过。名称还留在历史决策文档或原生 wire 数据中不算残留实现；不能为了检索零命中改写历史文件格式。

**实施发现（2026-11-06）。** 原清单中两处删除有实际生命周期消费者。内部 `beforeStart` 回调在 `session_start` 之前挂接唯一投影；删除它会漏掉最初的 `message_start`，后续流增量因此无法恢复。它保留为内部构建回调，没有宿主出口或第二条执行路径。`PiBehavior.submitUser` 保留为内部 `ContractHarness.sendUser` 入口：H2/H5 需要现有 adapter inbox，包括 session 构建期间接纳的输入。直接换成原生 follow-up 会改变该契约，使队列／等待用例死锁。这个五行入口复用现有 submit helper 和计数器，没有新增队列或测试专用配置。公开包出口仍收缩到上面的九个名称。

退役测试按下表归入现有行为所有者。仅验证可选旧执行器、公开 callback 槽位或重复事件字段的用例随 API 退出。原生自动重试投影、从 `session_start` 绕过入口创建 child 的用例也退出：现有生产 behavior 路径本来就关闭重试，并禁止扩展自行启动执行。启动文本观察继续覆盖，child 配置／就绪继续通过已接纳的 behavior 工作验证。

| 退役场景组 | 保留的契约证据 |
| --- | --- |
| AskUser 与 Todo | `behaviorRuntime.test.ts` 验证审批／回答、Stop 后迟到答案、Todo 原生文件重开且不请求模型；`agent-behavior/tests/core/interaction/interaction.test.ts` 负责输入校验。 |
| 输出落盘 | `behaviorAdapter.test.ts` 覆盖保存成功／失败、摘录、图片顺序、结构化输出及文件重开；`agent-behavior/tests/core/context/context.test.ts` 负责选择／豁免规则。 |
| Goal 状态、停止与恢复 | `agent-behavior/tests/core/goal/` 负责预算／状态／历史；`tests/orchestration/fixtures/goal.test.ts` 和 `reopen.test.ts` 负责策略／恢复；Pi `behaviorRuntime.test.ts` 验证本地 goal 命令及压缩。 |
| Child 创建／fork／审批／模型／续接／停止／投递 | Pi `behaviorAdapter.test.ts`、`behaviorRuntime.test.ts`、`behaviorContract.test.ts` 和 `behaviorHistory.test.ts` 覆盖原生所有权、持久 lineage、独立续接、接纳失败、已停止轮次及报告；Main 子投影／归档套件保留产品持久化契约。 |
| 根 runtime 与原生存储 | 现有 runtime、生命周期、启动／流／边界观察、session／存储／事件及压缩套件继续保留；Gateway 和原生工具集成改为使用 `createPiRuntime`，不再依赖公开 session builder。 |

#### 11.4 兼容、存储与回退

不改变 SQLite schema、已发布 migration、nativeSubmission、checkpointMapping、原生 session 文件、provider response IDs、产品消息 IDs、持久化计费或 native custom-entry 格式。只收缩未持久化的接口和 context usage 的瞬时 cache/IPC 负载。旧历史中的不认识块保持原始内容和可读性，不因某个执行器退役而清空、迁移成新任务或自动派发。

原来仅由旧 standalone 工厂创建的会话，不再承诺通过该旧 API 继续执行。当前桌面已保存的原生归属和 child lineage 必须继续打开、观察与续接；只有确实缺少所属原生 owner 的历史才沿用现有只读／明确不可用结果，不能把退役 API 作为统一降级理由。不得添加另一套旧规则执行器来恢复兼容。

关闭和备份保持既有顺序：封闭新输入，按原生语义停稳或关闭，等待最后事实的观察回调，等待流／子投影写入，最终 flush，随后 stop/release。失败保留唯一写入者及可重试数据；最终 flush 后到显式 resume 前没有投影写入。snapshot/headless 的 unknown 输入保管仍是存活进程保证，不扩大为未落盘上下文的崩溃恢复。

每阶段的 producer、consumer 和类型一起提交并回退。没有数据格式变化，回退不运行数据库回滚、不删除用户文件、不撤销已批准的 Durable/Claude SDK 补丁，也不保留两套执行路径。若实际需要改变存储或 SDK，本修订的无 migration／无升级前提失效，必须重新说明具体需求和兼容方案。

#### 11.5 实施顺序与退出证据

本节接续已经交付的所有权迁移，不重做第 9 节的历史阶段。发布前核对实时 stack，将实质 Spec 修改放回其所属 Spec 层；不能把旧批准或下游 CI 当成本修订的批准。各阶段应独立可审查且类型完整；跨包的机械签名变化在同一阶段修改全部实际调用方。

| 阶段 | 聚焦删改 | 必需的退出证据 |
| --- | --- | --- |
| S1 | Main registry／死工具 API，以及公共 policies、单值标签和操作 receipt | 活跃 driver 注册、session bootstrap 和实际工具 UI／审批仍工作；声明、死 helper 和转发均退出，没有新增 wrapper。 |
| S2 | 三种 observation 出口、Claude 重复 archive/state、两个配置回调与 placement payload | baseline 不重计费，slow/overflow 不丢终态；Durable 内容／输入／结束仍来自同一原子提交；source-loss、child archive 和同步 reply reservation 结果不变。 |
| S3 | InputState.response、snapshot coverage、未展示 context limits、Durable 无调用 facet、Pi 冗余 events | unknown→断连→核对不重发；旧回调不影响新连接；压缩保留历史、计费不重复，context UI 分母和刷新不变。 |
| S4 | Pi 只保留 behavior 路径，删除旧执行器、出口与专属状态／测试 | 现有 Node 契约测试使用生产 adapter、脚本 provider 与 `createScriptedHost` 验证问答、goal、Todo、offload、child continuation／stop／reopen；桌面各能力只安装一套工具和规则。 |
| S5 | 文档与余留生产链复核、跨阶段验收 | 已退役符号没有生产入口／转发／构造器残留；所有剩余状态能指出消费者或必须隔离的生命周期，新增文件和状态有必要性证据；保留行为通过下面的验收矩阵。 |

每阶段记录删除的方法、出口、构造／复制路径、执行分支与状态容器，以及保留理由。净行数可作为附带信息，不能靠换名、搬文件或新增中间类型抵消删减；不承诺未经测量的性能收益。纯类型收窄和实际删除运行时工作分开报告。这样验收的是整条冗余路径退出，而不只是少几个字段。

| 验证范围 | 按明确文件运行的现有归属与预期行为 |
| --- | --- |
| 注册与核心结果 | `src/main/ai/runtime/__tests__/registerDrivers.test.ts`、`src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`、`packages/agent-runtime/tests/observation.test.ts`；未知 runtime 仍拒绝，busy/unknown/error 不退化为成功。 |
| 原子交付与关闭 | Pi `tests/runtimeLifecycle.test.ts`、`tests/startupObservation.test.ts`；Durable `tests/runtime.test.ts`、`tests/pendingObservation.test.ts`；Claude `tests/observation.test.ts`、`tests/runtime.test.ts`；三个桌面 connection/driver 套件验证回调阻塞时关闭／备份仍等待，flush 后不再写入。 |
| 输入与历史持久化 | Main `AgentSessionRuntimeService.handoff.test.ts`、`ChildThreadProjection.test.ts`、`AgentSessionArchivePersistence.integration.test.ts`；使用真实 SQLite 和生产 migration，验证冻结属性、同一回复归属、旧历史／明确撤回、失败重试及不重发。 |
| 用量与 context UI | 三个 package 的 `tests/contextUsage.test.ts`、Main `AgentSessionUsageAttribution.test.ts`、renderer `useAgentSessionContextUsage.test.ts` 及现有 context summary 套件；修订隔离、动态 reserved/free、full-window 分母和幂等费用保持。 |
| Pi 单一路径 | `packages/agent-runtime-pi/tests/behaviorRuntime.test.ts`、`tests/behaviorContract.test.ts`、`tests/behaviorHistory.test.ts`；保留各场景的真实行为断言，删除只证明旧 API 存在的测试。 |
| Electron 与备份 | 隔离 profile 下对三个 runtime 验证 root/child、多窗口、steer、定向停止、压缩后历史、权限／问答与 context 面板；使用应用现有备份入口执行导出→恢复→重开，核对保存内容／绑定／费用且恢复不额外提交。实际备份往返与仅 pause/drain 的证据分别记录。 |

实施前为每组保留行为运行已有定向基线；仅在确有未覆盖回归风险时补行为测试，不为被删除字段写存在性测试。实施后运行相同消费者检查、受影响 package build/typecheck、Main/必要 renderer 类型检查、变更文件格式化／lint，以及 docs:affected 的语义检查与文档 gate。全部测试使用实际文件过滤；完整测试与平台打包留给 CI。没有命令或 Electron 证据的条目保持未验证，本节不能仅凭静态审计或之前的绿色 CI 标记完成。

#### 11.6 2026-11-06 实施与验证

已在 `46d76e46c03d1d1f19da4ccf03cea27e24c11180` 基础上实施 R1–R13。第 11.3 节列出的十一个 Pi 执行器文件已删除；Pi 只有一条必选 behavior 路径，根出口收窄为九项。公共与具体 adapter 的声明、构造、转发及 Main 消费者同步收窄。runtime 生产源码净减少约 4,400 行，该数字不包含测试删除。没有新增生产模块、manager、队列、SDK 补丁、依赖升级、schema 或 migration。第 11.3 节保留的两个内部生命周期入口仍是原删除清单的明确例外。

Electron 验证还发现一条既有持久化旁路：手动压缩的完成标记直接送入流，而最终回复从 `RootMessageProjection` 保存，导致原生压缩成功但落盘回复为空。完成标记现已接回现有投影／控制交付路径，并保留原生回复的存活检查。两个真实 SQLite 测试先复现丢失，再分别验证完成早于和晚于开流的情况。没有增加 pending 状态。

| 证据 | 结果与范围 |
| --- | --- |
| 自动化消费者 | 明确选择的 25 个 Main 消费者文件通过 673 项测试；压缩修复后重跑四个受影响 service／projection 文件，通过 243 项，包含两个新增持久化用例。两个数字重叠，不能相加。 |
| 原生与行为契约 | common、三个 adapter、Pi behavior／history／storage、agent-behavior、context usage 与 renderer 消费者的定向测试通过。既有五项 Pi restart 跳过和三项 Durable 契约跳过仍按跳过记录。测试场景归属见第 11.3 节，退役 API 的断言不算保留行为覆盖。 |
| 构建与静态检查 | 四个 runtime 包构建、类型检查通过，Main 与 renderer 类型检查通过。变更 TypeScript 文件通过定向 Oxlint／ESLint 与格式检查。已退役导出标识没有 TypeScript 消费者。SDK patches、lockfile、schemas 和 migrations 均无差异。 |
| 三个 runtime 的 Electron | 隔离 profile 与本地受控 provider 验证父回复结束后子线程继续、双窗口观察、续接、定向停止兄弟线程、暂停拒绝输入、阻塞观察排空、最终 flush、历史保留、问答 UI／工具结果续接，以及手动压缩标记落盘和重开历史。子线程 context 展示保留 Pi／Durable 的完整窗口分母，以及 Claude 无可用读数时的 unknown。 |
| 完整备份往返 | 通过应用已有备份 IPC 导出并恢复完整归档。重启／重开后，82 条消息、13 个上下文绑定、39 条用量记录及三个 runtime 的压缩标记保留数据，15 个原生文件与归档 hash 一致；只有投影更新时间刷新。恢复与重开前后的 provider 请求数均为 42。这与阻塞回调的 pause／drain 证据分别记录。 |
| 文档 | 对 docs:affected 候选逐项做语义检查，更新当前 runtime 参考文档和 package README。历史文档指向已删除执行器的链接固定到审计提交，并补充双语退役说明。文档、配对与变更文件检查通过。 |

命令均使用明确测试文件；最终修复选择 Main 的 `AgentSessionRuntimeService.handoff`、`AgentSessionRuntimeService`、`RootMessageProjection` 和 `AgentSessionRuntimeService.projection` 套件。本地日志及测试归属记录位于 `.context/agent-runtime-contraction-20261106/`，Electron 脚本、截图和 `backup-roundtrip.json` 位于 `.context/cherry-electron-dev/`。受控 provider 不证明真实提供商质量、远端 CI、Windows／Linux 打包、强制结束进程或更广 AC12 的所有场景。第 11.7 节补充真实提供商、拒绝／取消及输入属性捕获验证。unknown 输入重连保留自动化覆盖。本文继续保持 proposed，此工作树实现尚未 commit 或 push。

#### 11.7 2026-11-06 补充 Electron 与真实提供商验证

使用 `pnpm dev` 重启隔离 profile。此前本任务实例已经退出，未结束其他 Electron 进程。只读访问已有开发数据库，将选定的提供商配置复制到隔离 profile，未修改原数据库；证据不包含凭据。真实模型为 LongCat AI 的 `LongCat-2.0`，使用其 OpenAI 兼容接口。

| 场景 | 实际结果 |
| --- | --- |
| 配置期间打开子线程 | Pi、Durable：阻塞现有子线程配置回调，打开子线程面板，确认访问仍在等待且尚未发起子线程提供商请求，然后释放配置。原面板收到子线程输出，资源所有者只有一份。Claude：父响应结束前打开面板并收到子线程输出，但原生子线程身份已经可用；本次没有证明身份未就绪时的等待。 |
| 权限拒绝与取消 | 三个 runtime：通过 UI 拒绝 shell 写文件，确认文件未生成且拒绝结果落盘。取消另一条等待审批的调用，拒绝其迟到审批响应，随后新一轮正常完成。 |
| 冻结输入属性 | 三个 runtime：提交 steer 和 headless 输入，捕获后修改调用方 snapshot／headless 选项，验证捕获的作者、交互模式以及仅一条已绑定用户记录。Claude 在下述边界修复后通过，两次提供商调用的用量分别归属正确的产品回复。 |
| 真实 Pi 与 Durable | 子线程从本地测试文件读取随机值，提示词不包含该值。父回复结束、子线程 UI 输出、同一子线程读取第二个随机文件的续接，以及内容落盘均通过。核对的会话包含九条 Pi、八条 Durable 用量记录。 |
| 真实 Claude Code | 父回复结束、原生子线程 shell／读取工具、子线程面板中的首个随机值及历史落盘通过。续接未通过：该轮创建了三个额外 Agent 子线程，没有把要求的后续输入交付给原子线程。已停止该轮并保留证据，原因尚未确认。 |
| 修复后的真实 Claude steer | 后续回复保留新捕获的作者，用量归属该回复，后续输入仅绑定一次。但 LongCat 仍返回原来的 `SLEEP_FINISHED`，没有执行追加的读取文件指令。回复归属通过，遵循 steer 指令未通过。 |
| AI SDK 流兼容 | 捕获的 LongCat Anthropic 流以 `usage: {}` 开始。未打补丁的 `@ai-sdk/anthropic@3.0.125` schema 要求 `message_start.message.usage.input_tokens` 必须存在；校验错误中断流，随后被 `doStream` 包装为 `statusCode: 500` 的 `AI_APICallError`。这定位的是客户端 AI SDK 的兼容性拒绝，不能据此认定提供商返回了 HTTP 500 或 agent-runtime 生命周期有缺陷。本地回放确认：HTTP 200 流即使后续带有完整用量，也会因首帧用量为空而被拒绝；同一条流在首帧带有 `input_tokens` 时正常完成并更新最终计量。初始真实成功场景仅在隔离 profile 中选择 OpenAI 接口。后续 [Anthropic 用量兼容修复](../../implemented/bug-fix/2026-11-06-anthropic-usage-compatibility.md) 覆盖流式／非流式用量，并通过 LongCat-2.5 Anthropic 接口的真实文件读取请求，输出落盘且记录两条用量。其他尝试的开发配置返回 401、403 或额度耗尽的 429，均不算 runtime 验收通过。 |

输入捕获场景发现 Claude 的一处归属缺陷：steer 正文落入前一条回复，捕获了新身份的回复却为空。原生 `status: requesting` 已携带本次请求的输入 UUID，但 adapter 此前等待 assistant／result 关联，而这份关联可能直到终态结果前仍只带原输入。adapter 现校验已有的请求成员字段，在后续正文和计费前交付输入边界。无需 SDK 补丁、新协议类型或额外 pending 状态。使用真实 SDK／CLI 的回归断言先因正文前缺少边界而失败，修复后通过。重新构建并重启 Electron 后，steer 和 headless 的 UI／SQLite 检查通过，回复及用量分别归属正确。

验证明确选择 Claude package 的 `runtime`、`control`、`observation` 和 `projection` 测试文件，共 74 项通过。Main 的 `desktopRuntime.integration` 与 `AgentSessionRuntimeService.handoff` 文件共 37 项通过。Claude package 构建／类型检查、定向 Oxlint／ESLint 通过。这些结果补充第 11.6 节，不替代更广的 CI 覆盖。

证据位于 `.context/cherry-electron-dev/`：`live-*-evidence.json`、`live-claude-steer*.json`、`remainder-*-config.json`、`remainder-*-permission.json`、`remainder-*-steer.json`、截图和命令日志。`remainder-claude-code-steer-before.json` 保留失败时的轨迹及数据库记录；`ai-sdk-usage-validation-probe.json` 记录已安装 AI SDK 的回放结果。后续用量兼容修复将实例重启为 PID 36557、CDP 19288，已登记在 `instance.json` 并保持运行。真实 Claude 续接／指令遵循、Claude 身份未就绪的时序、Electron 中的 unknown 输入重连、远端 CI 和平台打包仍有未验证或未通过项，完整验收矩阵尚未完成。

### 12. 产品回复行为清单（2026-11-06）

本节记录本轮确认的产品要求：属于当前请求、需要回传结果的后台子智能体尚未完成时，输入框保留停止入口，后续父线程进展与汇总沿用原助手消息。它限定在没有新用户输入或 steer 等回复切换边界的同一次产品回复内。原生前台轮结束、后台资源存活、产品回复完成是三个不同事实；此次整理不代表修复或验收已经完成。

沿用同一助手消息的是父线程的进展与汇总。子线程完整输出仍由各自投影与历史持有，不直接拼入父线程正文。

#### 12.1 字段含义与决策归属

| 项目 | 含义与权威来源 | 产品边界 |
| --- | --- | --- |
| `background` / `run_in_background` | 工具输入决定子任务是否脱离父线程的前台等待；原生 runtime／behavior 执行并报告实际模式。 | 并行执行不等于后台执行；缺省参数必须核对实际默认值。它不直接决定助手消息是否结束。 |
| 原生前台结果 | adapter 解释原生接纳、运行、完成、失败及取消证据。 | 父线程返回一次 `result` 或前台结束事实，不足以证明它所属的产品回复已经完成。 |
| 后台任务与结果排空 | 原生所有者报告任务身份、来源、实际状态，以及结果交付／后续生成是否结束；无法证明时保留未知。 | 后台列表为空不能单独证明最终汇总及观察回调已经处理完成；连接保活也不等于保持回复等待。 |
| `awaitingReply` | 当前 adapter → Main 协议中的内部字段，不是用户配置，也不是模型工具参数。 | 按第 12.5 节移除 adapter 对该字段的赋值和协议出口。Main 根据有归属的原生结果事实决定回复等待，连接保活不再持有该产品判断。 |
| 产品回复身份与终态 | Main 持有用户输入、助手消息 ID、回复交接与持久化责任。 | 停止按钮、完成标记和消息合并由同一回复状态驱动。不能仅在 UI 拼接已拆分的数据库消息。 |
| 原生调度与费用 | 原生 runtime 继续拥有任务执行／调度；既有采集路径记录实际提供商调用，Main 负责费用与消息归属。 | 恢复产品等待不伪造原生 busy，不新增模型请求、自动重发或重复费用；消息合并不改变调用身份。 |

#### 12.2 场景与预期结果

| 场景 | 输入框／任务展示 | 产品消息与完成条件 |
| --- | --- | --- |
| 普通父线程生成，或前台等待子智能体 | 保留停止入口；子任务按实际状态展示。 | 父线程的工具调用、结果与汇总保持在该回复内，按正常结束与持久化条件完成。 |
| 后台子智能体运行，父线程已返回阶段性结果 | 保留停止入口和未完成状态；原生前台可以空闲。 | 原助手消息继续等待，不因父线程本轮结果提前标记成功。 |
| 多个后台子智能体中只有一部分完成 | 已完成子任务更新状态，其他任务继续；停止入口保留。 | “第一个已完成”等父线程进展追加原助手消息，不创建无新用户输入的后继回复。 |
| 最后一个子任务完成，但父线程还在汇总，或结果回调仍被阻塞 | 任务卡可以全部完成，输入框仍保留停止入口。 | 待相关结果、父线程汇总和观察交付完成，再持久化最终回复；不能只看任务数量或某次 idle。 |
| 本次回复的结果与汇总已交付并成功落盘 | 输入框恢复发送状态，回复显示完成。 | 本次回复只完成一次；重复快照、重复终态和重开历史不生成额外助手消息。 |
| 仅有不需要当前回复等待的后台命令／常驻进程 | 任务可继续展示运行；回复完成后输入框恢复发送状态。 | 不为这类资源无限保留当前回复。根据已确认任务语义与归属处理，不能把所有后台任务统一视为待汇总子智能体。 |
| 停止一个子任务，或点击会话停止 | 定向停止不停止兄弟任务；会话停止沿用既有 Stop 范围。 | 使用原生停止结果及既有取消／失败语义结清，保留已产生内容；不能只隐藏按钮或将停止报为成功。 |
| 子任务失败、原生连接失败或结果未知 | 展示真实失败／未知；其他任务是否继续按既有策略处理。 | 子任务失败不自动等于父回复失败，父线程仍可汇总失败结果；根执行失败或未知不能因后台列表清空被改成成功。 |
| 等待期间再次输入、steer 或 follow-up | 保留既有排队、接纳和交互策略。 | 允许既有输入边界创建后继回复；不因“同一消息”要求吞掉用户输入，也不把旧任务的迟到事实归给最新回复。跨输入结果归属需单独验收。 |
| 切换窗口、重新挂接、关闭或备份 | 多窗口读取同一产品状态；观察脱离不停止任务。 | 重挂接不重放完成；关闭／备份沿用 seal → drain → flush 契约，不把界面完成当作原生及写入都已排空。 |

#### 12.3 修复前证据

此次对照基于 main `702b394a616cd3b37aff50238f77cd0627d626da` 与 `46d76e46c03d1d1f19da4ccf03cea27e24c11180` 上的当前未提交实现。结论来自代码、隔离 Electron 实例及其实际消息／工具记录；没有在本节整理时重新发起模型任务。

| 路径 | 已核实的事实 | 能证明的范围 |
| --- | --- | --- |
| Claude Code 后台调用 | 本次两个 `Agent` 调用均设置 `run_in_background: true`。子任务仍运行时原回复已成功落盘；一个用户输入最终产生“已启动”“部分完成”“最终报告”三条助手消息。`c04c203d78a0` 迁移将后台事件统一设为 `awaitingReply: false`；main 的旧 adapter 原本保留对子智能体结果的等待。 | 已确认产品回复回归；原生子任务与最终报告仍完成，不能将原生完成作为产品行为通过。 |
| Pi Durable 本次调用 | 两次 `subagent` 均未传 `background`，实际任务记录为 `isBackgrounded: false`；父线程等待并只保存一条助手消息。 | 证明这次前台等待路径正常，不证明后台路径正常。 |
| Pi／Durable 后台分支 | 当前两个连接都发出固定 `awaitingReply: false`；Durable 在对照 main 上也如此。 | 需要使用明确的后台工具参数验证；既有 main 代码不等于已确认的跨 runtime 产品约定。 |
| 现有自动化测试 | Main 的同回复测试人工传入等待状态，Claude control 及桌面桥接测试却断言后台 `awaitingReply: false`。 | 各层绿色没有证明彼此使用相同契约；这些断言需要由产品结果回归覆盖，不能继续作为通过证据。 |

代码核对入口：[Claude 控制](../../../../packages/agent-runtime-claude-code/src/control.ts)、[Pi 连接](../../../../src/main/ai/runtime/pi/PiRuntimeConnection.ts)、[Durable 连接](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts)、[Main 回复状态](../../../../src/main/ai/agentSession/agentSessionRuntimeState.ts)、[Main 回复交接](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts)。字段保留与删改必须遵守第 1 节的现有所有权，不新增通用 scheduler 或第二套回复状态机。

#### 12.4 修复与验收清单

以下检查以第 12.6 节为证据。第 10、11 节的历史通过记录不能替代本节的端到端证据；用量归属的限制单独记录。

- [x] 核对三个 runtime 的前台、后台模式与结果交付事实，记录来源、归属、失败和排空条件；缺少证据时明确缺口，不把未知默认成不等待。
- [x] 保留原生前台结束与后台独立运行，恢复 Main 的产品回复等待与完成规则；普通后台命令不永久阻塞回复，不直接把所有 `false` 改成 `true`。
- [x] 用真实 adapter 事件进入 Main 与真实 SQLite，覆盖两个后台子任务错峰完成、父线程阶段性回复与最终汇总；等待期间原助手行保持未完成，全部父线程文本沿用同一消息 ID，最终仅结清一次。
- [x] 覆盖空任务快照早于汇总、阻塞观察回调、重复结束事件、单任务停止、会话停止、失败及结果未知；校验正确终态与无重复写入。
- [x] 验证新用户输入、steer／follow-up、重连及旧回调：保留既有输入边界与冻结属性，旧结果不串到后继回复，不重发已接纳输入。
- [x] 对 Claude Code、Pi、Pi Durable 分别在 Electron 验证前台与明确后台模式，记录实际工具参数、等待中的停止入口、完成后的发送入口、助手消息 ID／条数与重开后的内容；至少一次真实模型后台场景验证每个支持该能力的 runtime。
- [ ] 核对现有用量与原生调用归属，证明保持同一产品回复没有新增请求、重复收费或遗漏子线程记录；补足对应消费者测试后再记录通过。

#### 12.5 修改方案：模型选择执行模式，Main 持有回复

模型已经拥有前台／后台选择权：Claude 的 `Agent` 使用 `run_in_background`；Pi／Durable 的 `subagent` 使用 `background`，未提供时为 `false`。共享工具说明已要求需要结果才能继续时前台等待，有独立工作可做时选择后台。保留现有参数、默认值、权限、并发限制和原生调度；不新增控制消息结束的模型参数，也不根据回答里的“完成了”判断产品终态。

实施顺序如下，每一步都以实际消费者结果验证：

| 步骤 | 具体修改位置与动作 | 本步验证 |
| --- | --- | --- |
| 1. 把执行模式与结果等待分开 | 保留 [工具定义](../../../../packages/agent-behavior/src/orchestration/tools/subagents.ts) 与 [原生创建决定](../../../../packages/agent-behavior/src/core/subagents/subagentDecisions.ts) 的参数语义。修改 `src/main/ai/runtime/types.ts` 的后台事件：保留 `active` 表示连接保活，删除 `awaitingReply`；补充有原生来源的未排空结果事实，供 Main 归属与结清使用。 | 显式 `false`、显式 `true`、省略参数分别得到既有前台／后台行为；并行前台调用不会被改为后台。新的事实必须有 Main 消费者，不能增加无读取字段。 |
| 2. 修复 Claude 事实输出 | 修改 `packages/agent-runtime-claude-code/src/control.ts`、`src/main/ai/runtime/claudeCode/ClaudeRuntimeState.ts` 与 `ClaudeCodeRuntimeDriver.ts`：删除统一的 `awaitingReply: false`，根据 SDK 任务类型、实际后台状态、调用关联、通知及后续原生生成判断结果是否仍未排空。沿用现有 `session_state_changed` 透传与有序观察屏障；普通常驻命令可以继续保活而没有待返回的子智能体结果。 | 两个后台子智能体错峰结束、空列表早于汇总、后台子智能体与常驻命令并存均有正确事实；最后一种场景中命令继续运行不阻止已完成的回复结清。 |
| 3. 修复 Pi／Durable 结果交付边界 | 修改 `src/main/ai/runtime/pi/PiRuntimeConnection.ts`、`src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts` 及两个 runtime package 的 `src/behavior/harness.ts` 观察接入。复用 [子任务记录与待通知结果](../../../../packages/agent-behavior/src/core/subagents/subagentLedger.ts)、[报告作业](../../../../packages/agent-behavior/src/orchestration/jobs/subagentReport.ts)、[通知决定](../../../../packages/agent-behavior/src/core/driver/idle.ts) 和原生输入／轮次完成事实；必要时从现有 behavior 导出所需的纯读取投影。`BehaviorEvent.subagents`／`SubagentView` 继续用于展示，不能再用 `views.filter(status !== 'finished').length` 宣告结果排空。Durable 从同一提交修订读取相关事实，Pi 从既有有序生命周期读取。 | 暂停报告记录、通知接纳或父线程汇总中的任一步，Main 都不会提前结束；交付恢复后正常完成。静默交付、用户停止和被撤回通知沿用既有行为，不额外启动模型轮次。 |
| 4. 在已有回复状态内统一等待和归属 | 修改 `AgentSessionRuntimeService.ts` 与 `agentSessionRuntimeState.ts`：把待结果的归属放入已有 `AgentSessionRuntimeReply`，连接 occupancy 只管理保活／重建。原生前台成功先记录其事实；只有该回复没有未排空结果、没有仍属该回复的原生生成，并且先前观察内容已处理，才进入既有最终持久化流程。`autonomous-turn-state` 的后台通知按原生来源恢复所属回复；同一输入边界内沿用助手 ID。 | 真实 adapter → Main → SQLite 贯通验证：中途保持同一未完成助手行，进展与汇总在同一行，最终只结清一次；两条用户输入、steer、续接和旧连接回调不串回复。 |
| 5. 清理旧断言并验收产品行为 | 更新 Claude `control.test.ts`、桌面桥接测试、两种 Pi connection 测试以及 Main reducer／`AgentSessionRuntimeService.subagentWake.test.ts`／handoff 测试。删除把后台统一断言为 `awaitingReply: false` 的测试，以产品结果覆盖；实际贯通测试使用 `setupTestDatabase()`。输入框继续读取 Main 已有的流状态。 | 完成第 12.4 节的三 runtime × 前台／后台 Electron 验收，记录真实工具参数、停止／发送入口和数据库消息归属；分别报告契约测试与真实模型结果。 |

**原生结果事实的最小范围。** 在现有后台事件通道携带“哪些后台结果仍未排空”及其原生来源；复用已有 task／child／run、触发调用或输入身份，只传 Main 归属实际读取的部分。它覆盖运行中、报告尚未记录、通知尚未处理，以及通知触发的父线程生成尚未结束。已确认空集合才能表示结果排空；未知不能编码成空集合。普通后台命令的连接保活与这一集合独立。任务展示列表、延时、防抖或一次全局 idle 都不能替代这些事实。无需把这些内部生命周期扩展到公共 `Subagent` DTO，也不新增通用任务状态机。

**一次创建不等于每次回复的来源。** `Subagent.origin.toolCallId` 是不可变的创建关联；续接同一个子线程时不能把新结果一律放回最早回复。使用现有原生历史中的续接调用／输入与报告通知身份定位本次结果，再交给 Main 的既有输入／回复交接处理。绑定在事实被接纳时确定，不能在异步回调里重新取“最新回复”。新用户输入或 steer 仍可开启后继回复；已经结束的回复不会被无来源的后台通知重新打开。若某个 adapter 无法从现有证据建立关联，必须报告该能力缺口，不能猜测身份或自动重发。

**明确删除或替换的代码：**

- 删除三个 adapter 中固定的 `awaitingReply: false`，以及 `ClaudeControl`／`AgentRuntimeEvent` 上由 adapter 输出的 `awaitingReply` 成员。
- 删除 `handleBackgroundWorkState(..., awaitingReply = active)` 的隐式默认，以及 `connection.occupancy.background.awaitingReply`；回复是否等待只由已有 reply 状态持有。
- 替换 `hasAgentSessionRuntimePendingReply` 从连接布尔值推断回复的实现；连接释放不再隐式制造当前回复的成功终态。
- 替换仅凭 `origin.kind === 'background-work'` 和“当前正在等待”选择回复的分支，加入真实来源归属；保留确有新输入／独立原生轮次时创建新回复的路径。
- 删除 Pi／Durable 从展示任务数量推导“已排空”的分支，以及对应只验证固定布尔值或 mock 调用的断言。

等待状态只在已有 reply 内保存一份；原生记录继续由原生所有者保管。此次范围不包括新 manager、调度器、数据库表、持久化台账、模型参数、SDK 升级或 renderer 拼接补丁，也不自动合并此前已经拆成多行的历史。所需身份和排空证据必须先通过原生探针，再迁移 Main 消费者。实现完成后同步 `agent-session-runtime.md`、`adding-a-runtime.md` 及实际受影响的 package README；本次方案阶段不把参考文档改写成已实现。

#### 12.6 已实现契约与验证（2026-11-07）

第 12.5 节已批准的范围已实现。`awaitingReply` 和根据展示任务数量判断结束的分支已删除。现有原生记录提供未排空结果的来源，`AgentSessionRuntimeReply.pendingResultToolCallIds` 持有产品等待状态。只有通知的全部来源调用均属于该回复时，才恢复该回复；来源缺失或混合归属沿用现有独立回合交接。此次实现没有增加 SDK patch、schema、manager 或模型参数。

| 边界 | 实现依据与证据 |
| --- | --- |
| Claude Code | 原生 task/run 身份、触发调用、通知、父线程结果及已补丁透传的原生 idle 屏障共同确认排空。仅清空任务列表不会释放回复。真实 SDK 子进程连接受控 HTTP 供应商，驱动 Main 与 SQLite 经历两个错峰结果，三段父线程回复保存为同一行。 |
| Pi / Durable | `subagentResults` 从既有启动／继续记录及通知派生来源。Pi 通过有序生命周期发布；Durable 从与内容、完成事实相同的已提交 view publication 保留 entries/tasks。真实原生执行测试覆盖启动调用、继续调用及通知开始生成前的空档。行为工具仍限定模型直接调用，没有增加嵌套调用映射。 |
| Main | 现有 reply 持有未决来源和原生终态。真实 SQLite 回归覆盖常驻命令、未知／混合／外来通知来源、被让出的回复恢复及最终持久化。启动与两次汇总的重复用量事实只产生三条独立费用记录，均绑定同一回复。既有停止、失败、重连、旧回调和阻塞关闭消费者仍有覆盖。 |

真实 Electron 验收复用隔离开发 profile 和已配置的 LongCat 供应商。每个场景启动两个子任务，通过文件门控读操作控制结束顺序；后台结果分别释放。等待及部分完成截图保留停止入口，最终截图恢复发送入口，持久化和重开检查均保留一条助手行及两个子线程 context。

| Runtime | 真实模型 | 前台参数 | 后台参数 | 结果 |
| --- | --- | --- | --- | --- |
| Claude Code | `longcat::LongCat-2.0` | 两次 `run_in_background: false` | 两次 `run_in_background: true` | 前台、后台及重开历史通过。 |
| Pi | `longcat::LongCat-2.0` | 省略 `background`，沿用默认 `false` | 两次 `background: true` | 前台、后台及重开历史通过。 |
| Pi Durable | `longcat::LongCat-2.5` | 两次 `background: false` | 两次 `background: true` | 前台、后台及重开历史通过。 |

定向验证通过：behavior／Pi／Durable 包测试（118 项）、Claude 控制与原生测试（56 项）、受影响 Main 消费者、包构建、四个包的类型检查、node 类型检查、限定文件的 Oxlint／ESLint 及文档检查。Main handoff 文件通过 23 项，包括费用去重及外来／缺失／混合来源三种情况。一次 Claude SDK 集成用例在组合运行时超时，定向复跑及整份 20 项集成文件均通过；最终定向复跑增加了明确的完成断言。没有宣称运行全量本地测试或远端 CI。

本地证据位于 `.context/agent-runtime-background-fix-20261106/`（测试、范围及文档审查）和 `.context/cherry-electron-dev/reply-*-*.json` / `reply-*-*.png`（实际参数、状态、消息 ID 及截图）；`background-reply-audit.json` 汇总六组场景与子线程／用量关联。LongCat 2.5 有一次将阶段性回答全部放入思考内容，验收读取保留的原生 parts，没有制造正文块；最初仅检查正文的探针及其超时仍保留在本地证据中。所有已观察到的会话回复均保留产品归属，request ID 没有重复。另有一条 Claude Gateway 调用没有已发布的原生消息关联，保持未绑定；此次修复不猜测它的归属，也不宣称已完整归属 SDK 的不透明内部调用。

本节证明后台回复修复。所属 Spec 保持 proposed，待核对整个栈的累计验收与发布状态；本节不宣称此前所有迁移验收条件均已完成。


### 13. 删除 Durable 重复的关系索引（2026-11-07）

维护者于 2026-11-07 批准本次后续修改，基线为 `origin/main` 的 `4fb6b8a5dc95`，范围是 `packages/agent-runtime-pi-durable/src/runtime.ts` 中第 3 节尚未收敛的部分。已删除的 `relations` 存的是 `Promise<Subagent & { child: Thread }>`，不只是 `ConversationRecord`：它缓存原生归属／来源的读取结果，为迟打开的父会话重放关系，并服务于 `relation()` 和 `openChild()`。失败的 Promise 也会一直保留。task graph 观察仅用于填充这个索引。两者现已删除，本地验证证据记录在第 13.5 节。

#### 13.1 权威来源与准确删除清单

Pi Durable 1.4.0 已提供 `tx.conversation(id)`、`tx.task(id)` 和分页的 `tx.scanConversations({ ownerConversationId }, limit, cursor)`。原生 conversation 归属确定父会话；behavior lineage 确定原始创建调用，也覆盖后台 owner task 与该调用不同的情况。保留将这些事实规范化为现有 `Subagent` 契约的过程。保留 `ThreadFeed.snapshot.subagents` 作为消费者投影，不再维护第二份覆盖整个 runtime 的关系存储。

| `runtime.ts` 中的位置 | 删除内容 | 替代来源 |
| --- | --- | --- |
| `relations` 与 `publishRelation()` | 常驻 Map、Promise 缓存及全部 `get/set/has/values` 消费者 | 私有、无缓存的规范化函数，通过 SDK 记录读取接口读取原生记录、原始 lineage 和工具输入；挂载／访问查询在一个事务中完成 |
| task graph 初始化与关闭 | `TaskGraph`／`TaskGraphWatch` 导入、`watchTaskGraph()`、`updateRelations()`、`graph.start`、仅用于 graph 的失败／关闭处理及 `graph.stop()` | 新创建会话走已有 commit 订阅；历史子会话走原生归属查询 |
| `load()` | 仅 behavior 路径通过 `facts.children` 发现子会话，以及遍历全部关系缓存的重放 | 按原生 `ownerConversationId` 分页查询直接子会话，覆盖 behavior 与原始 adapter |
| `durable.relation()` | `relations.get(childId)` | 按需读取当前子会话的原生记录并规范化关系 |
| `durable.openChild()` | 遍历整个 runtime 的 `Promise.all(relations.values())` | 解析指定创建调用时，只查询当前父会话拥有的原生子会话 |

保留 `entries`、`live`、输入关联、归档保管、现有操作跟踪 Set、原生 view 观察及 Main 的子会话资源记录；它们的所有权不属于本次删除范围。无需升级／修改 SDK、增加 schema migration、扩大公开类型、引入替代 manager 或新增关系缓存。

#### 13.2 初次挂载与后续创建

1. 保持现有 commit 订阅先于任何父会话加载注册。父会话首次查询原生子会话前，先注册其 live projection。在同一个原生事务中读取全部分页并规范化记录，复用现有 `pages()`。
2. 查询前已提交的创建由查询恢复；查询后提交的创建由订阅交付。两条路径可能 upsert 同一个子会话身份，但投影中只能有一个子会话。behavior 已在同一事务中提交创建和 `subagent-origin`，无需增加临时的未知来源缓存。
3. 新创建的子会话只向已挂载父会话发布。异步规范化前捕获该父会话 entry，完成后确认仍由同一 entry 接收。父会话尚未打开时不保留任务或关系，后续查询原生归属即可恢复。即使父会话从未打开，直接打开子会话也能通过 `relation()` 获取归属。
4. 异步关系读取／交付纳入现有操作跟踪。`settled()` 在原生任务／输入清空后，还须等待已接纳的关系操作完成；仅凭 `inspect()` 为空不足以进入备份。关闭时，存储关闭前完成已接纳的原生读取，feed 关闭前交付捕获的关系，最终持久化前排空观察回调。不能因为 `shutdown()` 已开始就丢弃最后的关系。删除 graph 专属故障处理后保留 native／view 的来源丢失报告。

已安装的 SDK 禁止在 commit 监听器中调用 Session API，并且会先停止 view 观察，再关闭存储。因此，创建通知通过所属存储读取不可变的归属／来源／工具输入记录，与事务查询复用同一个规范化函数。现有存储关闭包装在后端关闭前等待跟踪操作完成，feed 在 `native.closed` 时关闭。这些独立读取不用于推断可变的任务结果。初次挂载失败时解绑 view 并移除其 live entry，避免重试残留第二个观察者。

即使没有 shared behavior，重启后查询也会包含已完成的所属子会话，旧的 live task graph 可能遗漏它们；这是明确的恢复修正。查询只包含直接原生归属：fork 继承的历史本身不能证明父子关系，孙会话由其实际父会话发现。现有子会话归档和输入／用量完成语义保持不变。

#### 13.3 子会话访问与失败结果

`relation()` 一起读取当前子会话的 `ConversationRecord` 和原始创建证据。无 owner 的会话没有关系。缺失来源仍保持缺失；原生读取失败仍作为失败返回，下次调用可以重试。续聊不能替换创建来源。

`openChild()` 保留现有每次访问的观察和取消生命周期。查询限定在接收调用的父会话及原始工具调用。初始观察、相关子会话发布、目标工具完成或恢复时，通过原生子会话解析结果，不因无关文本增量逐次查询。匹配到零个、一个还是多个子会话，由原生查询决定，不依赖异步 `subagent.upsert` 何时交付。

已知且仍在执行的调用可以等待。工具进入终态后，报告 `child-unavailable` 前必须完成原生查询，避免关系交付阻塞时漏掉已经提交的子会话。唯一匹配一起返回关系和 handle；多个匹配返回 `ambiguous-origin`；未知调用、原生读取失败、取消和所有者关闭保持既有不同结果。打开／释放访问不提交、恢复调度或停止原生工作。并发调用获得可独立释放的 handle，取消其中一个不能取消另一个。

#### 13.4 实施与验证顺序

1. 将规范化、`relation()` 和 `openChild()` 迁到限定范围的原生读取。在 `packages/agent-runtime-pi-durable/tests/runtime.test.ts` 和 `packages/agent-runtime-pi-durable/tests/behaviorContract.test.ts` 验证创建来源稳定、工具终态先于关系交付时仍能访问、暂时读取失败后的重试、来源歧义及独立取消。
2. 替换初次发现／重放，再删除整个 Map 和 task graph 观察。在上述 package 测试及 `packages/agent-runtime-pi-durable/tests/recoveryConfiguration.test.ts` 验证迟挂载、初次查询期间创建、跨多个分页、嵌套归属和已完成子会话的 SQLite 重开恢复。
3. 在 `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts` 验证受影响的 Main 消费者：独立子会话历史、续聊／重开及最终持久化期间观察阻塞。实现后再修改 package README 的 task graph 所有权／发现描述及受影响的双语参考文档。运行 package typecheck、限定文件的 lint／format 和文档检查，并搜索生产代码，证明该 adapter 中不再保留 `relations` 或 task graph 发现路径。

AC24–AC28 由实现者负责。本次修改不重新讨论三个 runtime 的产品等待策略，也不因删掉 Map 就宣称性能提升。

#### 13.5 本地实施证据（2026-11-07）

| 验收项 | 证据 |
| --- | --- |
| AC24 | `relations.test.ts` 验证 260 个直接子会话、嵌套归属、排除无 owner 的 fork 祖先关系、扫描失败后的重试，以及初次挂载期间排队的创建。`runtime.test.ts` 扩展的 SQLite 测试在旧实现上复现了重启后先于父会话打开已完成子会话时关系缺失的问题，改用原生查询后通过。 |
| AC25 | `relations.test.ts` 在关系交付阻塞时打开已提交子会话，区分未知／无子会话／歧义调用，并验证暂时的原生关系读取失败后可以重试且不增加模型调用。现有 Main 测试保留后台续聊和重开期间的 behavior 创建来源。 |
| AC26 | `relations.test.ts` 覆盖独立并发访问、取消、访问释放和 runtime 关闭。失败打开的清理及捕获 entry 的身份检查隔离已丢弃挂载的交付；扫描重试场景验证后继挂载能正常打开。 |
| AC27 | `relations.test.ts` 在 `settled()` 和 shutdown 期间分别阻塞关系交付，检查交付先于关闭。原生存储失败仍以 `source-lost` 关闭观察。`PiDurableRuntimeConnection.test.ts` 保留真实 SQLite 下独立历史、续聊／重开及最终持久化前子会话观察阻塞的覆盖。 |
| AC28 | 生产符号审计确认该 adapter 不再有关系 Map 或 task graph 订阅。原生存储计数器验证等待子会话访问期间，20 次无关文本修订不会引发额外查询。公开子会话类型和 Main 资源归属未变。package typecheck／build、限定文件的 Oxlint／ESLint 及变更文件格式检查通过。 |

限定范围的 package 验证：**82 项通过，3 项既有跳过**。Main 集成验证：**23 项通过**。命令：

```sh
pnpm exec vitest run --root packages/agent-runtime-pi-durable tests/runtime.test.ts tests/relations.test.ts tests/behaviorContract.test.ts tests/recoveryConfiguration.test.ts tests/pendingObservation.test.ts tests/projection.test.ts
pnpm --filter @cherrystudio/agent-runtime-pi-durable typecheck
pnpm --filter @cherrystudio/agent-runtime-pi-durable build
pnpm test:main src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts
```

3 项跳过保留已记录的 context-filter 和 foreground-continuation 限制。这些是使用脚本化提供商的原生 runtime 与 SQLite 测试，不是 Electron 或真实模型验收。本节只记录本地实施，不宣称整个 Spec 的其余验收条件完成，也不宣称远端 CI／发布已完成。

## 考虑过的替代方案

| 替代方案 | 不采用的原因 |
| --- | --- |
| 把完整 Cherry session／message／service 对象传入原生 package | 通过让原生所有者依赖产品存储、价格和窗口来减少查询，破坏恢复和依赖边界。 |
| 把现有映射抽进共享 manager 或基类 | 只搬移分散所有权，没有补齐原生边界；同一个类还得解释三种原生生命周期。 |
| 删除所有映射，全部从 idle 或最新快照推导 | 丢失排队／纯原生输入、待完成子线程创建、延迟用量关联和归档 flush 义务。 |
| 引入通用 run／task 协议或持久化关联台账 | 未解决实际存储缺口，却新增第二套调度器／状态模型和 migration；引擎专属事实已经存在。 |
| 只扩展 `Subagent`，保持消费者不变 | 补了来源，却未解决就绪、输入上下文重复、控制重放及 Claude 归档所有权。 |
| 重写现有内容协议 Spec | 把已交付的内容／持久化修复与仍处于提案阶段的控制和生命周期工作混在一起；分开决策归属便于审查。 |
| 只删类型成员，保留专用构造、复制和旧执行器 | 只缩小声明，运行时维护成本没有退出；本修订要求逐条报告被删除的生产链。 |
| 继续支持两个 Pi 行为入口，增加弃用转发或模式开关 | 当前生产消费者只有桌面接入，Node 契约测试可复用现有 behavior 路径；兼容包装会延续第二套所有权和测试面。 |
| 保留 Durable Promise 缓存来合并原生读取 | 它能避免重复读取，但也保留失败，并与原生归属及现有投影重复。把读取限定在挂载／访问边界和父会话范围，可以避免新增缓存生命周期。 |
| 只从最新投影快照解析 Durable 子会话 | 关系交付可能晚于工具终态。判定子会话不可用或解析来源歧义前，需要限定范围的原生查询。 |

## 验收标准

- AC1 — 原生 package 不包含 Cherry 数据库实体、产品价格、窗口对象或产品回复分配；复用现有所有者和 schema。(verification: unit — 由实现者负责 package build 及导入边界检查)
- AC2 — 产品输入上下文在 Main 只有一个所有者；三个 driver 均报告 ID，队列、steer 和失败路径保留原始 snapshot／headless 属性。(verification: unit — 会话 reducer 与 runtime service 测试)
- AC3 — Pi／Durable 放置后、下一次提供商请求前完成回复预留；重复事实及多输入共享响应不重复分配回复，Claude started 不被误报为 placed。(verification: unit — 原生探针及桌面桥接测试)
- AC4 — 未知接纳之后经历断连、重连并确认结果，仍保留原始 snapshot／headless 属性且不重新提交；恢复的纯原生输入和旧回调不会提前完成或修改后继连接。(verification: unit — adapter 与会话服务测试)
- AC5 — 三个 adapter 在配置未完成、嵌套、续接及冷历史场景提供有证据的子线程来源与访问；证据不可用时保留可读历史并明确限制，打开或释放访问不启动或停止执行。(verification: unit — runtime 契约测试)
- AC6 — 一份 Main 子线程记录持有访问和投影；挂接失败可重试，最终 flush 失败保留可重试输出，不创建第二个写入者。(verification: unit — 子投影、归档持久化和桌面桥接测试)
- AC7 — 子线程输入和最终写入者遵守 pause／drain；关闭／备份在最终 flush 前等待被阻塞的观察回调和最终事实，此后直到显式 resume 都没有投影写入。父线程完成与面板脱离不终止独立运行的子线程。(verification: unit — runtime 生命周期及 pause／child 服务测试)
- AC8 — Durable 在原生输入未决或压缩未结束时，idle 不能完成产品轮次；有序结束证据保留终态失败。(verification: unit — Durable package 与 connection 测试)
- AC9 — 首次挂接不重放历史完成／用量；溢出恢复在正文之后交付未见控制事实，并如实报告不可恢复缺口。(verification: unit — adapter observation 与桌面集成测试)
- AC10 — Claude 权限拒绝、明确撤回、别名和已提交子线程内容来自原生 adapter；仅元数据更新仍可见，压缩不删除保留的产品历史。(verification: unit — Claude projection、metadata 和子线程归档测试)
- AC11 — Claude SDK 调用聚合只有一个原生所有者；Main 保留价格时序、幂等持久化和延迟响应归属，Gateway 仍只有一条采集路径。(verification: unit — Claude 桌面与用量归属测试)
- AC12 — Claude Code、Pi 和 Pi Durable 均支持多窗口子线程观察、续接、历史、steer、定向停止和备份／恢复。(verification: Electron — 由实现者记录隔离 profile 场景)
- AC13 — 已迁移原生事实只有一个生产者；列出的 Main 镜像和原始控制解析器已删除，保留状态有明确所有者，参考文档与实现边界一致。(verification: docs gate — 生产者／消费者检索、变更范围清单及双语文档检查)

- AC14 — 产品回复在异步准备前拥有完整身份；内容、控制与计费归属在准备／保存失败后保持一致。前驱落盘、原生释放与流排空分别形成交接条件；延后输入不重发、旧回调不推进新回复，关闭结清未开流占位。 (verification: unit — handoff 真实 SQLite 测试、reducer 测试及 stream-manager 屏障测试)

- AC15 — 指定公开字段、死 driver 方法和原生 facet 退出，三个 Main 消费者仍完成实际调用；删除记录能对应到生产者、专用状态及复制路径，没有替代 manager 或兼容执行链。 (verification: docs gate — 实现者提交逐项消费者与删除证据，并运行受影响类型检查)
- AC16 — 去掉公开 delivery/revision/pending/state 副本后，基线不重放、慢观察者不丢终态、Durable 原子结束、Claude 原始内容与明确撤回仍成立；关闭和备份等待阻塞回调，最终 flush 后无写入。 (verification: unit — 三个 adapter observation/runtime 及桌面关闭屏障测试)
- AC17 — Pi 桌面接入只使用现有 behavior 路径，问答、goal、Todo、输出落盘及子线程创建／续接／停止／恢复结果保持；旧 standalone 执行器和专属出口不存在。现有 Node 契约测试验证同一 adapter 和 behavior。 (verification: unit — Pi behaviorRuntime/behaviorContract/behaviorHistory 与 Main 连接测试，由实现者维护真实场景)
- AC18 — 删除 InputState.response 和 Durable 外部查询／撤回面后，unknown 输入跨连接核对保留冻结属性、不重发，历史和费用仍按实际原生身份恰好归属，旧回调不修改新连接。 (verification: unit — Main handoff、nativeSubmission、子归档与用量测试)
- AC19 — context usage 不再输出 inputLimit/compactionThreshold；完整窗口分母、动态 reserved/free、估计／未知区别和 revision 隔离保持，读取不发起模型请求或增加费用。 (verification: unit — 三个 adapter contextUsage 及 renderer hook/summary 测试)
- AC20 — 三个 runtime 的既有历史、输入绑定、子线程归属和费用在隔离备份导出／恢复／重开后保留，恢复不额外提交；没有 schema、migration、SDK patch 或 native custom-entry 格式变更。 (verification: Electron — 实现者记录完整备份往返，结合现有真实 SQLite／原生 reopen 测试与变更范围检查)

- AC21 — 三个 runtime 在无新输入边界的后台子智能体场景中，父线程阶段性结束不完成产品回复；进展与最终汇总沿用同一助手消息，相关事实交付及最终持久化后只结清一次。无需该回复等待的后台命令不无限阻塞。 (verification: unit — 实现者使用真实 adapter 事件贯通 Main 与真实 SQLite，覆盖空任务快照、部分完成、阻塞观察、失败及重复终态)
- AC22 — 三个 runtime 分别验证前台与明确后台模式：等待与汇总期间停止入口保留，完成后恢复发送，重开仍保持正确消息数量与归属；停止、新输入、重连和费用沿用原有契约。原生参数、UI、持久化和真实模型证据分别记录。 (verification: Electron — 实现者按第 12.4 节完成逐场景验收，历史绿色记录或单独 mock 的等待标记不算通过)
- AC23 — 模型工具中的前台／后台选择保持原有参数与默认语义；adapter 只提供有来源的原生结果事实，不决定产品回复是否等待。相同子线程的续接结果按本次触发来源归属，任务展示完成、未知来源、连接释放和常驻命令均不能误结清或无限占用无关回复。 (verification: unit — 实现者验证第 12.5 节的参数矩阵、原生报告／通知间隙、跨输入续接、命令并存及未知来源，并检查旧字段和判断分支已移除)

- AC24 — 父会话迟打开、初次查询与创建并发、查询跨多个分页或完成后重开 SQLite 时，Durable 都能恢复每个直接所属子会话且不重复；behavior 与原始 adapter 保留归属，不混入兄弟会话或继承的 fork 历史。(verification: unit — 实现者扩展 Durable package 的 runtime.test.ts 和 recoveryConfiguration.test.ts)
- AC25 — 创建已提交但关系交付阻塞时仍能打开子会话；续聊保留创建来源，未知与歧义调用保持不同错误，原生读取暂时失败后可重试且不启动工作。(verification: unit — 实现者扩展 Durable 的 runtime.test.ts 和 behaviorContract.test.ts)
- AC26 — 并发打开子会话得到可独立释放的访问；取消其中一个不影响另一个，关闭会结束待完成的打开操作，迟到的关系交付不能写入替代 entry。(verification: unit — 实现者扩展 Durable 的 runtime.test.ts)
- AC27 — 删除 graph 观察后保留独立子会话历史、续聊和重开；关系或观察回调阻塞时，shutdown／backup 等待最终事实，最终持久化后不再发生投影写入。(verification: unit — 实现者扩展 Durable 的 runtime.test.ts 及 PiDurableRuntimeConnection.test.ts)
- AC28 — Durable adapter 不再有覆盖整个 runtime 的关系缓存或 task graph 发现订阅；原生查询限定在父会话范围且不由无关文本增量触发，公开子会话契约及 Main 资源归属保持不变。(verification: docs gate — 实现者提供符号／消费者审计、package typecheck、限定范围测试证据及更新后的 README)
## 风险

| 风险 | 必需保护 |
| --- | --- |
| 原生 API 提供的证据少于目标契约所需 | 先通过已安装 adapter 和脚本化原生探针证明行为。明确保留来源缺失、未知接纳和不可恢复缺口。必需的上游 SDK 变更由维护者另行决策，不能用 Main 推测补偿。 |
| 子线程配置、观察和关闭发生竞态 | 异步配置前登记原生创建；失败／关闭时结束所有等待，释放未被采用的访问，并保留最终写入者直到持久化成功或其失败被明确呈现。 |
| 删除输入镜像改变回复时序或用户属性 | 派发前登记，保留同步预留钩子，转交捕获的完整上下文，并按连接代次隔离迟到回调。 |
| 合并只是搬移重复状态 | 为每个删除字段指明现有权威原生记录，或唯一保留的产品／资源记录。拒绝复制两侧状态的新 manager。 |
| 基线或溢出处理重放旧完成，或丢掉新完成 | 原生身份和来源随批次捕获，保留正文先于终态的顺序，为交付历史设界，并测试慢观察者及后续提交。 |
| 用量规范化过晚冻结价格，或重复记录 Gateway 调用 | 保留调用开始证据和现有唯一采集所有者；分别测试原生身份、持久化费用和延迟消息绑定。 |
| 大范围重构掩盖恢复回归 | 按上述聚焦阶段交付，保持既有内容／checkpoint 契约，只重跑被该阶段变更失效的检查。分别报告 adapter、SQLite、Electron、重启和 CI 证据。 |
| 字段收缩误删内部算法或同名持久化字段 | 区分公开 batch revision 与 context revision、root DTO parts 与 child archive parts、返回 messages 与原始 NativeArchive；保留来源成员资格、原子提交及观察排空。 |
| 删除旧 Pi 执行器时误删共享的历史恢复逻辑 | 保留当前桌面原生归属和 child lineage；原生文件不改写，不制造替代任务，不用缺失旧 API 解释所有恢复失败。 |
| 只有类型／测试变少，冗余生产链仍存在 | 每阶段核对专用构造器、状态、复制及执行分支的退出；产品场景先迁移到现有测试，不以重命名、新 DTO 或仅删除测试充当收敛。 |
| 恢复已完成的 Durable 子会话增加挂载读取和下游子会话观察 | 只分页查询直接归属，避免遍历整个 runtime 或逐 token 查询，并覆盖多页场景。记录有意扩展的恢复范围，未测量前不宣称延迟降低。 |
| 删除关系缓存改变异步交付时序 | 验证工具完成及关闭前关系交付阻塞的场景；最终持久化前等待现有跟踪操作完成，保留明确的原生读取错误，不返回成功的空查询。 |

不因映射减少就假定性能受益。成功标准是在可观察行为不变的前提下，减少独立解释和同步路径。任何阻碍必需验收标准的 SDK 限制，都必须先在所属契约中解决并经过审查，再推进其消费者阶段。
