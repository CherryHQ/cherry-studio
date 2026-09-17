import type { SWRInfiniteConfiguration } from 'swr/infinite'

import { createInfiniteQueryRetentionMiddleware } from '@data/hooks/createInfiniteQueryRetentionMiddleware'
import { type ParamsOption, useInfiniteQuery, type UseInfiniteQueryResult } from '@data/hooks/useDataApi'
import type { QueryParamsForPath, ResponseForPath } from '@shared/data/api/paths'

const CONVERSATION_HISTORY_RETENTION = {
  idleTtlMs: 10 * 60_000,
  maxInactiveGroups: 4,
  maxInactivePages: 12,
  releaseDelayMs: 1_000
} as const

type ConversationHistoryPath = '/topics/:topicId/messages' | '/agent-sessions/:sessionId/messages'

type ConversationHistoryQueryOptions<TPath extends ConversationHistoryPath> = ParamsOption<TPath, 'GET'> & {
  query?: Omit<QueryParamsForPath<TPath, 'GET'>, 'cursor' | 'limit'>
  limit?: number
  enabled?: boolean
  swrOptions?: SWRInfiniteConfiguration
}

type UseConversationInfiniteQuery = <TPath extends ConversationHistoryPath>(
  path: TPath,
  options?: ConversationHistoryQueryOptions<TPath>
) => UseInfiniteQueryResult<ResponseForPath<TPath, 'GET'>>

// Both members of the closed path union are cursor endpoints; TypeScript cannot reduce that generic condition here.
const useConversationInfiniteQuery = useInfiniteQuery as UseConversationInfiniteQuery

const conversationHistoryRetentionMiddleware = createInfiniteQueryRetentionMiddleware(CONVERSATION_HISTORY_RETENTION)

export function useConversationHistoryQuery<TPath extends ConversationHistoryPath>(
  path: TPath,
  options?: ConversationHistoryQueryOptions<TPath>
): UseInfiniteQueryResult<ResponseForPath<TPath, 'GET'>> {
  const managedOptions = {
    ...options,
    swrOptions: {
      ...options?.swrOptions,
      use: [conversationHistoryRetentionMiddleware, ...(options?.swrOptions?.use ?? [])]
    }
  } as ConversationHistoryQueryOptions<TPath>

  return useConversationInfiniteQuery(path, managedOptions)
}
