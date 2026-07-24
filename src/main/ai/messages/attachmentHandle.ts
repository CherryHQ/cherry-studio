import { createHash } from 'node:crypto'

export function createFileAttachmentHandle(fileEntryId: string): string {
  const digest = createHash('sha256').update(fileEntryId).digest('hex').slice(0, 16)
  return `file_${digest}`
}
