# aiCore 迁移 — Renderer 侧开发计划

> **设计文档**: [aiCore 后端迁移完整方案（单进程版）](https://mcnnox2fhjfq.feishu.cn/docx/I8ghdsU1zonCgMxt1aOcY06xnyf)
>
> **本地副本**: [ai-core-migration.md](./ai-core-migration.md) — Person A (DeJeune) 已将飞书文档转为 markdown
>
> **分支**: `DeJeune/aicore-to-backend` (基于 v2)
>
> **角色**: Person B — Renderer Transport + useChat
>
> **Review 修订记录**: 经过方案 review 后修正了以下问题：Mock chunk 字段名、listener 清理机制、abort 流关闭、DataUIPart 注册方式（泛型而非 dataPartSchemas）、translation schema 与 DB 一致性、Chat.tsx 双轨策略

---

## 目标

将 Renderer 侧 50+ 个 aiCore 文件替换为 2 个文件（`IpcChatTransport` + `useAiChat`），通过 IPC 通道消费 Main 进程的 AI 流式回复。

核心架构（来自设计文档）：

```
Renderer                           Main
useChat()                          AiService (lifecycle)
  → IpcChatTransport                 → AiCompletionService
    → ipcRenderer.invoke()    ──→      → streamText()
    ← ipcRenderer.on('chunk') ←──      ← UIMessageChunk stream
```

---

## 开发策略：主流程优先 + Mock 驱动

前端开发不依赖 Person A 的 Main 侧实现进度。通过在 Main 进程注册临时 Mock IPC handler，模拟 AI 流式回复，**独立跑通 Renderer 侧全链路**。

```
Mock 驱动阶段（P0-P1）✅           适配阶段（P1.5）✅         联调阶段（P2）✅       UI 优化（P3）
─────────────────────────       ──────────────────       ──────────────       ──────────
IPC Channel 定义        ✅       适配层(parts→blocks) ✅   替换 Mock ✅           组件直读 parts ✅
preload API            ✅       V2ChatContent        ✅   真实 AiService ✅       CitationBlock去Redux ✅
AiService + Mock 输出  ✅       Chat.tsx 双轨开关    ✅   端到端验证 ✅           操作全链路 ✅
共享错误类型           ✅       Redux 同步→props直传 ✅   消息持久化 ✅           Parts 直渲染 ⬜
IpcChatTransport       ✅       现有组件渲染验证     ✅   消息删除   ✅           删适配层 ⬜
共享 Schema            ✅                                Topic 双写  ✅           删旧代码 ⬜
useAiChat hook         ✅                                                       Agent 统一 ⬜
TestChat 页面验证      ✅
```

---

## 当前进度（2026-04-08 更新）

### 已完成

**P0-P1：管道搭建 + Mock 验证** — 从 Renderer 到 Main 的完整 IPC 流式通道已跑通，TestChat 临时页面验证 mock 数据正常显示。

- IPC 通道（5 个 channel）、Preload API、AiService + AiCompletionService（含 mock 输出）
- IpcChatTransport（ChatTransport 实现，IPC 事件 → ReadableStream）
- 共享 Schema（Zod 校验）、共享类型（SerializedError、CherryDataUIParts）
- useAiChat Hook（封装 useChat + IpcChatTransport）
- 单元测试 14 个通过（9 IpcChatTransport + 5 AiCompletionService）

**P1.5：适配层 + 现有页面接入** ✅ — 将 AI SDK 的新数据格式（UIMessage.parts[]）翻译为旧格式（Message + MessageBlock[]），写入 Redux，让现有 Chat 页面的渲染组件无需修改即可展示 V2 数据。手动验证通过。

- useV2MessageAdapter：UIMessage.parts[] → Message[] + MessageBlock[] 的转换函数
- V2ChatContent：桥接组件，同步适配后的数据到 Redux，挂载现有 Messages 组件
- Chat.tsx 双轨开关：`USE_V2_CHAT` 常量，`true` 时走 V2 管道，`false` 走原有逻辑
- ✅ Chat 页面开启 V2 开关，mock 数据通过现有 Message 组件正确渲染（2026-04-04 手动验证）

### 已完成：P3.1 Inputbar 桥接（发送入口切换）✅

> **目标**: 让现有 Inputbar 组件在 V2 模式下通过 `useAiChat` 发送消息，替代 Redux thunk 链路。
> 改造后 Inputbar 不再直接触发 `messageThunk.sendMessage`，而是调用 `useAiChat` 返回的 `sendMessage` / `regenerate`。
>
> **策略**: 渐进式替换 — Inputbar UI 组件不改，只替换数据流入口。V1/V2 双轨开关继续生效。
>
> **范围调整（2026-04-04）**: 经 review 后将 P3.1 拆分为"发送桥接"和"持久化"两部分。
> 持久化相关任务作为 P3.1b 单独跟踪（见下方）。

#### 现有发送链路（将被替换）

```
Inputbar.sendMessage()
  → MessagesService.getUserMessage()     构造 Message + MessageBlock[]
  → dispatch(messageThunk.sendMessage)   Redux thunk
    → streamingService.createUserMessage  持久化用户消息
    → streamingService.createAssistantMessage  创建占位
    → fetchAndProcessAssistantResponseImpl     调用 AI + 流式写入 Redux
```

#### Task 列表（发送桥接 — 现在做）

| # | Task | 涉及文件 | 说明 | 状态 |
|---|------|----------|------|------|
| 1 | `useAiChat` 扩展 options | `useAiChat.ts` | 新增 `topicId`、`assistantId` 参数，sendMessage/regenerate 自动注入 body | ✅ |
| 2 | `useAiChat` 扩展 body 传递 | `useAiChat.ts` | AI SDK 原生支持 per-call body 合并，无需额外代码 | ✅ |
| 3 | `IpcChatTransport` 透传 body | `IpcChatTransport.ts` | 已有 `...body` 展开，preload 接受 `[key: string]: unknown` | ✅ |
| 4 | `V2ChatContent` 接入真实 Inputbar | `V2ChatContent.tsx` | 替换 stub input 为真实 Inputbar，handleSendV2 桥接 useAiChat.sendMessage | ✅ |
| 5 | Inputbar 双轨发送逻辑 | `Inputbar.tsx` | 新增 `onSendV2` prop，V2 模式下调用回调而非 dispatch thunk | ✅ |
| 6 | Regenerate / Resend / Delete 迁移 | `useMessageOperations.ts` | React Context 方案：V2ChatOverridesProvider 注入 regenerate/resend/deleteMessage/deleteMessageGroup | ✅ |
| 7 | 单元测试 | `useAiChat.test.ts` | 9 个测试覆盖 config、body 注入、regenerate body 注入 | ✅ |
| 8 | 集成验证 | — | V2 开关 + 真实 Inputbar → mock 回复正确渲染（2026-04-04 手动验证） | ✅ |

#### 依赖说明

- Task 1-3 是基础层，可并行开发
- Task 4-5 依赖 Task 1-3，是 Inputbar 与 useAiChat 的桥接
- Task 6 可与 Task 4-5 并行
- Task 7-8 在功能代码完成后进行

### 阶段总览

| 阶段 | 内容 | 负责 | 状态 |
|------|------|------|------|
| P2 | AiCompletionService 接真实 aiCore | Person A | ✅ |
| P2 | 端到端验证（真实模型回复） | 双方 | ✅ |
| **P3.1b** | **消息持久化 + 操作全链路（pause/clear/edit/resend/onError）** | **Person B** | **✅** |
| **P3.2** | **组件直读 + 去 Redux**（V2BlockContext + CitationBlock 去 Redux）— 7/7 完成 | **Person B** | **✅** |
| **P3.2b** | **Parts 直渲染 — 收掉 useV2MessageAdapter + V2BlockContext 适配层** | **Person B** | **⬜** |
| **P3.2c** | **ChatSessionManager — 流实例与 UI 解耦** | **Person B** | **✅** |
| P3.3 | Agent 统一（useAiChat 加 Agent 模式） | Person B | ⬜ |
| P3.4 | 旧代码清理（50+ aiCore 文件、BlockManager、StreamingService 等） | Person B | ⬜ |

> **P3.1b 消息持久化 + 删除 + Topic 双写**
>
> **实现策略变更（2026-04-08）**: 原计划通过适配层将 `UIMessage` 转为 `Message + MessageBlock[]` 再持久化。
> 实际实现直接将 `UIMessage.parts[]` 作为 `CherryMessagePart[]` 存入 DataApi `data.parts` 字段，
> 跳过已废弃的 block 格式。这是更优的方案——新数据直接用新格式，读取侧由 `partsToBlocks` 负责向后兼容。
>
> | # | Task | 涉及文件 | 说明 | 状态 |
> |---|------|----------|------|------|
> | b1 | onFinish 持久化实现 | `V2ChatContent.tsx` | `handleFinish` 回调中直接将 `UIMessage.parts` 通过 DataApi 持久化到 SQLite，区分新对话 vs regenerate/resend | ✅ |
> | b2 | 消息树语义对齐 | `V2ChatContent.tsx`, `useMessageOperations.ts` | parentId 链接、regenerate 不重复创建 user 节点、abort→paused、单条删除 vs 级联删除、setMessages 同步 | ✅ |
> | b3 | Topic 双写 | `Topics.tsx`, `AssistantService.ts`, `TopicService.ts` | create/update/delete 双写到 SQLite，CreateTopicDto 支持客户端 id，isPinned 映射 | ✅ |
> | b4 | 操作全链路 | `useMessageOperations.ts`, `V2ChatContent.tsx`, `blocksToparts.ts` | pause→stop、clear→cascade delete root、edit→blocksToParts+PATCH、resendWithEdit→edit+resend、onError→toast | ✅ |
> | b5 | 单元测试 | `blocksToparts.test.ts`, `useAiChat.test.ts` | blocksToparts 19 tests（全 11 种 block 类型含 TOOL/CITATION）+ useAiChat 回调 5 tests | ✅ |
> | b6 | 端到端持久化验证 | — | V2 发送 → 回复 → SQLite → 重载 → 编辑 → 删除 → 清空（手动 dev 验证） | ⬜ |
> | b7 | Request status 透传 + 操作健壮性 | `useMessageOperations.ts`, `V2ChatContent.tsx`, `Inputbar.tsx`, `InputbarCore.tsx`, `MessageMenubar.tsx`, `MessageEditor.tsx` | `V2ChatOverrides.isLoading` → `requestStatus: RequestStatus`；`useTopicLoading` / `useRequestStatus` 从 context 派生；Inputbar send/pause 互斥渲染；开放 V2 编辑/删除/重新生成按钮（supportsWrites）；持久化后 setMessages 同步真实 ID（修复操作 404）；regenerate/resend 前清除旧 assistant 消息；`handleFinish` 跳过 abort 空消息持久化；根消息删除 fallback cascade；CodeBlock/Table/Messages 接入 V2BlockContext | ✅ |

> **P3.2 组件直读 parts，删除适配层**
>
> **目标**: V2 模式下，渲染组件直接消费 `UIMessage.parts[]`，不再经过 `useV2MessageAdapter` → Redux 的中转。
> 适配层和 Redux 同步仅保留给 V1 模式，V2 走 props 直传。
>
> **架构变化**:
> ```
> 旧（P1.5 适配层）:
>   useAiChat → UIMessage[] → useV2MessageAdapter → Message[] + blocks → Redux dispatch → Components(useSelector)
>
> 当前（P3.2 Task 6 完成后）:
>   useAiChat → UIMessage[] → useV2MessageAdapter → Messages(props) + V2BlockContext → Components
>                                                    ↑ 不再经过 Redux，props 直传
>
> 目标（P3.2 完成后 + 适配层删除）:
>   useAiChat → UIMessage[] → V2ChatContent props → MessageBlockRenderer(parts[]) → Block 组件
> ```
>
> **核心发现**：渲染 switch 逻辑（`Blocks/index.tsx`）与 block 来源完全解耦，只关心 `block.type` 和 typed shape。
> 如果传入结构匹配 `MessageBlock` 子类型的对象，所有叶子 Block 组件无需修改。
>
> **改动范围分析**:
>
> | 文件 | 当前数据来源 | 改动 | 复杂度 |
> |------|-------------|------|--------|
> | `Blocks/index.tsx` | Redux `messageBlocksSelectors.selectEntities` + ID lookup | 接受 `blocks: MessageBlock[]` props 替代 ID 数组 | 中 |
> | `MessageContent.tsx` | `message.blocks` (string IDs) | V2 模式传 resolved blocks 而非 IDs | 低 |
> | `MainTextBlock.tsx` | Redux `selectFormattedCitationsByBlockId` | Citation 数据从 parts 预解析传入 | 中 |
> | `CitationBlock.tsx` | Redux `state.messages.entities[block.messageId]` | `askId` 改为 prop 传入 | 低 |
> | `MessageOutline.tsx` | Redux `messageBlocksSelectors.selectEntities` | 接受 resolved blocks 或从 parts 提取 | 低 |
> | `MessageMenubar.tsx` | Redux `messageBlocksSelectors.selectEntities` | 接受 resolved blocks 作为 prop | 低 |
> | 其他叶子 Block 组件 | 纯 props | **无需修改** | — |
>
> #### Task 列表
>
> | # | Task | 涉及文件 | 说明 | 状态 |
> |---|------|----------|------|------|
> | 1 | V2BlockContext + MessageBlockRenderer 双轨 | `Blocks/index.tsx` | 新增 `V2BlockContext`、`V2BlockProvider`、`useV2BlockMap`；renderer 优先从 context 读 block，无则走 Redux | ✅ |
> | 2 | MessageContent V2 数据通路 | — | Context 方案无需改 MessageContent，中间组件全部透传 | ✅ |
> | 3 | V2ChatContent 加 V2BlockProvider | `V2ChatContent.tsx` | 用 `V2BlockProvider value={blockMap}` 包裹子树，block 数据直接注入 context | ✅ |
> | 4 | CitationBlock 去 Redux | `CitationBlock.tsx`, `MainTextBlock.tsx`, `V2Contexts.ts` | V2 模式下从 block prop / V2BlockContext 读 citation，不走 Redux；提取 V2Contexts.ts 消除循环依赖 | ✅ |
> | 5 | MessageOutline / MessageMenubar 去 Redux 读 block | `MessageOutline.tsx`, `MessageMenubar.tsx` | 同样模式：`useV2BlockMap()` + fallback Redux，下游 `blockEntities` 变量不变 | ✅ |
> | 6 | 删除 Redux 同步，Messages 走 props 直传 | `V2ChatContent.tsx`, `Messages.tsx` | Messages 新增可选 `messages` prop，V2 模式传入 adaptedMessages；V2ChatContent 删除 useEffect Redux dispatch | ✅ |
> | 7 | typecheck + 测试 | — | typecheck 通过，2813 tests 全通过（2026-04-04） | ✅ |
>
> #### 依赖说明
> - Task 1-2 是核心，必须先做
> - Task 3 依赖 Task 1-2（去掉 Redux 同步前，组件必须能直接收数据）
> - Task 4-5 可与 Task 3 并行
> - Task 6 依赖 Messages.tsx 支持 props 传入 — **已完成**（2026-04-04）
> - Task 7 贯穿全程
>
> **当前状态**: 7/7 完成 ✅。V2 模式下数据流已完全绕过 Redux：
> - 消息通过 props 直传 Messages
> - blocks 通过 V2BlockContext 直传渲染组件
> - CitationBlock / MainTextBlock 从 V2BlockContext 读 citation 数据，不走 Redux selector
> - V2Contexts.ts 提取避免循环依赖

> **P3.2c ChatSessionManager — 流实例与 UI 解耦 ✅**
>
> **问题**: V2 使用 `useChat` hook，Chat 实例存在 `useRef` 中，组件卸载（切换 topic）= 流销毁。
> keep-alive 方案（`display: none` + 同步 ref + reap timer）引入竞态条件。
> V1 无此问题——PQueue 和 Redux 均不绑定 React 组件生命周期。
>
> **根因**: 原设计文档对比 V1→V2 时只对比了功能列（流式/节流/abort），遗漏了生命周期列（流跨 topic 存活、后台完成通知）。
> "useChat 单请求 + Main 侧管理" 一行隐含假设 useChat 等价 PQueue——实际不等价。
>
> **方案**: 将 Chat 实例从 React 提升到独立 Service 层。AI SDK `@ai-sdk/react` 的 `Chat` 类公开导出，
> 可在组件外 `new Chat()`。`~registerMessagesCallback` 等方法兼容 `useSyncExternalStore`。
>
> **核心设计**:
> - `ChatSession`: 封装 Chat 实例 + 持久化逻辑 + 引用计数 + 完成标记
> - `ChatSessionManager`: 全局单例注册表（getOrCreate/retain/release），缓存 snapshot，LRU 驱逐
> - `useChatSession`: React hook，`useSyncExternalStore` 订阅，`retain`/`release` 自动管理
> - 侧边栏指示器直接订阅 `chatSessionManager.subscribe`，不再走 CacheService
>
> **useSyncExternalStore 陷阱**:
> - `subscribe` / `getSnapshot` 必须是稳定引用（箭头函数属性），否则无限 re-render
> - `getSnapshot` 必须返回缓存对象，在 `notify()` 时失效重建
>
> | # | Task | 涉及文件 | 状态 |
> |---|------|----------|------|
> | 1 | 创建 ChatSession + ChatSessionManager | `services/ChatSessionManager.ts` | ✅ |
> | 2 | 创建 useChatSession hook | `hooks/useChatSession.ts` | ✅ |
> | 3 | 持久化逻辑搬入 ChatSession | `ChatSessionManager.ts` (handleFinish) | ✅ |
> | 4 | 简化 V2ChatContent + Chat.tsx，移除 keep-alive | `V2ChatContent.tsx`, `Chat.tsx` | ✅ |
> | 5 | 侧边栏指示器对接 ChatSessionManager | `Topics.tsx` | ✅ |
> | 6 | 清理废弃代码（cache keys、keep-alive 残留） | `cacheSchemas.ts`, `Chat.tsx` | ✅ |
> | 7 | TypeScript 编译 + 测试验证 | — | ✅ (0 TS error, 294/295 tests pass) |
>
> **删除代码量**: Chat.tsx ~80 行 keep-alive 逻辑、V2ChatContent ~60 行 ref hack、cacheSchemas 2 个 v2 cache key

### 新增文件清单

| 文件 | 说明 | 阶段 |
|------|------|------|
| `src/renderer/src/transport/IpcChatTransport.ts` | ChatTransport 实现 | P0 |
| `packages/shared/ai-transport/schemas.ts` | AiStreamRequest Zod schema | P0 |
| `packages/shared/ai-transport/dataUIParts.ts` | Cherry Studio 自定义 DataUIPart 类型 | P0 |
| `packages/shared/ai-transport/index.ts` | barrel export | P0 |
| `src/renderer/src/hooks/useAiChat.ts` | 封装 useChat + IpcChatTransport | P1 |
| `src/renderer/src/hooks/useV2MessageAdapter.ts` | UIMessage.parts → Message + MessageBlock 适配层 | P1.5 |
| `src/renderer/src/pages/home/V2ChatContent.tsx` | V2 桥接组件（props 直传 Messages + V2BlockContext + 持久化） | P1.5→P3.1b |
| `src/renderer/src/utils/partsToBlocks.ts` | 共享 parts→blocks 转换（DataApi 读取 + live 适配共用） | P1.5 |
| `src/renderer/src/pages/test-chat/TestChat.tsx` | 临时测试页面（P3 删除） | P1 |
| `src/renderer/src/routes/app/test-chat.tsx` | 临时测试路由（P3 删除） | P1 |
| `src/renderer/src/transport/__tests__/IpcChatTransport.test.ts` | Transport 单元测试 | P1 |
| `src/renderer/src/utils/blocksToparts.ts` | blocks→parts 反向转换（编辑用） | P3.1b |
| `src/renderer/src/utils/__tests__/blocksToparts.test.ts` | blocksToparts 单元测试（19 tests） | P3.1b |
| `src/renderer/src/pages/home/Messages/Blocks/V2Contexts.ts` | V2Block/Parts Context 定义（消除循环依赖） | P3.2 |
| `src/renderer/src/pages/home/v2ChatMessageUtils.ts` | V2 消息合并/查找工具函数 | P3.1b |
| `src/renderer/src/pages/home/__tests__/v2ChatMessageUtils.test.ts` | v2ChatMessageUtils 单元测试（12 tests） | P3.1b |
| `src/renderer/src/services/ChatSessionManager.ts` | ChatSession + ChatSessionManager 服务层 | P3.2c |
| `src/renderer/src/hooks/useChatSession.ts` | ChatSession React 消费 hook (useSyncExternalStore) | P3.2c |

### 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/renderer/src/pages/home/Chat.tsx` | V2 双轨开关 + V2ChatContent 渲染（P3.2c 移除 keep-alive，简化为单实例 `key={topicId}`） |
| `src/renderer/src/pages/home/Messages/Messages.tsx` | 新增可选 `messages` prop，V2 模式下 props 直传绕过 Redux |
| `src/renderer/src/pages/home/Messages/Blocks/index.tsx` | 新增 V2BlockContext，双轨 block 解析 + PartsProvider |
| `src/renderer/src/pages/home/Messages/MessageOutline.tsx` | 接入 useV2BlockMap fallback |
| `src/renderer/src/pages/home/Messages/MessageMenubar.tsx` | 接入 useV2BlockMap fallback；开放 V2 编辑/删除/重新生成按钮 |
| `src/renderer/src/pages/home/Inputbar/Inputbar.tsx` | 新增 onSendV2 prop，V2 双轨发送 + Topic 双写；useRequestStatus 驱动 primaryActionMode |
| `src/renderer/src/pages/home/Tabs/components/Topics.tsx` | Topic 双写 + P3.2c 侧边栏指示器改用 `chatSessionManager.subscribe` + `useSyncExternalStore` |
| `src/renderer/src/hooks/useMessageOperations.ts` | V2ChatOverridesProvider + pause/clearTopicMessages/editMessage/regenerate/resend/delete V2 全链路；`RequestStatus` type + `useTopicLoading` / `useRequestStatus` hooks |
| `src/renderer/src/hooks/useAiChat.ts` | 新增 onError 回调选项 |
| `src/renderer/src/hooks/useTopicMessagesV2.ts` | 新增 refresh 返回值供持久化后刷新 |
| `src/renderer/src/pages/home/Messages/Blocks/CitationBlock.tsx` | V2 模式下从 block prop 读 citation，不走 Redux |
| `src/renderer/src/pages/home/Messages/Blocks/MainTextBlock.tsx` | V2 模式下从 V2BlockContext 读 citation block |
| `src/renderer/src/pages/home/Messages/Blocks/index.tsx` | context 定义提取到 V2Contexts.ts，re-export |
| `src/renderer/src/pages/home/Messages/Messages.tsx` | 移除 V2 clearTopic 过时守卫 |
| `src/renderer/src/services/AssistantService.ts` | mapLegacyTopicToDto 带上客户端 id |
| `packages/shared/data/api/schemas/topics.ts` | CreateTopicDto 支持可选 id 字段 |
| `src/main/data/services/TopicService.ts` | create 时优先使用客户端传入 id |
| `src/renderer/src/routeTree.gen.ts` | 自动生成（新增 test-chat 路由） |
| `src/renderer/src/pages/home/Inputbar/components/InputbarCore.tsx` | 新增 primaryActionMode prop，send/pause 按钮互斥渲染 |
| `src/renderer/src/pages/home/Messages/MessageEditor.tsx` | V2 模式跳过 Redux 消息查询 |
| `src/renderer/src/pages/home/Markdown/CodeBlock.tsx` | V2 模式从 useV2BlockMap context 读 block |
| `src/renderer/src/pages/home/Markdown/Table.tsx` | V2 模式从 useV2BlockMap context 读 block |
| `src/renderer/src/pages/home/Messages/Messages.tsx` | 代码块编辑事件处理支持 V2BlockContext ref |

---

## P0：通道基建 ✅

> 让 IPC 通信管道就绪。不涉及 AI 逻辑，不依赖 Person A。
> **进度**: 全部完成。0.1 + 0.2 由 Person A (commit `e4830ee`)，0.3 + 0.4 由 Person B 完成。

### 0.1 IPC Channel 常量 ✅

> **已完成** — commit `e4830ee` (Person A)

**修改文件**: `packages/shared/IpcChannel.ts`

实际添加的 channel 常量（注意：`Ai_StreamText` 改名为 `Ai_StreamRequest`）：

```typescript
// AI Stream
Ai_StreamRequest = 'ai:stream-request',  // Renderer → Main: 发起流式请求
Ai_StreamChunk = 'ai:stream-chunk',      // Main → Renderer: 推送 UIMessageChunk
Ai_StreamDone = 'ai:stream-done',        // Main → Renderer: 流结束
Ai_StreamError = 'ai:stream-error',      // Main → Renderer: 流错误
Ai_Abort = 'ai:abort',                   // Renderer → Main: 中止请求
```

### 0.2 Preload 暴露 AI API ✅

> **已完成** — commit `e4830ee` (Person A)

**修改文件**: `src/preload/index.ts`

实际实现（与计划基本一致，关键差异已标注）：

```typescript
ai: {
  streamText: (request: {
    requestId: string
    chatId: string
    trigger: 'submit-message' | 'regenerate-message'
    messageId?: string
    messages: unknown[]
    [key: string]: unknown
  }) => ipcRenderer.invoke(IpcChannel.Ai_StreamRequest, request),
  abort: (requestId: string) => ipcRenderer.send(IpcChannel.Ai_Abort, requestId),
  onStreamChunk: (callback: (data: { requestId: string; chunk: UIMessageChunk }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: { requestId: string; chunk: UIMessageChunk }) =>
      callback(data)
    ipcRenderer.on(IpcChannel.Ai_StreamChunk, listener)
    return () => ipcRenderer.removeListener(IpcChannel.Ai_StreamChunk, listener)
  },
  onStreamDone: (callback: (data: { requestId: string }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: { requestId: string }) => callback(data)
    ipcRenderer.on(IpcChannel.Ai_StreamDone, listener)
    return () => ipcRenderer.removeListener(IpcChannel.Ai_StreamDone, listener)
  },
  // ⚠️ 与计划不同: error 类型是 SerializedError 对象，不是 string
  onStreamError: (callback: (data: { requestId: string; error: SerializedError }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: { requestId: string; error: SerializedError }) =>
      callback(data)
    ipcRenderer.on(IpcChannel.Ai_StreamError, listener)
    return () => ipcRenderer.removeListener(IpcChannel.Ai_StreamError, listener)
  }
}
```

> **实现确认**:
> - `abort` 使用 `ipcRenderer.send`（单向 fire-and-forget），Main 侧 AiService 使用 `this.ipcOn()` 接收 ✅
> - `onStreamChunk/Done/Error` 返回 unsubscribe 函数 ✅
> - `onStreamError` 的 `error` 字段为 `SerializedError` 结构化对象（含 name/message/stack/i18nKey 等），**不是** 原计划中的 `string`。IpcChatTransport 实现时需注意类型适配。
```

### 0.3 IpcChatTransport ✅

**新建文件**: `src/renderer/src/transport/IpcChatTransport.ts`

实现 AI SDK 的 `ChatTransport` 接口（参考设计文档 Phase 2 Step 2.3）：

- `sendMessages`: 生成 requestId → `window.api.ai.streamText()` 发 IPC → 监听 `onStreamChunk` / `onStreamDone` / `onStreamError` → 构造 `ReadableStream<UIMessageChunk>` 返回给 `useChat`
- `reconnectToStream`: 返回 `null`（Electron IPC 不需要重连机制）
- abort: `abortSignal` 触发时调用 `window.api.ai.abort(requestId)`，**同时调用 `controller.close()` 关闭 ReadableStream**，防止 useChat 悬挂
- 清理: 流结束（done/error/abort）后调用所有 unsubscribe 函数移除 IPC listener，防止内存泄漏
- ⚠️ **错误类型适配**: `onStreamError` 传递的是 `SerializedError` 对象（来自 `packages/shared/types/error.ts`），含 `name`/`message`/`stack`/`i18nKey`/`providerContext` 等字段，需转换为 `useChat` 能理解的错误格式

**关键类型**（来自 AI SDK v6）：

```typescript
interface ChatTransport<UI_MESSAGE extends UIMessage> {
  sendMessages: (options: {
    trigger: 'submit-message' | 'regenerate-message';
    chatId: string;
    messageId: string | undefined;
    messages: UI_MESSAGE[];
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions) => Promise<ReadableStream<UIMessageChunk>>;

  reconnectToStream: (options: {
    chatId: string;
  } & ChatRequestOptions) => Promise<ReadableStream<UIMessageChunk> | null>;
}
```

### 0.4 共享 Schema ✅

**新建目录**: `packages/shared/ai-transport/`

**schemas.ts** — 请求/响应 Zod schema（参考设计文档 Step 1.16）：

```typescript
export const aiStreamRequestSchema = z.object({
  requestId: z.string(),
  chatId: z.string(),
  trigger: z.enum(['submit-message', 'regenerate-message']),
  messages: z.array(z.any()),           // UIMessage[]
  providerId: z.string(),
  modelId: z.string(),
  assistantConfig: assistantConfigSchema,
  websearchConfig: z.any().optional(),
  mcpToolIds: z.array(z.string()).optional(),
  knowledgeBaseIds: z.array(z.string()).optional(),
})
```

**dataUIParts.ts** — 自定义 DataUIPart 定义（参考设计文档 Step 3.2）：

Cherry Studio 特有的 Block 类型通过 AI SDK 的 `DataUIPart` 扩展机制承载：

| 原 Block | DataUIPart type | 说明 |
|----------|----------------|------|
| CitationMessageBlock | `data-citation` | WebSearchResponse / KnowledgeReference / MemoryItem |
| TranslationMessageBlock | `data-translation` | 翻译内容 + 源语言/目标语言 |
| VideoMessageBlock | `data-video` | 视频 URL + MIME type |
| CompactMessageBlock | `data-compact` | /compact 命令摘要 |
| CodeMessageBlock | `data-code` | 独立代码块（可选，也可合并到 TextUIPart markdown） |
| ErrorMessageBlock | `data-error` | 错误信息（持久化在消息内，不丢失） |

**index.ts** — barrel export

---

## P1：Mock + Hook + 最小 UI 接入 ✅

> 让流跑起来，在界面上看到 mock 的流式文字。
> **进度**: 全部完成。1.1 + 1.2 由 Person A，1.3 + 1.4 由 Person B 完成。

### 1.1 Mock AiService（Main 侧临时 handler） ✅

> **已完成（超预期）** — commit `e4830ee` (Person A)
>
> Person A 直接实现了正式的 `AiService`（生命周期服务）+ `AiCompletionService`，内含 mock ReadableStream 输出。
> **不再需要** 原计划中的临时 `MockAiService.ts`。

**实际实现文件**:
- `src/main/ai/AiService.ts` — 生命周期服务，注册 IPC handler，桥接 Renderer ↔ AiCompletionService
- `src/main/ai/AiCompletionService.ts` — AI 补全服务，当前为 mock 输出（Step 2 替换为真实 aiCore）
- `src/main/ai/__tests__/AiCompletionService.test.ts` — 单元测试（stream、abort、request lifecycle）
- `src/main/core/application/serviceRegistry.ts` — 已注册 AiService

**实际架构**（与设计文档一致）：
- `AiService` 使用 `this.ipcHandle()` / `this.ipcOn()` 注册 IPC，自动随生命周期清理
- `executeStream()` 同时支持 Renderer 发起和 Server-push（Channel/Agent）场景
- abort 通过 `AbortController` 管理，`ipcOn(Ai_Abort)` 触发 `completionService.abort(requestId)`
- Mock 输出: `text-start` → `text-delta` × 8 → `text-end`（80ms 间隔），支持 abort 中断

**与计划的差异**:
- 不需要手动 `new` + `ipcMain.handle`，而是 `@Injectable` + `@ServicePhase` + `@DependsOn` 声明式注册
- Mock 目前只覆盖纯文本场景；thinking/工具调用/error 场景 mock 待后续需要时补充
- 新增共享类型: `packages/shared/types/error.ts`（SerializedError + AI SDK 错误子类型）、`serializable.ts`（serializeError 工具函数）

**仍需覆盖的 Mock 场景**（后续按需补充）:

| 场景 | Mock 数据 | 状态 |
|------|----------|------|
| 纯文本回复 | text-start → text-delta × N → text-end | ✅ 已实现 |
| 用户中止 | AbortController.abort() → stream close | ✅ 已实现 |
| 带 thinking | reasoning-start → reasoning-delta × N → reasoning-end → text-start → ... | 待补充 |
| 工具调用 | tool-input-start → tool-input-available → tool-output-available → text-start → ... | 待补充 |
| 错误 | error chunk | 待补充 |

### 1.2 安装依赖 ✅

> 设计文档 Step 3.1。Person A 的 commit `6fcb821` 已添加 `@ai-sdk/react`，确认 package.json 中已存在，无需重复安装。

### 1.3 useAiChat Hook ✅

**新建文件**: `src/renderer/src/hooks/useAiChat.ts`

封装 AI SDK 的 `useChat`（参考设计文档 Phase 3 Step 3.3）：

```typescript
import { useChat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { IpcChatTransport } from '@renderer/transport/IpcChatTransport'

// 定义自定义消息类型（DataUIPart 通过泛型注册，不是 options 参数）
type CherryUIMessage = UIMessage<
  { totalTokens?: number },  // metadata 类型
  {                           // DataUIPart 类型
    citation: { type: 'web' | 'knowledge' | 'memory'; sources: Array<{ url?: string; title?: string; content?: string }> }
    translation: { content: string; targetLanguage: string; sourceLanguage?: string }
    error: { name?: string; message: string; code?: string }
    video: { url: string; mimeType?: string }
    compact: { summary: string; removedCount: number }
    code: { language: string; code: string; filename?: string }
  }
>

const transport = new IpcChatTransport()

export function useAiChat(options: UseAiChatOptions) {
  const chat = useChat<CherryUIMessage>({
    id: options.chatId,
    transport,
    messages: options.initialMessages,
    experimental_throttle: 50,
    onFinish: async ({ message, isAbort, isError }) => {
      if (!isAbort && !isError) {
        await dataApi.messages.upsert(message)
      }
    },
    onError: (error) => {
      // 错误处理
    },
  })

  return {
    ...chat,
    regenerate: (messageId: string) => chat.reload({ messageId }),
  }
}
```

> **Review 修正**:
> - DataUIPart 的注册方式是 **TypeScript 泛型** `useChat<CherryUIMessage>()`，不是 `dataPartSchemas` option。AI SDK v6 通过泛型参数推导 data part 类型。
> - `translation` schema 中的字段名改为 `content`+`targetLanguage`，与 DB 实际数据（TranslationBlock）一致，移除了设计文档中不存在于 DB 的 `originalText`/`translatedText`。
> - 补充了 `onFinish` 的 `isAbort`/`isError` 判断，避免中止或出错时也持久化。

### 1.4 Chat.tsx 最小改造 ✅

**修改文件**: `src/renderer/src/pages/home/Chat.tsx`

> **双轨共存策略**: 当前 Chat.tsx 深度耦合 Redux + ApiService，直接替换会破坏现有功能。P1 阶段采用**临时测试路由**方案：新建 `/app/test-chat` 路由，挂载一个独立的 TestChat 页面，只接入 useAiChat + Mock，不干扰现有 Chat.tsx。主流程验证通过后，P3 阶段再正式替换 Chat.tsx。

**新建文件**:
- `src/renderer/src/pages/test-chat/TestChat.tsx`（临时，P3 后删除）
- `src/renderer/src/routes/app/test-chat.tsx`（路由文件）

最小改动让主流程跑通：

1. 引入 `useAiChat` hook
2. 消息发送: `chat.sendMessage({ text: input }, { body: { providerId, modelId, assistantConfig } })`
3. 流式文字: 遍历 `chat.messages` → `message.parts` → 渲染 `TextUIPart.text`
4. 停止: `chat.stop()`
5. 重新生成: `chat.reload()`
6. 状态显示: `chat.status` 控制 loading/streaming/ready UI

**不做**：Message 组件内部改造、blocks→parts 渲染分支、旧代码删除。这些留到 P3。

---

## P2：联调验证 ✅

> 替换 Mock 为 Person A 的真实 AiService，端到端跑通。

### 2.1 替换 Mock

1. ~~从 `serviceRegistry.ts` 注销 MockAiService~~ — **不需要**，Person A 直接实现了正式的 AiService，无临时 Mock 文件
2. ~~删除 `src/main/services/ai/MockAiService.ts` 文件~~ — **不需要**，文件不存在
3. 将 `AiCompletionService.streamText()` 中的 mock ReadableStream 替换为真实 aiCore 调用 ✅ AiService 已注册到 `serviceRegistry.ts`
4. 删除临时测试路由 `/test-chat` 和 `TestChat.tsx` — ⬜ 待清理

### 2.2 端到端验证清单

- [ ] 发送消息 → 流式文字正常显示
- [ ] thinking 模型（Claude/DeepSeek）→ reasoning 部分正常显示
- [ ] 工具调用 → ToolUIPart 状态流转正常
- [ ] 用户点击停止 → abort 信号传递，流立即中止
- [ ] 重新生成 → reload 正常触发新的流
- [ ] 多窗口并发 → requestId 隔离，不串流
- [ ] 网络错误 → error chunk 正确传递到 Renderer

### 2.3 单元测试（部分完成）

- ✅ `src/renderer/src/transport/__tests__/IpcChatTransport.test.ts` — 9 个测试全过（流式、abort、error、requestId 过滤、listener 清理、body 透传、reconnect）
- ✅ `src/main/ai/__tests__/AiCompletionService.test.ts` — 5 个测试全过（Person A 已实现）
- ⬜ `src/renderer/src/hooks/__tests__/useAiChat.test.ts` — mock Transport，验证状态管理、持久化（P2 联调后补充）

---

## P3：UI 组件适配 + 清理（后续）

> 主流程跑通后，再做组件精细化和旧代码清理。
> **核心原则**：主流程跑通后，数据层（Transport → useChat → parts）已经稳定，UI 组件的优化是相对独立的工作，可以按组件逐个推进，互不阻塞。

### 3.1 Message 组件 blocks → parts 改造

参考设计文档的 MessageBlock → UIMessage.parts 映射表：

| 原 Block | AI SDK Part | 渲染组件 |
|----------|------------|---------|
| MainTextBlock | TextUIPart | 复用现有 Markdown 渲染 |
| ThinkingBlock | ReasoningUIPart | 复用现有 Thinking 折叠组件 |
| ToolBlock | ToolUIPart | 复用现有工具调用展示 |
| ImageBlock | FileUIPart (image/*) | 复用现有图片渲染 |
| FileBlock | FileUIPart | 复用现有文件卡片 |
| ErrorBlock | DataUIPart (data-error) | 复用现有错误提示 |
| TranslationBlock | DataUIPart (data-translation) | 复用现有翻译面板 |
| CitationBlock | DataUIPart (data-citation) | 复用现有引用列表 |

### 3.2 删除旧代码

- `src/renderer/src/aiCore/` — 50+ 文件
- `src/renderer/src/services/messageStreaming/` — BlockManager, StreamingService
- `src/renderer/src/types/chunk.ts` — ChunkType 枚举
- `src/renderer/src/services/ApiService.ts` 中的 AI 调用方法
- `electron.vite.config.ts` renderer 侧 `@cherrystudio/ai-core` alias
- `src/renderer/src/pages/test-chat/` — P1 临时测试路由

### 3.2.1 全局 import 清理 checklist（设计文档 Step 3.7）

逐项全局搜索，确认全部移除：

- [ ] `from.*aiCore` — renderer 侧不应再有 aiCore import
- [ ] `ChunkType` — 枚举类型引用
- [ ] `BlockManager` — 流式块管理器引用
- [ ] `AiSdkToChunkAdapter` — 旧适配器引用
- [ ] `StreamProcessingService` — 旧流处理服务
- [ ] `fetchChatCompletion` — ApiService 旧方法调用
- [ ] `AgentApiClient` — 旧 Agent SSE 客户端
- [ ] `parseAgentSSEChunk` — 旧 Agent 解析

### 3.3 Agent 统一

- `useAiChat` 添加 Agent 模式（chatId 前缀判断 + agentConfig 传递）
- 删除旧 Agent 前端代码（AgentApiClient、parseAgentSSEChunk、AgentMessageDataSource）

### 3.4 UI 组件样式迁移（独立于主流程）

> Chat 区域当前处于 **v2 UI 迁移的早中期**，styled-components + antd 与 Tailwind + Shadcn 混用。
> 数据层稳定后，每个组件都可以独立地从旧方案迁移到新方案，不影响其他组件。

#### 当前各组件样式状态

| 组件 | 当前样式方案 | antd 依赖 | Tailwind/Shadcn 状态 |
|------|------------|----------|---------------------|
| ErrorBlock | Tailwind + lucide + @cherrystudio/ui Button | 无 | **已完成** |
| MainTextBlock | Tailwind 类名 + 少量 styled-components | 无 | **部分完成** |
| ThinkingBlock | styled-components | Collapse | 未迁移 |
| ImageBlock | styled-components | Skeleton | 未迁移 |
| ToolBlock / MessageTools | styled-components | 多个 | 未迁移 |
| Message.tsx 容器 | styled-components | Divider | 未迁移 |
| MessageGroup.tsx | styled-components | Popover | 未迁移 |
| Chat.tsx 布局 | styled-components + @cherrystudio/ui Flex | 无 | 部分完成 |
| Inputbar | styled-components | 多个 | 未迁移 |

#### 迁移策略

**P1 阶段（主流程跑通）**：parts 渲染分支直接复用现有 Block 组件，只做数据适配（`UIMessagePart` → 组件 props），不改样式。

**P3 阶段（组件独立优化）**：逐个组件用 Tailwind + @cherrystudio/ui 重写，参考 ErrorBlock 已完成的模式：

- 样式用 Tailwind 类名，不再写 styled-components
- 图标统一用 lucide-react，不再用 @ant-design/icons
- 交互组件用 @cherrystudio/ui 的 Shadcn 封装（Accordion 替代 antd Collapse、Popover 替代 antd Popover 等）
- 主题变量用 `--cs-*` 命名空间（packages/ui/styles/tokens.css）

每个组件的迁移都是独立 PR，不互相依赖：

```
ThinkingBlock: antd Collapse → @cherrystudio/ui Accordion + Tailwind
ImageBlock:    antd Skeleton → @cherrystudio/ui Skeleton + Tailwind
Message.tsx:   antd Divider  → @cherrystudio/ui Divider + Tailwind
MessageGroup:  antd Popover  → @cherrystudio/ui Popover + Tailwind
Inputbar:      styled-components → Tailwind 全面替换
```

#### @cherrystudio/ui 可用组件（packages/ui）

已导出可直接替换 antd 的组件：

| antd 组件 | @cherrystudio/ui 替代 | 状态 |
|-----------|----------------------|------|
| Collapse | Accordion | 可用 |
| Popover | Popover | 可用 |
| Divider | Divider | 可用 |
| Skeleton | Skeleton | 可用 |
| Tooltip | Tooltip | 已在用 |
| Button | Button | 已在用 |
| Dialog/Modal | Dialog | 可用 |
| Drawer | Drawer | 可用 |
| Input | Input | 可用 |
| Tabs | Tabs | 可用 |

---

## AI SDK v6 技术参考

> 来源: [Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) |
> [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) |
> [useChat](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot) |
> [UIMessage](https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message)

### 1. Stream Protocol（流式协议）

所有 chunk 以 SSE 格式传输，每条为一个 JSON 对象。我们的 IpcChatTransport 不走 HTTP SSE，而是通过 IPC 直接推送同样格式的 JSON chunk。

#### 完整 chunk 类型及 JSON 格式

**控制类 chunk**:

```json
// 消息流开始 — 必须首先发送
{"type":"start","messageId":"msg_abc123"}

// 消息流结束
{"type":"finish","finishReason":"stop"}

// 错误
{"type":"error","errorText":"rate limit exceeded"}

// 中止
{"type":"abort","reason":"user cancelled"}

// Agent 步骤边界
{"type":"start-step"}
{"type":"finish-step"}

// 消息元数据（如 token usage）
{"type":"message-metadata","metadata":{"totalTokens":150}}
```

**文本类 chunk**（start/delta/end 三段式）:

```json
{"type":"text-start","id":"text_001"}
{"type":"text-delta","id":"text_001","delta":"Hello"}
{"type":"text-delta","id":"text_001","delta":", world!"}
{"type":"text-end","id":"text_001"}
```

→ 累积后生成 `TextUIPart { type: 'text', text: 'Hello, world!', state: 'done' }`

**推理类 chunk**（与文本同构）:

```json
{"type":"reasoning-start","id":"reasoning_001"}
{"type":"reasoning-delta","id":"reasoning_001","delta":"Let me think about this..."}
{"type":"reasoning-end","id":"reasoning_001"}
```

→ 累积后生成 `ReasoningUIPart { type: 'reasoning', text: '...', state: 'done' }`

**工具类 chunk**（完整生命周期）:

```json
// 1. 工具调用开始 — 携带工具名和 callId
{"type":"tool-input-start","toolCallId":"call_xyz","toolName":"getWeather"}

// 2. 参数流式输入（可选，大参数时逐步推送）
{"type":"tool-input-delta","toolCallId":"call_xyz","inputTextDelta":"{\"city\":\"San"}

// 3. 参数就绪 — input 完整可用
{"type":"tool-input-available","toolCallId":"call_xyz","toolName":"getWeather","input":{"city":"San Francisco"}}

// 4a. 执行成功 — output 就绪
{"type":"tool-output-available","toolCallId":"call_xyz","output":{"weather":"sunny","temp":72}}

// 4b. 执行失败
{"type":"tool-output-error","toolCallId":"call_xyz","errorText":"API timeout"}

// 4c. 需要用户审批（Agent 场景）
{"type":"tool-approval-request","toolCallId":"call_xyz","toolName":"deleteFile","input":{"path":"/important.txt"}}

// 4d. 用户拒绝
{"type":"tool-output-denied","toolCallId":"call_xyz"}
```

→ 生成 `ToolUIPart { type: 'tool-getWeather', toolCallId: 'call_xyz', state: 'output-available', input: {...}, output: {...} }`

**工具 state 流转**:

```
input-streaming → input-available → approval-requested(可选) → output-available / output-error / output-denied
```

**文件/来源 chunk**:

```json
// 文件
{"type":"file","url":"https://example.com/image.png","mediaType":"image/png"}

// URL 来源
{"type":"source-url","sourceId":"src_001","url":"https://example.com","title":"Example"}

// 文档来源
{"type":"source-document","sourceId":"src_002","mediaType":"application/pdf","title":"Report"}
```

**自定义数据 chunk**（DataUIPart）:

```json
// type 必须是 "data-" 前缀 + 自定义名称
{"type":"data-citation","data":{"type":"web","sources":[{"url":"...","title":"..."}]}}
{"type":"data-translation","data":{"content":"...","targetLanguage":"zh"}}
{"type":"data-error","data":{"name":"AbortError","message":"pause_placeholder"}}
```

#### chunk 与 UIMessage.parts 的对应关系

流式 chunk 是传输层的"增量事件"，`useChat` 内部自动将它们累积还原为 `UIMessage.parts` 数组：

| 流式 chunk 序列 | 累积后的 UIMessage.parts 元素 |
|-----------------|-------------------------------|
| text-start → text-delta × N → text-end | `TextUIPart { type: 'text', text, state: 'done' }` |
| reasoning-start → reasoning-delta × N → reasoning-end | `ReasoningUIPart { type: 'reasoning', text, state: 'done' }` |
| tool-input-start → tool-input-available → tool-output-available | `ToolUIPart { type: 'tool-{name}', state: 'output-available', input, output }` |
| file | `FileUIPart { type: 'file', mediaType, url }` |
| source-url | `SourceUrlUIPart { type: 'source-url', url, title }` |
| data-{name} | `DataUIPart { type: 'data-{name}', data }` |

**关键理解**：我们的 `IpcChatTransport.sendMessages()` 返回的 `ReadableStream<UIMessageChunk>` 中推送的就是这些 chunk。`useChat` 自动处理累积逻辑，我们不需要手动拼装 parts。

---

### 2. ChatTransport 接口

> 来源: [Building Custom Transports](https://ai-sdk.dev/docs/ai-sdk-ui/transport)

```typescript
interface ChatTransport<UI_MESSAGE extends UIMessage> {
  /**
   * 发送消息并返回流式响应。
   * useChat 内部调用此方法，将返回的 ReadableStream 中的 chunk 累积为 UIMessage.parts。
   */
  sendMessages(options: {
    trigger: 'submit-message' | 'regenerate-message';
    chatId: string;
    messageId: string | undefined;       // regenerate 时为目标消息 ID
    messages: UI_MESSAGE[];              // 完整消息历史
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>>;

  /**
   * 重连到已有的流（断线恢复）。
   * 返回 null 表示没有活跃的流可恢复。
   * Electron IPC 不需要此能力，直接返回 null。
   */
  reconnectToStream(options: {
    chatId: string;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk> | null>;
}
```

**内置实现对比**（帮助理解我们为什么需要自定义）：

| 实现 | 通信方式 | 适用场景 | 流式支持 | 重连 |
|------|---------|---------|---------|------|
| `DefaultChatTransport` | HTTP POST + SSE JSON | Web 应用标准场景 | JSON event stream | 支持 |
| `TextStreamChatTransport` | HTTP POST + 纯文本流 | 简单文本回复 | 纯文本 | 支持 |
| `DirectChatTransport` | 进程内直接调用 Agent | SSR/测试/单进程 | 内存流 | 不支持（返回 null） |
| **`IpcChatTransport`（我们）** | **Electron IPC** | **桌面应用跨进程** | **IPC 事件→ReadableStream** | **不支持（返回 null）** |

**我们的 IpcChatTransport 核心逻辑**：

```typescript
// 伪代码 — sendMessages 的核心实现思路
async sendMessages({ trigger, chatId, messages, abortSignal, body }) {
  const requestId = crypto.randomUUID()

  // 1. 通过 IPC invoke 发起请求（不等待响应，响应通过事件推送）
  window.api.ai.streamText({ requestId, chatId, trigger, messages, ...body })

  // 2. 收集 unsubscribe 函数，流结束后统一清理
  const cleanups: Array<() => void> = []

  // 3. 构造 ReadableStream，将 IPC 事件桥接为流
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      const cleanup = () => cleanups.forEach(fn => fn())

      // 监听 chunk 推送
      cleanups.push(window.api.ai.onStreamChunk(({ requestId: rid, chunk }) => {
        if (rid === requestId) controller.enqueue(chunk)
      }))
      // 监听结束
      cleanups.push(window.api.ai.onStreamDone(({ requestId: rid }) => {
        if (rid === requestId) { cleanup(); controller.close() }
      }))
      // 监听错误
      cleanups.push(window.api.ai.onStreamError(({ requestId: rid, error }) => {
        if (rid === requestId) { cleanup(); controller.error(new Error(error)) }
      }))
      // abort 信号传递 — 同时关闭 ReadableStream，防止 useChat 悬挂
      abortSignal?.addEventListener('abort', () => {
        window.api.ai.abort(requestId)
        cleanup()
        controller.close()
      })
    }
  })
}
```

---

### 3. useChat Hook

> 来源: [Chatbot](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)

#### 完整 API

```typescript
const {
  messages,      // UIMessage[] — 消息列表，每条含 parts 数组
  status,        // 'submitted' | 'streaming' | 'ready' | 'error'
  error,         // Error | undefined
  sendMessage,   // 发送用户消息
  stop,          // 中止当前流
  setMessages,   // 直接修改消息列表
} = useChat({
  id: 'chat-id',                    // 聊天会话 ID
  transport: ipcChatTransport,       // 我们的自定义 Transport
  messages: initialMessages,         // 初始消息（从 DB 加载）
  dataPartSchemas: {                 // 注册自定义 DataUIPart 类型
    citation: citationSchema,
    translation: translationSchema,
    error: errorSchema,
    // ...
  },
  experimental_throttle: 50,         // 节流渲染频率（ms）

  // 回调
  onFinish: ({ message, messages, isAbort, isDisconnect, isError }) => {
    // 流结束后持久化到 SQLite
  },
  onError: (error) => {
    // 请求级错误处理
  },
})
```

#### status 状态流转

```
ready → submitted → streaming → ready
                              → error → ready（重试后）
```

| status | 含义 | UI 行为 |
|--------|------|--------|
| `ready` | 空闲，可发送新消息 | 输入框可用，发送按钮可用 |
| `submitted` | 已发送，等待流开始 | 显示 loading 指示器 |
| `streaming` | 流式响应中 | 显示停止按钮，文字逐步渲染 |
| `error` | 请求失败 | 显示错误提示，可重试 |

#### sendMessage 用法

```typescript
// 基本发送
chat.sendMessage({ text: 'Hello' })

// 带附件
chat.sendMessage({
  text: 'What is in this image?',
  files: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,...' }],
})

// 带额外参数（通过 body 传递给 Transport → Main 进程）
chat.sendMessage(
  { text: 'Hello' },
  { body: { providerId: 'openai', modelId: 'gpt-4o', assistantConfig: {...} } }
)
```

#### reload（重新生成）

```typescript
// 重新生成最后一条助手消息
chat.reload()

// 重新生成指定消息（regenerate-message trigger）
chat.reload({ messageId: 'msg_xxx' })
```

#### onFinish 回调

```typescript
onFinish: ({ message, messages, isAbort, isDisconnect, isError }) => {
  // message: 本次助手回复的 UIMessage（含完整 parts）
  // messages: 当前全部消息列表
  // isAbort: 用户是否主动中止
  // isDisconnect: 是否断线
  // isError: 是否出错

  if (!isAbort && !isError) {
    // 持久化到 SQLite
    dataApi.messages.upsert(message)
  }
}
```

#### 消息元数据（metadata）

服务端可以通过 `message-metadata` chunk 附加元数据（如 token usage）：

```json
{"type":"message-metadata","metadata":{"totalTokens":150,"modelId":"gpt-4o"}}
```

客户端通过 `message.metadata` 访问：

```typescript
message.metadata?.totalTokens
```

---

### 4. UIMessage 结构

```typescript
interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: UIMessagePart[];         // 消息内容，由 chunk 累积而成
  metadata?: Record<string, any>; // 可选元数据
}

// UIMessagePart 是以下类型的联合
type UIMessagePart =
  | TextUIPart            // { type: 'text', text, state? }
  | ReasoningUIPart       // { type: 'reasoning', text, state?, providerMetadata? }
  | ToolUIPart            // { type: 'tool-{name}', toolCallId, state, input?, output? }
  | FileUIPart            // { type: 'file', mediaType, url, filename? }
  | SourceUrlUIPart       // { type: 'source-url', url, title? }
  | SourceDocumentUIPart  // { type: 'source-document', mediaType, title? }
  | DataUIPart            // { type: 'data-{name}', data }
```

#### 渲染 parts 的标准模式

```tsx
{message.parts.map((part, i) => {
  switch (part.type) {
    case 'text':
      return <MarkdownRenderer key={i} text={part.text} />
    case 'reasoning':
      return <ThinkingBlock key={i} text={part.text} />
    default:
      if (part.type.startsWith('tool-'))
        return <ToolCallBlock key={i} part={part} />
      if (part.type.startsWith('data-'))
        return <DataPartRenderer key={i} part={part} />
      return null
  }
})}
```

---

### 5. DataUIPart 扩展机制

> DataUIPart 是 AI SDK 官方提供的扩展点，用于传输标准 part 类型无法覆盖的自定义数据。

#### 类型定义

```typescript
type DataUIPart<DATA_TYPES extends UIDataTypes> = ValueOf<{
  [NAME in keyof DATA_TYPES & string]: {
    type: `data-${NAME}`;
    id?: string;
    data: DATA_TYPES[NAME];
  };
}>;
```

#### 注册方式

> **Review 修正**: AI SDK v6 的 DataUIPart 注册不是通过 `dataPartSchemas` option，而是通过 **TypeScript 泛型** `UIMessage<Metadata, DataParts>`。

```typescript
import type { UIMessage } from 'ai'

// 1. 定义自定义消息类型
type CherryUIMessage = UIMessage<
  { totalTokens?: number },  // metadata 类型
  {                           // DataUIPart 类型映射
    citation: {
      type: 'web' | 'knowledge' | 'memory'
      sources: Array<{ url?: string; title?: string; content?: string }>
    }
    translation: {
      content: string
      targetLanguage: string
      sourceLanguage?: string
    }
    error: {
      name?: string
      message: string
      code?: string
    }
    video: {
      url: string
      mimeType?: string
    }
    compact: {
      summary: string
      removedCount: number
    }
    code: {
      language: string
      code: string
      filename?: string
    }
  }
>

// 2. 传入泛型
const chat = useChat<CherryUIMessage>({ transport })

// 3. 类型安全地访问 data parts
message.parts.forEach(part => {
  if (part.type === 'data-citation') {
    part.data.sources  // 类型推导为 Array<{ url?: string; ... }>
  }
})
```

流中的 `{"type":"data-citation","data":{...}}` 会自动出现在 `message.parts` 中，TypeScript 提供完整的类型推导。

---

### 6. 对 IpcChatTransport 实现的关键约束

从 AI SDK 文档提炼的实现要点：

1. **`sendMessages` 必须返回 `ReadableStream<UIMessageChunk>`**。`useChat` 内部通过 reader 逐 chunk 读取，自动累积为 `UIMessage.parts`。我们不需要手动拼装 parts。

2. **chunk 必须以 `start` 开头、`finish` 结尾**。`useChat` 依赖这两个控制 chunk 来管理 status 状态（submitted → streaming → ready）。

3. **`reconnectToStream` 返回 null 即可**。`DirectChatTransport` 就是这样做的，Electron IPC 不需要 HTTP 重连语义。

4. **requestId 隔离**。多窗口/多会话并发时，每个流有独立 requestId，IPC listener 按 requestId 过滤，防止串流。

5. **listener 清理**。流结束（done/error）后必须移除 IPC listener，否则内存泄漏。

6. **abort 传递**。`abortSignal` 触发时调用 `window.api.ai.abort(requestId)`，Main 侧停止推送 chunk。

---

## 文件清单

### 新建

| 文件 | Phase | 说明 |
|------|-------|------|
| `src/renderer/src/transport/IpcChatTransport.ts` | P0 | ChatTransport over IPC |
| `src/renderer/src/hooks/useAiChat.ts` | P1 | useChat 封装 |
| `packages/shared/ai-transport/schemas.ts` | P0 | Zod schema |
| `packages/shared/ai-transport/dataUIParts.ts` | P0 | DataUIPart 定义 |
| `packages/shared/ai-transport/index.ts` | P0 | barrel export |
| `src/main/services/ai/MockAiService.ts` | P1 | 临时 mock（联调后删除） |

### 修改

| 文件 | Phase | 说明 |
|------|-------|------|
| `packages/shared/IpcChannel.ts` | P0 | 添加 AI stream channel |
| `src/preload/index.ts` | P0 | 添加 ai API（listener 返回 unsubscribe） |
| `src/preload/preload.d.ts` | P0 | 添加类型声明 |

### 删除（P2-P3）

| 文件/目录 | Phase | 说明 |
|-----------|-------|------|
| `src/main/services/ai/MockAiService.ts` | P2 | 联调后删除，同步注销 serviceRegistry |
| `src/renderer/src/pages/test-chat/` | P2 | 临时测试路由 |
| `src/renderer/src/aiCore/` | P3 | 50+ 文件 |
| `src/renderer/src/services/messageStreaming/` | P3 | BlockManager 等 |
| `src/renderer/src/types/chunk.ts` | P3 | ChunkType 枚举 |

### 测试

| 文件 | Phase | 说明 |
|------|-------|------|
| `src/renderer/src/transport/__tests__/IpcChatTransport.test.ts` | P2 | Transport 测试 |

---

## P3.5：UI 框架迁移 — styled-components / antd → Tailwind / @cherrystudio/ui

> **目标**：将对话渲染相关组件从旧 UI 栈（styled-components + antd）迁移到 v2 目标栈（Tailwind CSS + @cherrystudio/ui），保持组件 props 接口不变。
>
> **前置条件**：无，与 Person A 主链路完全解耦，立即可开始。
>
> **分支**：基于当前分支 `DeJeune/aicore-to-backend`，每个 Wave 独立 commit。
>
> **核心约束**：
> - 只做 UI 框架替换，**不改 props 类型**（等 P2 联调后数据模型变更再做）
> - `*.v2.ts` 后缀规则不适用 UI 组件，**原位修改**
> - Citation 渲染逻辑和 toolPermissions Redux 逻辑**暂不动**
> - 每个 Wave 完成后必须跑 `pnpm typecheck && pnpm test` 全部通过才 commit

---

### antd → @cherrystudio/ui 替换映射

| antd 组件 | 替换为 | 来源 |
|-----------|--------|------|
| `Collapse` | `Accordion` / `AccordionItem` | `@cherrystudio/ui` `primitives/accordion.tsx` |
| `Popover` | `Popover` | `@cherrystudio/ui` `primitives/popover.tsx` |
| `Skeleton` | Tailwind `animate-pulse` 自实现 | 无对应组件，两处使用场景均简单 |
| `Dropdown` | `DropdownMenu` | Shadcn standard（已在 @cherrystudio/ui 导出） |
| `Popconfirm` | `ConfirmDialog` | `@cherrystudio/ui` `composites/ConfirmDialog/` |
| `Checkbox` | `Checkbox` | `@cherrystudio/ui` `primitives/checkbox.tsx` |
| `Divider` | `Separator` | `@cherrystudio/ui` `primitives/separator.tsx` |
| `Upload` | 移除，纯展示 Tailwind | MessageAttachments 仅展示无上传需求 |
| `Image`（zoom） | 待定 | Wave 4 暂缓，需选型 |

---

### Wave 划分

#### Wave 1 — Blocks 封闭组件（影响范围最小：全部只被 `Blocks/index.tsx` 一处引用）

| # | 文件 | 工作内容 | 复杂度 |
|---|------|---------|--------|
| 1 | `Blocks/PlaceholderBlock.tsx` | 1 个 styled `MessageContentLoading` → Tailwind | 低 |
| 2 | `Blocks/index.tsx` | 1 个 styled `ImageBlockGroup` → Tailwind | 低 |
| 3 | `Blocks/MainTextBlock.tsx` | 1 个 styled `MentionTag` → Tailwind；citation 逻辑保留 | 低 |
| 4 | `Blocks/CitationBlock.tsx` | 1 个 styled `SearchEntryPoint` → Tailwind；Redux 逻辑保留 | 低 |
| 5 | `Blocks/ImageBlock.tsx` | 1 个 styled `Container` + antd `Skeleton` → Tailwind `animate-pulse` | 低 |
| 6 | `Blocks/ThinkingBlock.tsx` | 3 个 styled + antd `Collapse` → `Accordion` | 中 |
| 7 | `Blocks/CompactBlock.tsx` | 8 个 styled + antd `Collapse` → `Accordion` | 中 |
| 8 | `Blocks/ToolBlockGroup.tsx` | 6 个 styled + antd `Collapse` → `Accordion`；toolPermissions 逻辑保留 | 中 |

**Wave 1 验收标准**：
- `pnpm typecheck` 通过
- `pnpm test` 通过（Blocks 有 `__tests__/` 单元测试需全绿）
- V2 模式下（`USE_V2_CHAT=true`）启动 app，所有 block 类型视觉正常
- ThinkingBlock / CompactBlock / ToolBlockGroup 折叠展开功能正常

---

#### Wave 2 — 骨架层封闭组件（引用方全在骨架层内部）

| # | 文件 | 工作内容 | 复杂度 |
|---|------|---------|--------|
| 9 | `Messages/MessageOutline.tsx` | 5 个 styled → Tailwind | 低 |
| 10 | `Messages/MessageTokens.tsx` | 1 个 styled + antd `Popover` → Shadcn `Popover` | 低 |
| 11 | `Messages/MessageHeader.tsx` | 5 个 styled + antd `Checkbox` → Shadcn `Checkbox` | 中 |
| 12 | `Messages/MessageMenubar.tsx` | 2 个 styled + antd `Dropdown` / `Popconfirm` → `DropdownMenu` / `ConfirmDialog` | 中 |
| 13 | `Messages/MessageAttachments.tsx` | 2 个 styled + antd `Upload` → 纯展示 Tailwind | 中 |
| 14 | `Messages/CitationsList.tsx` | 13 个 styled + antd `Popover` × 2 / `Skeleton` → Tailwind + Shadcn `Popover` | 高 |

**Wave 2 验收标准**：
- `pnpm typecheck` + `pnpm test` 通过
- 消息菜单栏全部操作（复制 / 重生成 / 删除 / 翻译等）功能正常
- 多选模式（MessageHeader Checkbox）正常
- MessageOutline 大纲导航正常

---

#### Wave 3 — 骨架核心（跨模块引用，需多窗口验证）

| # | 文件 | 工作内容 | 跨模块引用 | 复杂度 |
|---|------|---------|-----------|--------|
| 15 | `Messages/MessageContent.tsx` | 1 个 styled → Tailwind | mini 窗口、划词窗口 | 低 |
| 16 | `Messages/Messages.tsx` | 1 个 styled `LoaderContainer` → Tailwind | mini 窗口 | 低 |
| 17 | `Messages/MessageGroup.tsx` | 3 个 styled + antd `Popover` → Shadcn `Popover` | AgentSessionMessages | 中 |
| 18 | `Messages/Message.tsx` | 4 个 styled + antd `Divider` → `Separator` | mini / 划词 / 历史 / Agent，**引用最广** | 中 |

**Wave 3 验收标准**：
- `pnpm typecheck` + `pnpm test` 通过
- 主对话页（普通 + V2 模式）视觉正常
- **mini 窗口** 消息渲染正常
- **划词窗口**（ActionGeneral / ActionTranslate）正常
- **历史记录页** TopicMessages 正常
- **Agent 对话页** AgentSessionMessages 正常

---

#### Wave 4 — 遗留高复杂度（暂缓）

| 文件 | 暂缓原因 |
|------|---------|
| `Messages/MessageImage.tsx` | antd `Image` 内置 zoom 功能无直接替换，需选型决策后再做 |
| `Blocks/CitationBlock.tsx` citation 渲染逻辑 | 等后端 parts 结构（data-citation）确定后一并重写 |

---

### Agent Teams 执行流程

```
主 Agent（协调 + 向用户汇报）
│
├── Wave N 启动
│   ├── 向用户报告：本波次目标文件、分配方案、验收标准
│   │
│   ├── 并行派发 Worker Agents（worktree 隔离）
│   │   ├── Worker A：读原文件 → 替换 styled/antd → 写回（1-2 个文件）
│   │   ├── Worker B：读原文件 → 替换 styled/antd → 写回（1-2 个文件）
│   │   └── Worker C：...
│   │
│   ├── 所有 Worker 完成 → 并行派发 Code Review Agents
│   │   └── Review Agent（每个改动文件一个）：
│   │       ✓ 无残留 styled-components import
│   │       ✓ 无残留 antd import（Citation / toolPermissions 例外已标注）
│   │       ✓ Tailwind 类名语义正确，无魔法数字
│   │       ✓ props 接口签名未变更
│   │       ✓ 无新增 console.log / any 类型
│   │
│   ├── Review 全部通过 → 派发 Test Agent
│   │   └── Test Agent：pnpm typecheck && pnpm test
│   │       ✓ 全部通过 → 主 Agent 汇报 Wave N 完成，请求用户确认
│   │       ✗ 有失败 → 主 Agent 分析错误，派发修复 Worker → 重新 Review + Test
│   │
│   └── 用户确认 → commit（conventional commit 格式）→ 启动 Wave N+1
```

---

### 进度追踪

| Wave | 状态 | 完成时间 |
|------|------|---------|
| Wave 1 — Blocks 封闭组件（8 个文件） | ⬜ 未开始 | — |
| Wave 2 — 骨架层封闭组件（6 个文件） | ⬜ 未开始 | — |
| Wave 3 — 骨架核心，跨模块（4 个文件） | ⬜ 未开始 | — |
| Wave 4 — 遗留高复杂度 | ⏸ 暂缓 | — |
| `src/renderer/src/hooks/__tests__/useAiChat.test.ts` | P2 | Hook 测试 |
