import { createHash } from 'node:crypto'

import type { UIMessage } from 'ai'

import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import { readCherryMeta } from '@shared/data/types/uiParts'

import { collectComposerFileTokenIds, getNoteSourcePath, isActiveManagedFilePart } from './composerFileParts'

export function createAssistantFileAttachmentHandle(fileEntryId: string): string {
  const digest = createHash('sha256').update(fileEntryId).digest('hex').slice(0, 16)
  return `file_${digest}`
}

export function collectAssistantFileAttachments(messages: UIMessage[] | undefined): FileAttachmentRef[] {
  const attachments = new Map<string, FileAttachmentRef>()

  for (const message of messages ?? []) {
    const composerFileTokenIds = collectComposerFileTokenIds(message)
    for (const part of message.parts ?? []) {
      if (part.type !== 'file') continue
      const meta = readCherryMeta(part)
      const fileEntryId = meta?.fileEntryId
      if (!fileEntryId || attachments.has(fileEntryId)) continue
      if (!isActiveManagedFilePart(part, composerFileTokenIds)) continue

      const noteSourcePath = getNoteSourcePath(part)
      attachments.set(fileEntryId, {
        fileEntryId,
        handle: createAssistantFileAttachmentHandle(fileEntryId),
        displayName: part.filename?.trim() || 'file',
        ...(noteSourcePath ? { noteSourcePath } : {})
      })
    }
  }

  return Array.from(attachments.values())
}
