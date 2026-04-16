/**
 * Reverse conversion: renderer legacy MessageBlock[] → CherryMessagePart[].
 *
 * Used by V2 edit operations to convert edited blocks back to parts
 * for DataApi persistence and useChat state updates.
 *
 * This is the inverse of partToBlock (partsToBlocks.ts).
 */

import { loggerService } from '@logger'
import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'

const logger = loggerService.withContext('blocksToParts')

/**
 * Convert a single MessageBlock to a CherryMessagePart.
 * Returns null for block types that have no parts equivalent.
 */
export function blockToPart(block: MessageBlock): CherryMessagePart | null {
  switch (block.type) {
    case MessageBlockType.MAIN_TEXT:
      return {
        type: 'text',
        text: block.content || ''
      } as CherryMessagePart

    case MessageBlockType.THINKING:
      return {
        type: 'reasoning',
        text: block.content || '',
        reasoning: block.content || ''
      } as CherryMessagePart

    case MessageBlockType.IMAGE:
      return {
        type: 'file',
        mediaType: 'image/png',
        url: block.url || ''
      } as CherryMessagePart

    case MessageBlockType.FILE:
      return {
        type: 'file',
        mediaType: 'application/octet-stream',
        url: block.file?.path ? `file://${block.file.path}` : '',
        filename: block.file?.name || ''
      } as CherryMessagePart

    case MessageBlockType.TOOL: {
      const toolName = block.toolName ?? 'unknown'
      return {
        type: `tool-${toolName}`,
        toolCallId: block.toolId,
        toolName,
        state: block.status === 'error' ? 'output-error' : 'output-available',
        input: block.arguments,
        output: block.content
      } as unknown as CherryMessagePart
    }

    case MessageBlockType.CITATION:
      return {
        type: 'data-citation',
        data: {
          response: block.response,
          knowledge: block.knowledge,
          memories: block.memories
        }
      } as unknown as CherryMessagePart

    case MessageBlockType.ERROR:
      return {
        type: 'data-error',
        data: {
          ...block.error,
          name: block.error?.name ?? undefined,
          message: block.error?.message ?? undefined,
          stack: block.error?.stack ?? null,
          code: block.error?.code
        }
      } as CherryMessagePart

    case MessageBlockType.TRANSLATION:
      return {
        type: 'data-translation',
        data: {
          content: block.content || '',
          targetLanguage: block.targetLanguage || '',
          sourceLanguage: block.sourceLanguage
        }
      } as CherryMessagePart

    case MessageBlockType.VIDEO:
      return {
        type: 'data-video',
        data: { url: block.url, filePath: block.filePath }
      } as CherryMessagePart

    case MessageBlockType.COMPACT:
      return {
        type: 'data-compact',
        data: { content: block.content || '', compactedContent: block.compactedContent || '' }
      } as CherryMessagePart

    case MessageBlockType.CODE:
      return {
        type: 'data-code',
        data: { content: block.content || '', language: block.language || '' }
      } as CherryMessagePart

    default:
      logger.warn('Unknown block type during blocks→parts conversion', { type: block.type })
      return null
  }
}

/**
 * Convert an array of MessageBlocks to CherryMessageParts.
 * Filters out null results (unsupported block types).
 */
export function blocksToParts(blocks: MessageBlock[]): CherryMessagePart[] {
  const parts: CherryMessagePart[] = []
  for (const block of blocks) {
    const part = blockToPart(block)
    if (part) {
      parts.push(part)
    }
  }
  return parts
}
