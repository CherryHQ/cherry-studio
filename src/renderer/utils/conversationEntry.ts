import { cacheService } from '@data/CacheService'
import { prefetch } from '@data/hooks/useDataApi'
import { isDataApiNotFoundError } from '@shared/data/api/errors'

/**
 * Entry-target resolution for the conversation routes (`/app/chat`, `/app/agents`),
 * called from their `beforeLoad` interceptors on a bare entry (no explicit
 * topicId / sessionId in the URL).
 *
 * Resolution order: the cross-window "last focused" id, validated by its by-id
 * endpoint, then the globally most-recently-updated conversation. `null` means
 * nothing to resume — the route falls through bare and the page creates its own
 * first conversation.
 *
 * `last_used_*` ids are never cleared on delete, so a remembered id may point at
 * a deleted row — that surfaces as NOT_FOUND here and falls through to latest.
 * Fetches go through `prefetch` so the validation also warms the exact SWR cache
 * entry the page's by-id hook reads: the page mounts straight onto settled data.
 */

export async function resolveChatEntryTopicId(): Promise<string | null> {
  const lastUsedTopicId = cacheService.getPersist('ui.chat.last_used_topic_id')
  if (lastUsedTopicId) {
    try {
      await prefetch('/topics/:id', { params: { id: lastUsedTopicId } })
      return lastUsedTopicId
    } catch (error) {
      if (!isDataApiNotFoundError(error)) throw error
    }
  }
  const { topic } = await prefetch('/topics/latest')
  return topic?.id ?? null
}

export async function resolveAgentEntrySessionId(): Promise<string | null> {
  const lastUsedSessionId = cacheService.getPersist('ui.agent.last_used_session_id')
  if (lastUsedSessionId) {
    try {
      await prefetch('/agent-sessions/:sessionId', { params: { sessionId: lastUsedSessionId } })
      return lastUsedSessionId
    } catch (error) {
      if (!isDataApiNotFoundError(error)) throw error
    }
  }
  const { session } = await prefetch('/agent-sessions/latest')
  return session?.id ?? null
}
