import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { parseDataUrl } from '@shared/utils/dataUrl'

import type { AgentRuntimeUserInput } from '../types'

type LocalContent = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }

export async function localContent(input: AgentRuntimeUserInput, images: boolean): Promise<LocalContent[]> {
  const content: LocalContent[] = []
  for (const part of input.message.data.parts ?? []) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text })
    } else if (part.type === 'file') {
      if (images && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(part.mediaType)) {
        const materialized = await materializeNativeFilePart(part)
        const parsed = materialized?.url ? parseDataUrl(materialized.url) : null
        if (!parsed?.isBase64 || !parsed.data) throw new Error('The attached image is unavailable')
        content.push({ type: 'image', mimeType: parsed.mediaType ?? part.mediaType, data: parsed.data })
      } else {
        const fileEntryId = readCherryMeta(part)?.fileEntryId
        const path = fileEntryId
          ? application.get('FileManager').getPhysicalPath(fileEntryId)
          : part.url.startsWith('file://')
            ? fileURLToPath(part.url)
            : undefined
        if (!path) throw new Error('The attached file has no local path')
        content.push({ type: 'text', text: `Attached file: ${JSON.stringify(path)}` })
      }
    } else {
      throw new Error(`Unsupported local agent input: ${part.type}`)
    }
  }
  return content
}
