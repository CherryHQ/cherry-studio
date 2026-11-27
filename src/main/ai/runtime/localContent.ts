import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import { t } from '@main/i18n'
import type { CherryMessagePart, FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { parseDataUrl } from '@shared/utils/dataUrl'

import { withAgentContext } from './agentUserContent'
import type { AgentRuntimeUserInput } from './types'

type LocalContent = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }

export async function localContent(input: AgentRuntimeUserInput, images: boolean): Promise<LocalContent[]> {
  const content: LocalContent[] = []
  const message = withAgentContext(input.message, input.context)
  for (const part of message.data.parts ?? []) {
    if (part.type === 'data-knowledge-scope') continue
    content.push(await localPartContent(part, images))
  }
  return content
}

export async function localPartContent(part: CherryMessagePart, images: boolean): Promise<LocalContent> {
  if (part.type === 'text') return { type: 'text', text: part.text }
  if (part.type !== 'file') throw new Error(`Unsupported local agent input: ${part.type}`)
  if (part.mediaType.startsWith('image/')) {
    if (!images) throw new Error(t('agent.session.attachment.image_unsupported'))
    return { type: 'image', ...(await inlineFileContent(part)) }
  }
  const path = localFilePath(part)
  if (!path) throw new Error('The attached file has no local path')
  return { type: 'text', text: `Attached file: ${JSON.stringify(path)}` }
}

export async function inlineFileContent(part: FileUIPart) {
  const materialized = await materializeNativeFilePart(part)
  const parsed = materialized?.url ? parseDataUrl(materialized.url) : null
  if (!parsed?.isBase64 || !parsed.data)
    throw new Error(t('agent.session.attachment.unavailable', { name: part.filename ?? part.mediaType }))
  return { mimeType: parsed.mediaType ?? part.mediaType, data: parsed.data }
}

export function localFilePath(part: FileUIPart): string | undefined {
  const fileEntryId = readCherryMeta(part)?.fileEntryId
  return fileEntryId
    ? application.get('FileManager').getPhysicalPath(fileEntryId)
    : part.url.startsWith('file://')
      ? fileURLToPath(part.url)
      : undefined
}
