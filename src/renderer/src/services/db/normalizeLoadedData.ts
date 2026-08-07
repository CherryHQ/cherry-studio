import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'

/**
 * Normalize in-progress message statuses that may have been persisted mid-stream.
 * Persisted storage should always represent a final state; active streams
 * create new in-memory messages and never resume from history.
 */
export function normalizeLoadedMessages<T extends Message>(messages: T[]): T[] {
  return messages.map((message) => {
    if (
      message.status === AssistantMessageStatus.PROCESSING ||
      message.status === AssistantMessageStatus.PENDING ||
      message.status === AssistantMessageStatus.SEARCHING
    ) {
      return { ...message, status: AssistantMessageStatus.SUCCESS }
    }
    return message
  })
}

/**
 * Normalize in-progress block statuses that may have been persisted mid-stream.
 * Persisted storage should always represent a final state; active streams
 * create new in-memory blocks and never resume from history.
 */
export function normalizeLoadedBlocks<T extends MessageBlock>(blocks: T[]): T[] {
  return blocks.map((block) => {
    if (
      block.status === MessageBlockStatus.STREAMING ||
      block.status === MessageBlockStatus.PROCESSING ||
      block.status === MessageBlockStatus.PENDING
    ) {
      return { ...block, status: MessageBlockStatus.SUCCESS }
    }
    return block
  })
}
