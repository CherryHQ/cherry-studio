/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { KnowledgeBase } from '@renderer/types'

export interface KnowledgeState {
  bases: KnowledgeBase[]
}

const initialState: KnowledgeState = {
  bases: []
}

const knowledgeSlice = createSlice({
  name: 'knowledge',
  initialState,
  reducers: {
    // addBase(state, action: PayloadAction<KnowledgeBase>) {
    //   state.bases.push(action.payload)
    // },
    // deleteBase(state, action: PayloadAction<{ baseId: string }>) {
    //   state.bases = state.bases.filter((base) => base.id !== action.payload.baseId)
    // },
    // renameBase(state, action: PayloadAction<{ baseId: string; name: string }>) {},
    // updateBase(state, action: PayloadAction<KnowledgeBase>) {},
    // updateBases(state, action: PayloadAction<KnowledgeBase[]>) {},
    // addItem(state, action: PayloadAction<{ baseId: string; item: KnowledgeItem }>) {},
    // removeItem(state, action: PayloadAction<{ baseId: string; item: KnowledgeItem }>) {},
    // updateItem(state, action: PayloadAction<{ baseId: string; item: KnowledgeItem }>) {},
    // addFiles(state, action: PayloadAction<{ baseId: string; items: KnowledgeItem[] }>) {},
    // updateNotes(state, action: PayloadAction<{ baseId: string; item: KnowledgeItem }>) {},
    // updateItemProcessingStatus(state, action: PayloadAction<unknown>) {},
    // clearCompletedProcessing(state, action: PayloadAction<{ baseId: string }>) {},
    // clearAllProcessing(state, action: PayloadAction<{ baseId: string }>) {},
    // syncPreprocessProvider(state, action: PayloadAction<Partial<PreprocessProvider>>) {},
    // updateBaseItemUniqueId(state, action: PayloadAction<{ baseId: string; itemId: string; uniqueId: string; uniqueIds: string[] }>) {},
    // updateBaseItemIsPreprocessed(state, action: PayloadAction<{ baseId: string; itemId: string; isPreprocessed: boolean }>) {},
    setPlaceholder: (state, action: PayloadAction<Partial<KnowledgeState>>) => {
      state.bases = action.payload.bases ?? state.bases
    }
  }
})

export const {
  // addBase,
  // deleteBase,
  // renameBase,
  // updateBase,
  // updateBases,
  // addItem,
  // addFiles,
  // updateNotes,
  // removeItem,
  // updateItem,
  // updateItemProcessingStatus,
  // clearCompletedProcessing,
  // clearAllProcessing,
  // updateBaseItemUniqueId,
  // updateBaseItemIsPreprocessed,
  // syncPreprocessProvider,
  setPlaceholder
} = knowledgeSlice.actions

export default knowledgeSlice.reducer
