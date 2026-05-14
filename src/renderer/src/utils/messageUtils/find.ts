/**
 * `Message` content readers.
 *
 * Synthesise V1-shaped `MessageBlock`s from `Message.parts` so block-shape
 * consumers (export, knowledge analysis, etc.) keep their signatures. Pure
 * — no Redux, no DataApi. The parameter `BlockEntities` is retained for
 * call-site compatibility but is no longer consulted: the v1 message-blocks
 * Redux slice is gone, parts are the single source of truth.
 */
import type { FileMetadata } from '@renderer/types'
import type { ExportableMessage } from '@renderer/types/messageExport'
import type {
  CitationMessageBlock,
  CodeMessageBlock,
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  MessageBlock,
  ThinkingMessageBlock,
  TranslationMessageBlock
} from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import type {
  CherryProviderMetadata,
  CodePartData,
  ErrorPartData,
  TranslationPartData
} from '@shared/data/types/uiParts'

// Retained as a no-op signature alias so existing call sites don't have to
// drop their second argument when the v1 Redux-backed lookup goes away.
type BlockEntities = Record<string, MessageBlock | undefined>

function syntheticBase(
  messageId: string,
  index: number
): Pick<MessageBlock, 'id' | 'messageId' | 'createdAt' | 'status'> {
  return {
    id: `${messageId}-part-${index}`,
    messageId,
    createdAt: '',
    status: MessageBlockStatus.SUCCESS
  }
}

function getCherryMeta(part: CherryMessagePart): CherryProviderMetadata | undefined {
  if ('providerMetadata' in part && part.providerMetadata) {
    return (part.providerMetadata as { cherry?: CherryProviderMetadata }).cherry
  }
  return undefined
}

function getParts(message: ExportableMessage): CherryMessagePart[] {
  return message.parts ?? []
}

function getDataPart<T>(part: CherryMessagePart): Partial<T> | undefined {
  if ('data' in part && part.data && typeof part.data === 'object') {
    return part.data as Partial<T>
  }
  return undefined
}

function formatCodePart(data: Partial<CodePartData> | undefined): string {
  const content = data?.content ?? ''
  if (!content.trim()) return ''
  const language = data?.language ?? ''
  return `\`\`\`${language}\n${content}\n\`\`\``
}

function formatErrorPart(data: Partial<ErrorPartData> | undefined): string {
  if (!data) return ''
  return [data.name, data.code, data.message].filter(Boolean).join('\n')
}

function getRenderableTextContent(part: CherryMessagePart): string {
  switch (part.type) {
    case 'text':
      return part.text ?? ''
    case 'data-code':
      return formatCodePart(getDataPart<CodePartData>(part))
    case 'data-translation':
      return getDataPart<TranslationPartData>(part)?.content ?? ''
    case 'data-error':
      return formatErrorPart(getDataPart<ErrorPartData>(part))
    default:
      return ''
  }
}

// ── Public API ───────────────────────────────────────────────────────

export const findAllBlocks = (message: ExportableMessage): MessageBlock[] => {
  const parts = getParts(message)
  if (parts.length === 0) return []
  const out: MessageBlock[] = []
  parts.forEach((part, i) => {
    const base = syntheticBase(message.id, i)
    const partType = part.type as string
    switch (partType) {
      case 'text':
        out.push({
          ...base,
          type: MessageBlockType.MAIN_TEXT,
          content: (part as { text?: string }).text ?? ''
        } as MainTextMessageBlock)
        break
      case 'reasoning':
        out.push({
          ...base,
          type: MessageBlockType.THINKING,
          content: (part as { text?: string }).text ?? '',
          thinking_millsec: getCherryMeta(part)?.thinkingMs ?? 0
        } as ThinkingMessageBlock)
        break
      case 'data-code': {
        const data = getDataPart<CodePartData>(part)
        out.push({
          ...base,
          type: MessageBlockType.CODE,
          content: data?.content ?? '',
          language: data?.language ?? ''
        } as CodeMessageBlock)
        break
      }
      case 'data-error': {
        const data = getDataPart<ErrorPartData>(part)
        out.push({
          ...base,
          type: MessageBlockType.ERROR,
          error: data
            ? {
                name: data.name ?? undefined,
                message: data.message ?? data.code ?? 'Error occurred',
                stack: data.stack ?? undefined
              }
            : undefined
        } as ErrorMessageBlock)
        break
      }
      case 'data-translation': {
        const data = getDataPart<TranslationPartData>(part)
        out.push({
          ...base,
          type: MessageBlockType.TRANSLATION,
          content: data?.content ?? '',
          sourceBlockId: data?.sourceBlockId,
          sourceLanguage: data?.sourceLanguage,
          targetLanguage: data?.targetLanguage ?? ''
        } as TranslationMessageBlock)
        break
      }
      case 'file': {
        const filePart = part as { mediaType?: string; url?: string; filename?: string }
        if (filePart.mediaType?.startsWith('image/')) {
          out.push({
            ...base,
            type: MessageBlockType.IMAGE,
            url: filePart.url,
            file: filePart.url
              ? ({ name: filePart.filename ?? '', path: filePart.url, type: filePart.mediaType } as FileMetadata)
              : undefined
          } as ImageMessageBlock)
        } else if (filePart.url) {
          out.push({
            ...base,
            type: MessageBlockType.FILE,
            file: { name: filePart.filename ?? '', path: filePart.url, type: filePart.mediaType ?? '' } as FileMetadata
          } as FileMessageBlock)
        }
        break
      }
      default:
        if (partType.startsWith('tool-') || partType === 'dynamic-tool') {
          out.push({
            ...base,
            type: MessageBlockType.TOOL,
            toolId: (part as { toolCallId?: string }).toolCallId ?? base.id
          } as MessageBlock)
        }
        break
    }
  })
  return out
}

export const findMainTextBlocks = (
  message: ExportableMessage,
  _blockEntities?: BlockEntities
): MainTextMessageBlock[] => {
  const out: MainTextMessageBlock[] = []
  getParts(message).forEach((part, i) => {
    if (part.type !== 'text') return
    out.push({
      ...syntheticBase(message.id, i),
      type: MessageBlockType.MAIN_TEXT,
      content: part.text ?? ''
    })
  })
  return out
}

export const findThinkingBlocks = (
  message: ExportableMessage,
  _blockEntities?: BlockEntities
): ThinkingMessageBlock[] => {
  const out: ThinkingMessageBlock[] = []
  getParts(message).forEach((part, i) => {
    if (part.type !== 'reasoning') return
    out.push({
      ...syntheticBase(message.id, i),
      type: MessageBlockType.THINKING,
      content: part.text ?? '',
      thinking_millsec: getCherryMeta(part)?.thinkingMs ?? 0
    })
  })
  return out
}

export const findImageBlocks = (message: ExportableMessage): ImageMessageBlock[] => {
  const out: ImageMessageBlock[] = []
  getParts(message).forEach((part, i) => {
    if (part.type !== 'file') return
    const filePart = part as { mediaType?: string; url?: string; filename?: string }
    if (!filePart.mediaType?.startsWith('image/')) return
    out.push({
      ...syntheticBase(message.id, i),
      type: MessageBlockType.IMAGE,
      url: filePart.url,
      file: filePart.url
        ? ({ name: filePart.filename ?? '', path: filePart.url, type: filePart.mediaType } as FileMetadata)
        : undefined
    })
  })
  return out
}

export const findFileBlocks = (message: ExportableMessage): FileMessageBlock[] => {
  const out: FileMessageBlock[] = []
  getParts(message).forEach((part, i) => {
    if (part.type !== 'file') return
    const filePart = part as { mediaType?: string; url?: string; filename?: string }
    if (filePart.mediaType?.startsWith('image/')) return
    if (!filePart.url) return
    out.push({
      ...syntheticBase(message.id, i),
      type: MessageBlockType.FILE,
      file: { name: filePart.filename ?? '', path: filePart.url, type: filePart.mediaType ?? '' } as FileMetadata
    })
  })
  return out
}

export const getMainTextContent = (message: ExportableMessage): string => {
  return getParts(message)
    .map(getRenderableTextContent)
    .filter((t) => t.trim().length > 0)
    .join('\n\n')
}

export const getThinkingContent = (message: ExportableMessage, _blockEntities?: BlockEntities): string => {
  return getParts(message)
    .filter((p): p is Extract<CherryMessagePart, { type: 'reasoning' }> => p.type === 'reasoning')
    .map((p) => p.text ?? '')
    .filter((t) => t.trim().length > 0)
    .join('\n\n')
}

export const getCitationContent = (message: ExportableMessage, _blockEntities?: BlockEntities): string => {
  // V2 stores citations on text parts via `providerMetadata.cherry.references`
  // (not as separate `data-citation` parts). Walk text parts and format each
  // citation-category reference into `[N] [title](url)` — same shape v1's
  // `formatCitationsFromBlock` produced. Non-web reference categories are
  // dropped just like the v1 path did.
  const lines: string[] = []
  for (const part of getParts(message)) {
    if (part.type !== 'text') continue
    const refs = (getCherryMeta(part)?.references ?? []) as Array<{
      category?: string
      number?: number
      title?: string
      url?: string
    }>
    for (const ref of refs) {
      if (ref.category !== 'citation') continue
      if (!ref.url) continue
      const number = ref.number ?? lines.length + 1
      const title = ref.title || ref.url.slice(0, 1999)
      lines.push(`[${number}] [${title}](${ref.url.slice(0, 1999)})`)
    }
  }
  return lines.join('\n\n')
}

export const getFileContent = (message: ExportableMessage, _blockEntities?: BlockEntities): FileMetadata[] => {
  const files: FileMetadata[] = []
  for (const block of findFileBlocks(message)) {
    if (block.file) files.push(block.file)
  }
  for (const block of findImageBlocks(message)) {
    if (block.file) files.push(block.file)
  }
  return files
}

// `findCitationBlocks` from the v1 path is no longer exposed — V2 has no
// standalone citation blocks; consumers wanting the formatted text should
// call `getCitationContent` directly.
export type { CitationMessageBlock }
