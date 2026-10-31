import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { ContentBlock, PromptCapabilities } from '@agentclientprotocol/sdk'

import { application } from '@application'
import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import { t } from '@main/i18n'
import type { CherryMessagePart, FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { parseDataUrl } from '@shared/utils/dataUrl'
import { textExts } from '@shared/utils/file'

import type { AgentRuntimeUserInput } from '../types'

type LocalContent = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }

export async function localContent(input: AgentRuntimeUserInput, images: boolean): Promise<LocalContent[]> {
  const content: LocalContent[] = []
  for (const part of input.message.data.parts ?? []) content.push(await localPartContent(part, images))
  return content
}

async function localPartContent(part: CherryMessagePart, images: boolean): Promise<LocalContent> {
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

async function inlineFileContent(part: FileUIPart) {
  const materialized = await materializeNativeFilePart(part)
  const parsed = materialized?.url ? parseDataUrl(materialized.url) : null
  if (!parsed?.isBase64 || !parsed.data)
    throw new Error(t('agent.session.attachment.unavailable', { name: part.filename ?? part.mediaType }))
  return { mimeType: parsed.mediaType ?? part.mediaType, data: parsed.data }
}

function localFilePath(part: FileUIPart): string | undefined {
  const fileEntryId = readCherryMeta(part)?.fileEntryId
  return fileEntryId
    ? application.get('FileManager').getPhysicalPath(fileEntryId)
    : part.url.startsWith('file://')
      ? fileURLToPath(part.url)
      : undefined
}

export async function acpContent(
  input: AgentRuntimeUserInput,
  capabilities: PromptCapabilities
): Promise<ContentBlock[]> {
  const content: ContentBlock[] = []
  for (const [index, part] of (input.message.data.parts ?? []).entries()) {
    if (part.type === 'file' && part.mediaType.startsWith('audio/')) {
      if (capabilities.audio !== true) throw new Error(t('agent.session.attachment.audio_unsupported'))
      content.push({ type: 'audio', ...(await inlineFileContent(part)) })
      continue
    }
    if (part.type !== 'file' || part.mediaType.startsWith('image/')) {
      content.push(await localPartContent(part, capabilities.image === true))
      continue
    }
    try {
      const path = localFilePath(part)
      const uri = path ? pathToFileURL(path).href : `urn:cherry:attachment:${index}`
      if (capabilities.embeddedContext === true) {
        const materialized = await materializeNativeFilePart(part)
        const parsed = materialized?.url ? parseDataUrl(materialized.url) : null
        if (!parsed || !materialized) throw new Error('Missing file content')
        const mimeType = materialized.mediaType
        const bytes = parsed.isBase64
          ? Buffer.from(parsed.data, 'base64')
          : Buffer.from(decodeURIComponent(parsed.data))
        const isText =
          mimeType.startsWith('text/') ||
          textExts.includes((extname(part.filename ?? '') || extname(path ?? '')).toLowerCase())
        content.push({
          type: 'resource',
          resource: {
            uri,
            mimeType,
            ...(isText
              ? { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
              : { blob: bytes.toString('base64') })
          }
        })
      } else {
        if (!path) throw new Error('Missing local file path')
        const metadata = await stat(path)
        if (!metadata.isFile()) throw new Error('Not a file')
        content.push({
          type: 'resource_link',
          uri,
          name: part.filename ?? basename(path),
          mimeType: part.mediaType,
          size: metadata.size
        })
      }
    } catch {
      throw new Error(t('agent.session.attachment.unavailable', { name: part.filename ?? part.mediaType }))
    }
  }
  return content
}
