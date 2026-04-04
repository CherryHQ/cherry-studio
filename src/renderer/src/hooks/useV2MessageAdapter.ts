import type { CherryUIMessage } from '@renderer/hooks/useAiChat'
import { FILE_TYPE } from '@renderer/types/file'
import {
  AssistantMessageStatus,
  type CitationMessageBlock,
  type CodeMessageBlock,
  type CompactMessageBlock,
  type ErrorMessageBlock,
  type MainTextMessageBlock,
  type Message,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType,
  type ThinkingMessageBlock,
  type ToolMessageBlock,
  type TranslationMessageBlock,
  UserMessageStatus,
  type VideoMessageBlock
} from '@renderer/types/newMessage'
import type { CherryDataUIParts } from '@shared/ai-transport'
import type { ChatStatus, DataUIPart, FileUIPart, ReasoningUIPart, TextUIPart } from 'ai'
import { useRef } from 'react'
import { useMemo } from 'react'

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

/** Extract the tool invocation UIPart shape from AI SDK (not exported directly). */
interface ToolUIPart {
  type: `tool-${string}`
  toolCallId: string
  state: string
  input?: unknown
  output?: unknown
  toolName?: string
}

function createBaseBlock(
  messageId: string,
  index: number,
  isStreaming: boolean,
  createdAt: string
): Omit<MessageBlock, 'type'> {
  return {
    id: `${messageId}-block-${index}`,
    messageId,
    createdAt,
    status: isStreaming ? MessageBlockStatus.STREAMING : MessageBlockStatus.SUCCESS
  }
}

function adaptSingleMessage(
  uiMessage: CherryUIMessage,
  chatStatus: ChatStatus,
  topicId: string,
  assistantId: string,
  timestampCache: Map<string, string>
): { message: Message; blocks: MessageBlock[] } {
  const isLastAssistant = uiMessage.role === 'assistant'
  const isStreaming = isLastAssistant && chatStatus === 'streaming'

  // Cache timestamps per message ID so they stay stable across re-renders
  let cachedTimestamp = timestampCache.get(uiMessage.id)
  if (!cachedTimestamp) {
    cachedTimestamp = new Date().toISOString()
    timestampCache.set(uiMessage.id, cachedTimestamp)
  }

  const blocks: MessageBlock[] = []

  for (let i = 0; i < uiMessage.parts.length; i++) {
    const part = uiMessage.parts[i]
    const base = createBaseBlock(uiMessage.id, i, isStreaming, cachedTimestamp)
    const partType = part.type as string

    if (partType === 'text') {
      const textPart = part as TextUIPart
      blocks.push({
        ...base,
        type: MessageBlockType.MAIN_TEXT,
        content: textPart.text
      } as MainTextMessageBlock)
    } else if (partType === 'reasoning') {
      const reasoningPart = part as ReasoningUIPart
      blocks.push({
        ...base,
        type: MessageBlockType.THINKING,
        content: reasoningPart.text,
        thinking_millsec: 0
      } as ThinkingMessageBlock)
    } else if (partType === 'file') {
      const filePart = part as FileUIPart
      if (filePart.mediaType.startsWith('image/')) {
        blocks.push({ ...base, type: MessageBlockType.IMAGE, url: filePart.url } as MessageBlock)
      } else {
        blocks.push({
          ...base,
          type: MessageBlockType.FILE,
          file: {
            id: base.id,
            name: filePart.filename ?? 'file',
            origin_name: filePart.filename ?? 'file',
            path: filePart.url,
            size: 0,
            ext: '',
            type: FILE_TYPE.OTHER,
            created_at: cachedTimestamp,
            count: 0
          }
        } as MessageBlock)
      }
    } else if (partType.startsWith('tool-')) {
      // ToolUIPart — type is `tool-${toolName}`, fields are flat
      const toolPart = part as unknown as ToolUIPart
      blocks.push({
        ...base,
        type: MessageBlockType.TOOL,
        toolId: toolPart.toolCallId,
        toolName: toolPart.toolName ?? partType.replace('tool-', ''),
        arguments: toolPart.input as Record<string, unknown> | undefined,
        content: toolPart.state === 'output-available' ? toolPart.output : undefined,
        status:
          toolPart.state === 'output-available'
            ? MessageBlockStatus.SUCCESS
            : toolPart.state === 'input-available'
              ? MessageBlockStatus.PROCESSING
              : MessageBlockStatus.STREAMING
      } as ToolMessageBlock)
    } else if (partType === 'data-error') {
      const dataPart = part as DataUIPart<CherryDataUIParts>
      const data = dataPart.data as CherryDataUIParts['error']
      blocks.push({
        ...base,
        type: MessageBlockType.ERROR,
        error: { name: data.name ?? 'Error', message: data.message, stack: '' }
      } as ErrorMessageBlock)
    } else if (partType === 'data-translation') {
      const dataPart = part as DataUIPart<CherryDataUIParts>
      const data = dataPart.data as CherryDataUIParts['translation']
      blocks.push({
        ...base,
        type: MessageBlockType.TRANSLATION,
        content: data.content,
        targetLanguage: data.targetLanguage,
        sourceLanguage: data.sourceLanguage
      } as TranslationMessageBlock)
    } else if (partType === 'data-citation') {
      blocks.push({
        ...base,
        type: MessageBlockType.CITATION
      } as CitationMessageBlock)
    } else if (partType === 'data-video') {
      const dataPart = part as DataUIPart<CherryDataUIParts>
      const data = dataPart.data as CherryDataUIParts['video']
      blocks.push({ ...base, type: MessageBlockType.VIDEO, url: data.url } as VideoMessageBlock)
    } else if (partType === 'data-compact') {
      const dataPart = part as DataUIPart<CherryDataUIParts>
      const data = dataPart.data as CherryDataUIParts['compact']
      blocks.push({
        ...base,
        type: MessageBlockType.COMPACT,
        content: data.summary,
        compactedContent: ''
      } as CompactMessageBlock)
    } else if (partType === 'data-code') {
      const dataPart = part as DataUIPart<CherryDataUIParts>
      const data = dataPart.data as CherryDataUIParts['code']
      blocks.push({
        ...base,
        type: MessageBlockType.CODE,
        content: data.code,
        language: data.language
      } as CodeMessageBlock)
    }
    // Unknown part types are silently skipped
  }

  // If assistant message has no blocks yet (streaming just started), add a pending text block
  if (blocks.length === 0 && uiMessage.role === 'assistant') {
    blocks.push({
      ...createBaseBlock(uiMessage.id, 0, true, cachedTimestamp),
      type: MessageBlockType.MAIN_TEXT,
      content: ''
    } as MainTextMessageBlock)
  }

  const message: Message = {
    id: uiMessage.id,
    role: uiMessage.role as Message['role'],
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

    for (const uiMsg of uiMessages) {
      const { message, blocks } = adaptSingleMessage(uiMsg, chatStatus, topicId, assistantId, timestampCacheRef.current)
      messages.push(message)
      for (const block of blocks) {
        blockMap[block.id] = block
      }
    }

    return { messages, blockMap }
  }, [uiMessages, chatStatus, topicId, assistantId])
}
