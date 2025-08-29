import { db } from '@renderer/databases'
import KnowledgeQueue from '@renderer/queue/KnowledgeQueue'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { RootState, useAppDispatch } from '@renderer/store'
import {
  addBase,
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
import {
  addFilesThunk,
  addImagesThunk,
  addItemThunk,
  addNoteThunk,
  addVedioThunk
} from '@renderer/store/thunk/knowledgeThunk'
import { FileMetadata, KnowledgeBase, KnowledgeItem, MigrationModeEnum, ProcessingStatus } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import dayjs from 'dayjs'
import { cloneDeep } from 'lodash'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { useAgents } from './useAgents'
import { useAssistants } from './useAssistant'

export const useKnowledge = (baseId: string) => {
  const dispatch = useAppDispatch()
  const base = useSelector((state: RootState) => state.knowledge.bases.find((b) => b.id === baseId))
  const checkTimerRef = useRef<NodeJS.Timeout>(undefined)

  // 重命名知识库
  const renameKnowledgeBase = (name: string) => {
    dispatch(renameBase({ baseId, name }))
  }

  // 更新知识库
  const updateKnowledgeBase = (base: KnowledgeBase) => {
    dispatch(updateBase(base))
  }

  useEffect(() => {
    return () => {
      clearTimeout(checkTimerRef.current)
    }
  }, [])

  // 检查知识库
  const checkAllBases = () => {
    clearTimeout(checkTimerRef.current)
    checkTimerRef.current = setTimeout(() => KnowledgeQueue.checkAllBases(), 0)
  }

  // 批量添加文件
  const addFiles = (files: FileMetadata[]) => {
    dispatch(addFilesThunk(baseId, files))
    checkAllBases()
  }

  // 添加笔记
  const addNote = async (content: string) => {
    await dispatch(addNoteThunk(baseId, content))
    checkAllBases()
  }

  // 添加URL
  const addUrl = (url: string) => {
    dispatch(addItemThunk(baseId, 'url', url))
    checkAllBases()
  }

  // 添加 Sitemap
  const addSitemap = (url: string) => {
    dispatch(addItemThunk(baseId, 'sitemap', url))
    checkAllBases()
  }

  // Add directory support
  const addDirectory = (path: string) => {
    dispatch(addItemThunk(baseId, 'directory', path))
    checkAllBases()
  }

  // add video support
  const addVideo = (files: FileMetadata[]) => {
    dispatch(addVedioThunk(baseId, 'video', files))
    setTimeout(() => KnowledgeQueue.checkAllBases(), 0)
  }

  const addImages = (files: FileMetadata[]) => {
    dispatch(addImagesThunk(baseId, files))
    setTimeout(() => KnowledgeQueue.checkAllBases(), 0)
  }

  // 更新笔记内容
  const updateNoteContent = async (noteId: string, content: string) => {
    const note = await db.knowledge_notes.get(noteId)
    if (note) {
      const updatedNote = {
        ...note,
        content,
        updated_at: Date.now()
      }
      await db.knowledge_notes.put(updatedNote)
      dispatch(updateNotes({ baseId, item: updatedNote }))
    }
    const noteItem = base?.items.find((item) => item.id === noteId)
    noteItem && refreshItem(noteItem)
  }

  // 获取笔记内容
  const getNoteContent = async (noteId: string) => {
    return await db.knowledge_notes.get(noteId)
  }

  const updateItem = (item: KnowledgeItem) => {
    dispatch(updateItemAction({ baseId, item }))
  }

  // 移除项目
  const removeItem = async (item: KnowledgeItem) => {
    dispatch(removeItemAction({ baseId, item }))
    if (!base || !item?.uniqueId || !item?.uniqueIds) {
      return
    }

    const removalParams = {
      uniqueId: item.uniqueId,
      uniqueIds: item.uniqueIds,
      base: getKnowledgeBaseParams(base)
    }

    await window.api.knowledgeBase.remove(removalParams)

    if (item.type === 'file' && typeof item.content === 'object') {
      const file = item.content as FileMetadata
      // name: eg. text.pdf
      await window.api.file.delete(file.name)
    } else if (item.type === 'video') {
      // video item has srt and video files
      const files = item.content as FileMetadata[]
      const deletePromises = files.map((file) => window.api.file.delete(file.name))

      await Promise.allSettled(deletePromises)
    }
  }
  // 刷新项目
  const refreshItem = async (item: KnowledgeItem) => {
    const status = getProcessingStatus(item.id)

    if (status === 'pending' || status === 'processing') {
      return
    }

    if (!base || !item?.uniqueId || !item?.uniqueIds) {
      return
    }
    if (base && item.uniqueId && item.uniqueIds) {
      await window.api.knowledgeBase.remove({
        uniqueId: item.uniqueId,
        uniqueIds: item.uniqueIds,
        base: getKnowledgeBaseParams(base)
      })
      updateItem({
        ...item,
        processingStatus: 'pending',
        processingProgress: 0,
        processingError: '',
        uniqueId: undefined,
        updated_at: Date.now()
      })
      checkAllBases()
    }

    const removalParams = {
      uniqueId: item.uniqueId,
      uniqueIds: item.uniqueIds,
      base: getKnowledgeBaseParams(base)
    }

    await window.api.knowledgeBase.remove(removalParams)

    updateItem({
      ...item,
      processingStatus: 'pending',
      processingProgress: 0,
      processingError: '',
      uniqueId: undefined,
      updated_at: Date.now()
    })
    setTimeout(() => KnowledgeQueue.checkAllBases(), 0)
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
  const migrateBase = async (newBase: KnowledgeBase, mode: MigrationModeEnum) => {
    if (!base) return

    const timestamp = dayjs().format('YYMMDDHHmmss')
    const newName = `${newBase.name || base.name}-${timestamp}`

    const migratedBase = {
      ...cloneDeep(base), // 深拷贝原始知识库
      ...newBase,
      id: newBase.id, // 确保使用新的ID
      name: newName,
      created_at: Date.now(),
      updated_at: Date.now(),
      items: [],
      framework: mode === MigrationModeEnum.MigrationToLangChain ? 'langchain' : base.framework
    } as KnowledgeBase

    if (mode === MigrationModeEnum.MigrationToLangChain) {
      await window.api.knowledgeBase.create(getKnowledgeBaseParams(migratedBase))
    }

    dispatch(addBase(migratedBase))

    const files: FileMetadata[] = []

    // 遍历原知识库的 items，重新添加到新知识库
    for (const item of base.items) {
      switch (item.type) {
        case 'file':
          if (typeof item.content === 'object' && item.content !== null && 'path' in item.content) {
            files.push(item.content as FileMetadata)
          }
          break
        case 'note':
          try {
            const note = await db.knowledge_notes.get(item.id)
            const content = (note?.content || '') as string
            await dispatch(addNoteThunk(newBase.id, content))
          } catch (error) {
            throw new Error(`Failed to migrate note item ${item.id}: ${error}`)
          }
          break
        default:
          try {
            dispatch(addItemThunk(newBase.id, item.type, item.content as string))
          } catch (error) {
            throw new Error(`Failed to migrate item ${item.id}: ${error}`)
          }
          break
      }
    }

    try {
      if (files.length > 0) {
        dispatch(addFilesThunk(newBase.id, files))
      }
    } catch (error) {
      throw new Error(`Failed to migrate files ${files}: ${error}`)
    }

    checkAllBases()
  }

  const fileItems = base?.items.filter((item) => item.type === 'file') || []
  const directoryItems = base?.items.filter((item) => item.type === 'directory') || []
  const urlItems = base?.items.filter((item) => item.type === 'url') || []
  const sitemapItems = base?.items.filter((item) => item.type === 'sitemap') || []
  const [noteItems, setNoteItems] = useState<KnowledgeItem[]>([])
  const videoItems = base?.items.filter((item) => item.type === 'video') || []
  const imageItems = base?.items.filter((item) => item.type === 'image') || []

  useEffect(() => {
    const notes = base?.items.filter((item) => item.type === 'note') || []
    runAsyncFunction(async () => {
      const newNoteItems = await Promise.all(
        notes.map(async (item) => {
          const note = await db.knowledge_notes.get(item.id)
          return { ...item, content: note?.content || '' }
        })
      )
      setNoteItems(newNoteItems.filter((note) => note !== undefined) as KnowledgeItem[])
    })
  }, [base?.items])

  return {
    base,
    fileItems,
    urlItems,
    sitemapItems,
    noteItems,
    videoItems,
    imageItems,
    renameKnowledgeBase,
    updateKnowledgeBase,
    migrateBase,
    addFiles,
    addUrl,
    addSitemap,
    addNote,
    addVideo,
    addImages,
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
  const { agents, updateAgents } = useAgents()

  const addKnowledgeBase = (base: KnowledgeBase) => {
    dispatch(addBase(base))
  }

  const renameKnowledgeBase = (baseId: string, name: string) => {
    dispatch(renameBase({ baseId, name }))
  }

  const deleteKnowledgeBase = (baseId: string) => {
    const base = bases.find((b) => b.id === baseId)
    if (!base) return
    dispatch(deleteBase({ baseId, baseParams: getKnowledgeBaseParams(base) }))

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
    const _agents = agents.map((agent) => {
      if (agent.knowledge_bases?.find((kb) => kb.id === baseId)) {
        return {
          ...agent,
          knowledge_bases: agent.knowledge_bases.filter((kb) => kb.id !== baseId)
        }
      }
      return agent
    })

    updateAssistants(_assistants)
    updateAgents(_agents)
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
