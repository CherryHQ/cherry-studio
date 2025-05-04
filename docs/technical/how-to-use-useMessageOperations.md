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
