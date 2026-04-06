/**
 * TODO: Temporary compatibility layer — remove after message type migration.
 *
 * This module bridges the Data API (shared types) and the renderer (legacy types)
 * by converting SharedMessage → renderer Message + MessageBlock[].
 *
 * Once the renderer adopts shared types directly (Message from @shared/data/types/message),
 * this conversion layer and the separate MessageBlock store become unnecessary.
 * The renderer should consume Data API responses as-is without re-shaping.
 */
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type {
  CodeMessageBlock,
  CompactMessageBlock,
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  Message,
  MessageBlock,
  ThinkingMessageBlock,
  ToolMessageBlock,
  TranslationMessageBlock,
  VideoMessageBlock
} from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { ToolType } from '@renderer/types/tool'
import { ErrorCode } from '@shared/data/api/apiErrors'
import type { BranchMessagesResponse, CherryMessagePart, Message as SharedMessage } from '@shared/data/types/message'
import type { CherryProviderMetadata } from '@shared/data/types/uiParts'

const logger = loggerService.withContext('DataApiMessageDataSource')

const FETCH_LIMIT = 999

/**
 * Fetch messages for a topic from the Data API and convert to renderer format.
 */
export async function fetchMessagesFromDataApi(topicId: string): Promise<{
  messages: Message[]
  blocks: MessageBlock[]
}> {
  try {
    const response = (await dataApiService.get(`/topics/${topicId}/messages`, {
      query: { limit: FETCH_LIMIT, includeSiblings: true }
    })) as BranchMessagesResponse

    const messages: Message[] = []
    const blocks: MessageBlock[] = []

    for (const item of response.items) {
      const result = convertSharedMessage(item.message)
      messages.push(result.message)
      blocks.push(...result.blocks)

      if (item.siblingsGroup) {
        for (const sibling of item.siblingsGroup) {
          const sibResult = convertSharedMessage(sibling)
          messages.push(sibResult.message)
          blocks.push(...sibResult.blocks)
        }
      }
    }

    logger.debug('Fetched messages from Data API', {
      topicId,
      messageCount: messages.length,
      blockCount: blocks.length
    })

    return { messages, blocks }
  } catch (error: any) {
    if (error?.code === ErrorCode.NOT_FOUND) {
      logger.debug(`Topic ${topicId} not found in Data API, returning empty`)
      return { messages: [], blocks: [] }
    }
    logger.error(`Failed to fetch messages from Data API for topic ${topicId}:`, error as Error)
    throw error
  }
}

/**
 * Convert a shared Message (Data API) to renderer Message + MessageBlock[].
 *
 * Block data was written from renderer format (minus id/status/messageId),
 * so we restore those fields with deterministic IDs based on messageId + index.
 */
function convertSharedMessage(shared: SharedMessage): {
  message: Message
  blocks: MessageBlock[]
} {
  const rendererBlocks: MessageBlock[] = []
  const blockIds: string[] = []

  // Support both old format (data.blocks) and new format (data.parts from AI SDK UIMessage)
  const dataBlocks = shared.data?.blocks || []
  const dataParts = shared.data?.parts || []

  if (dataBlocks.length > 0) {
    // Old format: data.blocks (MessageDataBlock[])
    for (let i = 0; i < dataBlocks.length; i++) {
      const { type, createdAt, ...rest } = dataBlocks[i] as Record<string, any>
      const blockId = `${shared.id}-block-${i}`
      blockIds.push(blockId)

      rendererBlocks.push({
        ...rest,
        id: blockId,
        messageId: shared.id,
        type,
        status: mapBlockStatus(shared.status),
        createdAt: typeof createdAt === 'number' ? new Date(createdAt).toISOString() : createdAt || shared.createdAt
      } as MessageBlock)
    }
  } else if (dataParts.length > 0) {
    // New format: data.parts (UIMessagePart[]) — convert back to renderer blocks temporarily
    // TODO: Remove this compatibility layer when renderer adopts UIMessage.parts rendering
    for (let i = 0; i < dataParts.length; i++) {
      const part = dataParts[i]
      const blockId = `${shared.id}-block-${i}`
      blockIds.push(blockId)

      const block = convertPartToBlock(part, blockId, shared.id, shared.createdAt, shared.status)
      if (block) {
        rendererBlocks.push(block)
      }
    }
  }

  const message: Message = {
    id: shared.id,
    topicId: shared.topicId,
    role: shared.role,
    assistantId: shared.assistantId || '',
    status: shared.status as Message['status'],
    blocks: blockIds,
    createdAt: shared.createdAt,
    updatedAt: shared.updatedAt,
    askId: shared.parentId ?? undefined,
    modelId: shared.modelId ?? undefined,
    traceId: shared.traceId ?? undefined,
    ...(shared.stats && {
      usage: {
        prompt_tokens: shared.stats.promptTokens ?? 0,
        completion_tokens: shared.stats.completionTokens ?? 0,
        total_tokens: shared.stats.totalTokens ?? 0
      },
      metrics: {
        completion_tokens: shared.stats.completionTokens ?? 0,
        time_completion_millsec: shared.stats.timeCompletionMs ?? 0,
        time_first_token_millsec: shared.stats.timeFirstTokenMs,
        time_thinking_millsec: shared.stats.timeThinkingMs
      }
    })
  }

  return { message, blocks: rendererBlocks }
}

/**
 * Part as stored in DB — same as CherryMessagePart.
 */
type StoredPart = CherryMessagePart

/**
 * Convert a UIMessage part back to a renderer MessageBlock.
 * Temporary compatibility layer until renderer adopts parts-based rendering.
 */
function convertPartToBlock(
  part: StoredPart,
  blockId: string,
  messageId: string,
  fallbackCreatedAt: string,
  messageStatus: string
): MessageBlock | null {
  const status = mapBlockStatus(messageStatus)

  function getCherryMeta(): CherryProviderMetadata | undefined {
    if ('providerMetadata' in part && part.providerMetadata) {
      return part.providerMetadata.cherry as CherryProviderMetadata | undefined
    }
    return undefined
  }

  const cherryMeta = getCherryMeta()
  const createdAt = cherryMeta?.createdAt ? new Date(cherryMeta.createdAt).toISOString() : fallbackCreatedAt

  switch (part.type) {
    case 'text': {
      const block: MainTextMessageBlock = {
        id: blockId,
        messageId,
        status,
        createdAt,
        type: MessageBlockType.MAIN_TEXT,
        content: part.text || ''
      }
      if (cherryMeta?.references) {
        block.citationReferences = cherryMeta.references as MainTextMessageBlock['citationReferences']
      }
      return block
    }

    case 'reasoning': {
      const block: ThinkingMessageBlock = {
        id: blockId,
        messageId,
        status,
        createdAt,
        type: MessageBlockType.THINKING,
        content: part.text || '',
        thinking_millsec: (cherryMeta?.thinkingMs as number) ?? 0
      }
      return block
    }

    case 'dynamic-tool': {
      const toolCallId = part.toolCallId || blockId
      const toolName = part.toolName || 'unknown'
      const isError = part.state === 'output-error'
      const content: string | object | undefined = isError
        ? {
            isError: true,
            content: [{ type: 'text', text: ('errorText' in part ? part.errorText : undefined) || 'Error' }]
          }
        : 'output' in part
          ? (part.output as object | undefined)
          : undefined

      const block: ToolMessageBlock = {
        id: blockId,
        messageId,
        status,
        createdAt,
        type: MessageBlockType.TOOL,
        toolId: toolCallId,
        toolName,
        arguments: part.input as Record<string, unknown>,
        content,
        metadata: {
          rawMcpToolResponse: {
            id: toolCallId,
            tool: { id: toolCallId, name: toolName, type: 'mcp' as ToolType },
            arguments: part.input as Record<string, unknown>,
            status: isError ? 'error' : 'done',
            response: content,
            toolCallId
          }
        }
      }
      return block
    }

    case 'file': {
      if (part.mediaType?.startsWith('image/')) {
        const block: ImageMessageBlock = {
          id: blockId,
          messageId,
          status,
          createdAt,
          type: MessageBlockType.IMAGE,
          url: part.url
        }
        return block
      }
      const block: FileMessageBlock = {
        id: blockId,
        messageId,
        status,
        createdAt,
        type: MessageBlockType.FILE,
        file: {
          id: blockId,
          name: part.filename || '',
          origin_name: part.filename || '',
          path: part.url?.replace('file://', '') || '',
          size: 0,
          ext: '',
          type: 'other',
          created_at: createdAt,
          count: 0
        }
      }
      return block
    }

    default: {
      // Handle data-* parts
      if (part.type.startsWith('data-')) {
        return convertDataPartToBlock(part, blockId, messageId, status, createdAt)
      }
      logger.warn('Unknown part type during parts→blocks conversion', { type: part.type })
      return null
    }
  }
}

/**
 * Convert data-* parts (error, translation, video, compact, code) to renderer blocks.
 */
function convertDataPartToBlock(
  part: StoredPart,
  blockId: string,
  messageId: string,
  status: MessageBlockStatus,
  createdAt: string
): MessageBlock | null {
  const data = 'data' in part ? (part.data as Record<string, unknown>) : {}

  switch (part.type) {
    case 'data-error': {
      const block: ErrorMessageBlock = {
        id: blockId,
        messageId,
        status,
        createdAt,
        type: MessageBlockType.ERROR,
        error: { name: (data.name as string) ?? null, message: (data.message as string) ?? null, stack: null }
      }
      return block
    }

    case 'data-translation': {
      const block: TranslationMessageBlock = {
        id: blockId,
        messageId,
        status,
        createdAt,
        type: MessageBlockType.TRANSLATION,
        content: (data.content as string) || '',
        targetLanguage: (data.targetLanguage as string) || ''
      }
      return block
    }

    case 'data-video': {
      const block: VideoMessageBlock = {
        id: blockId,
        messageId,
        status,
        createdAt,
        type: MessageBlockType.VIDEO,
        url: data.url as string | undefined,
        filePath: data.filePath as string | undefined
      }
      return block
    }

    case 'data-compact': {
      const block: CompactMessageBlock = {
        id: blockId,
        messageId,
        status,
        createdAt,
        type: MessageBlockType.COMPACT,
        content: (data.content as string) || '',
        compactedContent: (data.compactedContent as string) || ''
      }
      return block
    }

    case 'data-code': {
      const block: CodeMessageBlock = {
        id: blockId,
        messageId,
        status,
        createdAt,
        type: MessageBlockType.CODE,
        content: (data.content as string) || '',
        language: (data.language as string) || ''
      }
      return block
    }

    default:
      logger.warn('Unknown data part type during parts→blocks conversion', { type: part.type })
      return null
  }
}

function mapBlockStatus(messageStatus: string): MessageBlockStatus {
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
