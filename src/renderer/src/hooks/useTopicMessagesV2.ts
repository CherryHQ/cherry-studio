/**
 * V2 hook for loading topic messages from DataApi as CherryUIMessage[].
 *
 * Replaces the V1 Redux thunk path (loadTopicMessagesThunk → DataApiMessageDataSource → Redux).
 * Returns messages in AI SDK UIMessage format for direct consumption by useAiChat and PartsContext.
 *
 * Also provides a legacy-adapted view (Message[] + blockMap) for components
 * that haven't migrated to read parts yet.
 */

import { dataApiService } from '@data/DataApiService'
import type { CherryUIMessage } from '@renderer/hooks/useAiChat'
import { AssistantMessageStatus, type Message, type MessageBlock, UserMessageStatus } from '@renderer/types/newMessage'
import { mapMessageStatusToBlockStatus, partToBlock } from '@renderer/utils/partsToBlocks'
import type {
  BranchMessage,
  BranchMessagesResponse,
  CherryMessagePart,
  Message as SharedMessage
} from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'
import useSWR from 'swr'

const FETCH_LIMIT = 999

interface UseTopicMessagesV2Result {
  /** Messages in AI SDK UIMessage format — for useAiChat initialMessages */
  uiMessages: CherryUIMessage[]
  /** Messages in legacy renderer format — for components still reading blocks */
  adaptedMessages: Message[]
  /** Block map keyed by block ID — for V2BlockContext */
  blockMap: Record<string, MessageBlock>
  /** Parts map keyed by message ID — for PartsContext */
  partsMap: Record<string, CherryMessagePart[]>
  /** Loading state */
  isLoading: boolean
  /** Error if fetch failed */
  error?: Error
  /** SWR mutate — call to revalidate after write operations */
  refresh: () => Promise<void>
}

/**
 * Convert a DataApi SharedMessage to a CherryUIMessage for useChat.
 */
function toUIMessage(shared: SharedMessage): CherryUIMessage {
  return {
    id: shared.id,
    role: shared.role,
    parts: (shared.data?.parts ?? []) as CherryUIMessage['parts'],
    metadata: shared.stats?.totalTokens ? { totalTokens: shared.stats.totalTokens } : undefined
  }
}

/**
 * Convert a DataApi SharedMessage to a legacy renderer Message + MessageBlock[].
 * Same logic as DataApiMessageDataSource.convertSharedMessage but without the module-level side effects.
 */
function toAdaptedMessage(shared: SharedMessage): { message: Message; blocks: MessageBlock[] } {
  const dataParts = shared.data?.parts ?? []
  const status = mapMessageStatusToBlockStatus(shared.status)
  const blocks: MessageBlock[] = []
  const blockIds: string[] = []

  for (let i = 0; i < dataParts.length; i++) {
    const part = dataParts[i]
    const blockId = `${shared.id}-block-${i}`
    const block = partToBlock(part, blockId, shared.id, shared.createdAt, status)
    if (block) {
      blockIds.push(blockId)
      blocks.push(block)
    }
  }

  const message: Message = {
    id: shared.id,
    topicId: shared.topicId,
    role: shared.role,
    assistantId: shared.assistantId || '',
    status:
      shared.role === 'user'
        ? UserMessageStatus.SUCCESS
        : (shared.status as AssistantMessageStatus) || AssistantMessageStatus.SUCCESS,
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

  return { message, blocks }
}

/**
 * Flatten BranchMessage[] items to ordered SharedMessage[].
 */
function flattenBranchMessages(items: BranchMessage[]): SharedMessage[] {
  const result: SharedMessage[] = []
  for (const item of items) {
    result.push(item.message)
    if (item.siblingsGroup) {
      for (const sibling of item.siblingsGroup) {
        result.push(sibling)
      }
    }
  }
  return result
}

export function useTopicMessagesV2(topicId: string, enabled = true): UseTopicMessagesV2Result {
  const fetcher = async (): Promise<BranchMessagesResponse | null> => {
    try {
      return (await dataApiService.get(`/topics/${topicId}/messages`, {
        query: { limit: FETCH_LIMIT, includeSiblings: true }
      })) as BranchMessagesResponse
    } catch (err: unknown) {
      // Topic not found in DataApi (e.g. legacy data not yet migrated) — treat as empty
      if (err instanceof Object && 'code' in err && err.code === 'NOT_FOUND') {
        return null
      }
      throw err
    }
  }

  const { data, isLoading, error, mutate } = useSWR(enabled ? ['v2-topic-messages', topicId] : null, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000
  })

  const refresh = useCallback(async () => {
    await mutate()
  }, [mutate])

  return useMemo(() => {
    if (!data) {
      return {
        uiMessages: [],
        adaptedMessages: [],
        blockMap: {},
        partsMap: {},
        isLoading,
        error,
        refresh
      }
    }

    const sharedMessages = flattenBranchMessages(data.items)
    const uiMessages: CherryUIMessage[] = []
    const adaptedMessages: Message[] = []
    const blockMap: Record<string, MessageBlock> = {}
    const partsMap: Record<string, CherryMessagePart[]> = {}

    for (const shared of sharedMessages) {
      // UIMessage for useAiChat initialMessages
      uiMessages.push(toUIMessage(shared))

      // Parts map for PartsContext
      const parts = shared.data?.parts ?? []
      if (parts.length > 0) {
        partsMap[shared.id] = parts
      }

      // Legacy adapted message + blocks for V2BlockContext
      const { message, blocks } = toAdaptedMessage(shared)
      adaptedMessages.push(message)
      for (const block of blocks) {
        blockMap[block.id] = block
      }
    }

    return { uiMessages, adaptedMessages, blockMap, partsMap, isLoading, error, refresh }
  }, [data, isLoading, error, refresh])
}
