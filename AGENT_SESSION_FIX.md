# Agent Session 消息持久化问题修复

## 问题描述
在Agent会话中发送消息后，如果切换到其他会话再切回来，消息会丢失。错误信息：
```
[MessageThunk] persistAgentExchange: missing user or assistant message entity
```

## 问题原因
1. **原始实现问题**：
   - `saveMessageAndBlocksToDB` 对Agent会话直接返回，不保存消息
   - 消息只存在于Redux state中

2. **V2实现问题**：
   - `AgentMessageDataSource.appendMessage` 是空操作
   - 期望通过 `persistExchange` 在响应完成后保存

3. **时序问题**：
   - `persistAgentExchange` 在Agent响应完成后才被调用
   - 如果用户在响应过程中切换会话，Redux state被清空
   - `persistAgentExchange` 找不到消息实体，保存失败

## 解决方案
修改 `AgentMessageDataSource.appendMessage` 方法，让它立即保存消息到后端，而不是等待响应完成。

### 修改内容
```typescript
// src/renderer/src/services/db/AgentMessageDataSource.ts

async appendMessage(topicId: string, message: Message, blocks: MessageBlock[]): Promise<void> {
  // 立即保存消息，不等待persistExchange
  const sessionId = extractSessionId(topicId)
  
  const payload: AgentPersistedMessage = {
    message,
    blocks
  }

  // 通过IPC立即保存单个消息
  await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
    sessionId,
    agentSessionId: '',
    ...(message.role === 'user' 
      ? { user: { payload } }
      : { assistant: { payload } }
    )
  })
}
```

## 影响分析

### 优点
1. 消息立即持久化，不会因切换会话而丢失
2. 即使Agent响应失败，用户消息也已保存
3. 提高了数据安全性

### 潜在问题
1. **可能的重复保存**：
   - `appendMessage` 保存一次
   - `persistAgentExchange` 可能再次保存
   - 需要后端处理重复消息（通过messageId去重）

2. **性能考虑**：
   - 每条消息都触发IPC调用
   - 可能增加延迟

## 测试验证

### 测试步骤
1. 启用V2功能
2. 创建Agent会话
3. 发送消息
4. 在Agent响应过程中立即切换到其他会话
5. 切回Agent会话
6. **期望结果**：消息应该正确显示，不会丢失

### 测试场景
- ✅ 正常发送和接收
- ✅ 响应中切换会话
- ✅ 快速连续发送多条消息
- ✅ 网络中断恢复

## 后续优化建议

1. **批量保存**：
   - 考虑缓存多条消息后批量保存
   - 减少IPC调用次数

2. **去重机制**：
   - 后端通过messageId去重
   - 避免重复存储

3. **错误处理**：
   - 添加重试机制
   - 失败时的降级策略

## 回滚方案
如果修复引起新问题：
1. 恢复 `AgentMessageDataSource.appendMessage` 为原始空操作
2. 考虑其他解决方案（如在切换会话前强制调用persistExchange）