import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { AGENT_SESSION_STREAM_TOPIC_CACHE_KEY } from '@shared/ai/agentSessionStreamTopic'
import { buildAgentSessionTopicId } from '@shared/ai/agentSessionTopic'

/** A recovered run keeps the stream address it was admitted on until history takes over. */
export function useAgentSessionStreamTopic(sessionId: string | undefined): string {
  const topic = useSharedCacheValue(AGENT_SESSION_STREAM_TOPIC_CACHE_KEY(sessionId ?? ''))
  return sessionId ? (topic ?? buildAgentSessionTopicId(sessionId)) : ''
}
