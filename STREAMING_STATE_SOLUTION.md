# Agent Session 流式状态保持方案

## 问题描述
Agent会话中发送消息后，如果在响应过程中切换会话：
1. 消息内容不丢失了（已修复）✅
2. 但是pending/processing状态丢失了 ❌
3. loading状态丢失了 ❌
4. 导致无法显示"暂停"按钮，无法中止正在进行的响应

## 问题分析

### 现状
```javascript
// AgentSessionInputbar.tsx
const streamingAskIds = useMemo(() => {
  // 检查消息的 status === 'processing' || 'pending'
  // 切换会话后这些状态丢失了
}, [topicMessages])

const canAbort = loading && streamingAskIds.length > 0
// loading 状态也丢失了
```

### 根本原因
1. **消息保存时机问题**：
   - 用户消息立即保存（状态为success）
   - 助手消息创建时是pending状态
   - 但保存到后端时可能已经是最终状态

2. **状态管理问题**：
   - loading状态只在Redux中，不持久化
   - 切换会话时Redux被清空
   - 重新加载时无法知道是否有正在进行的响应

## 解决方案

### 方案一：全局流式状态管理器（推荐）✅

创建一个全局的流式状态管理器，独立于Redux，跨会话保持状态。

```typescript
// src/renderer/src/services/StreamingStateManager.ts
class StreamingStateManager {
  // 记录正在进行的流式响应
  private streamingSessions = new Map<string, {
    topicId: string
    askId: string
    assistantMessageId: string
    startTime: number
    agentSession?: {
      agentId: string
      sessionId: string
    }
  }>()

  startStreaming(topicId: string, askId: string, assistantMessageId: string, agentSession?: any) {
    this.streamingSessions.set(topicId, {
      topicId,
      askId,
      assistantMessageId,
      startTime: Date.now(),
      agentSession
    })
  }

  stopStreaming(topicId: string) {
    this.streamingSessions.delete(topicId)
  }

  isStreaming(topicId: string): boolean {
    return this.streamingSessions.has(topicId)
  }

  getStreamingInfo(topicId: string) {
    return this.streamingSessions.get(topicId)
  }

  // 获取所有正在流式的会话
  getAllStreaming() {
    return Array.from(this.streamingSessions.values())
  }

  // 清理超时的流式状态（防止内存泄漏）
  cleanupStale(maxAge = 5 * 60 * 1000) { // 5分钟
    const now = Date.now()
    for (const [topicId, info] of this.streamingSessions) {
      if (now - info.startTime > maxAge) {
        this.streamingSessions.delete(topicId)
      }
    }
  }
}

export const streamingStateManager = new StreamingStateManager()
```

**集成点**：

1. **开始流式时**：
```typescript
// messageThunk.ts - fetchAndProcessAgentResponseImpl
streamingStateManager.startStreaming(
  topicId, 
  userMessageId, 
  assistantMessage.id,
  agentSession
)
```

2. **结束流式时**：
```typescript
// callbacks.ts - onComplete
streamingStateManager.stopStreaming(topicId)
```

3. **UI使用**：
```typescript
// AgentSessionInputbar.tsx
const isStreaming = streamingStateManager.isStreaming(sessionTopicId)
const streamingInfo = streamingStateManager.getStreamingInfo(sessionTopicId)

const canAbort = isStreaming && streamingInfo?.askId
```

### 方案二：增强消息持久化（备选）

修改消息保存逻辑，保留流式状态：

```typescript
// AgentMessageDataSource.ts
async appendMessage(topicId: string, message: Message, blocks: MessageBlock[]) {
  // 保存时保留 pending/processing 状态
  const messageToSave = {
    ...message,
    // 如果是助手消息且状态是pending，保持这个状态
    status: message.status === 'pending' ? 'pending' : message.status
  }
  
  // ... 保存逻辑
}

// 加载时恢复状态
async fetchMessages(topicId: string) {
  const { messages, blocks } = // ... 从后端加载
  
  // 检查是否有未完成的消息
  for (const msg of messages) {
    if (msg.status === 'pending' || msg.status === 'processing') {
      // 恢复loading状态
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))
      
      // 可能需要重新启动流式处理或标记为失败
    }
  }
}
```

### 方案三：Session级别状态存储（简单但有限）

在localStorage或sessionStorage中保存流式状态：

```typescript
// 保存流式状态
const saveStreamingState = (topicId: string, state: any) => {
  const states = JSON.parse(localStorage.getItem('streamingStates') || '{}')
  states[topicId] = {
    ...state,
    timestamp: Date.now()
  }
  localStorage.setItem('streamingStates', JSON.stringify(states))
}

// 恢复流式状态
const getStreamingState = (topicId: string) => {
  const states = JSON.parse(localStorage.getItem('streamingStates') || '{}')
  const state = states[topicId]
  
  // 检查是否过期（比如超过5分钟）
  if (state && Date.now() - state.timestamp < 5 * 60 * 1000) {
    return state
  }
  
  // 清理过期状态
  delete states[topicId]
  localStorage.setItem('streamingStates', JSON.stringify(states))
  return null
}
```

## 推荐实施步骤

### 步骤1：实现StreamingStateManager
1. 创建全局状态管理器
2. 在开始/结束流式时更新状态
3. 添加定期清理机制

### 步骤2：更新messageThunk.ts
1. 在`fetchAndProcessAgentResponseImpl`开始时注册流式状态
2. 在完成/错误/中止时清除状态
3. 确保所有退出路径都清理状态

### 步骤3：更新UI组件
1. 修改`AgentSessionInputbar.tsx`使用StreamingStateManager
2. 不再依赖消息的status字段判断流式状态
3. 使用全局状态判断是否显示暂停按钮

### 步骤4：处理边界情况
1. 页面刷新时的状态恢复
2. 网络中断的处理
3. 超时自动清理

## 测试验证

### 测试场景
1. **正常流式**：
   - 发送消息
   - 观察流式响应
   - 验证暂停按钮显示

2. **切换会话**：
   - 发送消息开始流式
   - 立即切换到其他会话
   - 切回来验证暂停按钮仍然显示
   - 可以正确暂停

3. **刷新页面**：
   - 流式过程中刷新
   - 验证状态是否合理处理（显示失败或继续）

4. **超时清理**：
   - 模拟长时间流式
   - 验证超时后状态被清理

## 优势对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| 全局状态管理器 | • 简单可靠<br>• 跨会话工作<br>• 易于调试 | • 需要额外内存<br>• 页面刷新丢失 |
| 增强持久化 | • 数据一致性好<br>• 页面刷新可恢复 | • 实现复杂<br>• 需要后端配合 |
| Session存储 | • 实现简单<br>• 可跨页面刷新 | • 容量限制<br>• 需要清理逻辑 |

## 建议
推荐使用**方案一：全局流式状态管理器**，因为：
1. 实现简单，不需要修改后端
2. 可以快速解决当前问题
3. 易于扩展和维护
4. 对现有代码改动最小

如果需要页面刷新后也能恢复状态，可以结合方案三，将关键信息保存到localStorage。