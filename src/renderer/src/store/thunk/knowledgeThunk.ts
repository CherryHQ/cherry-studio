import { db } from '@renderer/databases'
import { addFiles as addFilesAction, addItem, updateNotes } from '@renderer/store/knowledge'
import { FileMetadata, KnowledgeItem } from '@renderer/types'
import { v4 as uuidv4 } from 'uuid'

import { AppDispatch } from '..'

/**
 * 批量添加文件，需要手动调用 KnowledgeQueue.checkAllBases()
 * @param baseId 知识库 ID
 * @param files 文件列表
 */
export const addFilesThunk = (baseId: string, files: FileMetadata[]) => (dispatch: AppDispatch) => {
  const timestamp = Date.now()
  const filesItems: KnowledgeItem[] = files.map((file) => ({
    id: uuidv4(),
    type: 'file' as const,
    content: file,
    created_at: timestamp,
    updated_at: timestamp,
    processingStatus: 'pending',
    processingProgress: 0,
    processingError: '',
    retryCount: 0
  }))
  dispatch(addFilesAction({ baseId, items: filesItems }))
}

/**
 * 添加笔记，需要手动调用 KnowledgeQueue.checkAllBases()
 * @param baseId 知识库 ID
 * @param content 笔记内容
 */
export const addNoteThunk = (baseId: string, content: string) => async (dispatch: AppDispatch) => {
  const noteId = uuidv4()
  const timestamp = Date.now()
  const note: KnowledgeItem = {
    id: noteId,
    type: 'note',
    content,
    created_at: timestamp,
    updated_at: timestamp,
    processingStatus: 'pending',
    processingProgress: 0,
    processingError: '',
    retryCount: 0
  }

  // 存储完整笔记到数据库
  await db.knowledge_notes.add(note)

  // 在 store 中只存储引用
  const noteRef: KnowledgeItem = {
    id: noteId,
    type: 'note',
    content: '', // store中不需要存储实际内容
    created_at: timestamp,
    updated_at: timestamp,
    processingStatus: 'pending',
    processingProgress: 0,
    processingError: '',
    retryCount: 0
  }

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
    const timestamp = Date.now()
    const newItem: KnowledgeItem = {
      id: uuidv4(),
      type,
      content,
      created_at: timestamp,
      updated_at: timestamp,
      processingStatus: 'pending',
      processingProgress: 0,
      processingError: '',
      retryCount: 0
    }
    dispatch(addItem({ baseId, item: newItem }))
  }
