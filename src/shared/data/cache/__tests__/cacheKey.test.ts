import { describe, expect, it } from 'vitest'

import { topicLastSeenCompletionCacheKey, topicScrollAnchorCacheKey, topicStreamStatusCacheKey } from '../cacheKey'
import { getSharedCacheDefaultValue, getUseCacheDefaultValue } from '../templateKey'

describe('topic cache keys', () => {
  it.each(['topic-1', 'agent-session:session-1', 'topic.with.dots', '中文主题'])(
    'keeps the semantic topic ID %s usable under the cache key contract',
    (topicId) => {
      expect(getSharedCacheDefaultValue(topicStreamStatusCacheKey(topicId))).toBeNull()
      expect(getSharedCacheDefaultValue(topicLastSeenCompletionCacheKey(topicId))).toBeNull()
      expect(getUseCacheDefaultValue(topicScrollAnchorCacheKey(topicId))).toBeNull()
    }
  )

  it('does not merge topic identities that differ only by punctuation', () => {
    const ids = ['agent-session:1', 'agent-session-1', 'agent_session_1', 'agent.session.1']
    expect(new Set(ids.map(topicStreamStatusCacheKey)).size).toBe(ids.length)
    expect(new Set(ids.map(topicLastSeenCompletionCacheKey)).size).toBe(ids.length)
    expect(new Set(ids.map(topicScrollAnchorCacheKey)).size).toBe(ids.length)
  })
})
