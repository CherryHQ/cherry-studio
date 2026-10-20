import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ImageContent } from '@earendil-works/pi-ai'

import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { parseDataUrl } from '@shared/utils/dataUrl'

import { buildAgentUserContent } from '../agentUserContent'
import { loadPiSdk } from './piSdk'

type ImageFailure = 'read' | 'empty' | 'processing'

export class PiImagePreparationError extends Error {
  readonly i18nKey = 'pi_image_preparation_failed'
  readonly detailI18nKey: string
  readonly detailI18nValues: { filename: string }

  constructor(reason: ImageFailure, filename: string | undefined, attachmentNumber: number) {
    super(`Image attachment preparation failed: ${filename ?? attachmentNumber} (${reason})`)
    this.name = 'PiImagePreparationError'
    this.detailI18nKey = `pi_image_${reason}_failed${filename ? '' : '_unnamed'}`
    this.detailI18nValues = { filename: filename || String(attachmentNumber) }
  }
}

function needsImagePreparation(
  part: NonNullable<AgentSessionMessageEntity['data']['parts']>[number]
): part is FileUIPart {
  return (
    part.type === 'file' &&
    part.mediaType.toLowerCase().startsWith('image/') &&
    !/^https?:/i.test(part.url) &&
    (!!readCherryMeta(part)?.fileEntryId || !part.url || part.url.startsWith('file://') || part.url.startsWith('data:'))
  )
}

export function hasPiLocalImages(message: AgentSessionMessageEntity): boolean {
  return message.data.parts?.some(needsImagePreparation) ?? false
}

function attachmentFilename(part: FileUIPart): string | undefined {
  if (part.filename) return part.filename
  if (part.url.startsWith('file://')) {
    try {
      return basename(fileURLToPath(part.url)) || undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

export async function preparePiUserContent(message: AgentSessionMessageEntity): Promise<{
  text: string
  images: ImageContent[]
}> {
  const images: ImageContent[] = []
  const parts: typeof message.data.parts = []
  let attachmentNumber = 0
  for (const part of message.data.parts ?? []) {
    if (part.type === 'file') attachmentNumber++
    if (!needsImagePreparation(part)) {
      parts.push(part)
      continue
    }
    const filename = attachmentFilename(part)
    const fail = (reason: ImageFailure) => new PiImagePreparationError(reason, filename, attachmentNumber)
    const materialized = await materializeNativeFilePart(part)
    if (!materialized?.url) throw fail('read')
    const parsed = parseDataUrl(materialized.url)
    if (!parsed) throw fail('read')
    if (!parsed.data) throw fail('empty')
    if (!parsed.isBase64) throw fail('read')
    const bytes = Buffer.from(parsed.data, 'base64')
    if (bytes.length === 0) throw fail('empty')
    let image
    try {
      // The session uses Pi's default auto-resize limits; preflight before Pi can omit a bad image.
      image = await (await loadPiSdk()).resizeImage(bytes, materialized.mediaType)
    } catch {
      throw fail('processing')
    }
    if (!image?.data) throw fail('processing')
    images.push({ type: 'image', mimeType: image.mimeType, data: image.data })
  }
  return { text: buildAgentUserContent({ ...message, data: { ...message.data, parts } }), images }
}
