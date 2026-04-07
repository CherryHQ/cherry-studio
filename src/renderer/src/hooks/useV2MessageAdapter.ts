import type { CherryUIMessage } from '@renderer/hooks/useAiChat'
import {
  AssistantMessageStatus,
  type MainTextMessageBlock,
  type Message,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { partToBlock } from '@renderer/utils/partsToBlocks'
import type { ChatStatus } from 'ai'
import { useMemo, useRef } from 'react'

/**
 * Adapter that converts AI SDK UIMessage.parts[] into the legacy
 * Message + MessageBlock[] shape consumed by existing rendering components.
 *
 * This is a temporary bridge for P1-P2. In P3, components will read parts directly.
 */

interface AdaptedMessages {
  /** Legacy Message objects (with block ID arrays) */
  messages: Message[]
  /** All MessageBlock objects, keyed by ID for lookup */
  blockMap: Record<string, MessageBlock>
}

function adaptSingleMessage(
  uiMessage: CherryUIMessage,
  chatStatus: ChatStatus,
  topicId: string,
  assistantId: string,
  timestampCache: Map<string, string>
): { message: Message; blocks: MessageBlock[] } {
  const isAssistantMessage = uiMessage.role === 'assistant'
  const isStreaming = isAssistantMessage && chatStatus === 'streaming'

  // Cache timestamps per message ID so they stay stable across re-renders
  let cachedTimestamp = timestampCache.get(uiMessage.id)
  if (!cachedTimestamp) {
    cachedTimestamp = new Date().toISOString()
    timestampCache.set(uiMessage.id, cachedTimestamp)
  }

  const blocks: MessageBlock[] = []
  const blockStatus = isStreaming ? MessageBlockStatus.STREAMING : MessageBlockStatus.SUCCESS

  for (let i = 0; i < uiMessage.parts.length; i++) {
    const part = uiMessage.parts[i]
    const blockId = `${uiMessage.id}-block-${i}`
    const block = partToBlock(part, blockId, uiMessage.id, cachedTimestamp, blockStatus)
    if (block) {
      blocks.push(block)
    }
  }

  // If assistant message has no blocks yet (streaming just started), add a pending text block
  if (blocks.length === 0 && uiMessage.role === 'assistant') {
    blocks.push({
      id: `${uiMessage.id}-block-0`,
      messageId: uiMessage.id,
      createdAt: cachedTimestamp,
      status: MessageBlockStatus.STREAMING,
      type: MessageBlockType.MAIN_TEXT,
      content: ''
    } as MainTextMessageBlock)
  }

  const message: Message = {
    id: uiMessage.id,
    role: uiMessage.role,
    assistantId,
    topicId,
    createdAt: cachedTimestamp,
    status:
      uiMessage.role === 'user'
        ? UserMessageStatus.SUCCESS
        : isStreaming
          ? AssistantMessageStatus.PROCESSING
          : AssistantMessageStatus.SUCCESS,
    blocks: blocks.map((b) => b.id)
  }

  return { message, blocks }
}

/**
 * Hook that adapts useAiChat's UIMessage[] into legacy Message[] + blockMap
 * for consumption by existing Messages/MessageGroup/MessageItem components.
 */
export function useV2MessageAdapter(
  uiMessages: CherryUIMessage[],
  chatStatus: ChatStatus,
  topicId: string,
  assistantId: string
): AdaptedMessages {
  // Stable timestamp cache — preserves createdAt across re-renders for each message ID
  const timestampCacheRef = useRef(new Map<string, string>())

  return useMemo(() => {
    const messages: Message[] = []
    const blockMap: Record<string, MessageBlock> = {}
    const activeIds = new Set<string>()

    for (const uiMsg of uiMessages) {
      activeIds.add(uiMsg.id)
      const { message, blocks } = adaptSingleMessage(uiMsg, chatStatus, topicId, assistantId, timestampCacheRef.current)
      messages.push(message)
      for (const block of blocks) {
        blockMap[block.id] = block
      }
    }

    // Prune stale entries from timestamp cache to prevent memory leaks across topic switches
    for (const key of timestampCacheRef.current.keys()) {
      if (!activeIds.has(key)) {
        timestampCacheRef.current.delete(key)
      }
    }

    return { messages, blockMap }
  }, [uiMessages, chatStatus, topicId, assistantId])
}
