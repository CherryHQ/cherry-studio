import { isDeepStrictEqual } from 'node:util'

import type { MessageParam, ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/messages'

export interface AnthropicToolBlockLocation {
  messageIndex: number
  contentIndex: number
}

export type AnthropicToolHistoryNormalizationResult =
  | { status: 'unchanged'; messages: MessageParam[] }
  | {
      status: 'repaired'
      messages: MessageParam[]
      duplicateToolUseCount: number
      duplicateToolResultCount: number
    }
  | {
      status: 'conflict'
      toolUseId: string
      reason: 'different-call' | 'cross-turn-reuse' | 'different-result'
      firstLocation: AnthropicToolBlockLocation
      duplicateLocation: AnthropicToolBlockLocation
    }

interface SeenBlock<T> {
  block: T
  location: AnthropicToolBlockLocation
}

export function normalizeAnthropicToolHistory(messages: MessageParam[]): AnthropicToolHistoryNormalizationResult {
  const seenToolUses = new Map<string, SeenBlock<ToolUseBlockParam>>()
  const seenToolResults = new Map<string, SeenBlock<ToolResultBlockParam>>()
  const duplicateIndexes = new Map<number, Set<number>>()
  let duplicateToolUseCount = 0
  let duplicateToolResultCount = 0

  const markDuplicate = (messageIndex: number, contentIndex: number): void => {
    const messageDuplicates = duplicateIndexes.get(messageIndex)
    if (messageDuplicates) {
      messageDuplicates.add(contentIndex)
    } else {
      duplicateIndexes.set(messageIndex, new Set([contentIndex]))
    }
  }

  for (const [messageIndex, message] of messages.entries()) {
    if (!Array.isArray(message.content)) continue

    for (const [contentIndex, block] of message.content.entries()) {
      const duplicateLocation = { messageIndex, contentIndex }

      if (block.type === 'tool_use') {
        const first = seenToolUses.get(block.id)
        if (!first) {
          seenToolUses.set(block.id, { block, location: duplicateLocation })
          continue
        }
        if (first.location.messageIndex !== messageIndex) {
          return {
            status: 'conflict',
            toolUseId: block.id,
            reason: 'cross-turn-reuse',
            firstLocation: first.location,
            duplicateLocation
          }
        }
        if (!isDeepStrictEqual(first.block, block)) {
          return {
            status: 'conflict',
            toolUseId: block.id,
            reason: 'different-call',
            firstLocation: first.location,
            duplicateLocation
          }
        }

        markDuplicate(messageIndex, contentIndex)
        duplicateToolUseCount += 1
      } else if (block.type === 'tool_result') {
        const first = seenToolResults.get(block.tool_use_id)
        if (!first) {
          seenToolResults.set(block.tool_use_id, { block, location: duplicateLocation })
          continue
        }
        if (!isDeepStrictEqual(first.block, block)) {
          return {
            status: 'conflict',
            toolUseId: block.tool_use_id,
            reason: 'different-result',
            firstLocation: first.location,
            duplicateLocation
          }
        }

        markDuplicate(messageIndex, contentIndex)
        duplicateToolResultCount += 1
      }
    }
  }

  if (duplicateIndexes.size === 0) return { status: 'unchanged', messages }

  return {
    status: 'repaired',
    messages: messages.map((message, messageIndex) => {
      const messageDuplicates = duplicateIndexes.get(messageIndex)
      if (!messageDuplicates || !Array.isArray(message.content)) return message
      return {
        ...message,
        content: message.content.filter((_, contentIndex) => !messageDuplicates.has(contentIndex))
      }
    }),
    duplicateToolUseCount,
    duplicateToolResultCount
  }
}
