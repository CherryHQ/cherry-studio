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

## 方案

### 1. 范围与所有权

复用现有所有者。不新增通用 `BaseRuntime`、第二个会话服务、持久化提交台账、能力矩阵或 migration。普通 AI SDK 对话及已退役 runtime 不在范围内；SDK 升级、提供商路由变更、schema 重设计和通用配置重构也不在范围内。

| 所有者 | 权威状态 | 可跨边界传递的内容 | 不得承担的职责 |
| --- | --- | --- | --- |
| `AgentSessionRuntimeService` 及其现有连接记录 | 产品输入上下文、回复预留、队列、连接代次、产品轮次切换 | 不可变的原生命令；按输入身份关联的回调 | 原生任务调度或 SDK 流帧解释 |
| 现有 runtime connection | 原生访问租约、产品上下文绑定、每个被观察子线程的一份资源记录 | 供产品投影与计费使用的完整原生事实 | 第二份输入上下文或原生任务状态 |
| package 内的原生 runtime／behavior 所有者 | 接纳、放置、原生输入结果、子线程来源／就绪、原生任务、内容与归档证据 | 在原生边界捕获的类型化值；受支持的原生控制 | Cherry 数据库实体、窗口对象、价格或产品消息创建 |
| `ThreadMessageProjection` 及根／子产品投影 | 展示装饰、来源到产品消息的组合、保留的产品历史和归档写入 | 产品消息与挂接快照 | 原生执行或第二份原生归档 |
| Main 中的用量采集与归属 | 冻结的凭据／价格证据、持久化费用、原生响应到产品消息的归属 | 原生调用身份与计费结果 | SDK 流重建 |

“传完整对象”指在所有者范围内保持一个内聚、不可变的值完整：子线程访问结果一起携带关系和句柄；输入的产品属性一起保留在 Main。它不意味着让整个服务、数据库行对象图或可变会话对象穿过每一层。

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

Durable 增加具体的观察批次，同时携带内容／输入事实，以及从同一权威原生修订计算出的前台结束结果。相关已接纳或纯原生输入仍无终态／本地结果，或前台执行／压缩尚未完成时，结束状态必须保持 pending；未知状态不能变为成功。adapter 在发布结束结果前核对原生提交记录。携带区分新结束与重放所需的原生身份／修订。最终输入结果和内容先于相应终态事实发布。后台工作和 runtime 整体排空仍是独立概念。

维护者于 2026-11-05 另行批准最小 SDK 导出补丁：向仓库现有的 Pi Durable 1.4.0 patch 追加已有 `conversationViews`、`ConversationView` 和 `ViewObserver` 的导出。公开 `watch` 会合并修订，无法建立此契约。补丁只改变导出，保留锁定版本，让 adapter 在同一已提交存储／视图修订中规范化提交结果。

这样 Main 才能删除 `pendingInputs`、`refreshInputs` 和 `finishIfIdle` 中的原生轮询。不能用 `activity === idle` 或 `hostPending.size === 0` 替代。原生所有者仍可能需要输入索引；应并入现有原生输入记录，而不是再建一份提交台账。公共 `Activity` 类型继续只描述前台活动。

Claude 在现有 owner／feed 中规范化为可判别联合。每个迁移的控制事实一起携带其原生身份和有关 input／response／task 关联。标准内容由现有 SDK 消息投影处理。把原始 `command_lifecycle`、`result`、任务回执及权限拒绝解释移出 Main，包括任务解析器对 `ClaudeMessageMetadata` 的依赖。尚未映射的 SDK 变体，必须在 adapter 契约测试中明确归为内容、控制、诊断或有理由的不支持；不能静默强转为兜底对象。

观察交付必须区分首次挂接基线、后续原生更新、缺口后恢复、仅元数据刷新。别名、撤回和来源信息随交付批次一起捕获；不能在交付已经前进后再读取可变别名表。复用 Claude 的具体批次，为 Pi／Durable facet 提供等价的完整载荷。Main 投影入口改为接收这一完整值，替代快照、推测的 `liveSnapshot` 标记和另行读取的别名表。连接边界可以做纯类型化字段映射，不能再维护一个语义 reducer。

首次基线加载历史和当前状态，不重放历史轮次完成或费用。后续溢出恢复必须在相应正文更新之后交付之前未见的终态／控制事实。按原生事实身份，在现有原生 feed 中维护每次观察的交付位置／去重；按 feed 现有保留策略压缩已确认交付状态，不永久保留全部事件。这是访问生命周期状态，不是另一份持久化事件日志。慢观察者不能阻塞原生执行。如果 feed 无法恢复必需的控制事实，应报告缺口，不伪造完成。Main 持久化在重复事实下保持幂等；这不承诺跨进程崩溃的 exactly-once 效果。

### 6. 从展示装饰器移除 Claude 原生归档与语义

以 `handle.claude.archive()` 作为 `ChildThreadProjection.readCommitted` 的已提交原生内容来源。对单次捕获的归档结果做纯类型化转换，保留现有 Main 已提交历史消费形状。Pi、Durable 继续读取各自原生归档。不创建新归档服务，也不让展示装饰器成为归档提供者。

Claude adapter 把权限拒绝语义应用到受影响的 SDK 工具 part，保留明确的来源撤回，并把别名、旧来源关联与所属归档／观察一起暴露。即使所属调用已不在选定视图内，明确撤回仍应移除其输出。某项不在压缩后／当前视图内，不代表可以删除保留的产品历史。

消费者改用这些原生事实后，删除 `ClaudeMessageMetadata.messages`、`removed`、`legacy`、`denied` 和 `archive()`。剩余装饰器只负责 MCP 标签、产品 reminder 可见性等产品展示。宿主观察到的 reasoning 时间戳可以作为展示计时状态保留；明确并保持其当前含义，不把它替换为没有依据的原生思考时长。其他剩余原生内容解释也必须先移入 adapter，再删除 Main 副本。

保留 `ThreadMessageProjection` 的原始／装饰视图：元数据可以在内容未变化时改变。为协调原生当前视图和保留的产品历史，继续保留必要的 child composition、持久化产品／原生身份、tombstone 和 checkpoint 映射。它们属于不同所有权领域，不是重复的原生消息仓库。

### 7. 下移 SDK 用量聚合，计费保留在 Main

Claude adapter 把 SDK 消息／流用量合并为完整原生调用事实：稳定调用身份、原生 thread／response 身份、模型身份、有证据的 token 数、完成／错误状态及计时观察来源。部分流帧和最终 assistant 帧更新同一调用记录。复用原生所有者及其响应关联，不保留独立的 Main 聚合实现。

Main 仅在 `usageCapture.owner === 'agent-sdk'` 时消费这些事实，在现有调用边界冻结既有凭据／价格证据，并通过现有计费服务持久化。如果只报告终态会导致价格或归属冻结过晚，就不能只报告终态；必须以同一身份报告开始／关联证据和后续更新。SDK 会话累计用量不能被当成额外调用。

Gateway 路径继续以 `provider-calls` 为唯一采集所有者。`AgentSessionUsageAttribution.owners/pending` 仍有必要：提供商调用可能先完成，响应随后才归到产品消息。立即持久化会话所属的用量，之后绑定已有记录，不改变费用。本提案不新增计费表或用量所有权 migration。

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
| 输入、写入屏障与持久化 | `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`、`agentSessionRuntimeState.test.ts`、`AgentSessionRuntimeService.child.test.ts`、`AgentSessionRuntimeService.pause.test.ts`、`ChildThreadProjection.test.ts`、`AgentSessionArchivePersistence.integration.test.ts`、`AgentSessionUsageAttribution.test.ts` |
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

## 考虑过的替代方案

| 替代方案 | 不采用的原因 |
| --- | --- |
| 把完整 Cherry session／message／service 对象传入原生 package | 通过让原生所有者依赖产品存储、价格和窗口来减少查询，破坏恢复和依赖边界。 |
| 把现有映射抽进共享 manager 或基类 | 只搬移分散所有权，没有补齐原生边界；同一个类还得解释三种原生生命周期。 |
| 删除所有映射，全部从 idle 或最新快照推导 | 丢失排队／纯原生输入、待完成子线程创建、延迟用量关联和归档 flush 义务。 |
| 引入通用 run／task 协议或持久化关联台账 | 未解决实际存储缺口，却新增第二套调度器／状态模型和 migration；引擎专属事实已经存在。 |
| 只扩展 `Subagent`，保持消费者不变 | 补了来源，却未解决就绪、输入上下文重复、控制重放及 Claude 归档所有权。 |
| 重写现有内容协议 Spec | 把已交付的内容／持久化修复与仍处于提案阶段的控制和生命周期工作混在一起；分开决策归属便于审查。 |

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

不因映射减少就假定性能受益。成功标准是在可观察行为不变的前提下，减少独立解释和同步路径。任何阻碍必需验收标准的 SDK 限制，都必须先在所属契约中解决并经过审查，再推进其消费者阶段。
