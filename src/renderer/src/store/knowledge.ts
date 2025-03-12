import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import FileManager from '@renderer/services/FileManager'
import { FileType, KnowledgeBase, KnowledgeItem, ProcessingStatus } from '@renderer/types'

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
        FileManager.deleteFiles(files.map((item) => item.content) as FileType[])
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
          // 确保自身的created_at和updated_at是时间戳
          action.payload.item.created_at = new Date(action.payload.item.created_at).getTime()
          action.payload.item.updated_at = new Date(action.payload.item.updated_at).getTime()

          // 确保文件内容中的created_at和updated_at也是时间戳
          if (action.payload.item.content && typeof action.payload.item.content === 'object') {
            const content = action.payload.item.content as any
            if (content.created_at) {
              content.created_at = new Date(content.created_at).getTime()
            }
            if (content.updated_at) {
              content.updated_at = new Date(content.updated_at).getTime()
            }
          }

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
        // 处理所有项目中的日期，确保都是时间戳
        const serializedItems = action.payload.items.map((item) => {
          // 处理项目自身的日期字段
          item.created_at = new Date(item.created_at).getTime()
          item.updated_at = new Date(item.updated_at).getTime()

          // 处理file类型项目中content的日期字段
          if (item.type === 'file' && item.content && typeof item.content === 'object') {
            const content = item.content as any
            if (content.created_at) {
              content.created_at = new Date(content.created_at).getTime()
            }
            if (content.updated_at) {
              content.updated_at = new Date(content.updated_at).getTime()
            }
          }

          return item
        })

        base.items = [...base.items, ...serializedItems]
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

          // 确保文件内容中的date对象也被序列化
          if (item.type === 'file' && item.content && typeof item.content === 'object') {
            const content = item.content as any
            if (content.created_at && content.created_at instanceof Date) {
              content.created_at = content.created_at.getTime()
            }
            if (content.updated_at && content.updated_at instanceof Date) {
              content.updated_at = content.updated_at.getTime()
            }
          }
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
      if (base) {
        const item = base.items.find((item) => item.id === action.payload.itemId)
        if (item) {
          item.uniqueId = action.payload.uniqueId
          item.uniqueIds = action.payload.uniqueIds
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
  updateBaseItemUniqueId
} = knowledgeSlice.actions

export default knowledgeSlice.reducer
