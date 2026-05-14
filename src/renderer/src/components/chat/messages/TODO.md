我读完 README 后，下一步重构重点很明确：**继续让 `components/chat/messages` 只负责显示，不直接知道 Home/Agent/模型/语言/平台副作用这些业务能力。**

当前还残留的主要问题：

- `MessageMenuBar.tsx` 还直接 `useLanguages()`、`useModelById()`。
- `MessageFrame.tsx`、`MessageEditor.tsx` 还直接 `useAssistant()`。
- `ErrorBlock.tsx` 还直接用 `dataApiService/cacheService` 做 AI 诊断和 message patch。
- Provider 还是一个大 Context，`partsByMessageId` 这类高频数据变化会带动很多低频组件 render。
- `MessageMenuBar` 仍是大分支 UI，还没有真正 action-registry 化。
- Adapter 还放在 `messages/adapters` 内，短期可以接受，但长期最好把 Home/Agent 业务 wiring 往页面侧移。

**下一步建议分 6 步走。**

**Step 1：清掉 shared frame/menu/editor 的业务 hook**
目标：`frame/` 里的 shared 组件不再直接 import `useAssistant/useModelById/useLanguages`。

改法：

- `MessageListState` 增加当前可显示模型/助手/语言需要的 render-only 数据。
- `MessageListActions` 增加必要能力，例如：
  - `getLanguageLabel`
  - `getModelById` 或直接提供 `modelsById`
  - `setMessageModel`
  - `getAssistantProfile`
- Home adapter 提供完整能力。
- Agent/History 不提供写能力时，UI 自动隐藏或降级。
- `MessageMenuBar`、`MessageFrame`、`MessageEditor` 只读 provider，不再直接调业务 hook。

验收：

```bash
rg "useAssistant|useModelById|useLanguages" src/renderer/src/components/chat/messages/frame
```

应该清零，或者只剩 adapter。

**Step 2：拆 `MessageListProvider`，降低重渲染范围**
目标：解决你刚才担心的 Provider 性能问题。

现在是一个大 context：

```ts
{ state, actions, meta }
```

建议拆成：

- `MessageListDataContext`：`topic/messages/hasOlder/listKey`
- `MessagePartsContext`：`partsByMessageId`
- `MessageActionsContext`：稳定 actions
- `MessageRenderConfigContext`：字体、narrow、样式配置
- `MessageSelectionContext`：多选状态
- `MessageRuntimeContext`：scroll/runtime 绑定

这样 streaming parts 更新时，尽量只影响内容渲染，不影响 header、menu、selection、layout。

验收：

- `MessageMenuBar` 不因为 `partsByMessageId` 整体变化而跟着整树刷新。
- `MessageHeader` 不依赖完整 provider value。
- `MessagePartsRenderer` 仍能拿到最新 parts。

**Step 3：把 `MessageMenuBar` 迁到 ActionRegistry**
目标：菜单可见性完全 capability-driven，删除大段 `buttonRenderers/menuItems` 条件分支。

分两阶段做：

1. 保持 UI 不变，只把每个按钮注册成 action：
   - copy
   - edit
   - delete
   - regenerate
   - fork
   - translate
   - export markdown
   - export word
   - save to knowledge
   - trace
2. `messageMenuBar.ts` 只保留 ordering/surface 配置。

验收：

- `MessageMenuBar.tsx` 不再有大量业务判断。
- 是否显示按钮只看 action availability。
- Agent/History 缺写能力时，编辑/删除/重试自然不显示。

**Step 4：把 `ErrorBlock` 诊断逻辑下沉成 capability**
目标：`blocks/ErrorBlock.tsx` 不直接碰 `dataApiService/cacheService`。

新增 provider action：

```ts
diagnoseError?(message, part): Promise<DiagnosisResult>
persistMessageParts?(messageId, parts): Promise<void>
```

Home adapter 实现 AI 诊断缓存和 patch。
Agent/History 可以不实现，ErrorBlock 就只显示原始错误。

验收：

```bash
rg "dataApiService|cacheService" src/renderer/src/components/chat/messages/blocks/ErrorBlock.tsx
```

清零。

**Step 5：梳理 `stream/` 和 runtime 事件边界**
目标：`messages` 可以显示 streaming parts，但不直接承担 Home 的聊天生命周期。

保留在 shared messages 内：

- `partsByMessageId` overlay helper
- `PartsProvider`
- block renderer

逐步外移或 adapter 化：

- `ExecutionStreamCollector` 是否应该留在 Home side
- `EventEmitter` runtime binding 是否应从 adapter 挪到 page wiring
- `bindRuntime/bindMessageRuntime` 是否改成显式 refs/actions

验收：

- shared list 不直接知道 `SEND_MESSAGE/CLEAR_MESSAGES/NEW_CONTEXT` 这些 Home event。
- Home 页面负责把外部事件转成 provider action。

**Step 6：整理 adapter 归属**
目标：README 说 adapter 可以在 `messages/adapters`，但长期更清晰的是：shared contract 留在 `messages`，业务 assembly 回到页面侧。

建议最终结构：

```txt
components/chat/messages/
  MessageList.tsx
  MessageListProvider.tsx
  types.ts
  frame/
  blocks/
  list/
  tools/

pages/home/messages/
  homeMessageListAdapter.tsx

pages/agents/messages/
  agentMessageListAdapter.ts
```

这样 shared 目录更干净，业务 import 更不容易回流。

验收：

```bash
rg "@renderer/hooks|@data|EventEmitter|window\\.api" src/renderer/src/components/chat/messages
```

最终 shared core 基本清零；只允许 markdown/oembed 这类纯显示依赖，或者明确记录例外。
