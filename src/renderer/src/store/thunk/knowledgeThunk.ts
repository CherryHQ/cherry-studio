import { loggerService } from '@logger'
import { db } from '@renderer/databases'
import { addFiles as addFilesAction, addItem, updateNotes } from '@renderer/store/knowledge'
import { FileMetadata, isKnowledgeNoteItem, KnowledgeItem } from '@renderer/types'
import { v4 as uuidv4 } from 'uuid'

import { AppDispatch } from '..'

const logger = loggerService.withContext('knowledgeThunk')

/**
 * Creates a new knowledge item with default values.
 * @param type The type of the knowledge item.
 * @param content The content of the knowledge item.
 * @param overrides Optional overrides for the default values.
 * @returns A new knowledge item.
 */
export const createKnowledgeItem = (
  type: KnowledgeItem['type'],
  content: KnowledgeItem['content'],
  overrides: Partial<KnowledgeItem> = {}
): KnowledgeItem => {
  const timestamp = Date.now()
  return {
    id: uuidv4(),
    type,
    content,
    created_at: timestamp,
    updated_at: timestamp,
    processingStatus: 'pending',
    processingProgress: 0,
    processingError: '',
    retryCount: 0,
    ...overrides
  }
}

/**
 * 批量添加文件，需要手动调用 KnowledgeQueue.checkAllBases()
 * @param baseId 知识库 ID
 * @param files 文件列表
 */
export const addFilesThunk = (baseId: string, files: FileMetadata[]) => (dispatch: AppDispatch) => {
  const filesItems = files.map((file) => createKnowledgeItem('file', file))
  dispatch(addFilesAction({ baseId, items: filesItems }))
}

/**
 * 检查笔记是否已存在于知识库中
 * @param baseId 知识库 ID
 * @param metadata 源笔记元数据
 * @returns 返回已存在的笔记或 null
 */
export const checkNoteExists = async (
  baseId: string,
  metadata: {
    sourceNoteId?: string
    sourceNotePath?: string
  }
): Promise<{ exists: boolean; hasChanges: boolean; existingNote?: any } | null> => {
  if (!metadata.sourceNoteId && !metadata.sourceNotePath) {
    return null
  }

  const allNotes = await db.knowledge_notes.toArray()
  const existingNote = allNotes.find(
    (note) =>
      note.baseId === baseId &&
      ((metadata.sourceNoteId && note.sourceNoteId === metadata.sourceNoteId) ||
        (metadata.sourceNotePath && note.sourceNotePath === metadata.sourceNotePath))
  )

  return existingNote ? { exists: true, hasChanges: false, existingNote } : { exists: false, hasChanges: false }
}

/**
 * 添加笔记，需要手动调用 KnowledgeQueue.checkAllBases()
 * @param baseId 知识库 ID
 * @param content 笔记内容
 * @param metadata 源笔记元数据（可选）
 * @param forceUpdate 是否强制更新已存在的笔记
 * @returns 包含操作结果的对象 { isNew, noteId }
 */
export const addNoteThunk =
  (
    baseId: string,
    content: string,
    metadata?: {
      sourceNotePath?: string
      sourceNoteId?: string
      contentHash?: string
    },
    forceUpdate = false
  ) =>
  async (dispatch: AppDispatch): Promise<{ isNew: boolean; noteId: string }> => {
    // 如果提供了源笔记信息，检查是否已存在
    if (forceUpdate && (metadata?.sourceNoteId || metadata?.sourceNotePath)) {
      const allNotes = await db.knowledge_notes.toArray()
      const existingNote = allNotes.find(
        (note) =>
          note.baseId === baseId &&
          ((metadata.sourceNoteId && note.sourceNoteId === metadata.sourceNoteId) ||
            (metadata.sourceNotePath && note.sourceNotePath === metadata.sourceNotePath))
      )

      if (existingNote) {
        // 找到已存在的笔记，更新它
        const updatedNote = {
          ...existingNote,
          content,
          contentHash: metadata.contentHash,
          updated_at: Date.now()
        }

        await db.knowledge_notes.put(updatedNote)
        logger.debug('Updated existing note in database', { noteId: existingNote.id })

        // 更新 store 中的引用
        const noteRef = { ...updatedNote, content: '' }
        dispatch(updateNotes({ baseId, item: noteRef }))

        return { isNew: false, noteId: existingNote.id }
      }
    }

    // 不存在，创建新笔记
    const noteId = uuidv4()
    const note = createKnowledgeItem('note', content, {
      id: noteId,
      baseId,
      ...(metadata && {
        sourceNotePath: metadata.sourceNotePath,
        sourceNoteId: metadata.sourceNoteId,
        contentHash: metadata.contentHash
      })
    })

    if (!isKnowledgeNoteItem(note)) {
      logger.error('Invalid note item', note)
      throw new Error('Invalid note item')
    }

    // 存储完整笔记到数据库，出错时交给调用者处理
    await db.knowledge_notes.add(note)

    // 验证数据已成功写入数据库
    const savedNote = await db.knowledge_notes.get(noteId)
    if (!savedNote) {
      logger.error('Failed to verify note was saved to database', { noteId })
      throw new Error('Failed to save note to database')
    }

    logger.debug('Created new note in database', { noteId })

    // 在 store 中只存储引用
    const noteRef = { ...note, content: '' } // store中不需要存储实际内容

    dispatch(updateNotes({ baseId, item: noteRef }))

    return { isNew: true, noteId }
  }

/**
 * 添加一个普通的知识库项，需要手动调用 KnowledgeQueue.checkAllBases()
 * @param baseId 知识库 ID
 * @param type 知识库项类型
 * @param content 知识库项内容
 */
export const addItemThunk =
  (baseId: string, type: KnowledgeItem['type'], content: string) => (dispatch: AppDispatch) => {
    const newItem = createKnowledgeItem(type, content)
    dispatch(addItem({ baseId, item: newItem }))
  }

export const addVedioThunk =
  (baseId: string, type: KnowledgeItem['type'], files: FileMetadata[]) => (dispatch: AppDispatch) => {
    const newItem = createKnowledgeItem(type, files)
    dispatch(addItem({ baseId, item: newItem }))
  }
