import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { db } from '@renderer/databases'
import type { RootState } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import {
  addBase,
  addFiles as addFilesAction,
  addItem,
  clearAllProcessing,
  clearCompletedProcessing,
  deleteBase,
  removeItem as removeItemAction,
  renameBase,
  updateBase,
  updateBases,
  updateItem as updateItemAction,
  updateItemProcessingStatus,
  updateNotes
} from '@renderer/store/knowledge'
import type { FileMetadata, KnowledgeBase, KnowledgeItem, KnowledgeNoteItem, ProcessingStatus } from '@renderer/types'
import { isKnowledgeFileItem, isKnowledgeNoteItem } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import type { CreateKnowledgeItemDto } from '@shared/data/api/schemas/knowledge'
import type {
  DirectoryItemData,
  FileItemData,
  ItemStatus,
  KnowledgeItem as KnowledgeItemV2,
  NoteItemData,
  SitemapItemData,
  UrlItemData
} from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { cloneDeep } from 'lodash'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { useAssistants } from './useAssistant'
import { useAssistantPresets } from './useAssistantPresets'
import {
  useKnowledgeDirectories,
  useKnowledgeFiles,
  useKnowledgeNotes,
  useKnowledgeSitemaps,
  useKnowledgeUrls
} from './useKnowledge.v2'

const logger = loggerService.withContext('useKnowledge')

const mapV2StatusToV1 = (status: ItemStatus): KnowledgeItem['processingStatus'] => {
  const statusMap: Record<ItemStatus, KnowledgeItem['processingStatus']> = {
    idle: 'pending',
    pending: 'pending',
    preprocessing: 'processing',
    embedding: 'processing',
    completed: 'completed',
    failed: 'failed'
  }
  return statusMap[status] ?? 'pending'
}

const toV1Item = (item: KnowledgeItemV2): KnowledgeItem => {
  switch (item.type) {
    case 'file': {
      const data = item.data as FileItemData
      return {
        id: item.id,
        type: item.type,
        content: data.file,
        created_at: Date.parse(item.createdAt),
        updated_at: Date.parse(item.updatedAt),
        processingStatus: mapV2StatusToV1(item.status),
        processingProgress: 0,
        processingError: item.error ?? '',
        retryCount: 0
      }
    }
    case 'directory': {
      const data = item.data as DirectoryItemData
      return {
        id: item.id,
        type: item.type,
        content: data.path,
        created_at: Date.parse(item.createdAt),
        updated_at: Date.parse(item.updatedAt),
        processingStatus: mapV2StatusToV1(item.status),
        processingProgress: 0,
        processingError: item.error ?? '',
        retryCount: 0
      }
    }
    case 'url': {
      const data = item.data as UrlItemData
      return {
        id: item.id,
        type: item.type,
        content: data.url,
        remark: data.name !== data.url ? data.name : undefined,
        created_at: Date.parse(item.createdAt),
        updated_at: Date.parse(item.updatedAt),
        processingStatus: mapV2StatusToV1(item.status),
        processingProgress: 0,
        processingError: item.error ?? '',
        retryCount: 0
      }
    }
    case 'sitemap': {
      const data = item.data as SitemapItemData
      return {
        id: item.id,
        type: item.type,
        content: data.url,
        remark: data.name !== data.url ? data.name : undefined,
        created_at: Date.parse(item.createdAt),
        updated_at: Date.parse(item.updatedAt),
        processingStatus: mapV2StatusToV1(item.status),
        processingProgress: 0,
        processingError: item.error ?? '',
        retryCount: 0
      }
    }
    case 'note': {
      const data = item.data as NoteItemData
      return {
        id: item.id,
        type: item.type,
        content: data.content,
        created_at: Date.parse(item.createdAt),
        updated_at: Date.parse(item.updatedAt),
        processingStatus: mapV2StatusToV1(item.status),
        processingProgress: 0,
        processingError: item.error ?? '',
        retryCount: 0
      }
    }
    default:
      return {
        id: item.id,
        type: item.type,
        content: '',
        created_at: Date.parse(item.createdAt),
        updated_at: Date.parse(item.updatedAt),
        processingStatus: mapV2StatusToV1(item.status),
        processingProgress: 0,
        processingError: item.error ?? '',
        retryCount: 0
      }
  }
}

export const useKnowledge = (baseId: string) => {
  const dispatch = useAppDispatch()
  const base = useSelector((state: RootState) => state.knowledge.bases.find((b) => b.id === baseId))
  const { addFiles: addFilesV2 } = useKnowledgeFiles(baseId)
  const { addNote: addNoteV2 } = useKnowledgeNotes(baseId)
  const { addUrl: addUrlV2 } = useKnowledgeUrls(baseId)
  const { addSitemap: addSitemapV2 } = useKnowledgeSitemaps(baseId)
  const { addDirectory: addDirectoryV2 } = useKnowledgeDirectories(baseId)

  // 重命名知识库
  const renameKnowledgeBase = (name: string) => {
    void dataApiService
      .patch(`/knowledge-bases/${baseId}` as any, {
        body: { name }
      })
      .catch((error) => {
        logger.error('Failed to rename knowledge base via Data API', error as Error, { baseId })
      })
    dispatch(renameBase({ baseId, name }))
  }

  // 更新知识库
  const updateKnowledgeBase = (base: KnowledgeBase) => {
    void dataApiService
      .patch(`/knowledge-bases/${base.id}` as any, {
        body: {
          name: base.name,
          description: base.description,
          embeddingModelId: `${base.model.provider}:${base.model.id}`,
          embeddingModelMeta: {
            id: base.model.id,
            provider: base.model.provider,
            name: base.model.name,
            dimensions: base.dimensions
          },
          rerankModelId: base.rerankModel ? `${base.rerankModel.provider}:${base.rerankModel.id}` : undefined,
          rerankModelMeta: base.rerankModel
            ? { id: base.rerankModel.id, provider: base.rerankModel.provider, name: base.rerankModel.name }
            : undefined,
          preprocessProviderId: base.preprocessProvider?.provider.id,
          chunkSize: base.chunkSize,
          chunkOverlap: base.chunkOverlap,
          threshold: base.threshold
        }
      })
      .catch((error) => {
        logger.error('Failed to update knowledge base via Data API', error as Error, { baseId: base.id })
      })
    dispatch(updateBase(base))
  }

  // 批量添加文件
  const addFiles = (files: FileMetadata[]) => {
    return addFilesV2(files)
  }

  // 添加笔记
  const addNote = async (content: string) => {
    return addNoteV2(content)
  }

  // 添加URL
  const addUrl = (url: string) => {
    return addUrlV2(url)
  }

  // 添加 Sitemap
  const addSitemap = (url: string) => {
    return addSitemapV2(url)
  }

  // Add directory support
  const addDirectory = (path: string) => {
    return addDirectoryV2(path)
  }

  // 更新笔记内容
  const updateNoteContent = async (noteId: string, content: string) => {
    const noteItem = base?.items.find((item) => item.id === noteId)
    const updatedAt = Date.now()

    try {
      await dataApiService.patch(`/knowledges/${noteId}` as any, {
        body: {
          data: {
            type: 'note',
            content
          } satisfies NoteItemData
        }
      })
    } catch (error) {
      logger.error('Failed to update note content via Data API', error as Error, { noteId })
      throw error
    }

    if (noteItem) {
      dispatch(
        updateNotes({
          baseId,
          item: {
            ...noteItem,
            content,
            updated_at: updatedAt
          }
        })
      )
    }

    const note = await db.knowledge_notes.get(noteId)
    if (note) {
      await db.knowledge_notes.put({ ...note, content, updated_at: updatedAt })
    }

    if (noteItem) {
      await refreshItem(noteItem)
    }
  }

  // 获取笔记内容
  const getNoteContent = async (noteId: string) => {
    const note = await db.knowledge_notes.get(noteId)
    if (note) {
      return note
    }

    const noteItem = base?.items.find((item) => item.id === noteId)
    if (noteItem && typeof noteItem.content === 'string') {
      return {
        ...noteItem,
        content: noteItem.content
      }
    }

    return undefined
  }

  const updateItem = (item: KnowledgeItem) => {
    dispatch(updateItemAction({ baseId, item }))
  }

  // 移除项目
  const removeItem = async (item: KnowledgeItem) => {
    if (!base || !item?.id) {
      return
    }

    try {
      await dataApiService.delete(`/knowledges/${item.id}` as any)
      dispatch(removeItemAction({ baseId, item }))

      if (isKnowledgeFileItem(item) && typeof item.content === 'object' && !Array.isArray(item.content)) {
        const file = item.content
        // name: eg. text.pdf
        await window.api.file.delete(file.name)
      }
    } catch (error) {
      logger.error('Failed to delete knowledge item via Data API', error as Error, { itemId: item.id })
      throw error
    }
  }
  // 刷新项目
  const refreshItem = async (item: KnowledgeItem) => {
    const status = getProcessingStatus(item.id)

    if (status === 'pending' || status === 'processing') {
      return
    }

    try {
      await dataApiService.post(`/knowledges/${item.id}/refresh` as any, { body: undefined })
      updateItem({
        ...item,
        processingStatus: 'pending',
        processingProgress: 0,
        processingError: '',
        retryCount: 0,
        updated_at: Date.now()
      })
    } catch (error) {
      logger.error('Failed to refresh knowledge item via Data API', error as Error, { itemId: item.id })
      throw error
    }
  }

  // 更新处理状态
  const updateItemStatus = (itemId: string, status: ProcessingStatus, progress?: number, error?: string) => {
    dispatch(
      updateItemProcessingStatus({
        baseId,
        itemId,
        status,
        progress,
        error
      })
    )
  }

  // 获取特定项目的处理状态
  const getProcessingStatus = useCallback(
    (itemId: string) => {
      return base?.items.find((item) => item.id === itemId)?.processingStatus
    },
    [base?.items]
  )

  // Use ref to store latest base to avoid recreating syncItemsFromApi on every base change
  const baseRef = useRef(base)
  baseRef.current = base

  const syncItemsFromApi = useCallback(async () => {
    const currentBase = baseRef.current
    if (!baseId || !currentBase) {
      return
    }

    try {
      const fetchedItems: KnowledgeItemV2[] = []
      let page = 1
      let total = 0

      do {
        const response = await dataApiService.get(`/knowledge-bases/${baseId}/items` as any, {
          query: { page, limit: 100 }
        })
        fetchedItems.push(...response.items)
        total = response.total ?? fetchedItems.length
        page += 1
      } while (fetchedItems.length < total)

      fetchedItems.forEach((item) => {
        const existing = currentBase.items.find((current) => current.id === item.id)
        const nextStatus = mapV2StatusToV1(item.status)

        if (existing) {
          const nextItem: KnowledgeItem = {
            ...existing,
            processingStatus: nextStatus,
            processingError: item.error ?? '',
            updated_at: Date.parse(item.updatedAt)
          }

          if (item.type === 'note') {
            const data = item.data as NoteItemData
            if (data.content) {
              nextItem.content = data.content
            }
          }

          dispatch(updateItemAction({ baseId, item: nextItem }))
        } else {
          const v1Item = toV1Item(item)
          if (v1Item.type === 'file') {
            dispatch(addFilesAction({ baseId, items: [v1Item] }))
          } else if (v1Item.type === 'note') {
            dispatch(updateNotes({ baseId, item: v1Item }))
          } else {
            dispatch(addItem({ baseId, item: v1Item }))
          }
        }
      })
    } catch (error) {
      logger.error('Failed to sync knowledge items from Data API', error as Error, { baseId })
    }
  }, [baseId, dispatch])

  // Initial sync and polling for active items
  useEffect(() => {
    if (!baseId) {
      return
    }

    // Initial sync
    void syncItemsFromApi()
  }, [baseId, syncItemsFromApi])

  // Separate effect for polling when there are active items
  useEffect(() => {
    if (!baseId) {
      return
    }

    const hasActiveItems = base?.items.some(
      (item) => item.processingStatus === 'pending' || item.processingStatus === 'processing'
    )

    if (!hasActiveItems) {
      return
    }

    const intervalId = setInterval(() => {
      void syncItemsFromApi()
    }, 5000)

    return () => {
      clearInterval(intervalId)
    }
  }, [base?.items, baseId, syncItemsFromApi])

  // 获取特定类型的所有处理项
  const getProcessingItemsByType = (type: 'file' | 'url' | 'note') => {
    return base?.items.filter((item) => item.type === type && item.processingStatus !== undefined) || []
  }

  // 清除已完成的项目
  const clearCompleted = () => {
    dispatch(clearCompletedProcessing({ baseId }))
  }

  // 清除所有处理状态
  const clearAll = () => {
    dispatch(clearAllProcessing({ baseId }))
  }

  // 迁移知识库（保留原知识库）
  const migrateBase = async (newBase: KnowledgeBase) => {
    if (!base) return null

    const timestamp = dayjs().format('YYMMDDHHmmss')
    const newName = `${newBase.name || base.name}-${timestamp}`

    try {
      const createdBase = await dataApiService.post('/knowledge-bases', {
        body: {
          name: newName,
          description: newBase.description,
          embeddingModelId: `${newBase.model.provider}:${newBase.model.id}`,
          embeddingModelMeta: {
            id: newBase.model.id,
            provider: newBase.model.provider,
            name: newBase.model.name,
            dimensions: newBase.dimensions
          },
          rerankModelId: newBase.rerankModel ? `${newBase.rerankModel.provider}:${newBase.rerankModel.id}` : undefined,
          rerankModelMeta: newBase.rerankModel
            ? {
                id: newBase.rerankModel.id,
                provider: newBase.rerankModel.provider,
                name: newBase.rerankModel.name
              }
            : undefined,
          preprocessProviderId: newBase.preprocessProvider?.provider.id,
          chunkSize: newBase.chunkSize,
          chunkOverlap: newBase.chunkOverlap,
          threshold: newBase.threshold
        }
      })

      const migratedBase: KnowledgeBase = {
        ...cloneDeep(base),
        ...newBase,
        id: createdBase.id,
        name: createdBase.name,
        created_at: Date.parse(createdBase.createdAt),
        updated_at: Date.parse(createdBase.updatedAt),
        items: []
      }

      dispatch(addBase(migratedBase))

      const itemsPayload: CreateKnowledgeItemDto[] = []

      for (const item of base.items) {
        switch (item.type) {
          case 'file':
            if (typeof item.content === 'object' && item.content !== null && 'path' in item.content) {
              itemsPayload.push({
                type: 'file',
                data: { type: 'file', file: item.content } satisfies FileItemData
              })
            }
            break
          case 'note': {
            const note = await db.knowledge_notes.get(item.id)
            const content = note?.content || (typeof item.content === 'string' ? item.content : '')
            itemsPayload.push({
              type: 'note',
              data: { type: 'note', content } satisfies NoteItemData
            })
            break
          }
          case 'url':
            if (typeof item.content === 'string') {
              itemsPayload.push({
                type: 'url',
                data: { type: 'url', url: item.content, name: item.remark || item.content } satisfies UrlItemData
              })
            }
            break
          case 'sitemap':
            if (typeof item.content === 'string') {
              itemsPayload.push({
                type: 'sitemap',
                data: {
                  type: 'sitemap',
                  url: item.content,
                  name: item.remark || item.content
                } satisfies SitemapItemData
              })
            }
            break
          case 'directory':
            if (typeof item.content === 'string') {
              itemsPayload.push({
                type: 'directory',
                data: { type: 'directory', path: item.content } satisfies DirectoryItemData
              })
            }
            break
          default:
            break
        }
      }

      if (itemsPayload.length > 0) {
        const result = await dataApiService.post(`/knowledge-bases/${migratedBase.id}/items`, {
          body: { items: itemsPayload }
        })

        const createdItems = result.items
        const v1Items = createdItems.map(toV1Item)
        const v1Files = v1Items.filter((item) => item.type === 'file')
        const v1Notes = v1Items.filter((item) => item.type === 'note')
        const v1Others = v1Items.filter((item) => item.type !== 'file' && item.type !== 'note')

        if (v1Files.length > 0) {
          dispatch(addFilesAction({ baseId: migratedBase.id, items: v1Files }))
        }

        v1Others.forEach((item) => {
          dispatch(addItem({ baseId: migratedBase.id, item }))
        })

        v1Notes.forEach((item) => {
          dispatch(updateNotes({ baseId: migratedBase.id, item }))
        })
      }

      return migratedBase
    } catch (error) {
      logger.error('Knowledge base migration failed via Data API', error as Error, { baseId: base.id })
      throw error
    }
  }

  const fileItems = base?.items.filter((item) => item.type === 'file') || []
  const directoryItems = base?.items.filter((item) => item.type === 'directory') || []
  const urlItems = base?.items.filter((item) => item.type === 'url') || []
  const sitemapItems = base?.items.filter((item) => item.type === 'sitemap') || []
  const [noteItems, setNoteItems] = useState<KnowledgeItem[]>([])

  useEffect(() => {
    const notes = base?.items.filter(isKnowledgeNoteItem) ?? []
    runAsyncFunction(async () => {
      const newNoteItems = await Promise.all(
        notes.map(async (item) => {
          const note = await db.knowledge_notes.get(item.id)
          const content = note?.content ?? (typeof item.content === 'string' ? item.content : '')
          return { ...item, content } satisfies KnowledgeNoteItem
        })
      )
      setNoteItems(newNoteItems)
    })
  }, [base?.items])

  return {
    base,
    fileItems,
    urlItems,
    sitemapItems,
    noteItems,
    renameKnowledgeBase,
    updateKnowledgeBase,
    migrateBase,
    addFiles,
    addUrl,
    addSitemap,
    addNote,
    updateNoteContent,
    getNoteContent,
    updateItem,
    updateItemStatus,
    refreshItem,
    getProcessingStatus,
    getProcessingItemsByType,
    clearCompleted,
    clearAll,
    removeItem,
    directoryItems,
    addDirectory
  }
}

export const useKnowledgeBases = () => {
  const dispatch = useDispatch()
  const bases = useSelector((state: RootState) => state.knowledge.bases)
  const { assistants, updateAssistants } = useAssistants()
  const { presets, setAssistantPresets } = useAssistantPresets()

  const addKnowledgeBase = (base: KnowledgeBase) => {
    dispatch(addBase(base))
  }

  const renameKnowledgeBase = (baseId: string, name: string) => {
    void dataApiService
      .patch(`/knowledge-bases/${baseId}` as any, {
        body: { name }
      })
      .catch((error) => {
        logger.error('Failed to rename knowledge base via Data API', error as Error, { baseId })
      })
    dispatch(renameBase({ baseId, name }))
  }

  const deleteKnowledgeBase = (baseId: string) => {
    const base = bases.find((b) => b.id === baseId)
    if (!base) return
    void dataApiService.delete(`/knowledge-bases/${baseId}` as any).catch((error) => {
      logger.error('Failed to delete knowledge base via Data API', error as Error, { baseId })
    })
    dispatch(deleteBase({ baseId }))

    // remove assistant knowledge_base
    const _assistants = assistants.map((assistant) => {
      if (assistant.knowledge_bases?.find((kb) => kb.id === baseId)) {
        return {
          ...assistant,
          knowledge_bases: assistant.knowledge_bases.filter((kb) => kb.id !== baseId)
        }
      }
      return assistant
    })

    // remove agent knowledge_base
    const _presets = presets.map((agent) => {
      if (agent.knowledge_bases?.find((kb) => kb.id === baseId)) {
        return {
          ...agent,
          knowledge_bases: agent.knowledge_bases.filter((kb) => kb.id !== baseId)
        }
      }
      return agent
    })

    updateAssistants(_assistants)
    setAssistantPresets(_presets)
  }

  const updateKnowledgeBases = (bases: KnowledgeBase[]) => {
    dispatch(updateBases(bases))
  }

  return {
    bases,
    addKnowledgeBase,
    renameKnowledgeBase,
    deleteKnowledgeBase,
    updateKnowledgeBases
  }
}
