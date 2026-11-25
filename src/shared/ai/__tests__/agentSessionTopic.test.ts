import { describe, expect, it } from 'vitest'

import { buildAgentSessionTopicId, extractAgentSessionId, isAgentSessionTopic } from '@shared/ai/agentSessionTopic'

describe('agent session topic ids', () => {
  it('round-trips a session id through its topic id', () => {
    const topicId = buildAgentSessionTopicId('session-1')
    expect(isAgentSessionTopic(topicId)).toBe(true)
    expect(extractAgentSessionId(topicId)).toBe('session-1')
  })

  it('rejects a chat topic id instead of returning it as a session id', () => {
    expect(isAgentSessionTopic('topic-1')).toBe(false)
    expect(() => extractAgentSessionId('topic-1')).toThrow()
  })
})
