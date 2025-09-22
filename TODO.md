# 统一 Chat 和 Agent Session 数据层架构重构方案

## 目标
通过创建统一的数据访问层，消除 AgentSessionMessages 和 Messages 组件的重复代码，实现普通聊天和 Agent 会话的统一处理。

## 核心设计
使用门面模式 (Facade Pattern) 和策略模式 (Strategy Pattern) 创建统一的数据访问层，对外提供一致的 API，内部根据 topicId 类型自动路由到不同的数据源。

## 架构设计

```
┌─────────────────────────────────────────┐
│           UI Components                  │
│  (Messages, Inputbar - 完全复用)         │
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│         Hooks & Selectors                │
│  (useTopic, useTopicMessages - 统一)     │
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│            Redux Thunks                  │
│  (不再判断 isAgentSessionTopicId)        │
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│         DbService (门面)                 │
│  根据 topicId 内部路由到对应数据源        │
└─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
┌──────────────┐        ┌──────────────────┐
│ DexieMessage │        │  AgentMessage    │
│  DataSource  │        │   DataSource     │
│              │        │                  │
│   (Dexie)    │        │   (IPC/Backend)  │
└──────────────┘        └──────────────────┘
```

## 实施计划

### Phase 1: 创建数据访问层 (`src/renderer/src/services/db/`)

#### 1.1 定义 MessageDataSource 接口
```typescript
// src/renderer/src/services/db/types.ts
interface MessageDataSource {
  // 读取操作
  fetchMessages(topicId: string): Promise<{ messages: Message[], blocks: MessageBlock[] }>
  getRawTopic(topicId: string): Promise<{ id: string; messages: Message[] }>

  // 写入操作
  persistExchange(topicId: string, exchange: MessageExchange): Promise<void>
  appendMessage(topicId: string, message: Message, blocks: MessageBlock[]): Promise<void>
  updateMessage(topicId: string, messageId: string, updates: Partial<Message>): Promise<void>
  deleteMessage(topicId: string, messageId: string): Promise<void>

  // 批量操作
  clearMessages(topicId: string): Promise<void>
  updateBlocks(blocks: MessageBlock[]): Promise<void>
}

interface MessageExchange {
  user?: { message: Message, blocks: MessageBlock[] }
  assistant?: { message: Message, blocks: MessageBlock[] }
}
```

#### 1.2 实现 DexieMessageDataSource
```typescript
// src/renderer/src/services/db/DexieMessageDataSource.ts
class DexieMessageDataSource implements MessageDataSource {
  async fetchMessages(topicId: string) {
    const topic = await db.topics.get(topicId)
    const messages = topic?.messages || []
    const messageIds = messages.map(m => m.id)
    const blocks = await db.message_blocks.where('messageId').anyOf(messageIds).toArray()
    return { messages, blocks }
  }

  async persistExchange(topicId: string, exchange: MessageExchange) {
    // 保存到 Dexie 数据库
    await db.transaction('rw', db.topics, db.message_blocks, async () => {
      // ... 现有的保存逻辑
    })
  }
  // ... 其他方法实现
}
```

#### 1.3 实现 AgentMessageDataSource
```typescript
// src/renderer/src/services/db/AgentMessageDataSource.ts
class AgentMessageDataSource implements MessageDataSource {
  async fetchMessages(topicId: string) {
    const sessionId = topicId.replace('agent-session:', '')
    const historicalMessages = await window.electron.ipcRenderer.invoke(
      IpcChannel.AgentMessage_GetHistory,
      { sessionId }
    )

    const messages: Message[] = []
    const blocks: MessageBlock[] = []

    for (const msg of historicalMessages) {
      if (msg?.message) {
        messages.push(msg.message)
        if (msg.blocks) blocks.push(...msg.blocks)
      }
    }

    return { messages, blocks }
  }

  async persistExchange(topicId: string, exchange: MessageExchange) {
    const sessionId = topicId.replace('agent-session:', '')
    await window.electron.ipcRenderer.invoke(
      IpcChannel.AgentMessage_PersistExchange,
      { sessionId, ...exchange }
    )
  }
  // ... 其他方法实现
}
```

#### 1.4 创建 DbService 门面
```typescript
// src/renderer/src/services/db/DbService.ts
class DbService {
  private dexieSource = new DexieMessageDataSource()
  private agentSource = new AgentMessageDataSource()

  private getDataSource(topicId: string): MessageDataSource {
    if (isAgentSessionTopicId(topicId)) {
      return this.agentSource
    }
    // 未来可扩展其他数据源判断
    return this.dexieSource
  }

  async fetchMessages(topicId: string) {
    return this.getDataSource(topicId).fetchMessages(topicId)
  }

  async persistExchange(topicId: string, exchange: MessageExchange) {
    return this.getDataSource(topicId).persistExchange(topicId, exchange)
  }

  // ... 代理其他方法
}

export const dbService = new DbService()
```

### Phase 2: 重构 Redux Thunks（详细拆分）

由于 messageThunk.ts 改动较大，将 Phase 2 分成多个批次逐步实施：

#### 2.0 准备工作
- [ ] 添加 Feature Flag: `USE_UNIFIED_DB_SERVICE`
- [ ] 创建 messageThunk.v2.ts 作为临时过渡文件
- [ ] 准备回滚方案

#### 2.1 批次1：只读操作重构（风险最低）
这批改动只涉及读取操作，不会影响数据写入，风险最低。

##### 需要重构的函数
```typescript
// loadTopicMessagesThunk
export const loadTopicMessagesThunkV2 = (topicId: string, forceReload: boolean = false) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    if (!forceReload && state.messages.messageIdsByTopic[topicId]) {
      return // 已有缓存
    }

    try {
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

      // 新：统一调用
      const { messages, blocks } = await dbService.fetchMessages(topicId)

      if (blocks.length > 0) {
        dispatch(upsertManyBlocks(blocks))
      }
      dispatch(newMessagesActions.messagesReceived({ topicId, messages }))
    } catch (error) {
      logger.error(`Failed to load messages for topic ${topicId}:`, error)
    } finally {
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    }
  }

// getRawTopic
export const getRawTopicV2 = async (topicId: string) => {
  return await dbService.getRawTopic(topicId)
}
```

##### 测试清单
- [ ] 普通 Topic 消息加载
- [ ] Agent Session 消息加载
- [ ] 缓存机制正常工作
- [ ] 错误处理

#### 2.2 批次2：辅助函数重构
这批函数不直接操作数据库，但依赖数据库操作。

##### 需要重构的函数
```typescript
// getTopic
export const getTopicV2 = async (topicId: string): Promise<Topic | undefined> => {
  const rawTopic = await dbService.getRawTopic(topicId)
  if (!rawTopic) return undefined

  return {
    id: rawTopic.id,
    type: isAgentSessionTopicId(topicId) ? TopicType.AgentSession : TopicType.Chat,
    messages: rawTopic.messages,
    // ... 其他字段
  }
}

// updateFileCount
export const updateFileCountV2 = async (
  fileId: string,
  delta: number,
  deleteIfZero = false
) => {
  // 只对 Dexie 数据源有效
  if (dbService.supportsFileCount) {
    await dbService.updateFileCount(fileId, delta, deleteIfZero)
  }
}
```

##### 测试清单
- [ ] getTopic 返回正确的 Topic 类型
- [ ] updateFileCount 只在支持的数据源上执行
- [ ] 边界条件测试

#### 2.3 批次3：删除操作重构
删除操作相对独立，风险可控。

##### 需要重构的函数
```typescript
// deleteMessageFromDB
export const deleteMessageFromDBV2 = async (
  topicId: string,
  messageId: string
): Promise<void> => {
  await dbService.deleteMessage(topicId, messageId)
}

// deleteMessagesFromDB
export const deleteMessagesFromDBV2 = async (
  topicId: string,
  messageIds: string[]
): Promise<void> => {
  await dbService.deleteMessages(topicId, messageIds)
}

// clearMessagesFromDB
export const clearMessagesFromDBV2 = async (topicId: string): Promise<void> => {
  await dbService.clearMessages(topicId)
}
```

##### 测试清单
- [ ] 单个消息删除
- [ ] 批量消息删除
- [ ] 清空所有消息
- [ ] 文件引用计数正确更新
- [ ] Agent Session 删除操作（应为 no-op）

#### 2.4 批次4：复杂写入操作重构
这批包含最复杂的写入逻辑，需要特别注意。

##### 需要重构的函数
```typescript
// saveMessageAndBlocksToDB
export const saveMessageAndBlocksToDBV2 = async (
  topicId: string,
  message: Message,
  blocks: MessageBlock[]
): Promise<void> => {
  // 移除 isAgentSessionTopicId 判断
  await dbService.appendMessage(topicId, message, blocks)
}

// persistExchange
export const persistExchangeV2 = async (
  topicId: string,
  exchange: MessageExchange
): Promise<void> => {
  await dbService.persistExchange(topicId, exchange)
}

// sendMessage (最复杂的函数)
export const sendMessageV2 = (userMessage, userMessageBlocks, assistant, topicId, agentSession?) =>
  async (dispatch, getState) => {
    // 保存用户消息 - 统一接口
    await dbService.appendMessage(topicId, userMessage, userMessageBlocks)
    dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))

    // ... 创建助手消息 ...

    // 保存交换对 - 统一接口
    await dbService.persistExchange(topicId, {
      user: { message: userMessage, blocks: userMessageBlocks },
      assistant: { message: assistantMessage, blocks: [] }
    })
  }
```

##### 测试清单
- [ ] 普通消息发送流程
- [ ] Agent Session 消息发送流程
- [ ] 消息块正确保存
- [ ] Redux state 正确更新
- [ ] 流式响应处理
- [ ] 错误处理和重试机制

#### 2.5 批次5：更新操作重构
更新操作通常涉及消息编辑、状态更新等。

##### 需要重构的函数
```typescript
// updateMessage
export const updateMessageV2 = async (
  topicId: string,
  messageId: string,
  updates: Partial<Message>
): Promise<void> => {
  await dbService.updateMessage(topicId, messageId, updates)
}

// updateSingleBlock
export const updateSingleBlockV2 = async (
  blockId: string,
  updates: Partial<MessageBlock>
): Promise<void> => {
  await dbService.updateSingleBlock(blockId, updates)
}

// bulkAddBlocks
export const bulkAddBlocksV2 = async (blocks: MessageBlock[]): Promise<void> => {
  await dbService.bulkAddBlocks(blocks)
}
```

##### 测试清单
- [ ] 消息内容更新
- [ ] 消息状态更新
- [ ] 消息块更新
- [ ] 批量块添加
- [ ] Agent Session 更新操作（应为 no-op）

#### 2.6 迁移策略

##### 阶段1：并行运行（Week 1）
```typescript
export const loadTopicMessagesThunk = (topicId: string, forceReload: boolean = false) => {
  if (featureFlags.USE_UNIFIED_DB_SERVICE) {
    return loadTopicMessagesThunkV2(topicId, forceReload)
  }
  return loadTopicMessagesThunkOriginal(topicId, forceReload)
}
```

##### 阶段2：灰度测试（Week 2）
- 10% 用户使用新实现
- 监控性能和错误率
- 收集用户反馈

##### 阶段3：全量迁移（Week 3）
- 100% 用户使用新实现
- 保留 feature flag 一周观察
- 准备回滚方案

##### 阶段4：代码清理（Week 4）
- 移除旧实现代码
- 移除 feature flag
- 更新文档

#### 2.8 回滚计划

如果出现问题，按以下步骤回滚：

1. **立即回滚**（< 5分钟）
   - 关闭 feature flag
   - 所有流量回到旧实现

2. **修复后重试**
   - 分析问题原因
   - 修复并添加测试
   - 小范围测试后重新上线

3. **彻底回滚**（如果问题严重）
   - 恢复到改动前的代码版本
   - 重新评估方案

### Phase 3: 统一 Hooks 层

#### 3.1 创建统一的 useTopic Hook
```typescript
// src/renderer/src/hooks/useTopic.ts
export const useTopic = (topicIdOrSessionId: string): Topic => {
  const topicId = buildTopicId(topicIdOrSessionId) // 处理映射
  const [topic, setTopic] = useState<Topic>()

  useEffect(() => {
    dbService.fetchTopic(topicId).then(setTopic)
  }, [topicId])

  return topic
}
```

#### 3.2 统一 useTopicMessages
```typescript
// src/renderer/src/hooks/useTopicMessages.ts
export const useTopicMessages = (topicId: string) => {
  const messages = useAppSelector(state => selectMessagesForTopic(state, topicId))
  const dispatch = useAppDispatch()

  useEffect(() => {
    dispatch(loadTopicMessagesThunk(topicId))
  }, [topicId, dispatch])

  return messages // 无需区分数据源
}
```

### Phase 4: UI 组件复用

#### 4.1 直接使用 Messages 组件
- 删除 `AgentSessionMessages.tsx`
- 在 Agent 会话页面直接使用 `Messages` 组件

#### 4.2 轻量化 AgentSessionInputbar
```typescript
// src/renderer/src/pages/home/Inputbar/AgentSessionInputbar.tsx
const AgentSessionInputbar: FC<Props> = ({ agentId, sessionId }) => {
  const topicId = buildAgentSessionTopicId(sessionId)
  const assistant = deriveAssistantFromAgent(agentId) // 从 agent 派生 assistant
  const topic = useTopic(topicId) // 使用统一 hook

  return <Inputbar assistant={assistant} topic={topic} />
}
```

### Phase 5: 测试和迁移

#### 5.1 单元测试
- [ ] DbService 路由逻辑测试
- [ ] DexieMessageDataSource CRUD 测试
- [ ] AgentMessageDataSource CRUD 测试
- [ ] 数据格式兼容性测试

#### 5.2 集成测试
- [ ] 普通聊天全流程
- [ ] Agent 会话全流程
- [ ] 消息编辑/删除
- [ ] 分支功能
- [ ] 流式响应

#### 5.3 性能测试
- [ ] 大量消息加载
- [ ] 内存占用
- [ ] 响应延迟

## 优势分析

### 代码精简度
- **组件层**: 减少 ~500 行（删除 AgentSessionMessages）
- **Thunk 层**: 减少 ~300 行（移除条件判断）
- **总计减少**: ~40% 重复代码

### 架构优势
1. **单一职责**: 数据访问逻辑完全独立
2. **开闭原则**: 新增数据源只需实现接口
3. **依赖倒置**: 高层模块不依赖具体实现
4. **接口隔离**: 清晰的 API 边界

### 维护性提升
- 统一的数据访问接口
- 减少条件判断分支
- 便于单元测试
- 易于调试和追踪

## 风险控制

### 潜在风险
1. **数据一致性**: 确保两种数据源的数据格式一致
2. **性能开销**: 门面层可能带来轻微性能损失（<5ms）
3. **缓存策略**: Agent 数据不应缓存到本地数据库

### 缓解措施
1. 添加数据格式验证层
2. 使用轻量级代理，避免过度抽象
3. 在 DbService 层明确缓存策略

## 实施建议

### 渐进式迁移
1. **Week 1**: 实现数据访问层，不改动现有代码
2. **Week 2**: 逐个迁移 thunk 函数，保持向后兼容
3. **Week 3**: 统一组件层，充分测试

### 回滚策略
- 保留原有代码分支
- 通过 feature flag 控制新旧实现切换
- 分阶段灰度发布

## 总结
这个方案通过门面模式和统一的数据访问接口，实现了普通聊天和 Agent 会话的完全统一，大幅减少了代码重复，提升了系统的可维护性和可扩展性。
