import { db } from '@renderer/databases'
import KnowledgeQueue from '@renderer/queue/KnowledgeQueue'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { RootState } from '@renderer/store'
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
import { FileMetadata, KnowledgeBase, KnowledgeItem, ProcessingStatus } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { useCallback, useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { v4 as uuidv4 } from 'uuid'

import { useAgents } from './useAgents'
import { useAssistants } from './useAssistant'

export const useKnowledge = (baseId: string) => {
  const dispatch = useDispatch()
  const base = useSelector((state: RootState) => state.knowledge.bases.find((b) => b.id === baseId))

  // 重命名知识库
  const renameKnowledgeBase = (name: string) => {
    dispatch(renameBase({ baseId, name }))
  }

  // 更新知识库
  const updateKnowledgeBase = (base: KnowledgeBase) => {
    dispatch(updateBase(base))
  }

  // 批量添加文件
  const addFiles = (files: FileMetadata[]) => {
    const filesItems: KnowledgeItem[] = files.map((file) => ({
      id: uuidv4(),
      type: 'file' as const,
      content: file,
      created_at: Date.now(),
      updated_at: Date.now(),
      processingStatus: 'pending',
      processingProgress: 0,
      processingError: '',
      retryCount: 0
    }))
    console.log('Adding files:', filesItems)
    dispatch(addFilesAction({ baseId, items: filesItems }))
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

  // 获取知识项目的显示名称
  const getKnowledgeItemDisplayName = (item: KnowledgeItem): string => {
    switch (item.type) {
      case 'file':
        return (item.content as FileMetadata).origin_name
      case 'url':
        return item.remark || (item.content as string)
      case 'note':
        return (item.content as string).slice(0, 50) + '...'
      case 'directory':
      case 'sitemap':
        return item.content as string
      default:
        return item.content as string
    }
  }

  // 移除项目
  const removeItem = async (item: KnowledgeItem) => {
    const itemName = getKnowledgeItemDisplayName(item)
    
    try {
      // 显示加载状态
      const loadingKey = `delete-${item.id}`
      window.message.loading({
        content: `正在删除${item.type === 'directory' ? '目录' : item.type === 'file' ? '文件' : '项目'} "${itemName}"...`,
        key: loadingKey,
        duration: 0 // 持续显示直到手动关闭
      })

      // 先执行后端删除操作
      if (base && item?.uniqueId && item?.uniqueIds) {
        await window.api.knowledgeBase.remove({
          uniqueId: item.uniqueId,
          uniqueIds: item.uniqueIds,
          base: getKnowledgeBaseParams(base)
        })
      }
      
      // 清理文件系统
      if (item.type === 'file' && typeof item.content === 'object') {
        await window.api.file.delete(item.content.name)
      }

      // 删除成功后，从界面状态中移除
      dispatch(removeItemAction({ baseId, item }))

      // 关闭加载提示并显示成功消息
      window.message.destroy(loadingKey)
      window.message.success(`${item.type === 'file' ? '文件' : item.type === 'directory' ? '目录' : '项目'} "${itemName}" 删除成功`)
    } catch (error: any) {
      // 删除失败，关闭加载提示并显示错误消息
      window.message.destroy(`delete-${item.id}`)
      window.message.error(`删除失败: ${error.message || '未知错误'}`)
      console.error('Knowledge item removal failed:', error)
      
      // 删除失败时不从UI状态中移除项目，用户可以重试
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
        uniqueId: undefined,
        updated_at: Date.now()
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

  return {
    base,
    fileItems,
    urlItems,
    sitemapItems,
    noteItems,
    renameKnowledgeBase,
    updateKnowledgeBase,
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
