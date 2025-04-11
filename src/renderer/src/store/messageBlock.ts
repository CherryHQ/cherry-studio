import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { MessageBlock } from '@renderer/types/newMessageTypes'

import type { RootState } from './index' // 确认 RootState 从 store/index.ts 导出

// 1. 创建实体适配器 (Entity Adapter)
// 我们使用块的 `id` 作为唯一标识符。
const messageBlocksAdapter = createEntityAdapter<MessageBlock>()

// 2. 使用适配器定义初始状态 (Initial State)
// 如果需要，可以在规范化实体的旁边添加其他状态属性。
const initialState = messageBlocksAdapter.getInitialState({
  loadingState: 'idle' as 'idle' | 'loading' | 'succeeded' | 'failed',
  error: null as string | null
})

// 3. 创建 Slice
const messageBlocksSlice = createSlice({
  name: 'messageBlocks',
  initialState,
  reducers: {
    // 使用适配器的 reducer 助手进行 CRUD 操作。
    // 这些 reducer 会自动处理规范化的状态结构。

    /** 添加或更新单个块 (Upsert)。 */
    upsertOneBlock: messageBlocksAdapter.upsertOne, // 期望 MessageBlock 作为 payload

    /** 添加或更新多个块。用于加载消息。 */
    upsertManyBlocks: messageBlocksAdapter.upsertMany, // 期望 MessageBlock[] 作为 payload

    /** 根据 ID 移除单个块。 */
    removeOneBlock: messageBlocksAdapter.removeOne, // 期望 EntityId (string) 作为 payload

    /** 根据 ID 列表移除多个块。用于清理话题。 */
    removeManyBlocks: messageBlocksAdapter.removeMany, // 期望 EntityId[] (string[]) 作为 payload

    /** 移除所有块。用于完全重置。 */
    removeAllBlocks: messageBlocksAdapter.removeAll,

    // 你可以为其他状态属性（如加载/错误）添加自定义 reducer
    setMessageBlocksLoading: (state, action: PayloadAction<'idle' | 'loading'>) => {
      state.loadingState = action.payload
      state.error = null
    },
    setMessageBlocksError: (state, action: PayloadAction<string>) => {
      state.loadingState = 'failed'
      state.error = action.payload
    }
    // 注意：如果只想更新现有块，也可以使用 `updateOne`
    // updateOneBlock: messageBlocksAdapter.updateOne, // 期望 { id: EntityId, changes: Partial<MessageBlock> }
  }
  // 如果需要处理其他 slice 的 action，可以在这里添加 extraReducers。
})

// 4. 导出 Actions 和 Reducer
export const {
  upsertOneBlock,
  upsertManyBlocks,
  removeOneBlock,
  removeManyBlocks,
  removeAllBlocks,
  setMessageBlocksLoading,
  setMessageBlocksError
} = messageBlocksSlice.actions

export const messageBlocksSelectors = messageBlocksAdapter.getSelectors<RootState>(
  (state) => state.messageBlocks // Ensure this matches the key in the root reducer
)

// Export the actions for use in thunks, etc.
export const messageBlocksActions = messageBlocksSlice.actions

export default messageBlocksSlice.reducer

// 5. 使用适配器的 getSelectors 创建并导出 Selectors
// 我们传递一个选择器函数，该函数返回 `messageBlocks` slice 的状态。
// 导出选择器的示例用法：
// const selectBlockById = (state: RootState, blockId: EntityId) =>
//   messageBlockSelectors.selectById(state, blockId);
// const selectAllBlocks = (state: RootState) =>
//   messageBlockSelectors.selectAll(state);
// const selectBlockEntities = (state: RootState) =>
//   messageBlockSelectors.selectEntities(state); // 获取 { id: block } 字典
