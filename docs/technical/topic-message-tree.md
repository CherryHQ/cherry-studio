# 消息历史版本管理系统设计技术报告（最终版 - 含多模型支持）

## 1. 系统概述

基于现有扁平化架构的最小化扩展，通过 **Topic快照 + Message字段扩展（含siblingIds）** 实现版本管理、分支对话和多模型并行回复功能。

### 1.1 核心设计理念

- **最小破坏性**：只扩展现有实体，不新增表
- **快照渲染**：通过Topic简单快照管理主线渲染顺序
- **关系扩展**：通过Message字段实现树状分支、双向链表版本、多模型兄弟关系

## 2. 数据结构设计

### 2.1 实体定义

```typescript
interface Topic {
  // === 现有字段保持不变 ===
  id: string
  name: string
  createdAt: string
  updatedAt: string

  // === 保持简单快照 ===
  activeMessageIds: string[] // 当前活跃对话主线的消息ID顺序
}

interface Message {
  // === 现有字段保持不变 ===
  id: string
  role: 'user' | 'assistant' | 'system'
  topicId: string
  blocks: MessageBlock['id'][]

  // === 新增：关系字段 ===
  askId?: string // 问答关系：assistant指向对应的user消息
  parentMessageId?: string // 分支关系：指向回复的目标消息
  version?: number // 版本号（assistant消息专用）
  prevVersionId?: string // 版本链表：前一版本
  nextVersionId?: string // 版本链表：后一版本
  groupRequestId?: string // 请求分组：同次API请求的标识
  siblingIds?: string[] // 兄弟关系：同级多模型回复的ID列表
}

interface MessageBlock {
  // === 完全不变 ===
  id: string
  messageId: string
  type: MessageBlockType
  content: string
  // ...其他现有字段
}
```

### 2.2 数据关系图

```mermaid
graph TB
    subgraph "Topic快照层 (主线)"
        T[Topic.activeMessageIds: user1→asst1-gpt→user2]
    end

    subgraph "消息实体层"
        U1[User Message 1<br/>id: user1]
        A1G["GPT-4 回复<br/>id: asst1-gpt, askId: user1<br/>siblingIds: [asst1-claude]"]
        A1C["Claude 回复<br/>id: asst1-claude, askId: user1<br/>siblingIds: [asst1-gpt]"]
        U2["User Message 2<br/>id: user2, parentMessageId: asst1-gpt"]
    end

    subgraph "版本链表层 (隐藏)"
        A1GV0[GPT-4 v0<br/>askId: user1, version: 0]
        A1GV1[GPT-4 v1<br/>askId: user1, version: 1]

        A1GV0 -.->|nextVersionId| A1GV1
        A1GV1 -.->|prevVersionId| A1GV0
    end

    subgraph "分支树层 (隐藏)"
        U1B[User Branch 1<br/>parentMessageId: asst1-gpt]
        A1B[Assistant Branch 1<br/>askId: user1b]
    end

    T --> U1
    T --> A1G
    T --> U2

    A1G -.->|askId| U1
    A1C -.->|askId| U1
    A1G -.->|siblingIds| A1C
    A1C -.->|siblingIds| A1G
    U2 -.->|parentMessageId| A1G

    U1B -.->|parentMessageId| A1G
    A1B -.->|askId| U1B
```

## 3. 核心操作流程

### 3.1 发送新消息（多模型）

```mermaid
sequenceDiagram
    participant UI
    participant Redux
    participant DB
    participant API

    UI->>Redux: sendMessage(userContent, models[])

    Note over Redux: 1. 创建用户消息
    Redux->>Redux: userMessage = { id: uuid(), role: 'user', ... }

    Note over Redux: 2. 创建助手消息（多模型）
    Redux->>Redux: groupRequestId = uuid()
    Redux->>Redux: assistantMessages = models.map(m => createAssistant(userMessage.id, m))

    Note over Redux: 3. 设置兄弟关系
    Redux->>Redux: assistantIds = assistantMessages.map(m => m.id)
    loop 每个助手消息
        Redux->>Redux: msg.siblingIds = assistantIds.filter(id => id !== msg.id)
    end

    Note over Redux: 4. 更新Topic快照
    Redux->>Redux: newActiveMessageIds = [<br/>...oldIds,<br/>userMessage.id,<br/>assistantMessages[0].id<br/>]

    Note over Redux: 5. 原子保存
    Redux->>DB: transaction([messages, topics])
    DB->>DB: messages.bulkPut([userMessage, ...assistantMessages])
    DB->>DB: topics.update(topicId, { activeMessageIds })

    Note over Redux: 6. 发送API请求
    loop 每个模型
        Redux->>API: generateResponse(model, userContent)
    end

    Redux->>UI: 更新状态
```

**复杂度**：O(M) where M = 模型数量

### 3.2 重发消息（版本管理）

```mermaid
sequenceDiagram
    participant UI
    participant Redux
    participant DB

    UI->>Redux: resendMessage(userMessageId)

    Note over Redux: 1. 查找现有版本
    Redux->>DB: messages.where('askId').equals(userMessageId)
    DB-->>Redux: existingVersions[]

    Note over Redux: 2. 计算新版本号
    Redux->>Redux: latestVersion = max(versions.map(v => v.version))
    Redux->>Redux: newVersion = latestVersion + 1

    Note over Redux: 3. 创建新版本消息（可能多模型）
    Redux->>Redux: newGroupRequestId = uuid()
    Redux->>Redux: newVersionMessages = models.map(m => createNewVersion(prevMsg, newVersion, newGroupRequestId))

    Note over Redux: 4. 设置新版本的兄弟关系
    Redux->>Redux: newVersionIds = newVersionMessages.map(m => m.id)
    loop 每个新版本消息
        Redux->>Redux: msg.siblingIds = newVersionIds.filter(id => id !== msg.id)
    end

    Note over Redux: 5. 更新版本链表
    Redux->>DB: transaction(messages)
    DB->>DB: messages.update(prevMessage.id, { nextVersionId })
    DB->>DB: messages.bulkPut(newVersionMessages)

    Redux->>UI: 更新状态
```

**复杂度**：O(V) 查找 + O(M) 创建

### 3.3 切换活跃模型（UI交互）

```mermaid
flowchart TD
    A[用户在UI上选择其他模型] --> B[获取当前快照]
    B --> C[找到当前助手消息在快照中的位置]
    C --> D[用新选择的模型消息ID替换快照中的ID]
    D --> E[保存到数据库]
    E --> F[Redux自动重新渲染]

    style A fill:#e1f5fe
    style F fill:#c8e6c9
```

```typescript
const switchActiveModel = async (topicId: string, messageIndex: number, newModelMessageId: string) => {
  const topic = await db.topics.get(topicId)
  const newActiveMessageIds = [...topic.activeMessageIds]
  newActiveMessageIds[messageIndex] = newModelMessageId

  await db.topics.update(topicId, { activeMessageIds: newActiveMessageIds })
}
```

**复杂度**：O(1)

## 4. 字段作用详解

### 4.1 关键字段关系图

```mermaid
graph LR
    subgraph "问答关系"
        askId[askId<br/>assistant → user<br/>逻辑关系，永久不变]
    end

    subgraph "分支关系"
        parentId[parentMessageId<br/>message → message<br/>分支对话，树状结构]
    end

    subgraph "版本关系"
        version[version + prevVersionId + nextVersionId<br/>同askId下的版本链表]
    end

    subgraph "请求分组"
        groupId[groupRequestId<br/>同次API请求标识<br/>一次性，每次重发都变]
    end

    subgraph "兄弟关系"
        siblingId[siblingIds<br/>同级多模型回复<br/>双向引用]
    end

    askId -.-> version
    askId -.-> siblingId
    parentId -.-> askId
    groupId -.-> askId
```

### 4.2 字段使用场景

| 字段                             | 用途       | 查询场景                   | 生命周期 |
| -------------------------------- | ---------- | -------------------------- | -------- |
| **askId**                        | 问答映射   | 查找用户问题的所有回复版本 | 永久不变 |
| **parentMessageId**              | 分支对话   | 查找某消息的回复分支       | 永久不变 |
| **version + prev/nextVersionId** | 版本管理   | 版本历史导航               | 永久不变 |
| **groupRequestId**               | 请求追踪   | 批量状态更新、请求监控     | 一次性   |
| **siblingIds**                   | 多模型并行 | 渲染同级多模型回复         | 永久不变 |

### 4.3 多模型并行渲染示例

```mermaid
graph TD
    U1[User: 帮我写个函数<br/>id: user1]

    subgraph "第一次请求 (groupRequestId: req1)"
        A1["GPT-4 回复<br/>id: asst1-gpt, askId: user1<br/>siblingIds: [asst1-claude]"]
        A2["Claude 回复<br/>id: asst1-claude, askId: user1<br/>siblingIds: [asst1-gpt]"]
    end

    subgraph "Topic快照 (主线)"
        T["activeMessageIds: [user1, asst1-gpt]"]
    end

    subgraph "UI渲染 (通过siblingIds扩展)"
        UI_U1[User: 帮我写个函数]
        UI_A1["GPT-4 回复 (活跃)"]
        UI_A2["Claude 回复 (可选)"]
    end

    U1 --> A1
    U1 --> A2

    T --> U1
    T --> A1

    A1 -.->|siblingIds| A2
    A2 -.->|siblingIds| A1

    UI_U1 -.-> UI_A1
    UI_U1 -.-> UI_A2
```

## 5. 数据查询与状态管理

### 5.1 话题加载流程

```mermaid
sequenceDiagram
    participant UI
    participant Redux
    participant DB
    participant Selector

    UI->>Redux: loadTopic(topicId)
    Redux->>DB: 并行查询

    par 查询消息
        DB->>DB: messages.where('topicId').equals(topicId)
    and 查询块
        DB->>DB: messageBlocks.where('topicId').equals(topicId)
    end

    DB-->>Redux: { messages[], blocks[] }
    Redux->>Redux: 更新实体状态

    UI->>Selector: selectActiveConversationWithSiblings(topicId)
    Selector->>Redux: 获取Topic.activeMessageIds
    Selector->>Redux: 获取messages实体
    Selector-->>UI: 按快照顺序的消息列表 (含兄弟节点)

    Note over UI: 渲染对话界面 (支持多模型)
```

### 5.2 渲染选择器（含兄弟节点）

```typescript
export const selectActiveConversationWithSiblings = createSelector(
  [
    (state: RootState, topicId: string) => state.topics.entities[topicId]?.activeMessageIds || [],
    (state: RootState) => state.messages.entities,
    (state: RootState) => state.messageBlocks.entities
  ],
  (activeMessageIds, messagesEntities, blocksEntities) => {
    return activeMessageIds
      .map((messageId) => {
        const message = messagesEntities[messageId]
        if (!message) return null

        if (message.role === 'user') {
          return { type: 'user', message, blocks: getMessageBlocks(message, blocksEntities) }
        } else if (message.role === 'assistant') {
          const siblingMessages = (message.siblingIds || []).map((id) => messagesEntities[id]).filter(Boolean)
          const allAssistantMessages = [message, ...siblingMessages]

          return {
            type: 'assistant_group',
            messages: allAssistantMessages.map((msg) => ({
              message: msg,
              blocks: getMessageBlocks(msg, blocksEntities),
              isActive: msg.id === messageId
            })),
            activeMessageId: messageId
          }
        }
      })
      .filter(Boolean)
  }
)
```

**复杂度**：O(N + S) where N = 快照长度, S = 兄弟节点总数

## 6. 时空复杂度分析

### 6.1 核心操作复杂度对比

```mermaid
graph LR
    subgraph "现有架构"
        A1[加载话题: O(M+B)]
        A2[渲染对话: O(M) 需要过滤排序]
        A3[发送消息: O(1)]
    end

    subgraph "新架构 (含多模型)"
        B1[加载话题: O(M+B) ✅相同]
        B2[渲染对话: O(N+S) ✅更优]
        B3[发送消息: O(M_models) ✅相同]
        B4[版本切换: O(1) ➕新功能]
        B5[重发消息: O(V)+O(M_models) ➕新功能]
        B6[模型切换: O(1) ➕新功能]
    end

    style B1 fill:#c8e6c9
    style B2 fill:#c8e6c9
    style B3 fill:#c8e6c9
    style B4 fill:#fff3e0
    style B5 fill:#fff3e0
    style B6 fill:#fff3e0
```

### 6.2 性能优势分析

| 操作         | 现有架构       | 新架构                       | 优势说明             |
| ------------ | -------------- | ---------------------------- | -------------------- |
| **话题加载** | O(M + B)       | O(M + B)                     | 性能保持不变         |
| **对话渲染** | O(M) 过滤+排序 | **O(N+S)** 直接索引+兄弟扩展 | N << M，S通常较小    |
| **发送消息** | O(1)           | O(M_models)                  | 支持多模型，合理增长 |
| **版本切换** | 不支持         | **O(1)**                     | 新功能，极佳性能     |
| **模型切换** | 不支持         | **O(1)**                     | 新功能，极佳性能     |

**关键优势**：

- **渲染性能提升**：从 O(M) 优化到 O(N+S)，长对话场景收益显著
- **多模型支持**：通过 siblingIds 优雅实现
- **版本管理**：O(1) 的版本/模型切换，用户体验极佳
- **向后兼容**：现有核心操作性能保持不变

## 7. 数据库Schema演进

### 7.1 Migration策略

```mermaid
flowchart TD
    A[现有Schema] --> B[添加字段]
    B --> C[创建索引]
    C --> D[数据迁移]
    D --> E[验证完整性]

    B1[Topic: +activeMessageIds]
    B2[Message: +askId, +parentMessageId<br/>+version, +prevVersionId<br/>+nextVersionId, +groupRequestId<br/>+siblingIds]

    C1[idx_messages_askid_version]
    C2[idx_messages_parent]
    C3[idx_messages_group_request]

    D1[生成activeMessageIds快照]
    D2[设置现有assistant消息version=0]

    B --> B1
    B --> B2
    C --> C1
    C --> C2
    C --> C3
    D --> D1
    D --> D2
```

### 7.2 SQL Migration

```sql
-- 1. 添加字段
ALTER TABLE topics ADD COLUMN activeMessageIds TEXT; -- JSON数组
ALTER TABLE messages ADD COLUMN askId TEXT;
ALTER TABLE messages ADD COLUMN parentMessageId TEXT;
ALTER TABLE messages ADD COLUMN version INTEGER;
ALTER TABLE messages ADD COLUMN prevVersionId TEXT;
ALTER TABLE messages ADD COLUMN nextVersionId TEXT;
ALTER TABLE messages ADD COLUMN groupRequestId TEXT;
ALTER TABLE messages ADD COLUMN siblingIds TEXT; -- JSON数组

-- 2. 创建索引
CREATE INDEX idx_messages_askid_version ON messages(askId, version);
CREATE INDEX idx_messages_parent ON messages(parentMessageId);
CREATE INDEX idx_messages_group_request ON messages(groupRequestId);

-- 3. 数据迁移
UPDATE messages SET version = 0 WHERE role = 'assistant';
```

## 8. 流式更新兼容性

### 8.1 MessageBlock更新流程

```mermaid
sequenceDiagram
    participant Stream
    participant Redux
    participant DB
    participant UI

    Note over Stream: 流式内容到达
    Stream->>Redux: updateBlock(blockId, content)
    Redux->>Redux: updateOneBlock({ id, changes })
    Redux->>UI: 立即更新显示

    Note over Redux: 节流数据库写入
    Redux->>DB: throttledDbUpdate(blockId, content)

    Note over Stream,UI: 版本/兄弟关系不影响块更新
```

**关键点**：

- MessageBlock 仍然直接关联到 Message
- 版本/兄弟关系在 Message 层面，不影响 Block 的流式更新
- 现有的节流机制和更新逻辑完全保持不变

## 9. 系统架构总览

### 9.1 整体架构图

```mermaid
graph TB
    subgraph "UI层"
        UI1[对话界面]
        UI2[版本选择器]
        UI3[分支导航]
        UI4[模型切换器]
    end

    subgraph "Redux状态层"
        R1[topics: EntityAdapter]
        R2[messages: EntityAdapter]
        R3[messageBlocks: EntityAdapter]
        S1[selectActiveConversationWithSiblings]
        S2[selectVersionHistory]
    end

    subgraph "数据库层"
        DB1[(topics表)]
        DB2[(messages表)]
        DB3[(messageBlocks表)]
    end

    subgraph "API层"
        API1[多模型并行请求]
        API2[流式响应处理]
    end

    UI1 --> S1
    UI2 --> S2
    UI4 --> S1
    S1 --> R1
    S1 --> R2
    S2 --> R2

    R1 <--> DB1
    R2 <--> DB2
    R3 <--> DB3

    R2 --> API1
    API2 --> R3

    style UI1 fill:#e3f2fd
    style R1 fill:#f3e5f5
    style R2 fill:#f3e5f5
    style R3 fill:#f3e5f5
    style DB1 fill:#e8f5e8
    style DB2 fill:#e8f5e8
    style DB3 fill:#e8f5e8
```

### 9.2 数据流向

```mermaid
flowchart LR
    A[用户输入] --> B[创建User Message]
    B --> C["创建Assistant Messages (多模型)"]
    C --> C1[设置Sibling关系]
    C1 --> D["更新Topic快照 (主线)"]
    D --> E[API并行请求]
    E --> F[流式更新Blocks]
    F --> G["UI实时渲染 (含多模型)"]

    H[版本切换] --> I[更新快照指针]
    I --> G

    J[分支对话] --> K[创建分支消息]
    K --> D

    L[模型切换] --> I

    style A fill:#ffebee
    style G fill:#e8f5e8
    style H fill:#fff3e0
    style J fill:#f3e5f5
    style L fill:#e1f5fe
```

## 10. Redux Slice 实现范例

根据上述架构设计，`messages` slice 将演变为一个纯粹的、由 `createEntityAdapter` 管理的"消息池"。它只负责高效地存储和访问单个消息实体，而不再关心对话的顺序。

### `store/messagesSlice.ts`

```typescript
import { createSlice, createEntityAdapter, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './store' // 你的store类型定义
import type { Message } from '@renderer/types/newMessage' // 假设 Message 类型定义在外部

// 1. 创建 Entity Adapter
// 它会自动生成管理实体的reducer逻辑，实现一个高效的消息池。
const messagesAdapter = createEntityAdapter<Message>()

// 2. 定义 Slice 的初始状态
// adapter.getInitialState() 会自动创建 { ids: [], entities: {} } 结构
const initialState = messagesAdapter.getInitialState()

// 3. 创建 Slice
const messagesSlice = createSlice({
  name: 'messages',
  initialState,
  // Reducers被极大简化，多数直接引用adapter提供的方法
  reducers: {
    // Action: 添加一条消息
    messageAdded: messagesAdapter.addOne,

    // Action: 一次性添加或更新多个消息 (高性能)
    // 用途: 加载话题历史、发送新一轮问答(user+assistants)
    messagesUpserted: messagesAdapter.upsertMany,

    // Action: 更新单个消息
    // 用途: 流式更新结束、状态变更等
    messageUpdated: messagesAdapter.updateOne,

    // Action: 删除单个消息
    messageRemoved: messagesAdapter.removeOne,

    // Action: 删除多个消息
    messagesRemoved: messagesAdapter.removeMany,

    // Action: 用新数据完全替换消息池
    // 用途: 首次加载或强制刷新
    messagesSet: messagesAdapter.setAll
  }
})

// 4. 导出 Actions
export const { messageAdded, messagesUpserted, messageUpdated, messageRemoved, messagesRemoved, messagesSet } =
  messagesSlice.actions

// 5. 导出 Selectors
// Adapter 会自动创建高效的查询函数 (e.g., O(1) by ID)
export const messagesSelectors = messagesAdapter.getSelectors((state: RootState) => state.messages)

// 6. 导出 Reducer
export default messagesSlice.reducer
```

### 核心思想总结

1.  **职责单一**: 此 Slice 只做一件事——管理 `Message` 实体。它像一个数据库表，高效地处理增删改查，但对业务逻辑（如对话顺序）一无所知。
2.  **逻辑上移**: 所有涉及多个 Slice 的复杂业务逻辑（如发送消息、切换版本）都应封装在 **Thunks** 或其他中间件中。Thunk 作为流程协调者，会 `dispatch` 多个原子化的 Action 给 `messagesSlice` 和 `topicsSlice`，以完成一次完整的业务操作并保证数据一致性。
3.  **性能保证**: `createEntityAdapter` 内部使用哈希表（对象）来存储实体，确保通过 ID 查询消息的操作为 O(1) 复杂度，性能极佳。

### 旧状态属性迁移

为了完成 `messagesSlice` 向纯粹"消息池"的演进，原有的混合状态属性需要被迁移或废弃，以实现彻底的职责分离。

| 原属性 (`newMessage.ts`) | 处理方式      | 新的归宿 / 说明                                                                               |
| :----------------------- | :------------ | :-------------------------------------------------------------------------------------------- |
| `messageIdsByTopic`      | **废弃**      | 核心职责转移。由 `topicsSlice` 中的 `activeMessageIds` 字段接管，作为渲染快照。               |
| `currentTopicId`         | **迁移**      | 属于UI当前上下文状态，应迁移至 `topicsSlice`。                                                |
| `loadingByTopic`         | **迁移**      | 话题的加载状态与话题本身更相关，应迁移至 `topicsSlice`。                                      |
| `displayCount`           | **废弃/迁移** | UI相关的显示逻辑，不属于消息数据层。建议迁移至专门的 `Slice` 或在相关组件中作为本地状态管理。 |
