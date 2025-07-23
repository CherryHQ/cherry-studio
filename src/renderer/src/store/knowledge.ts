import { loggerService } from '@logger'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import FileManager from '@renderer/services/FileManager'
import { FileMetadata, KnowledgeBase, KnowledgeItem, ProcessingStatus } from '@renderer/types'

const logger = loggerService.withContext('Store:Knowledge')

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
    addBase(state, action: PayloadAction<KnowledgeBase>) {
      state.bases.push(action.payload)
    },

    deleteBase(state, action: PayloadAction<{ baseId: string }>) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      if (base) {
        state.bases = state.bases.filter((b) => b.id !== action.payload.baseId)
        const files = base.items.filter((item) => item.type === 'file')
        FileManager.deleteFiles(files.map((item) => item.content) as FileMetadata[])
        window.api.knowledgeBase.delete(action.payload.baseId)
      }
    },

    renameBase(state, action: PayloadAction<{ baseId: string; name: string }>) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      if (base) {
        base.name = action.payload.name
        base.updated_at = Date.now()
      }
    },

    updateBase(state, action: PayloadAction<KnowledgeBase>) {
      const index = state.bases.findIndex((b) => b.id === action.payload.id)
      if (index !== -1) {
        state.bases[index] = action.payload
      }
    },

    updateBases(state, action: PayloadAction<KnowledgeBase[]>) {
      state.bases = action.payload
    },

    addItem(state, action: PayloadAction<{ baseId: string; item: KnowledgeItem }>) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      if (base) {
        if (action.payload.item.type === 'file') {
          action.payload.item.created_at = new Date(action.payload.item.created_at).getTime()
          action.payload.item.updated_at = new Date(action.payload.item.updated_at).getTime()
          base.items.push(action.payload.item)
        }
        if (action.payload.item.type === 'directory') {
          const directoryExists = base.items.some((item) => item.content === action.payload.item.content)
          if (!directoryExists) {
            base.items.push(action.payload.item)
          }
        }
        if (action.payload.item.type === 'url') {
          const urlExists = base.items.some((item) => item.content === action.payload.item.content)
          if (!urlExists) {
            base.items.push(action.payload.item)
          }
        }
        if (action.payload.item.type === 'sitemap') {
          const sitemapExists = base.items.some((item) => item.content === action.payload.item.content)
          if (!sitemapExists) {
            base.items.push(action.payload.item)
          }
        }
        if (action.payload.item.type === 'note') {
          base.items.push(action.payload.item)
        }
        base.updated_at = Date.now()
      }
    },

    removeItem(state, action: PayloadAction<{ baseId: string; item: KnowledgeItem }>) {
      const { baseId } = action.payload
      const base = state.bases.find((b) => b.id === baseId)
      if (base) {
        base.items = base.items.filter((item) => item.id !== action.payload.item.id)
        base.updated_at = Date.now()
      }
    },

    updateItem(state, action: PayloadAction<{ baseId: string; item: KnowledgeItem }>) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      if (base) {
        const index = base.items.findIndex((item) => item.id === action.payload.item.id)
        if (index !== -1) {
          base.items[index] = action.payload.item
        }
      }
    },

    addFiles(state, action: PayloadAction<{ baseId: string; items: KnowledgeItem[] }>) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      if (base) {
        base.items = [...base.items, ...action.payload.items]
        base.updated_at = Date.now()
      }
    },

    updateNotes(state, action: PayloadAction<{ baseId: string; item: KnowledgeItem }>) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      if (base) {
        const existingNoteIndex = base.items.findIndex(
          (item) => item.type === 'note' && item.id === action.payload.item.id
        )
        if (existingNoteIndex !== -1) {
          base.items[existingNoteIndex] = action.payload.item
        } else {
          base.items.push(action.payload.item)
        }
        base.updated_at = Date.now()
      }
    },

    updateItemProcessingStatus(
      state,
      action: PayloadAction<{
        baseId: string
        itemId: string
        status: ProcessingStatus
        progress?: number
        error?: string
        retryCount?: number
      }>
    ) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      if (base) {
        const item = base.items.find((item) => item.id === action.payload.itemId)
        if (item) {
          item.processingStatus = action.payload.status
          item.processingProgress = action.payload.progress
          item.processingError = action.payload.error
          item.retryCount = action.payload.retryCount
        }
      }
    },

    clearCompletedProcessing(state, action: PayloadAction<{ baseId: string }>) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      if (base) {
        base.items.forEach((item) => {
          if (item.processingStatus === 'completed' || item.processingStatus === 'failed') {
            item.processingStatus = undefined
            item.processingProgress = undefined
            item.processingError = undefined
            item.retryCount = undefined
          }
        })
      }
    },

    clearAllProcessing(state, action: PayloadAction<{ baseId: string }>) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      if (base) {
        base.items.forEach((item) => {
          item.processingStatus = undefined
          item.processingProgress = undefined
          item.processingError = undefined
          item.retryCount = undefined
        })
      }
    },

    updateBaseItemUniqueId(
      state,
      action: PayloadAction<{ baseId: string; itemId: string; uniqueId: string; uniqueIds: string[] }>
    ) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      logger.silly('base2', base)
      if (base) {
        const item = base.items.find((item) => item.id === action.payload.itemId)
        if (item) {
          item.uniqueId = action.payload.uniqueId
          item.uniqueIds = action.payload.uniqueIds
        }
      }
    },

    updateBaseItemIsPreprocessed(
      state,
      action: PayloadAction<{ baseId: string; itemId: string; isPreprocessed: boolean }>
    ) {
      const base = state.bases.find((b) => b.id === action.payload.baseId)
      logger.silly('base', base)
      if (base) {
        const item = base.items.find((item) => item.id === action.payload.itemId)
        logger.silly('item', item)
        if (item) {
          item.isPreprocessed = action.payload.isPreprocessed
        }
      }
    }
  }
})

export const {
  addBase,
  deleteBase,
  renameBase,
  updateBase,
  updateBases,
  addItem,
  addFiles,
  updateNotes,
  removeItem,
  updateItem,
  updateItemProcessingStatus,
  clearCompletedProcessing,
  clearAllProcessing,
  updateBaseItemUniqueId,
  updateBaseItemIsPreprocessed
} = knowledgeSlice.actions

export default knowledgeSlice.reducer
