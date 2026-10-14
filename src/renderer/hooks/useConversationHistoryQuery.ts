import { createInfiniteQueryRetentionMiddleware } from '@data/hooks/createInfiniteQueryRetentionMiddleware'
import {
  type CursorPaginatedPath,
  type InfiniteQueryOptions,
  useInfiniteQuery,
  type UseInfiniteQueryResult
} from '@data/hooks/useDataApi'
import type { ResponseForPath } from '@shared/data/api/paths'

const CONVERSATION_HISTORY_RETENTION = {
  idleTtlMs: 10 * 60_000,
  maxInactiveGroups: 4,
  maxInactivePages: 12,
  releaseDelayMs: 1_000
} as const

type ConversationHistoryPath = '/topics/:topicId/messages' | '/agent-sessions/:sessionId/messages'

const conversationHistoryRetentionMiddleware = createInfiniteQueryRetentionMiddleware(CONVERSATION_HISTORY_RETENTION)

export function useConversationHistoryQuery<TPath extends ConversationHistoryPath>(
  path: CursorPaginatedPath<TPath>,
  options: InfiniteQueryOptions<TPath>
): UseInfiniteQueryResult<ResponseForPath<TPath, 'GET'>> {
  const managedOptions: InfiniteQueryOptions<TPath> = {
    ...options,
    swrOptions: {
      ...options.swrOptions,
      use: [conversationHistoryRetentionMiddleware, ...(options.swrOptions?.use ?? [])]
    }
  }

  return useInfiniteQuery(path, managedOptions)
}
