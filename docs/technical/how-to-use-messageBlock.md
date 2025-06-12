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
