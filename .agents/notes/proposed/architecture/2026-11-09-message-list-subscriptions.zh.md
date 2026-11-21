# Agent Note: 增量持久化、timeline 投影与消息列表订阅

Status: proposed

[English](2026-11-09-message-list-subscriptions.md) | 中文

## 问题

在 Cherry `ab83909a7c637c81c6d59221f76d1aad919d2add`，Home 和 Agent 将完整实时助手合并到列表输入。本地 steer 分段在 acknowledgment／原生交接时改变临时 ID，克隆消息／part 包装，并把已结束投影 ID 保留为实时成员。这会扩大更新、重挂载内容，也可能使已完成内容继续被搜索排除。Main 回复持久化 listener 在成功／暂停／错误时保存，而非每个 part 完成时保存。

本文部分接续[原生 steer](https://github.com/CherryHQ/cherry-studio/blob/ab83909a7c637c81c6d59221f76d1aad919d2add/.agents/notes/proposed/bug-fix/2026-11-09-agent-native-steer.md)的 renderer 设计。原生优先级、准入、循环归属及其 AC1–AC11 仍归该文。[流重放交接](../../implemented/bug-fix/2026-10-22-stream-replay-handoff.md)、[滚动区域收敛](../simplification/2026-11-04-unified-scroll-area.md)及[代码块场景](2026-10-26-message-code-block-surfaces.md)保留各自所有者。本方案尚未实现，不声称已获 Spec-head Approval 或测得性能收益。

[Agent Run 与 Timeline 规范](2026-11-19-agent-session-timeline-and-context-transfer.md)负责 Agent 执行、条目放置、来源身份、工具结果寻址和两种恢复游标。本文负责 Renderer 按键订阅和 Home 身份。Agent 实时路径采用按键条目。

## 方案

### 1. 最终结构与归属

```text
Provider / SDK events
  -> existing runtime/source owner
  -> in-memory parts with stable IDs
       -> per-part subscribers
       -> part onDone: persist that part
  -> run or message completion: terminal state and statistics

SQLite: Agent run + message_part + existing tool outputs
History: scoped page -> batch-load ordered items -> existing message API where needed
UI: stable part references -> derived timeline rows -> existing viewport
```

Home message 或 Agent run 是容器，part 是内容／更新／持久化单位，timeline 行是派生展示。展示变化不改变原生执行归属。保留内建 text／reasoning／tool parts 及现有类型化 [DataUIPart 映射](../../../../src/shared/data/types/uiParts.ts)，不创建平行 TurnItem 内容模型、timeline 表或 SDK-frame 事件归档。

| 所有者 | 职责 |
| --- | --- |
| 现有 runtime adapters／会话所有者 | 规范化真实原生事实；拥有输入 placement、执行、活动及语义 part 完成 |
| `RootMessageProjection` 及现有来源投影 | 原生到产品映射、稳定 part IDs、内存正文及来源 checkpoint |
| 既有消息／context 数据服务 | 保存容器、独立 parts、既有拆分工具结果及必要来源元数据 |
| Main `MessageProjection`／`ProjectionSubscriptions` | 发布一致 snapshot／patch、管理窗口 lease，不处理 SQL 或执行控制 |
| Renderer transport／topic facade | 既有 attach、attempt 过滤、实时来源留存及历史／实时选择 |
| 按视图限定的消息列表投影 | 将稳定 parts 分组为行，公开按键不可变读取，不持有权威正文累加器 |
| 现有视口 runtime | 导航意图、测量、跟随／阅读及位置恢复 |

Shared 类型包含持久 part／DataUIPart 契约及传输事实，不包含 React 行或可变 store。Renderer 专属行类型留在消息列表契约旁。只有两端实际消费同一来源无关规则时才提取 shared 纯展示 helper，不因此增加另一 manager。

### 2. 独立 part 存储与完成写入

智能体会话保留 `agent_session_message` 作为容器，通过追加 migration 增加 `agent_session_message_part`。普通 Chat 保留既有内联正文存储 adapter。阶段 4 接入共享按键渲染契约之前，必须先完成下述 Home 身份迁移；没有持久 part IDs 的 adapter 不得接入该契约。

| 存储 | 内容 |
| --- | --- |
| 消息容器 | ID、父／分支关系、角色／模型、终态、归属及统计 |
| Message-part 行 | 稳定 ID、所属消息 ID、明确顺序及当前类型化 payload |
| 既有工具结果存储 | 既有消息／工具调用身份下的最新拆分输出 |
| 既有 checkpoint | 原生／来源关联及恢复元数据，不复制正文 |

API 继续返回组装的 `message.parts[]`。迁移后 part 表是唯一持久正文来源；移除旧持久数组，同批切换读写者，不永久双写，也不在两份正文权威之间运行时回退。按原顺序回填数组，一次分配 IDs，保留消息／分支关系、非 part 私有元数据、工具引用及 blob 信封，不还原工具全文。

#### Part ID 载体

Part ID 与 part 并列存放，不写入 part 内部。`CherryMessagePart` 保持未修改的 AI SDK `UIMessagePart` payload；不在 part 对象、`providerMetadata` 中加 ID，也不把 `message.parts[]` 包装为 `{ id, part }`。

| 层 | 载体 |
| --- | --- |
| SQLite | Agent：`agent_session_message_part.id`。Home：与既有内联 `parts` 并列的 `message.data.partIds`；两者均保持 part payload 不变 |
| 数据／投影契约 | Agent 使用按键时间线条目，Home 的 `partIds: readonly string[]` 与 `parts` 平行、等长且顺序一致，同消息内唯一 |
| Main 来源投影 | 有序 part IDs 加 `Map<partId, part>`；checkpoint 记录 part IDs |
| 传输 patch | 按 `partId` 寻址。Agent 按位置插入，Home 顺序变更携带新 `partIds` |
| Renderer | `partId` 作为 part 订阅键及 React key |
| 模型输入 | 只由 `parts` 构建；`partIds` 不进入服务商转换 |

Agent 的来源身份和替换规则由 timeline 规范负责。Home 由 Main 分配产品 part ID，遇到未知 ID 或并列列表长度不符时重新读取基线。Renderer 复用已接纳的 ID。

Home 的 `MessageService` 拥有并列的 `MessageData.partIds` 载体，并与 `parts` 原子写入。新增迁移按既有内联 parts 的存储顺序一次性分配 UUIDv7 IDs。新 part 在发布前由 Main 分配 ID，终态保存保留这些 IDs；更新和重排携带原 ID，插入或 fork 复制的 part 分配新 ID。ID 随所属 part 删除而结束。历史读取、renderer 重载及 reconnect 复用持久 IDs，不从内容或数组位置重新分配。Home 模型转换仍只消费 `parts`。

阶段 4 必须同批迁移所有 Home 写入者、历史／投影读取者及 fork 路径，然后才能启用 Home 按键订阅。验证已填充历史迁移、重载／reconnect 稳定性、编辑／重排和 fork 隔离。在该迁移交付前，Home 保持既有 adapter 和订阅行为；Agent part 存储本身不能证明 Home 身份恢复。

增量更新当前内存 part，并通知其订阅者。在该 part 自己语义上的 `onDone` 保存，不等整段助手回复的 `onDone`。回复完成等待必要保存，再更新容器状态／统计，不重写已保存 parts。Stop／错误先保存未完成 parts 的已收到内容及实际状态，再结算回复。用户输入接纳仍立即写入。不设置定时正文 checkpoint、逐 token 写入或历史 part 版本。Agent 按 timeline 的规则保存重放所需的放置元数据。Main 异常退出可能丢失当前未完成 part，已提交完成 parts 可恢复；Main 存活时 renderer 重载可重新 attach 到更新的内存内容。

相关 part／结果／来源映射变化使用既有同步 SQLite 事务。异步 blob／原生 checkpoint 工作在事务前准备，成功提交后发布。复用既有会话／attempt guards 处理过期完成、删除和 fork，不引入独立批次调度器。Part 保存不触发回复自动命名／用量结算。搜索响应相关文本／完成，不响应工具／隐藏 part 更新；存储迁移一起调整旧 JSON／FTS triggers。按需维护文件引用，保留其他 parts 仍引用的文件。测量大型单 part 序列化及完成写入；独立记录不意味着零拷贝持久化。

复用[工具结果 #23909](https://github.com/CherryHQ/cherry-studio/pull/23909)和[数据库 #23873](https://github.com/CherryHQ/cherry-studio/pull/23873)。已检查实现 head 为 `f89b6762dae797db222e97ec75e9f53a08391308`；本 Spec 堆叠于该实现之上。[所属说明](https://github.com/CherryHQ/cherry-studio/blob/f89b6762dae797db222e97ec75e9f53a08391308/.agents/notes/implemented/architecture/2026-11-09-tool-result-projection-boundaries.md)继续拥有已接纳不可变快照、序列化复用、最新结果覆盖、定向失效、有界详情读取及缓存寿命。不增加结果 revisions、内容 hashes、历史版本寻址或重复存储。Preliminary／替换结果遵循既有最新值契约，完成不代表历史不可变。

### 3. 稳定的输入、条目与行身份

| 身份 | 规则 |
| --- | --- |
| 用户消息 | 提交前分配合法 UUID，乐观消息与持久消息共用 |
| 产品助手 | Agent 沿用 run ID，Home 沿用产品消息 ID |
| 内容／工具 part | 使用稳定持久 part ID 及既有原生来源／tool-call 关联，追加／状态变化保持身份 |
| 必要边界 DataUIPart | 从已接纳用户 ID 和边界种类派生，不每次渲染随机生成 |
| 展示行 | 由稳定的时间线条目及其位置派生展示分组 |
| 传输 revision／generation | 既有顺序／过期事件控制，不进入内容或 React key |

当前 renderer 提交时不带消息 ID，由 Main 分配 `userMessageId`（`AgentChatContextProvider` 中的 `uuidv7()`，或既有投递消息 ID）。改为 renderer 在提交前一次分配用户消息 ID，贯穿提交请求，复用既有原生 `inputId = message.id` 关联。在边界校验 UUID、目标和权限。同一输入重复请求返回已有接纳；冲突 ID 不得覆盖无关输入或静默重复提交。投递未知不意味着允许重放。比较不可变提交事实，不比较可能追加应用元数据的可变 parts。

已有 Agent part 在后续输入或 part 到达时保留原位，新条目占自己的位置。Home 维持既有消息顺序并使用自己的 ID 载体。输入 ID 从接纳、放置到展示都保持稳定。


```text
run R: input U1 at pos 1, streaming part P1 at pos 2
steer U2 is placed into R at pos 3
append to P1: same part and position
new part P2: pos 4 in R
```

既有展示或生命周期事实可使用 DataUIPart。输入绑定后保留不可变提交事实，时间线归属独立记录。隐藏 part 不进模型输入，`data-retry` 仍为临时状态。压缩更新原有锚点，interrupt 保留已收到内容和既有分隔符。

输入框和 timeline 为本地、queued 和外部投递消费既有活动及输入处置事实。Busy 不等于原生 placement 信号。保留 origin 和持久输入身份，不建立平行准入算法。Queue-to-steer 提升不换输入身份。一条待接续 steer 的策略继续归原生 steer 所有者。渲染、观察和保存不打断／重启 agent loop。

### 4. Renderer 读取与寿命

```typescript
interface MessageListProjection {
  getRowKeys(): readonly MessageRowKey[]
  subscribeRows(listener: () => void): () => void
  getRow(key: MessageRowKey): MessageRowDescriptor | undefined
  subscribeRow(key: MessageRowKey, listener: () => void): () => void
  getPart(id: MessagePartId): CherryMessagePart | undefined
  subscribePart(id: MessagePartId, listener: () => void): () => void
}
```

这些是概念目标签名，不是已交付 API。行描述包含种类／分组元数据及有序完整 part IDs。移除的行／part 读取为缺失。可观察值未变时保持快照和数组引用。文本更新只通知受影响 part；part 成员／顺序变化通知所属描述／拓扑；状态／底部变化通知自己的消费者。反向索引定位受影响视图，不重建全部历史。先应用相关来源／绑定／索引变化，再发通知，避免读取半更新投影。活跃文本不反复重建行描述。

| 层 | 留存状态与寿命 |
| --- | --- |
| History hooks／SWR | 持久页、游标、加载／错误及既有延迟读取 |
| `MessageProjectionService` | 每目标／窗口一份共享 IPC 基线／patch 流、缺口恢复及引用计数 detach |
| `ExecutionStreamOverlayService` | 既有 attempt 过滤、实时 parts 和唯一历史／实时选择路径；保留不可变页引用，不再建历史缓存 |
| 限定列表视图 | 一个选中视图／分支的行／分组描述、part 引用及反向索引 |
| UI 状态 | 既有有界所有者中的选择、编辑、展开和视口状态 |

一个视图 hook acquire／release facade 并注册历史页引用。Provider／卡片只订阅，不 acquire 第二条连接。列表释放只丢弃派生监听器／索引；最后消费者 release 才脱离 renderer 观察，不取消 Main 工作。保留 Activity 隐藏／重显、分支／话题 owner guards 和过期页面拒绝。Context 传稳定 store／action handles，不传完整变化消息 map。Service 不导入组件局部行类型。

确认接纳、来源替换和历史交接时保留已挂载 part 的 key。Agent steer 保留已有 part 的位置。工具按 part ID 订阅，详情有界按需加载，加载状态独立于执行。用户切换视图时验证展开、审批、焦点和选择。

保留 Virtua、Streamdown、稳定 renderer／plugin 配置及既有视口 hooks。语义不变时复用已完成 Markdown 块，后续分隔符可能合法改变活跃解析区域。跟随模式保持实时底部，阅读模式保持语义锚点／偏移。本地发送只发一次导航意图，ack、保存及后继绑定不再发导航。自然内容增长与重挂载、意外锚点位移分开测量。没有已复现缺口不要求全局 observer 或 `flushSync`。

### 5. 简单完成、清理和历史读取

Main 提交成功后发布完成。Renderer 通过有作用域的游标读取已提交历史，然后释放对应已结束的实时内容。保存或刷新失败时保留可读实时内容并报告既有可恢复错误。保留更新的活跃 parts，遵循 attempt、话题和发布 guards。实时 reattach 沿用发布 revision，持久历史恢复遵循 Agent timeline 契约。

删除／fork 使用既有会话操作及原生 checkpoint 边界，完成 guards 防止迟到写入重建已删除内容。部分存储不构成自动恢复工具执行的授权。不为假设竞争另建锁／队列 manager，验证实际受影响交错即可。

历史按消息分页，批量读取其完整有序 parts，工具全文保持延迟。有具体需求的直接 part 引用可按 ID 定向读取，不需要通用跨页依赖图／解析器。展示由已有接纳事实驱动，不伪造旧 steer 字符截点。Fork 使用真实原生／产品 checkpoint，不使用 UI 行键。导出／搜索／截图复用既有消息／part 读取和组装入口，不各自重建来源，也不要求全部经过 UI timeline。可见选择的截图／复制遵循所选 part IDs／顺序；明确全文导出保留权威内容。删除目标按权威 ID 去重，展示分组变化也只归账一次。保留多模型／分支语义及明确操作能力。

### 6. 实现位置与删除边界

| 位置 | 改动 |
| --- | --- |
| `src/shared/data/types/uiParts.ts` 及现有 message types | 最小类型化 data-part 事实和稳定 part 契约，保留模型过滤／临时策略 |
| `src/shared/ai/messageProjection.ts` 及现有 IPC 路由 | 既有 snapshot／patch／revision 契约，补必要 part 身份／变化事实，不建第二协议 |
| `src/main/ai/agentSession/RootMessageProjection.ts` 及 runtime adapters | 稳定原生／产品 part 映射、内存更新及真实 part 完成回调 |
| `src/main/data/services/AgentSessionMessageService.ts`、context service 及 schemas | Part 表／迁移、按 part 保存、批量组装、文件／搜索适配及既有工具结果集成 |
| 现有 persistence backend／listener／runtime 所有者 | Part 完成保存、有序回复完成和 Stop／错误结算，不建定时 writer service |
| `src/main/ai/messages/MessageProjection.ts`、topic／child projections | 复用变化的不可变 parts，发布受影响更新，不把完整视图 clone／hash 作为文本热路径前提 |
| `src/renderer/services/aiTransport/*` | 既有 transport／facade 寿命和按键来源读取，通过当前公开 barrel 导入 |
| `components/chat/messages/types.ts`、provider／list／frame／blocks | 限定派生行视图和按键叶子读取，service 独立于组件类型 |
| 既有页面 runtime hooks／adapters | 组合选中目标、历史、能力／actions 和一个 acquired 来源 handle，不逐增量合并完整实时正文 |

只在实际体积／内聚性需要时创建私有 helper，不预建 TimelineService、ProgressWriter manager 或新进程根目录。现有生命周期所有者拥有留存资源。先迁移消费者，再删除本地 held steer 边界、临时 `CherryUIMessage` 接续、单一来源别名、解析式下标 IDs、投影 ID 实时并集和聚合正文订阅。只有按键历史／实时、引用、自动朗读及错误消费者迁完后才移除旧 `useMessageStreamingLayers` 组装；保留有用冷读取 helpers 及无关能力。

### 7. 迁移与验证单元

| 阶段 | 范围 | 证明 |
| --- | --- | --- |
| 1. 存储／身份 | 增加 part 记录，迁移数组，保留最新工具结果契约，切换唯一正文来源／读取组装 | 已填充 SQLite 迁移、有序往返、分支／fork／文件清理及输入锁测试 |
| 2. 完成持久化 | Part `onDone`、回复终态／Stop／错误顺序及既有刷新清理 | 回复完成前恢复已完成 part、不逐增量写入、失败留存及实际过期完成测试 |
| 3. Agent 按键渲染 | 稳定输入／part／行身份、来源 handle 寿命和 part 订阅，删除被替换本地路径 | Ack／交接／连续输入、无关快照、仅活动通知、双窗口／reattach 及操作测试 |
| 4. 共享消费者 | 先完成 Home 身份迁移，再接入多模型／历史及其余列表消费者，分页、来源感知操作和冷读取 | 消费者审计、明确受影响测试、全文复制／截图／选择和无重复订阅 |
| 5. 真实交互 | 既有视口／Markdown／工具过渡，仅修复测得缺口 | 真实 Electron Claude／Pi／Pi Durable steer／queue／compact／Stop／外部输入及跟随／阅读／焦点几何 |

切换 Agent 之前，要验证延迟工具结果后段的地址仍能用于预览，恢复和派发不会逐消息查询 parts。这是该栈内的消费者验收。

使用明确测试文件，SQLite 使用 `setupTestDatabase()`。合成重放证明数据／通知契约，真实 Electron 证明集成和几何。同夹具／构建／视口比较，通知／渲染／挂载次数与 CPU／帧／布局和内存分别记录。覆盖长历史、稳定大型结果加文本、仅元数据、媒体尺寸、前插及话题切换。不承诺未经证明的 FPS、零重挂载或无限时长无泄漏；原生指令遵循与操作系统／打包覆盖是独立证据。

### 8. 参考证据与限制

T3 参考使用 `c6ca6056309904f89b90b6055d797973be0a0939`：[ID 分配](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/packages/provider-core/src/server/IdAllocator.ts)、[item 级 steer 分组](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/apps/web/src/components/chat/MessagesTimeline.logic.ts#L1033)、[低频结构与按键文本](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/packages/client-runtime/src/state/threadDetail.ts#L354)、[事务／发布](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/apps/server/src/orchestration-v2/EventSink.ts)及[搜索索引门控](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/apps/server/src/orchestration-v2/messageSearchIndex.ts)。早期 renderer 探索使用 `d5290e9167ccbd8d2c7043eab8e311fd21a14464`，两份源码快照都不是 Cherry 运行时证明。

[消息列表规则](../../../../src/renderer/components/chat/messages/README.md)、[投影传输](../../../../src/renderer/services/aiTransport/MessageProjectionService.ts)、[topic facade](../../../../src/renderer/services/aiTransport/ExecutionStreamOverlayService.ts)、[持久化 listener](../../../../src/main/ai/streamManager/listeners/PersistenceListener.ts)和[视口 runtime](../../../../src/renderer/components/chat/messages/list/chatVirtualizerRuntime.tsx)仍为实现所有者。既有 steer 录像／测试和工具结果依赖的报告只证明其各自 head。本方案尚未执行 schema 迁移、新运行时验收或基准。

## 考虑过的替代方案

- 更多本地快照／别名或 renderer 事件存储：重复来源归属，仍有身份／重载分歧。
- 字符切片及通用边界谱系：已确认 item 级行为不需要。
- 平行 TurnItem 模型、timeline 表或完整 T3 事件日志：重复既有 parts／事实，增加重放／留存义务。
- 保持仅终态整条消息 JSON：不匹配选定的独立 part 持久化单位。
- 迁移后保留两份权威正文，或无限期保留旧聚合 API：更新归属和删除边界继续不清晰。
- 结果历史／revisions／hashes 或第二份工具存储：由既有最新结果依赖契约取代。
- 新提交证明／回执／版本或跨页依赖系统：既有完成／刷新和普通读取已经满足本范围。
- 替换 Virtua／Streamdown 或强制 observer／flushSync 机制：需要测得库／host 限制，不是假定修复。

## 验收标准

- AC1 — 仅文本更新保留行拓扑及无关 part 引用，只通知受影响 part 订阅者 (verification: 明确 projection／facade／list 测试 — renderer 负责人)
- AC2 — 正文相同时活动、审批、底部用量及终态变化仍可见 (verification: 按键状态／组件测试 — renderer 负责人)
- AC3 — Ack 与原生交接保留输入和 part 的 key 及兼容的工具子树，不重复（verification: 挂载／焦点断言及真实 Electron — 渲染负责人）
- AC4 — 替换或移除 part 时保留来源，按 ID 更新对应条目（verification: 来源投影重放 — 投影负责人）
- AC5 — 提交的条目位置可在重载及双窗口观察时重建，未知或被拒绝的输入不会自动重放（verification: 持久化 part 和 Electron reattach 测试 — Main／渲染负责人）
- AC6 — 保存／刷新失败保留可读输出，成功保存及刷新先于已结束实时清理 (verification: 失败注入和历史／overlay 测试 — Main／renderer 负责人)
- AC7 — 复制／截图按所选 part 顺序，全文导出保留内容，删除按来源 ID 去重，fork 使用真实 checkpoints (verification: 既有受影响操作／读取测试 — 集成负责人)
- AC8 — 既有跟随／阅读锚点在前插、展开、异步媒体、resize 和竞争导航中保持 (verification: 真实浏览器／Electron 几何 — 视口负责人)
- AC9 — 压缩留在来源锚点，中断为居中分隔符，实际输出保留 (verification: 聚焦 frame／projection 及原生 compact／Stop — renderer 负责人)
- AC10 — Detach、Activity 隐藏／重显、revision 缺口、过期 attempts 和话题切换不重复观察或取消／重开工作 (verification: lease／恢复测试及 Electron — 传输负责人)
- AC11 — Home 多模型／分支及共享消费者保留行为，被替换聚合／别名／下标 ID 路径无调用者 (verification: import 审计、定向类型检查及受影响测试 — 集成负责人)
- AC12 — 焦点、选择和动态效果偏好在支持的过渡中保留，profiles 区分次数及 CPU／布局／内存 (verification: 浏览器检查及同夹具 profiles — 验证负责人)
- AC13 — 已提交完成 parts 在整段回复结束前恢复，异常退出可丢失活跃未完成 part，不重跑工具 (verification: 已填充数据库／重启测试及 runtime 验收 — Main 负责人)
- AC14 — 输入绑定后的提交事实保持不可变，放置单独关联到 run，展示事实不进入模型输入；有序历史仍可读（verification: SQLite／输入锁／模型过滤测试 — 数据／runtime 负责人）
- AC15 — 本地、queued、压缩中和外部输入使用既有统一活动／处置事实，不伪造等待消息或中断循环 (verification: 确定性矩阵及真实原生轨迹 — runtime／renderer 负责人)
- AC16 — 订阅回调观察完整已安装来源／绑定快照，不出现行／正文中间态组合 (verification: 通知期间一致性及刷新竞争测试 — 投影负责人)
- AC17 — 纯追加保留已完成 Markdown DOM 和稳定工具／part keys，交接不额外导航或丢失阅读锚点 (verification: 明确 DOM／挂载及 Electron 几何测试 — renderer／视口负责人)
- AC18 — 输入、part、工具身份跨 ack、排队升级、来源替换及重连保持稳定，新内容获得新 ID。ID 位于 Agent timeline 条目或 Home 平行 `partIds` 中，独立于 part 载荷，且不进入模型输入（verification: schema／key／来源和 Electron trace — shared／Main／渲染负责人）
- AC19 — 迁移只留一份有序 part 正文存储，保留分支／工具／文件引用及 API 组装；单 part 写入不重写其他已完成 parts／结果 (verification: 已填充迁移／事务及消费者测试 — 数据／Main 负责人)
- AC20 — 增量不写正文行，每个 part onDone 独立保存，回复完成更新终态／统计，Stop／错误保存未完成内容，不设置定时 checkpoint (verification: 明确完成／Stop／错误 SQLite 测试 — runtime／数据负责人)

## 风险

原生完成粒度及稳定身份必须来自真实来源事实，缺少能力应修复现有 adapter，而非根据 UI 时序猜测。纯 UI 输入 parts 必须排除模型输入。迁移需要保留已有用户数据及关系，大型单 part 仍有序列化成本。

细粒度订阅的相等／寿命处理错误会遮蔽元数据变化或泄漏。稳定 ID 仍可能在工具重分组时换父节点，必须保留真实状态／焦点／选择并测量几何。留存保持有界；当前状态存储不承诺历史事件查询、精确字符切分或活跃 part 零丢失恢复。参考源码和聚焦单测不证明原生指令遵循、打包行为或全平台性能。
