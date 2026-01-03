# Inputbar 架构说明

本文档描述 `src/renderer/src/pages/home/Inputbar` 的组件分层、状态模型与工具系统，覆盖 Chat 与 Agent Session 两种输入栏形态。

## 目标与边界

- 输入栏是消息编辑与发送的入口，负责文本输入、附件处理、工具入口与快捷面板触发。
- 业务逻辑尽量由外层容器注入，`InputbarCore` 保持 UI 框架与交互通用能力。
- Tool 系统以注册表驱动，可在不同 scope 下显示不同工具与 QuickPanel 行为。

## 目录结构与职责

- `Inputbar.tsx`：Chat 模式输入栏容器，负责消息发送、topic 操作、token 估算、知识库/模型提及等业务逻辑。
- `AgentSessionInputbar.tsx`：Agent Session 模式输入栏容器，适配会话数据与 slash commands，发送逻辑与 Chat 不同。
- `components/InputbarCore.tsx`：核心 UI 与交互容器，集成文本区、工具栏、拖拽/粘贴、快捷面板触发。
- `context/InputbarToolsProvider.tsx`：输入栏共享状态与工具注册中心（工具状态、触发器、root menu）。
- `InputbarTools.tsx`：工具栏渲染与编排，处理工具排序、隐藏/显示、拖拽排序、QuickPanel 注册。
- `hooks/`：输入栏交互 hooks（粘贴、拖拽等）。
- `tools/`：工具定义与 QuickPanel 触发配置，注册到工具系统。
- `types.ts`、`registry.ts`：scope 定义、工具类型与注册表、scope 配置。

## 核心分层

1) **容器层（Inputbar / AgentSessionInputbar）**
   - 负责业务逻辑、消息发送、topic 操作、模型能力判断。
   - 构建 `InputbarToolsProvider` 的初始 state 与 actions，供工具使用。

2) **基础 UI 层（InputbarCore）**
   - 仅依赖 props 和共享上下文，不直接关心业务状态来源。
   - 处理：文本编辑、拖拽/粘贴、快捷面板触发、翻译快捷、附件预览。

3) **工具系统层（InputbarToolsProvider + InputbarTools + tools/）**
   - `InputbarToolsProvider` 提供状态与 dispatch，并维护 QuickPanel trigger/root menu 注册表。
   - `InputbarTools` 读取工具定义并渲染按钮，维护工具排序与可见性。
   - `tools/` 使用 `defineTool` 声明依赖、条件、QuickPanel 触发与渲染组件。

## Scope 与配置

- `types.ts` 定义 `InputbarScope`，主要是 `TopicType.Chat`、`TopicType.Session`、`mini-window`。
- `registry.ts` 为不同 scope 提供配置：行数、工具可折叠、QuickPanel/拖拽开关等。
- `InputbarCore` 根据 scope 读取配置，实现通用行为差异。

## 主要数据流

### Chat 模式（`Inputbar.tsx`）

1. 初始化：从 `CacheService` 读取草稿、读取上次 `mentionedModels` 缓存。
2. 输入状态：`useInputText` 管理文本，`useTextareaResize` 管理高度。
3. 发送消息：
   - 上传文件 `FileManager.uploadFiles`。
   - 构造 `MessageInputBaseParams`，估算 token 用量。
   - `dispatch(_sendMessage)`，清空文本与附件。
4. 快捷操作：新 topic、清空 topic、切换上下文等通过 EventEmitter 广播。
5. 能力判定：基于模型支持能力决定是否支持图片/文本文件与 Web Search。

### Agent Session 模式（`AgentSessionInputbar.tsx`）

1. 从 `useSession` 获取 session，构建 `assistantStub`。
2. 使用 `useInputText` + `CacheService` 做草稿缓存。
3. 发送消息：
   - 不上传文件，将文件路径拼接进消息文本。
   - 使用 `dispatchSendMessage` 与 session context。
4. Slash commands：通过 QuickPanel 直接显示命令列表并插入输入框。

## InputbarCore 交互能力

- **粘贴**：`usePasteHandler` 调用 `PasteService.handlePaste` 处理文本/图片/文件。
- **拖拽**：`useFileDragDrop` 处理文件与文本拖拽、扩展名过滤。
- **快捷面板**：
  - 使用 `QuickPanelReservedSymbol` (`/` root, `@` mention) 触发。
  - 根据输入边界与光标位置判断是否打开或恢复面板。
- **输入键位**：
  - Enter 发送（按设置快捷键），Shift+Enter 换行。
  - Esc 退出扩展输入。
- **附件处理**：
  - `AttachmentPreview` 渲染附件 tag。
  - `Backspace` 清除最后一个附件。

## InputbarToolsProvider 结构

- **State**：`files`、`mentionedModels`、`selectedKnowledgeBases`、`isExpanded`。
- **Derived State**：`couldAddImageFile`、`couldMentionNotVisionModel`、`extensions`。
- **Actions**：由容器层注入（resize、clearTopic、newContext、onTextChange 等）。
- **Registry**：
  - `registerRootMenu`：收集 `/` 根菜单条目。
  - `registerTrigger`：注册 QuickPanel 的 symbol 触发器。
  - `emit` + `getRootMenu` 提供给 `InputbarCore`。

## 工具系统设计

- `tools/index.ts` 负责导入并注册所有工具。
- `defineTool` 声明：
  - `visibleInScopes`：控制 scope 可见性。
  - `condition`：按能力/状态过滤。
  - `dependencies`：限定可访问的 state/actions，避免上下文滥用。
  - `quickPanel`：声明 root menu 与 trigger 逻辑。
  - `render`：返回按钮 UI（null 表示纯菜单贡献）。

### 典型工具

- `attachmentTool`：上传文件，依赖 `files/extension`。
- `mentionModelsTool`：@ 模型选择与 QuickPanel 管理。
- `knowledgeBaseTool`：知识库选择，条件为模型支持工具或 prompt tool。
- `newTopicTool` / `clearTopicTool` / `newContextTool`：topic 操作。
- `toggleExpandTool`：折叠与展开输入框。
- `slashCommandsTool`（Session）：Slash 命令入口与触发器。

## 关键 UI 组件

- `AttachmentPreview.tsx`：附件 tag 与预览/上下文菜单。
- `KnowledgeBaseInput.tsx`：知识库 tag 列表。
- `MentionModelsInput.tsx`：模型 tag 列表。
- `TokenCount.tsx`：输入与上下文 token 显示。
- `SendMessageButton.tsx`：发送按钮。

## 交互与扩展建议

- 新增工具：在 `tools/` 创建并 `registerTool`，再由 `tools/index.ts` 引入。
- QuickPanel 扩展：优先通过 `quickPanel` 声明式配置注册菜单与触发。
- 若工具需要 hooks：使用 `quickPanelManager` 组件注入。

## 相关文件

- `src/renderer/src/pages/home/Inputbar/Inputbar.tsx`
- `src/renderer/src/pages/home/Inputbar/AgentSessionInputbar.tsx`
- `src/renderer/src/pages/home/Inputbar/components/InputbarCore.tsx`
- `src/renderer/src/pages/home/Inputbar/context/InputbarToolsProvider.tsx`
- `src/renderer/src/pages/home/Inputbar/InputbarTools.tsx`
- `src/renderer/src/pages/home/Inputbar/tools/`
- `src/renderer/src/pages/home/Inputbar/types.ts`
- `src/renderer/src/pages/home/Inputbar/registry.ts`
