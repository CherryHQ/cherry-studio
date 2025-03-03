/* eslint-disable react-hooks/rules-of-hooks */
import { db } from '@renderer/databases/index'
import KnowledgeQueue from '@renderer/queue/KnowledgeQueue'
import FileManager from '@renderer/services/FileManager'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { NotionService } from '@renderer/services/NotionService'
import { RootState } from '@renderer/store'
import {
  addBase,
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
import { FileType, FileTypes, KnowledgeBase, ProcessingStatus } from '@renderer/types'
import { KnowledgeItem } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { message } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import { v4 as uuidv4 } from 'uuid'

import { useAgents } from './useAgents'
import { useAssistants } from './useAssistant'

export const useKnowledge = (baseId: string) => {
  const dispatch = useDispatch()
  const base = useSelector((state: RootState) => state.knowledge.bases.find((b) => b.id === baseId))
  const { t } = useTranslation()

  // 重命名知识库
  const renameKnowledgeBase = (name: string) => {
    dispatch(renameBase({ baseId, name }))
  }

  const queryKnowledgeBase = async (baseId: string) => {
    const base = await db.knowledge_notes.get(baseId)
    return base
  }

  // 更新知识库
  const updateKnowledgeBase = (base: KnowledgeBase) => {
    dispatch(updateBase(base))
  }

  // 批量添加文件
  const addFiles = (files: FileType[]) => {
    files.forEach((file) => {
      // 检查文件是否来自外部源
      const isExternal = !!file.externalSource

      dispatch(
        addItem({
          baseId,
          item: {
            id: file.id,
            uniqueId: file.id,
            type: isExternal ? 'external' : 'file', // 确保类型正确
            content: file,
            processingStatus: 'pending',
            processingProgress: 0,
            processingError: '',
            retryCount: 0,
            created_at: Date.now(),
            updated_at: Date.now()
          }
        })
      )
    })

    // 触发处理队列
    setTimeout(() => KnowledgeQueue.checkAllBases(), 0)
  }

  // 添加URL
  const addUrl = (url: string) => {
    const newUrlItem: KnowledgeItem = {
      id: uuidv4(),
      type: 'url' as const,
      content: url,
      created_at: Date.now(),
      updated_at: Date.now(),
      processingStatus: 'pending',
      processingProgress: 0,
      processingError: '',
      retryCount: 0
    }
    dispatch(addItem({ baseId, item: newUrlItem }))
    setTimeout(() => KnowledgeQueue.checkAllBases(), 0)
  }

  // 添加笔记
  const addNote = async (content: string) => {
    const noteId = uuidv4()
    const note: KnowledgeItem = {
      id: noteId,
      type: 'note',
      content,
      created_at: Date.now(),
      updated_at: Date.now()
    }

    // 存储完整笔记到数据库
    await db.knowledge_notes.add(note)

    // 在 store 中只存储引用
    const noteRef: KnowledgeItem = {
      id: noteId,
      baseId,
      type: 'note',
      content: '', // store中不需要存储实际内容
      created_at: Date.now(),
      updated_at: Date.now(),
      processingStatus: 'pending',
      processingProgress: 0,
      processingError: '',
      retryCount: 0
    }

    dispatch(updateNotes({ baseId, item: noteRef }))
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
    if (base) {
      if (item?.uniqueId && item?.uniqueIds) {
        await window.api.knowledgeBase.remove({
          uniqueId: item.uniqueId,
          uniqueIds: item.uniqueIds,
          base: getKnowledgeBaseParams(base)
        })
      }
    }
    if (item.type === 'file' && typeof item.content === 'object') {
      await FileManager.deleteFile(item.content.id)
    }
  }
  // 刷新项目
  const refreshItem = async (item: KnowledgeItem) => {
    const status = getProcessingStatus(item.id)

    if (status === 'pending' || status === 'processing') {
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
        uniqueId: undefined
      })
      setTimeout(() => KnowledgeQueue.checkAllBases(), 0)
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
  const getProcessingStatus = (itemId: string) => {
    return base?.items.find((item) => item.id === itemId)?.processingStatus
  }

  // 获取特定类型的所有处理项
  const getProcessingItemsByType = (type: 'file' | 'url' | 'note') => {
    return base?.items.filter((item) => item.type === type && item.processingStatus !== undefined) || []
  }

  // 获取目录处理进度
  const getDirectoryProcessingPercent = (itemId?: string) => {
    const [percent, setPercent] = useState<number>(0)

    useEffect(() => {
      if (!itemId) {
        return
      }

      const cleanup = window.electron.ipcRenderer.on(
        'directory-processing-percent',
        (_, { itemId: id, percent }: { itemId: string; percent: number }) => {
          if (itemId === id) {
            setPercent(percent)
          }
        }
      )

      return () => {
        cleanup()
      }
    }, [itemId])

    return percent
  }

  // 清除已完成的项目
  const clearCompleted = () => {
    dispatch(clearCompletedProcessing({ baseId }))
  }

  // 清除所有处理状态
  const clearAll = () => {
    dispatch(clearAllProcessing({ baseId }))
  }

  // 添加 Sitemap
  const addSitemap = (url: string) => {
    const newSitemapItem: KnowledgeItem = {
      id: uuidv4(),
      type: 'sitemap' as const,
      content: url,
      created_at: Date.now(),
      updated_at: Date.now(),
      processingStatus: 'pending',
      processingProgress: 0,
      processingError: '',
      retryCount: 0
    }
    dispatch(addItem({ baseId, item: newSitemapItem }))
    setTimeout(() => KnowledgeQueue.checkAllBases(), 0)
  }

  // Add directory support
  const addDirectory = (path: string) => {
    const newDirectoryItem: KnowledgeItem = {
      id: uuidv4(),
      type: 'directory',
      content: path,
      created_at: Date.now(),
      updated_at: Date.now(),
      processingStatus: 'pending',
      processingProgress: 0,
      processingError: '',
      retryCount: 0
    }
    dispatch(addItem({ baseId, item: newDirectoryItem }))
    setTimeout(() => KnowledgeQueue.checkAllBases(), 0)
  }

  const fileItems = base?.items.filter((item) => item.type === 'file') || []
  const directoryItems = base?.items.filter((item) => item.type === 'directory') || []
  const urlItems = base?.items.filter((item) => item.type === 'url') || []
  const sitemapItems = base?.items.filter((item) => item.type === 'sitemap') || []
  const externalItems = base?.items.filter((item) => item.type === 'external') || []
  const [noteItems, setNoteItems] = useState<KnowledgeItem[]>([])

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

  const importFromExternalSource = async (sourceType: string) => {
    if (!base) {
      return false
    }

    if (sourceType === 'notion') {
      // 获取 Notion 配置
      const notionConfig = base.externalImports?.type === 'notion' ? base.externalImports.notionConfig : undefined

      if (!notionConfig?.apiKey || !notionConfig?.databaseId) {
        message.error(t('knowledge.notion_config_missing'))
        return false
      }

      try {
        const notionService = new NotionService(notionConfig.apiKey)
        const externalFiles = await notionService.getDatabaseContent(notionConfig.databaseId, externalItems)
        const newItems = externalFiles.map((file) => ({
          ...file,
          uniqueId: file.id,
          uniqueIds: [file.id],
          externalSource: 'notion'
        }))
        addFiles(newItems as FileType[])
        return true
      } catch (error) {
        console.error(`Failed to import from Notion:`, error)
        return false
      }
    }

    // Add other external sources as needed
    return false
  }

  return {
    base,
    fileItems,
    externalItems,
    urlItems,
    sitemapItems,
    noteItems,
    renameKnowledgeBase,
    updateKnowledgeBase,
    queryKnowledgeBase,
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
    getDirectoryProcessingPercent,
    clearCompleted,
    clearAll,
    removeItem,
    directoryItems,
    addDirectory,
    importFromExternalSource
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
