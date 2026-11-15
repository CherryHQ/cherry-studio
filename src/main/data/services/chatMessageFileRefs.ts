import { isToolUIPart } from 'ai'

import { blobRefsOf, isPersistedToolOutput } from '@shared/ai/transport'
import type { chatMessageRoles } from '@shared/data/types/file'
import type { Message, MessageData } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

type ChatMessageFileRefEntry = { fileEntryId: string; role: (typeof chatMessageRoles)[number] }

export function extractChatMessageFileRefs(
  data: MessageData | null | undefined,
  snapshot?: Message['messageSnapshot']
): ChatMessageFileRefEntry[] {
  const refs: ChatMessageFileRefEntry[] = []
  const seen = new Set<string>()
  const add = (fileEntryId: string | undefined, role: ChatMessageFileRefEntry['role']) => {
    if (!fileEntryId) return
    const key = `${role}:${fileEntryId}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ fileEntryId, role })
  }
  for (const part of data?.parts ?? []) {
    if (part.type === 'file') {
      add(readCherryMeta(part)?.fileEntryId, 'attachment')
    } else if (isToolUIPart(part) && part.state === 'output-available' && isPersistedToolOutput(part.output)) {
      for (const blob of blobRefsOf(part.output.$persistedToolOutput)) add(blob.fileEntryId, 'tool_output')
    }
  }
  add(snapshot?.avatarFileId, 'author_avatar')
  return refs
}
