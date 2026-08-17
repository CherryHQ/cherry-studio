import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRawAgentSessionsSource, useRawAssistantTopicsSource } from '../resourceViewSources'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  useAgentSessionStats: vi.fn(),
  useTopicStats: vi.fn()
}))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: { get: mocks.get, post: mocks.post }
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useAgentSessionStats: mocks.useAgentSessionStats
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  useTopicStats: mocks.useTopicStats
}))

describe('resourceViewSources', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.useAgentSessionStats.mockReturnValue({
      stats: undefined,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mocks.useTopicStats.mockReturnValue({
      stats: undefined,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
  })

  it('atomically reuses or creates a topic independently of list streams', async () => {
    mocks.post.mockResolvedValueOnce({ topic: null, created: false })
    const { result } = renderHook(() => useRawAssistantTopicsSource())

    await result.current.reuseOrCreateTopic('assistant-a')

    expect(mocks.post).toHaveBeenCalledWith('/topics/reusable-placeholder', {
      body: { assistantId: 'assistant-a' }
    })
  })

  it('atomically reuses or creates a session for an exact workspace target', async () => {
    mocks.post.mockResolvedValueOnce({ session: null, created: false, deletedDuplicateSessionIds: [] })
    const { result } = renderHook(() => useRawAgentSessionsSource())

    await result.current.reuseOrCreateSession('agent-a', { type: 'system' })

    expect(mocks.post).toHaveBeenCalledWith('/agent-sessions/reusable-placeholders', {
      body: { agentId: 'agent-a', workspace: { type: 'system' } }
    })
  })
})
