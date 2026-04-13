/**
 * V2 hook for loading topic messages from DataApi as CherryUIMessage[].
 *
 * Replaces the V1 Redux thunk path (loadTopicMessagesThunk → DataApiMessageDataSource → Redux).
 * Returns messages in AI SDK UIMessage format for direct consumption by useAiChat and PartsContext.
 *
 * Also provides a legacy-adapted view (Message[]) for components that still
 * consume the renderer Message type (MessageGroup, MessageItem, etc.).
 */

import { dataApiService } from '@data/DataApiService'
import { AssistantMessageStatus, type Message, UserMessageStatus } from '@renderer/types/newMessage'
import type { CherryUIMessage } from '@shared/data/types/message'
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
  /** Messages in legacy renderer format — for components still reading Message type */
  adaptedMessages: Message[]
  /** Parts map keyed by message ID — for PartsContext (primary rendering source) */
  partsMap: Record<string, CherryMessagePart[]>
  /** Loading state */
  isLoading: boolean
  /** Error if fetch failed */
  error?: Error
  /** SWR mutate — call to revalidate after write operations. Returns refreshed UIMessages. */
  refresh: () => Promise<CherryUIMessage[]>
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
 * Convert a DataApi SharedMessage to a legacy renderer Message.
 * Block rendering is handled by PartsContext — blocks array is empty.
 */
function toAdaptedMessage(shared: SharedMessage): Message {
  return {
    id: shared.id,
    topicId: shared.topicId,
    role: shared.role,
    assistantId: shared.assistantId || '',
    status:
      shared.role === 'user'
        ? UserMessageStatus.SUCCESS
        : (shared.status as AssistantMessageStatus) || AssistantMessageStatus.SUCCESS,
    blocks: [],
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

  const refresh = useCallback(async (): Promise<CherryUIMessage[]> => {
    const result = await mutate()
    if (!result) return []
    return flattenBranchMessages(result.items).map(toUIMessage)
  }, [mutate])

  return useMemo(() => {
    if (!data) {
      return {
        uiMessages: [],
        adaptedMessages: [],
        partsMap: {},
        isLoading,
        error,
        refresh
      }
    }

    const sharedMessages = flattenBranchMessages(data.items)
    const uiMessages: CherryUIMessage[] = []
    const adaptedMessages: Message[] = []
    const partsMap: Record<string, CherryMessagePart[]> = {}

    for (const shared of sharedMessages) {
      uiMessages.push(toUIMessage(shared))

      const parts = shared.data?.parts ?? []
      if (parts.length > 0) {
        partsMap[shared.id] = parts
      }

      adaptedMessages.push(toAdaptedMessage(shared))
    }

    return { uiMessages, adaptedMessages, partsMap, isLoading, error, refresh }
  }, [data, isLoading, error, refresh])
}
