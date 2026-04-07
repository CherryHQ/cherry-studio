/**
 * Shared parts-to-blocks conversion utility.
 *
 * Converts AI SDK UIMessage.parts into renderer legacy MessageBlock[] format.
 * Used by both:
 * - DataApiMessageDataSource (persisted messages from Data API)
 * - useV2MessageAdapter (live streamed messages from useAiChat)
 *
 * TODO: Remove when renderer components adopt UIMessage.parts rendering directly.
 */

import { loggerService } from '@logger'
import { FILE_TYPE } from '@renderer/types/file'
import type { WebSearchSource } from '@renderer/types/index'
import type {
  CitationMessageBlock,
  CodeMessageBlock,
  CompactMessageBlock,
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  MessageBlock,
  ThinkingMessageBlock,
  ToolMessageBlock,
  TranslationMessageBlock,
  VideoMessageBlock
} from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { CherryMessagePart, CitationReference, ContentReference } from '@shared/data/types/message'
import { isWebCitation, ReferenceCategory } from '@shared/data/types/message'
import type {
  CherryProviderMetadata,
  CodePartData,
  CompactPartData,
  ErrorPartData,
  TranslationPartData,
  VideoPartData
} from '@shared/data/types/uiParts'
import type { FileUIPart, ReasoningUIPart, TextUIPart } from 'ai'

const logger = loggerService.withContext('partsToBlocks')

/** Tool UIPart shape — AI SDK does not export this directly. */
interface ToolUIPart {
  type: `tool-${string}`
  toolCallId: string
  state: string
  input?: unknown
  output?: unknown
  toolName?: string
  errorText?: string
}

/** Dynamic tool UIPart shape from AI SDK. */
interface DynamicToolUIPart {
  type: 'dynamic-tool'
  toolCallId: string
  toolName: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

/**
 * Extract CherryProviderMetadata from a part's providerMetadata.cherry field.
 */
function getCherryMeta(part: CherryMessagePart): CherryProviderMetadata | undefined {
  if ('providerMetadata' in part && part.providerMetadata) {
    return part.providerMetadata.cherry as CherryProviderMetadata | undefined
  }
  return undefined
}

/**
 * Convert a single UIMessage part to a renderer MessageBlock.
 *
 * @param part - The UIMessage part to convert
 * @param blockId - Deterministic block ID (e.g. `${messageId}-block-${index}`)
 * @param messageId - Parent message ID
 * @param createdAt - Fallback creation timestamp (ISO string)
 * @param status - Block status
 * @returns MessageBlock or null if the part should be skipped
 */
export function partToBlock(
  part: CherryMessagePart,
  blockId: string,
  messageId: string,
  createdAt: string,
  status: MessageBlockStatus
): MessageBlock | null {
  const cherryMeta = getCherryMeta(part)
  const resolvedCreatedAt = cherryMeta?.createdAt ? new Date(cherryMeta.createdAt).toISOString() : createdAt

  const base = {
    id: blockId,
    messageId,
    createdAt: resolvedCreatedAt,
    status
  }

  // Cast to string because CherryMessagePart is a wide union with dynamic `tool-*`
  // prefix types that cannot be exhaustively matched in a switch statement.
  const partType = part.type as string

  switch (partType) {
    case 'text': {
      const textPart = part as TextUIPart
      const block: MainTextMessageBlock = {
        ...base,
        type: MessageBlockType.MAIN_TEXT,
        content: textPart.text || ''
      }
      if (cherryMeta?.references) {
        block.citationReferences = convertReferencesToLegacyCitations(
          cherryMeta.references as ContentReference[],
          blockId
        )
      }
      return block
    }

    case 'source-url':
      // source-url parts are metadata already captured in text part's citationReferences
      return null

    case 'reasoning': {
      const reasoningPart = part as ReasoningUIPart
      const block: ThinkingMessageBlock = {
        ...base,
        type: MessageBlockType.THINKING,
        content: reasoningPart.text || '',
        thinking_millsec: cherryMeta?.thinkingMs ?? 0
      }
      return block
    }

    case 'dynamic-tool': {
      const toolPart = part as unknown as DynamicToolUIPart
      const toolCallId = toolPart.toolCallId || blockId
      const toolName = toolPart.toolName || 'unknown'
      const isError = toolPart.state === 'output-error'
      const content: string | object | undefined = isError
        ? {
            isError: true,
            content: [{ type: 'text', text: toolPart.errorText || 'Error' }]
          }
        : 'output' in toolPart
          ? (toolPart.output as object | undefined)
          : undefined

      const toolType = 'mcp' as const
      const block: ToolMessageBlock = {
        ...base,
        type: MessageBlockType.TOOL,
        toolId: toolCallId,
        toolName,
        arguments: toolPart.input as Record<string, unknown>,
        content,
        status: mapToolState(toolPart.state, status),
        metadata: {
          rawMcpToolResponse: {
            id: toolCallId,
            tool: { id: toolCallId, name: toolName, type: toolType },
            arguments: toolPart.input as Record<string, unknown>,
            status: isError ? 'error' : 'done',
            response: content,
            toolCallId
          }
        }
      }
      return block
    }

    case 'file': {
      const filePart = part as FileUIPart
      if (filePart.mediaType?.startsWith('image/')) {
        const block: ImageMessageBlock = {
          ...base,
          type: MessageBlockType.IMAGE,
          url: filePart.url
        }
        return block
      }
      if (!filePart.url) {
        logger.warn('File part has no url, skipping block creation', { filename: filePart.filename })
        return null
      }
      const block: FileMessageBlock = {
        ...base,
        type: MessageBlockType.FILE,
        file: {
          id: blockId,
          name: filePart.filename || '',
          origin_name: filePart.filename || '',
          path: filePart.url.replace('file://', ''),
          size: 0,
          ext: '',
          type: FILE_TYPE.OTHER,
          created_at: resolvedCreatedAt,
          count: 0
        }
      }
      return block
    }

    default: {
      // Handle tool-* parts (from useChat streaming)
      if (partType.startsWith('tool-')) {
        const toolPart = part as unknown as ToolUIPart
        const block: ToolMessageBlock = {
          ...base,
          type: MessageBlockType.TOOL,
          toolId: toolPart.toolCallId,
          toolName: toolPart.toolName ?? partType.replace('tool-', ''),
          arguments: toolPart.input as Record<string, unknown> | undefined,
          content: toolPart.state === 'output-available' ? (toolPart.output as string | object | undefined) : undefined,
          status: mapToolState(toolPart.state, status)
        }
        return block
      }

      // Handle data-* parts
      if (partType.startsWith('data-')) {
        return convertDataPartToBlock(part, base)
      }

      logger.warn('Unknown part type during parts→blocks conversion', { type: partType })
      return null
    }
  }
}

/**
 * Map tool state string to MessageBlockStatus.
 */
function mapToolState(state: string, fallbackStatus: MessageBlockStatus): MessageBlockStatus {
  switch (state) {
    case 'output-available':
      return MessageBlockStatus.SUCCESS
    case 'output-error':
      return MessageBlockStatus.ERROR
    case 'input-available':
      return MessageBlockStatus.PROCESSING
    default:
      return fallbackStatus
  }
}

/**
 * Convert data-* parts (error, translation, video, compact, code, citation) to renderer blocks.
 */
function convertDataPartToBlock(
  part: CherryMessagePart,
  base: { id: string; messageId: string; createdAt: string; status: MessageBlockStatus }
): MessageBlock | null {
  const partType = part.type as string
  const rawData = 'data' in part ? part.data : undefined

  if (!rawData) {
    logger.warn('data-* part missing data field', { type: partType })
    return null
  }

  switch (partType) {
    case 'data-error': {
      const data = rawData as ErrorPartData
      const block: ErrorMessageBlock = {
        ...base,
        type: MessageBlockType.ERROR,
        error: {
          name: data.name ?? null,
          message: data.message ?? null,
          stack: null,
          ...(data.code != null && { code: data.code })
        }
      }
      return block
    }

    case 'data-translation': {
      const data = rawData as TranslationPartData
      const block: TranslationMessageBlock = {
        ...base,
        type: MessageBlockType.TRANSLATION,
        content: data.content || '',
        targetLanguage: data.targetLanguage || '',
        sourceLanguage: data.sourceLanguage
      }
      return block
    }

    case 'data-citation': {
      // Citation data is typically embedded in MainTextBlock.citationReferences.
      // This block is an empty placeholder for legacy rendering compatibility.
      const block: CitationMessageBlock = {
        ...base,
        type: MessageBlockType.CITATION
      }
      return block
    }

    case 'data-video': {
      const data = rawData as VideoPartData
      const block: VideoMessageBlock = {
        ...base,
        type: MessageBlockType.VIDEO,
        url: data.url,
        filePath: data.filePath
      }
      return block
    }

    case 'data-compact': {
      const data = rawData as CompactPartData
      const block: CompactMessageBlock = {
        ...base,
        type: MessageBlockType.COMPACT,
        content: data.content || '',
        compactedContent: data.compactedContent || ''
      }
      return block
    }

    case 'data-code': {
      const data = rawData as CodePartData
      const block: CodeMessageBlock = {
        ...base,
        type: MessageBlockType.CODE,
        content: data.content || '',
        language: data.language || ''
      }
      return block
    }

    default:
      logger.warn('Unknown data part type during parts→blocks conversion', { type: partType })
      return null
  }
}

/**
 * Convert ContentReference[] (new format) to legacy citationReferences shape.
 * The renderer expects `{ citationBlockId?, citationBlockSource? }[]`.
 *
 * Note: Only web citations are converted. Knowledge and memory citations are not
 * supported by the legacy citationReferences format and are silently dropped.
 */
function convertReferencesToLegacyCitations(
  references: ContentReference[],
  blockId: string
): MainTextMessageBlock['citationReferences'] {
  const citations = references.filter((ref): ref is CitationReference => ref.category === ReferenceCategory.CITATION)
  if (citations.length === 0) return undefined

  const nonWebCitations = citations.filter((ref) => !isWebCitation(ref))
  if (nonWebCitations.length > 0) {
    logger.warn('Non-web citations dropped during legacy conversion (knowledge/memory not supported)', {
      droppedCount: nonWebCitations.length
    })
  }

  return citations.filter(isWebCitation).map((ref) => ({
    citationBlockId: blockId,
    citationBlockSource: (ref.content?.source ?? undefined) as WebSearchSource | undefined
  }))
}

/**
 * Map message status string to MessageBlockStatus.
 */
export function mapMessageStatusToBlockStatus(messageStatus: string): MessageBlockStatus {
  switch (messageStatus) {
    case 'success':
      return MessageBlockStatus.SUCCESS
    case 'error':
      return MessageBlockStatus.ERROR
    case 'paused':
      return MessageBlockStatus.PAUSED
    case 'pending':
      return MessageBlockStatus.PENDING
    default:
      return MessageBlockStatus.SUCCESS
  }
}
