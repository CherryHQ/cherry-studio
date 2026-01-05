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
import { loggerService } from '@logger'
import { db } from '@renderer/databases'
import { addFiles as addFilesAction, addItem, updateNotes } from '@renderer/store/knowledge'
import type { FileMetadata, KnowledgeItem } from '@renderer/types'
import { isKnowledgeNoteItem } from '@renderer/types'
import { v4 as uuidv4 } from 'uuid'

import type { AppDispatch } from '..'

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
 * 添加笔记，需要手动调用 KnowledgeQueue.checkAllBases()
 * @param baseId 知识库 ID
 * @param content 笔记内容
 */
export const addNoteThunk = (baseId: string, content: string) => async (dispatch: AppDispatch) => {
  const noteId = uuidv4()
  const note = createKnowledgeItem('note', content, { id: noteId })

  if (!isKnowledgeNoteItem(note)) {
    logger.error('Invalid note item', note)
    throw new Error('Invalid note item')
  }

  // 存储完整笔记到数据库，出错时交给调用者处理
  await db.knowledge_notes.add(note)

  // 在 store 中只存储引用
  const noteRef = { ...note, content: '' } // store中不需要存储实际内容

  dispatch(updateNotes({ baseId, item: noteRef }))
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
