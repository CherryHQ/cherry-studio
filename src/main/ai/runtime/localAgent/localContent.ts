import { isUtf8 } from 'node:buffer'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { application } from '@application'
import {
  encodeAcpAttachment,
  type AcpContentBlock,
  type AcpPromptCapabilities
} from '@cherrystudio/agent-runtime-acp/v1'
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
  for (const part of input.message.data.parts ?? []) {
    if (part.type === 'data-knowledge-scope') continue
    content.push(await localPartContent(part, images))
  }
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
  capabilities: AcpPromptCapabilities
): Promise<AcpContentBlock[]> {
  const content: AcpContentBlock[] = []
  for (const [index, part] of (input.message.data.parts ?? []).entries()) {
    if (part.type === 'data-knowledge-scope') continue
    if (part.type !== 'file') {
      content.push(await localPartContent(part, false))
      continue
    }
    const path = localFilePath(part)
    const unavailable = () =>
      new Error(t('agent.session.attachment.unavailable', { name: part.filename ?? part.mediaType }))
    content.push(
      await encodeAcpAttachment(
        {
          uri: path ? pathToFileURL(path).href : `urn:cherry:attachment:${index}`,
          name: part.filename ?? (path ? basename(path) : part.mediaType),
          mimeType: part.mediaType,
          inline: () => inlineFileContent(part),
          unsupported: (kind) =>
            new Error(
              t(
                kind === 'image'
                  ? 'agent.session.attachment.image_unsupported'
                  : 'agent.session.attachment.audio_unsupported'
              )
            ),
          async linkedSize() {
            const metadata = path && (await stat(path).catch(() => undefined))
            if (!metadata || !metadata.isFile()) throw unavailable()
            return metadata.size
          },
          async embedded() {
            try {
              const materialized = await materializeNativeFilePart(part)
              const parsed = materialized?.url ? parseDataUrl(materialized.url) : null
              if (!parsed || !materialized) throw unavailable()
              const mimeType = materialized.mediaType
              const bytes = parsed.isBase64
                ? Buffer.from(parsed.data, 'base64')
                : Buffer.from(decodeURIComponent(parsed.data))
              const text =
                mimeType.startsWith('text/') ||
                textExts.includes((extname(part.filename ?? '') || extname(path ?? '')).toLowerCase())
              return text && isUtf8(bytes)
                ? { mimeType, text: new TextDecoder().decode(bytes) }
                : { mimeType, blob: bytes.toString('base64') }
            } catch {
              throw unavailable()
            }
          }
        },
        capabilities
      )
    )
  }
  return content
}
