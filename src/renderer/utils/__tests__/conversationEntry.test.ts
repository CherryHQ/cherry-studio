import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPersist: vi.fn(),
  prefetch: vi.fn()
}))

vi.mock('@data/CacheService', () => ({
  cacheService: { getPersist: mocks.getPersist }
}))

vi.mock('@data/hooks/useDataApi', () => ({
  prefetch: mocks.prefetch
}))

import { resolveAgentEntrySessionId, resolveChatEntryTopicId } from '@renderer/utils/conversationEntry'

const notFoundError = () => new DataApiError(ErrorCode.NOT_FOUND, 'not found', 404)

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveChatEntryTopicId', () => {
  it('resolves the last-used topic when it still exists', async () => {
    mocks.getPersist.mockReturnValue('topic-last')
    mocks.prefetch.mockResolvedValue({ id: 'topic-last' })

    await expect(resolveChatEntryTopicId()).resolves.toBe('topic-last')
    expect(mocks.getPersist).toHaveBeenCalledWith('ui.chat.last_used_topic_id')
    expect(mocks.prefetch).toHaveBeenCalledWith('/topics/:id', { params: { id: 'topic-last' } })
    expect(mocks.prefetch).toHaveBeenCalledTimes(1)
  })

  it('falls through to the latest topic when the last-used topic was deleted', async () => {
    mocks.getPersist.mockReturnValue('topic-deleted')
    mocks.prefetch.mockRejectedValueOnce(notFoundError()).mockResolvedValueOnce({ topic: { id: 'topic-latest' } })

    await expect(resolveChatEntryTopicId()).resolves.toBe('topic-latest')
    expect(mocks.prefetch).toHaveBeenNthCalledWith(2, '/topics/latest')
  })

  it('asks for the latest topic when nothing is remembered', async () => {
    mocks.getPersist.mockReturnValue(null)
    mocks.prefetch.mockResolvedValue({ topic: { id: 'topic-latest' } })

    await expect(resolveChatEntryTopicId()).resolves.toBe('topic-latest')
    expect(mocks.prefetch).toHaveBeenCalledWith('/topics/latest')
    expect(mocks.prefetch).toHaveBeenCalledTimes(1)
  })

  it('returns null when the library is empty', async () => {
    mocks.getPersist.mockReturnValue(null)
    mocks.prefetch.mockResolvedValue({ topic: null })

    await expect(resolveChatEntryTopicId()).resolves.toBeNull()
  })

  it('rethrows non-NOT_FOUND validation errors instead of silently rebinding', async () => {
    mocks.getPersist.mockReturnValue('topic-last')
    const serverError = new DataApiError(ErrorCode.INTERNAL_SERVER_ERROR, 'boom', 500)
    mocks.prefetch.mockRejectedValue(serverError)

    await expect(resolveChatEntryTopicId()).rejects.toBe(serverError)
    expect(mocks.prefetch).toHaveBeenCalledTimes(1)
  })
})

describe('resolveAgentEntrySessionId', () => {
  it('resolves the last-used session when it still exists', async () => {
    mocks.getPersist.mockReturnValue('session-last')
    mocks.prefetch.mockResolvedValue({ id: 'session-last' })

    await expect(resolveAgentEntrySessionId()).resolves.toBe('session-last')
    expect(mocks.getPersist).toHaveBeenCalledWith('ui.agent.last_used_session_id')
    expect(mocks.prefetch).toHaveBeenCalledWith('/agent-sessions/:sessionId', {
      params: { sessionId: 'session-last' }
    })
  })

  it('falls through to the latest session when the last-used session was deleted', async () => {
    mocks.getPersist.mockReturnValue('session-deleted')
    mocks.prefetch.mockRejectedValueOnce(notFoundError()).mockResolvedValueOnce({ session: { id: 'session-latest' } })

    await expect(resolveAgentEntrySessionId()).resolves.toBe('session-latest')
    expect(mocks.prefetch).toHaveBeenNthCalledWith(2, '/agent-sessions/latest')
  })

  it('returns null when no sessions exist', async () => {
    mocks.getPersist.mockReturnValue(null)
    mocks.prefetch.mockResolvedValue({ session: null })

    await expect(resolveAgentEntrySessionId()).resolves.toBeNull()
  })
})
