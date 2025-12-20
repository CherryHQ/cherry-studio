# 消息系统

本文档介绍 Cherry Studio 的消息系统架构，包括消息生命周期、状态管理和操作接口。

## 消息的生命周期

![消息生命周期](../../assets/images/message-lifecycle.png)

---

# messageBlock.ts 使用指南

该文件定义了用于管理应用程序中所有 `MessageBlock` 实体的 Redux Slice。它使用 Redux Toolkit 的 `createSlice` 和 `createEntityAdapter` 来高效地处理规范化的状态，并提供了一系列 actions 和 selectors 用于与消息块数据交互。

## 核心目标

- **状态管理**: 集中管理所有 `MessageBlock` 的状态。`MessageBlock` 代表消息中的不同内容单元（如文本、代码、图片、引用等）。
- **规范化**: 使用 `createEntityAdapter` 将 `MessageBlock` 数据存储在规范化的结构中（`{ ids: [], entities: {} }`），这有助于提高性能和简化更新逻辑。
- **可预测性**: 提供明确的 actions 来修改状态，并通过 selectors 安全地访问状态。

## 关键概念

- **Slice (`createSlice`)**: Redux Toolkit 的核心 API，用于创建包含 reducer 逻辑、action creators 和初始状态的 Redux 模块。
- **Entity Adapter (`createEntityAdapter`)**: Redux Toolkit 提供的工具，用于简化对规范化数据的 CRUD（创建、读取、更新、删除）操作。它会自动生成 reducer 函数和 selectors。
- **Selectors**: 用于从 Redux store 中派生和计算数据的函数。Selectors 可以被记忆化（memoized），以提高性能。

## State 结构

`messageBlocks` slice 的状态结构由 `createEntityAdapter` 定义，大致如下：

```typescript
{
  ids: string[]; // 存储所有 MessageBlock ID 的有序列表
  entities: { [id: string]: MessageBlock }; // 按 ID 存储 MessageBlock 对象的字典
  loadingState: 'idle' | 'loading' | 'succeeded' | 'failed'; // (可选) 其他状态，如加载状态
  error: string | null; // (可选) 错误信息
}
```

## Actions

该 slice 导出以下 actions (由 `createSlice` 和 `createEntityAdapter` 自动生成或自定义)：

- **`upsertOneBlock(payload: MessageBlock)`**:

  - 添加一个新的 `MessageBlock` 或更新一个已存在的 `MessageBlock`。如果 payload 中的 `id` 已存在，则执行更新；否则执行插入。

- **`upsertManyBlocks(payload: MessageBlock[])`**:

  - 添加或更新多个 `MessageBlock`。常用于批量加载数据（例如，加载一个 Topic 的所有消息块）。

- **`removeOneBlock(payload: string)`**:

  - 根据提供的 `id` (payload) 移除单个 `MessageBlock`。

- **`removeManyBlocks(payload: string[])`**:

  - 根据提供的 `id` 数组 (payload) 移除多个 `MessageBlock`。常用于删除消息或清空 Topic 时清理相关的块。

- **`removeAllBlocks()`**:

  - 移除 state 中的所有 `MessageBlock` 实体。

- **`updateOneBlock(payload: { id: string; changes: Partial<MessageBlock> })`**:

  - 更新一个已存在的 `MessageBlock`。`payload` 需要包含块的 `id` 和一个包含要更改的字段的 `changes` 对象。

- **`setMessageBlocksLoading(payload: 'idle' | 'loading')`**:

  - (自定义) 设置 `loadingState` 属性。

- **`setMessageBlocksError(payload: string)`**:
  - (自定义) 设置 `loadingState` 为 `'failed'` 并记录错误信息。

**使用示例 (在 Thunk 或其他 Dispatch 的地方):**

```typescript
import { upsertOneBlock, removeManyBlocks, updateOneBlock } from './messageBlock'
import store from './store' // 假设这是你的 Redux store 实例

// 添加或更新一个块
const newBlock: MessageBlock = {
  /* ... block data ... */
}
store.dispatch(upsertOneBlock(newBlock))

// 更新一个块的内容
store.dispatch(updateOneBlock({ id: blockId, changes: { content: 'New content' } }))

// 删除多个块
const blockIdsToRemove = ['id1', 'id2']
store.dispatch(removeManyBlocks(blockIdsToRemove))
```

## Selectors

该 slice 导出由 `createEntityAdapter` 生成的基础 selectors，并通过 `messageBlocksSelectors` 对象访问：

- **`messageBlocksSelectors.selectIds(state: RootState): string[]`**: 返回包含所有块 ID 的数组。
- **`messageBlocksSelectors.selectEntities(state: RootState): { [id: string]: MessageBlock }`**: 返回块 ID 到块对象的映射字典。
- **`messageBlocksSelectors.selectAll(state: RootState): MessageBlock[]`**: 返回包含所有块对象的数组。
- **`messageBlocksSelectors.selectTotal(state: RootState): number`**: 返回块的总数。
- **`messageBlocksSelectors.selectById(state: RootState, id: string): MessageBlock | undefined`**: 根据 ID 返回单个块对象，如果找不到则返回 `undefined`。

**此外，还提供了一个自定义的、记忆化的 selector：**

- **`selectFormattedCitationsByBlockId(state: RootState, blockId: string | undefined): Citation[]`**:
  - 接收一个 `blockId`。
  - 如果该 ID 对应的块是 `CITATION` 类型，则提取并格式化其包含的引用信息（来自网页搜索、知识库等），进行去重和重新编号，最后返回一个 `Citation[]` 数组，用于在 UI 中显示。
  - 如果块不存在或类型不匹配，返回空数组 `[]`。
  - 这个 selector 封装了处理不同引用来源（Gemini, OpenAI, OpenRouter, Zhipu 等）的复杂逻辑。

**使用示例 (在 React 组件或 `useSelector` 中):**

```typescript
import { useSelector } from 'react-redux'
import { messageBlocksSelectors, selectFormattedCitationsByBlockId } from './messageBlock'
import type { RootState } from './store'

// 获取所有块
const allBlocks = useSelector(messageBlocksSelectors.selectAll)

// 获取特定 ID 的块
const specificBlock = useSelector((state: RootState) => messageBlocksSelectors.selectById(state, someBlockId))

// 获取特定引用块格式化后的引用列表
const formattedCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, citationBlockId))

// 在组件中使用引用数据
// {formattedCitations.map(citation => ...)}
```

## 集成

`messageBlock.ts` slice 通常与 `messageThunk.ts` 中的 Thunks 紧密协作。Thunks 负责处理异步逻辑（如 API 调用、数据库操作），并在需要时 dispatch `messageBlock` slice 的 actions 来更新状态。例如，当 `messageThunk` 接收到流式响应时，它会 dispatch `upsertOneBlock` 或 `updateOneBlock` 来实时更新对应的 `MessageBlock`。同样，删除消息的 Thunk 会 dispatch `removeManyBlocks`。

理解 `messageBlock.ts` 的职责是管理**状态本身**，而 `messageThunk.ts` 负责**触发状态变更**的异步流程，这对于维护清晰的应用架构至关重要。

---

# messageThunk.ts 使用指南

该文件包含用于管理应用程序中消息流、处理助手交互以及同步 Redux 状态与 IndexedDB 数据库的核心 Thunk Action Creators。主要围绕 `Message` 和 `MessageBlock` 对象进行操作。

## 核心功能

1.  **发送/接收消息**: 处理用户消息的发送，触发助手响应，并流式处理返回的数据，将其解析为不同的 `MessageBlock`。
2.  **状态管理**: 确保 Redux store 中的消息和消息块状态与 IndexedDB 中的持久化数据保持一致。
3.  **消息操作**: 提供删除、重发、重新生成、编辑后重发、追加响应、克隆等消息生命周期管理功能。
4.  **Block 处理**: 动态创建、更新和保存各种类型的 `MessageBlock`（文本、思考过程、工具调用、引用、图片、错误、翻译等）。

## 主要 Thunks

以下是一些关键的 Thunk 函数及其用途：

1.  **`sendMessage(userMessage, userMessageBlocks, assistant, topicId)`**

    - **用途**: 发送一条新的用户消息。
    - **流程**:
      - 保存用户消息 (`userMessage`) 及其块 (`userMessageBlocks`) 到 Redux 和 DB。
      - 检查 `@mentions` 以确定是单模型响应还是多模型响应。
      - 创建助手消息(们)的存根 (Stub)。
      - 将存根添加到 Redux 和 DB。
      - 将核心处理逻辑 `fetchAndProcessAssistantResponseImpl` 添加到该 `topicId` 的队列中以获取实际响应。
    - **Block 相关**: 主要处理用户消息的初始 `MessageBlock` 保存。

2.  **`fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistant, assistantMessage)`**

    - **用途**: (内部函数) 获取并处理单个助手响应的核心逻辑，被 `sendMessage`, `resend...`, `regenerate...`, `append...` 等调用。
    - **流程**:
      - 设置 Topic 加载状态。
      - 准备上下文消息。
      - 调用 `fetchChatCompletion` API 服务。
      - 使用 `createStreamProcessor` 处理流式响应。
      - 通过各种回调 (`onTextChunk`, `onThinkingChunk`, `onToolCallComplete`, `onImageGenerated`, `onError`, `onComplete` 等) 处理不同类型的事件。
    - **Block 相关**:
      - 根据流事件创建初始 `UNKNOWN` 块。
      - 实时创建和更新 `MAIN_TEXT` 和 `THINKING` 块，使用 `throttledBlockUpdate` 和 `throttledBlockDbUpdate` 进行节流更新。
      - 创建 `TOOL`, `CITATION`, `IMAGE`, `ERROR` 等类型的块。
      - 在事件完成时（如 `onTextComplete`, `onToolCallComplete`）将块状态标记为 `SUCCESS` 或 `ERROR`，并使用 `saveUpdatedBlockToDB` 保存最终状态。
      - 使用 `handleBlockTransition` 管理非流式块（如 `TOOL`, `CITATION`）的添加和状态更新。

3.  **`loadTopicMessagesThunk(topicId, forceReload)`**

    - **用途**: 从数据库加载指定主题的所有消息及其关联的 `MessageBlock`。
    - **流程**:
      - 从 DB 获取 `Topic` 及其 `messages` 列表。
      - 根据消息 ID 列表从 DB 获取所有相关的 `MessageBlock`。
      - 使用 `upsertManyBlocks` 将块更新到 Redux。
      - 将消息更新到 Redux。
    - **Block 相关**: 负责将持久化的 `MessageBlock` 加载到 Redux 状态。

4.  **删除 Thunks**

    - `deleteSingleMessageThunk(topicId, messageId)`: 删除单个消息及其所有 `MessageBlock`。
    - `deleteMessageGroupThunk(topicId, askId)`: 删除一个用户消息及其所有相关的助手响应消息和它们的所有 `MessageBlock`。
    - `clearTopicMessagesThunk(topicId)`: 清空主题下的所有消息及其所有 `MessageBlock`。
    - **Block 相关**: 从 Redux 和 DB 中移除指定的 `MessageBlock`。

5.  **重发/重新生成 Thunks**

    - `resendMessageThunk(topicId, userMessageToResend, assistant)`: 重发用户消息。会重置（清空 Block 并标记为 PENDING）所有与该用户消息关联的助手响应，然后重新请求生成。
    - `resendUserMessageWithEditThunk(topicId, originalMessage, mainTextBlockId, editedContent, assistant)`: 用户编辑消息内容后重发。先更新用户消息的 `MAIN_TEXT` 块内容，然后调用 `resendMessageThunk`。
    - `regenerateAssistantResponseThunk(topicId, assistantMessageToRegenerate, assistant)`: 重新生成单个助手响应。重置该助手消息（清空 Block 并标记为 PENDING），然后重新请求生成。
    - **Block 相关**: 删除旧的 `MessageBlock`，并在重新生成过程中创建新的 `MessageBlock`。

6.  **`appendAssistantResponseThunk(topicId, existingAssistantMessageId, newModel, assistant)`**

    - **用途**: 在已有的对话上下文中，针对同一个用户问题，使用新选择的模型追加一个新的助手响应。
    - **流程**:
      - 找到现有助手消息以获取原始 `askId`。
      - 创建使用 `newModel` 的新助手消息存根（使用相同的 `askId`）。
      - 添加新存根到 Redux 和 DB。
      - 将 `fetchAndProcessAssistantResponseImpl` 添加到队列以生成新响应。
    - **Block 相关**: 为新的助手响应创建全新的 `MessageBlock`。

7.  **`cloneMessagesToNewTopicThunk(sourceTopicId, branchPointIndex, newTopic)`**

    - **用途**: 将源主题的部分消息（及其 Block）克隆到一个**已存在**的新主题中。
    - **流程**:
      - 复制指定索引前的消息。
      - 为所有克隆的消息和 Block 生成新的 UUID。
      - 正确映射克隆消息之间的 `askId` 关系。
      - 复制 `MessageBlock` 内容，更新其 `messageId` 指向新的消息 ID。
      - 更新文件引用计数（如果 Block 是文件或图片）。
      - 将克隆的消息和 Block 保存到新主题的 Redux 状态和 DB 中。
    - **Block 相关**: 创建 `MessageBlock` 的副本，并更新其 ID 和 `messageId`。

8.  **`initiateTranslationThunk(messageId, topicId, targetLanguage, sourceBlockId?, sourceLanguage?)`**
    - **用途**: 为指定消息启动翻译流程，创建一个初始的 `TRANSLATION` 类型的 `MessageBlock`。
    - **流程**:
      - 创建一个状态为 `STREAMING` 的 `TranslationMessageBlock`。
      - 将其添加到 Redux 和 DB。
      - 更新原消息的 `blocks` 列表以包含新的翻译块 ID。
    - **Block 相关**: 创建并保存一个占位的 `TranslationMessageBlock`。实际翻译内容的获取和填充需要后续步骤。

## 内部机制和注意事项

- **数据库交互**: 通过 `saveMessageAndBlocksToDB`, `updateExistingMessageAndBlocksInDB`, `saveUpdatesToDB`, `saveUpdatedBlockToDB`, `throttledBlockDbUpdate` 等辅助函数与 IndexedDB (`db`) 交互，确保数据持久化。
- **状态同步**: Thunks 负责协调 Redux Store 和 IndexedDB 之间的数据一致性。
- **队列 (`getTopicQueue`)**: 使用 `AsyncQueue` 确保对同一主题的操作（尤其是 API 请求）按顺序执行，避免竞态条件。
- **节流 (`throttle`)**: 对流式响应中频繁的 Block 更新（文本、思考）使用 `lodash.throttle` 优化性能，减少 Redux dispatch 和 DB 写入次数。
- **错误处理**: `fetchAndProcessAssistantResponseImpl` 内的回调函数（特别是 `onError`）处理流处理和 API 调用中可能出现的错误，并创建 `ERROR` 类型的 `MessageBlock`。

开发者在使用这些 Thunks 时，通常需要提供 `dispatch`, `getState` (由 Redux Thunk 中间件注入)，以及如 `topicId`, `assistant` 配置对象, 相关的 `Message` 或 `MessageBlock` 对象/ID 等参数。理解每个 Thunk 的职责和它如何影响消息及块的状态至关重要。

---

# useMessageOperations.ts 使用指南

该文件定义了一个名为 `useMessageOperations` 的自定义 React Hook。这个 Hook 的主要目的是为 React 组件提供一个便捷的接口，用于执行与特定主题（Topic）相关的各种消息操作。它封装了调用 Redux Thunks (`messageThunk.ts`) 和 Actions (`newMessage.ts`, `messageBlock.ts`) 的逻辑，简化了组件与消息数据交互的代码。

## 核心目标

- **封装**: 将复杂的消息操作逻辑（如删除、重发、重新生成、编辑、翻译等）封装在易于使用的函数中。
- **简化**: 让组件可以直接调用这些操作函数，而无需直接与 Redux `dispatch` 或 Thunks 交互。
- **上下文关联**: 所有操作都与传入的 `topic` 对象相关联，确保操作作用于正确的主题。

## 如何使用

在你的 React 函数组件中，导入并调用 `useMessageOperations` Hook，并传入当前活动的 `Topic` 对象。

```typescript
import React from 'react';
import { useMessageOperations } from '@renderer/hooks/useMessageOperations';
import type { Topic, Message, Assistant, Model } from '@renderer/types';

interface MyComponentProps {
  currentTopic: Topic;
  currentAssistant: Assistant;
}

function MyComponent({ currentTopic, currentAssistant }: MyComponentProps) {
  const {
    deleteMessage,
    resendMessage,
    regenerateAssistantMessage,
    appendAssistantResponse,
    getTranslationUpdater,
    createTopicBranch,
    // ... 其他操作函数
  } = useMessageOperations(currentTopic);

  const handleDelete = (messageId: string) => {
    deleteMessage(messageId);
  };

  const handleResend = (message: Message) => {
    resendMessage(message, currentAssistant);
  };

  const handleAppend = (existingMsg: Message, newModel: Model) => {
    appendAssistantResponse(existingMsg, newModel, currentAssistant);
  }

  // ... 在组件中使用其他操作函数

  return (
    <div>
      {/* Component UI */}
      <button onClick={() => handleDelete('some-message-id')}>Delete Message</button>
      {/* ... */}
    </div>
  );
}
```

## 返回值

`useMessageOperations(topic)` Hook 返回一个包含以下函数和值的对象：

- **`deleteMessage(id: string)`**:

  - 删除指定 `id` 的单个消息。
  - 内部调用 `deleteSingleMessageThunk`。

- **`deleteGroupMessages(askId: string)`**:

  - 删除与指定 `askId` 相关联的一组消息（通常是用户提问及其所有助手回答）。
  - 内部调用 `deleteMessageGroupThunk`。

- **`editMessage(messageId: string, updates: Partial<Message>)`**:

  - 更新指定 `messageId` 的消息的部分属性。
  - **注意**: 目前主要用于更新 Redux 状态
  - 内部调用 `newMessagesActions.updateMessage`。

- **`resendMessage(message: Message, assistant: Assistant)`**:

  - 重新发送指定的用户消息 (`message`)，这将触发其所有关联助手响应的重新生成。
  - 内部调用 `resendMessageThunk`。

- **`resendUserMessageWithEdit(message: Message, editedContent: string, assistant: Assistant)`**:

  - 在用户消息的主要文本块被编辑后，重新发送该消息。
  - 会先查找消息的 `MAIN_TEXT` 块 ID，然后调用 `resendUserMessageWithEditThunk`。

- **`clearTopicMessages(_topicId?: string)`**:

  - 清除当前主题（或可选的指定 `_topicId`）下的所有消息。
  - 内部调用 `clearTopicMessagesThunk`。

- **`createNewContext()`**:

  - 发出一个全局事件 (`EVENT_NAMES.NEW_CONTEXT`)，通常用于通知 UI 清空显示，准备新的上下文。不直接修改 Redux 状态。

- **`displayCount`**:

  - (非操作函数) 从 Redux store 中获取当前的 `displayCount` 值。

- **`pauseMessages()`**:

  - 尝试中止当前主题中正在进行的消息生成（状态为 `processing` 或 `pending`）。
  - 通过查找相关的 `askId` 并调用 `abortCompletion` 来实现。
  - 同时会 dispatch `setTopicLoading` action 将加载状态设为 `false`。

- **`resumeMessage(message: Message, assistant: Assistant)`**:

  - 恢复/重新发送一个用户消息。目前实现为直接调用 `resendMessage`。

- **`regenerateAssistantMessage(message: Message, assistant: Assistant)`**:

  - 重新生成指定的**助手**消息 (`message`) 的响应。
  - 内部调用 `regenerateAssistantResponseThunk`。

- **`appendAssistantResponse(existingAssistantMessage: Message, newModel: Model, assistant: Assistant)`**:

  - 针对 `existingAssistantMessage` 所回复的**同一用户提问**，使用 `newModel` 追加一个新的助手响应。
  - 内部调用 `appendAssistantResponseThunk`。

- **`getTranslationUpdater(messageId: string, targetLanguage: string, sourceBlockId?: string, sourceLanguage?: string)`**:

  - **用途**: 获取一个用于逐步更新翻译块内容的函数。
  - **流程**:
    1.  内部调用 `initiateTranslationThunk` 来创建或获取一个 `TRANSLATION` 类型的 `MessageBlock`，并获取其 `blockId`。
    2.  返回一个**异步更新函数**。
  - **返回的更新函数 `(accumulatedText: string, isComplete?: boolean) => void`**:
    - 接收累积的翻译文本和完成状态。
    - 调用 `updateOneBlock` 更新 Redux 中的翻译块内容和状态 (`STREAMING` 或 `SUCCESS`)。
    - 调用 `throttledBlockDbUpdate` 将更新（节流地）保存到数据库。
  - 如果初始化失败（Thunk 返回 `undefined`），则此函数返回 `null`。

- **`createTopicBranch(sourceTopicId: string, branchPointIndex: number, newTopic: Topic)`**:
  - 创建一个主题分支，将 `sourceTopicId` 主题中 `branchPointIndex` 索引之前的消息克隆到 `newTopic` 中。
  - **注意**: `newTopic` 对象必须是调用此函数**之前**已经创建并添加到 Redux 和数据库中的。
  - 内部调用 `cloneMessagesToNewTopicThunk`。

## 依赖

- **`topic: Topic`**: 必须传入当前操作上下文的主题对象。Hook 返回的操作函数将始终作用于这个主题的 `topic.id`。
- **Redux `dispatch`**: Hook 内部使用 `useAppDispatch` 获取 `dispatch` 函数来调用 actions 和 thunks。

## 相关 Hooks

在同一文件中还定义了两个辅助 Hook：

- **`useTopicMessages(topic: Topic)`**:

  - 使用 `selectMessagesForTopic` selector 来获取并返回指定主题的消息列表。

- **`useTopicLoading(topic: Topic)`**:
  - 使用 `selectNewTopicLoading` selector 来获取并返回指定主题的加载状态。

这些 Hook 可以与 `useMessageOperations` 结合使用，方便地在组件中获取消息数据、加载状态，并执行相关操作。
