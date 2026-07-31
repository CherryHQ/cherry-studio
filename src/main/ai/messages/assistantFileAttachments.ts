import { createHash } from 'node:crypto'

import type { UIMessage } from 'ai'

import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import { readCherryMeta } from '@shared/data/types/uiParts'

export function createAssistantFileAttachmentHandle(fileEntryId: string): string {
  const digest = createHash('sha256').update(fileEntryId).digest('hex').slice(0, 16)
  return `file_${digest}`
}

export function collectAssistantFileAttachments(messages: UIMessage[] | undefined): FileAttachmentRef[] {
  const attachments = new Map<string, FileAttachmentRef>()

  for (const message of messages ?? []) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'file') continue
      const fileEntryId = readCherryMeta(part)?.fileEntryId
      if (!fileEntryId || attachments.has(fileEntryId)) continue

      attachments.set(fileEntryId, {
        fileEntryId,
        handle: createAssistantFileAttachmentHandle(fileEntryId),
        displayName: part.filename?.trim() || 'file'
      })
    }
  }

  return Array.from(attachments.values())
}
