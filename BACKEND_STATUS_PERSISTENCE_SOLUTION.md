# Agent Session 消息状态持久化方案

## 问题分析

### 当前流程
1. **发送消息时**：
   - 创建助手消息，状态为 `PENDING`
   - 通过 `appendMessage` 立即保存到后端（包含pending状态）

2. **切换会话后重新加载**：
   - 从后端加载消息
   - 但状态可能丢失或被覆盖

### 根本问题
后端可能没有正确保存或返回消息的 `status` 字段。

## 解决方案：确保状态正确持久化

### 方案A：修改 AgentMessageDataSource（前端方案）

```typescript
// src/renderer/src/services/db/AgentMessageDataSource.ts

// 1. 保存消息时确保状态被保存
async appendMessage(topicId: string, message: Message, blocks: MessageBlock[]): Promise<void> {
  const sessionId = extractSessionId(topicId)
  
  const payload: AgentPersistedMessage = {
    message: {
      ...message,
      // 明确保存状态
      status: message.status || AssistantMessageStatus.PENDING
    },
    blocks
  }
  
  await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
    sessionId,
    agentSessionId: '',
    ...(message.role === 'user' 
      ? { user: { payload } }
      : { assistant: { payload } }
    )
  })
}

// 2. 加载消息时恢复流式状态
async fetchMessages(topicId: string): Promise<{ messages: Message[], blocks: MessageBlock[] }> {
  const sessionId = extractSessionId(topicId)
  const historicalMessages = await window.electron.ipcRenderer.invoke(
    IpcChannel.AgentMessage_GetHistory,
    { sessionId }
  )
  
  const messages: Message[] = []
  const blocks: MessageBlock[] = []
  let hasStreamingMessage = false
  
  for (const persistedMsg of historicalMessages) {
    if (persistedMsg?.message) {
      const message = persistedMsg.message
      
      // 检查是否有未完成的消息
      if (message.status === 'pending' || message.status === 'processing') {
        hasStreamingMessage = true
        
        // 如果消息创建时间超过5分钟，标记为错误
        const messageAge = Date.now() - new Date(message.createdAt).getTime()
        if (messageAge > 5 * 60 * 1000) {
          message.status = 'error'
        }
      }
      
      messages.push(message)
      if (persistedMsg.blocks) {
        blocks.push(...persistedMsg.blocks)
      }
    }
  }
  
  // 如果有流式消息，恢复loading状态
  if (hasStreamingMessage) {
    // 这里需要dispatch action，可能需要通过回调或其他方式
    store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))
  }
  
  return { messages, blocks }
}
```

### 方案B：后端修改（更彻底的方案）

需要确保后端：

1. **sessionMessageRepository.ts** 正确保存消息状态
```typescript
// src/main/services/agents/database/sessionMessageRepository.ts

async persistExchange(params: PersistExchangeParams): Promise<void> {
  // 保存时确保状态字段被正确存储
  if (params.user) {
    await this.saveMessage({
      ...params.user.payload.message,
      status: params.user.payload.message.status // 确保状态被保存
    })
  }
  
  if (params.assistant) {
    await this.saveMessage({
      ...params.assistant.payload.message,
      status: params.assistant.payload.message.status // 确保状态被保存
    })
  }
}

async getHistory(sessionId: string): Promise<AgentPersistedMessage[]> {
  // 返回时确保状态字段被包含
  const messages = await this.db.getMessages(sessionId)
  return messages.map(msg => ({
    message: {
      ...msg,
      status: msg.status // 确保状态被返回
    },
    blocks: msg.blocks
  }))
}
```

2. **添加会话级别的流式状态**
```typescript
interface AgentSession {
  id: string
  // ... 其他字段
  streamingMessageId?: string // 当前正在流式的消息ID
  streamingStartTime?: number // 流式开始时间
}

// 开始流式时更新
async startStreaming(sessionId: string, messageId: string) {
  await this.updateSession(sessionId, {
    streamingMessageId: messageId,
    streamingStartTime: Date.now()
  })
}

// 结束流式时清除
async stopStreaming(sessionId: string) {
  await this.updateSession(sessionId, {
    streamingMessageId: null,
    streamingStartTime: null
  })
}
```

### 方案C：混合方案（推荐）

1. **前端立即保存状态**（已实现）
2. **后端确保状态持久化**
3. **加载时智能恢复状态**

```typescript
// AgentMessageDataSource.ts
async fetchMessages(topicId: string): Promise<{ messages: Message[], blocks: MessageBlock[] }> {
  const sessionId = extractSessionId(topicId)
  const historicalMessages = await window.electron.ipcRenderer.invoke(
    IpcChannel.AgentMessage_GetHistory,
    { sessionId }
  )
  
  const messages: Message[] = []
  const blocks: MessageBlock[] = []
  
  for (const persistedMsg of historicalMessages) {
    if (persistedMsg?.message) {
      const message = { ...persistedMsg.message }
      
      // 智能恢复状态
      if (message.status === 'pending' || message.status === 'processing') {
        // 检查消息年龄
        const age = Date.now() - new Date(message.createdAt).getTime()
        
        if (age > 5 * 60 * 1000) {
          // 超过5分钟，标记为错误
          message.status = 'error'
        } else if (age > 30 * 1000 && message.blocks?.length > 0) {
          // 超过30秒且有内容，可能已完成
          message.status = 'success'
        }
        // 否则保持原状态，让UI显示暂停按钮
      }
      
      messages.push(message)
      if (persistedMsg.blocks) {
        blocks.push(...persistedMsg.blocks)
      }
    }
  }
  
  return { messages, blocks }
}
```

## 实施步骤

### 步骤1：验证后端是否保存状态
1. 在 `appendMessage` 中添加日志，确认状态被发送
2. 检查后端数据库，确认状态被保存
3. 在 `fetchMessages` 中添加日志，确认状态被返回

### 步骤2：修复状态持久化
1. 如果后端没有保存状态，修改后端代码
2. 如果后端保存了但没返回，修改返回逻辑

### 步骤3：添加状态恢复逻辑
1. 在 `fetchMessages` 中智能恢复状态
2. 对于未完成的消息，根据时间判断是否需要标记为错误

### 步骤4：恢复loading状态
1. 如果有pending/processing消息，设置loading为true
2. 让UI正确显示暂停按钮

## 测试验证

1. **正常流程**
   - 发送消息
   - 观察pending状态
   - 响应完成后状态变为success

2. **切换会话**
   - 发送消息开始响应
   - 立即切换会话
   - 切回来，pending状态应该保持
   - 暂停按钮应该显示

3. **页面刷新**
   - 响应过程中刷新
   - 重新加载后状态应该合理（pending或error）

4. **超时处理**
   - 模拟长时间pending
   - 验证超时后自动标记为error

## 优势
- 符合现有架构，数据统一持久化
- 状态与消息一起保存，数据一致性好
- 页面刷新也能恢复
- 不需要额外的状态管理器