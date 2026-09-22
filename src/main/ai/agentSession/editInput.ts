import { open } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { AgentSessionEditError } from '@data/services/AgentSessionEditError'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

export async function validateEditedInput(parts: CherryMessagePart[]): Promise<void> {
  if (!parts.some((part) => part.type === 'file' || (part.type === 'text' && part.text.trim())))
    throw new AgentSessionEditError('input_unsupported')
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      if (readCherryMeta(part)?.composer?.tokens.some((token) => token.kind === 'command'))
        throw new AgentSessionEditError('input_unsupported')
      continue
    }
    if (part.type === 'data-knowledge-scope') continue
    if (part.type !== 'file' || !part.url) throw new AgentSessionEditError('input_unsupported')
    try {
      const id = readCherryMeta(part)?.fileEntryId
      if (id) await application.get('FileManager').readChunk(id, 0, 1)
      else {
        if (!part.url.startsWith('file://')) throw new Error('Attachment has no local reference')
        const file = await open(fileURLToPath(part.url), 'r')
        try {
          if (!(await file.stat()).isFile()) throw new Error('Attachment is not a file')
        } finally {
          await file.close()
        }
      }
    } catch {
      throw new AgentSessionEditError('attachment_unavailable')
    }
  }
}
