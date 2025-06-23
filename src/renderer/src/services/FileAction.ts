import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import Logger from '@renderer/config/logger'
import db from '@renderer/databases'
import FileManager from '@renderer/services/FileManager'
import store from '@renderer/store'
import { FileType } from '@renderer/types'
import { Message } from '@renderer/types/newMessage'
import dayjs from 'dayjs'

// 排序相关
export type SortField = 'created_at' | 'size' | 'name'
export type SortOrder = 'asc' | 'desc'

export function tempFilesSort(files: FileType[]): FileType[] {
  return files.sort((a, b) => {
    const aIsTemp = a.origin_name.startsWith('temp_file')
    const bIsTemp = b.origin_name.startsWith('temp_file')
    if (aIsTemp && !bIsTemp) return 1
    if (!aIsTemp && bIsTemp) return -1
    return 0
  })
}

export function sortFiles(files: FileType[], sortField: SortField, sortOrder: SortOrder): FileType[] {
  return [...files].sort((a, b) => {
    let comparison = 0
    switch (sortField) {
      case 'created_at':
        comparison = dayjs(a.created_at).unix() - dayjs(b.created_at).unix()
        break
      case 'size':
        comparison = a.size - b.size
        break
      case 'name':
        comparison = a.origin_name.localeCompare(b.origin_name)
        break
    }
    return sortOrder === 'asc' ? comparison : -comparison
  })
}

// 删除操作
export async function handleDelete(fileId: string, t: (key: string) => string) {
  const file = await FileManager.getFile(fileId)
  if (!file) return

  const paintings = await store.getState().paintings.paintings
  const paintingsFiles = paintings.flatMap((p) => p.files)

  if (paintingsFiles.some((p) => p.id === fileId)) {
    window.modal.warning({ content: t('files.delete.paintings.warning'), centered: true })
    return
  }
  await FileManager.deleteFile(fileId, true)

  const relatedBlocks = await db.message_blocks.where('file.id').equals(fileId).toArray()
  const blockIdsToDelete = relatedBlocks.map((b) => b.id)
  const affectedMessageIds = [...new Set(relatedBlocks.map((b) => b.messageId))]

  try {
    await db.transaction('rw', db.topics, db.message_blocks, async () => {
      const allTopics = await db.topics.toArray()
      const topicsToUpdate: Record<string, { messages: Message[] }> = {}

      for (const topic of allTopics) {
        let modified = false
        const newMessages = (topic.messages || []).map((msg) => {
          if (affectedMessageIds.includes(msg.id)) {
            const filtered = (msg.blocks || []).filter((blk) => !blockIdsToDelete.includes(blk))
            if (filtered.length < (msg.blocks || []).length) {
              modified = true
              return { ...msg, blocks: filtered }
            }
          }
          return msg
        })
        if (modified) topicsToUpdate[topic.id] = { messages: newMessages }
      }

      await Promise.all(Object.entries(topicsToUpdate).map(([id, data]) => db.topics.update(id, data)))
      await db.message_blocks.bulkDelete(blockIdsToDelete)
    })
    Logger.log(`Deleted ${blockIdsToDelete.length} blocks for file ${fileId}`)
  } catch (err) {
    Logger.error(`Error removing file blocks for ${fileId}:`, err)
    window.modal.error({ content: t('files.delete.db_error'), centered: true })
  }
}

// 重命名操作
export async function handleRename(fileId: string) {
  const file = await FileManager.getFile(fileId)
  if (!file) return
  const newName = await TextEditPopup.show({ text: file.origin_name })
  if (newName) {
    FileManager.updateFile({ ...file, origin_name: newName })
  }
}
