import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPersist: vi.fn(),
  get: vi.fn()
}))

vi.mock('@data/CacheService', () => ({
  cacheService: { getPersist: mocks.getPersist }
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: { get: mocks.get }
}))

import { resolveAgentEntrySessionId, resolveChatEntryTopicId } from '@renderer/utils/conversationEntry'

const notFoundError = () => new DataApiError(ErrorCode.NOT_FOUND, 'not found', 404)

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveChatEntryTopicId', () => {
  it('resolves the last-used topic when it still exists', async () => {
    mocks.getPersist.mockReturnValue('topic-last')
    mocks.get.mockResolvedValue({ id: 'topic-last' })

    await expect(resolveChatEntryTopicId({ allowLatest: false })).resolves.toBe('topic-last')
    expect(mocks.getPersist).toHaveBeenCalledWith('ui.chat.last_used_topic_id')
    expect(mocks.get).toHaveBeenCalledWith('/topics/topic-last')
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('falls through to the latest topic when the last-used topic was deleted', async () => {
    mocks.getPersist.mockReturnValue('topic-deleted')
    mocks.get.mockRejectedValueOnce(notFoundError()).mockResolvedValueOnce({ topic: { id: 'topic-latest' } })

    await expect(resolveChatEntryTopicId({ allowLatest: true })).resolves.toBe('topic-latest')
    expect(mocks.get).toHaveBeenNthCalledWith(2, '/topics/latest')
  })

  it('asks for the latest topic when nothing is remembered', async () => {
    mocks.getPersist.mockReturnValue(null)
    mocks.get.mockResolvedValue({ topic: { id: 'topic-latest' } })

    await expect(resolveChatEntryTopicId({ allowLatest: true })).resolves.toBe('topic-latest')
    expect(mocks.get).toHaveBeenCalledWith('/topics/latest')
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('does not query latest when another assistant conversation tab exists', async () => {
    mocks.getPersist.mockReturnValue(null)

    await expect(resolveChatEntryTopicId({ allowLatest: false })).resolves.toBeNull()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('does not query latest after a stale last-used topic when another assistant conversation tab exists', async () => {
    mocks.getPersist.mockReturnValue('topic-deleted')
    mocks.get.mockRejectedValue(notFoundError())

    await expect(resolveChatEntryTopicId({ allowLatest: false })).resolves.toBeNull()
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('returns null when the library is empty', async () => {
    mocks.getPersist.mockReturnValue(null)
    mocks.get.mockResolvedValue({ topic: null })

    await expect(resolveChatEntryTopicId({ allowLatest: true })).resolves.toBeNull()
  })

  it('performs a fresh latest read on each entry resolution', async () => {
    mocks.getPersist.mockReturnValue(null)
    mocks.get.mockResolvedValueOnce({ topic: { id: 'topic-first' } }).mockResolvedValueOnce({ topic: null })

    await expect(resolveChatEntryTopicId({ allowLatest: true })).resolves.toBe('topic-first')
    await expect(resolveChatEntryTopicId({ allowLatest: true })).resolves.toBeNull()
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('rethrows non-NOT_FOUND validation errors instead of silently rebinding', async () => {
    mocks.getPersist.mockReturnValue('topic-last')
    const serverError = new DataApiError(ErrorCode.INTERNAL_SERVER_ERROR, 'boom', 500)
    mocks.get.mockRejectedValue(serverError)

    await expect(resolveChatEntryTopicId({ allowLatest: true })).rejects.toBe(serverError)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })
})

describe('resolveAgentEntrySessionId', () => {
  it('resolves the last-used session when it still exists', async () => {
    mocks.getPersist.mockReturnValue('session-last')
    mocks.get.mockResolvedValue({ id: 'session-last' })

    await expect(resolveAgentEntrySessionId({ allowLatest: false })).resolves.toBe('session-last')
    expect(mocks.getPersist).toHaveBeenCalledWith('ui.agent.last_used_session_id')
    expect(mocks.get).toHaveBeenCalledWith('/agent-sessions/session-last')
  })

  it('falls through to the latest session when the last-used session was deleted', async () => {
    mocks.getPersist.mockReturnValue('session-deleted')
    mocks.get.mockRejectedValueOnce(notFoundError()).mockResolvedValueOnce({ session: { id: 'session-latest' } })

    await expect(resolveAgentEntrySessionId({ allowLatest: true })).resolves.toBe('session-latest')
    expect(mocks.get).toHaveBeenNthCalledWith(2, '/agent-sessions/latest')
  })

  it('does not query latest when another agent conversation tab exists', async () => {
    mocks.getPersist.mockReturnValue(null)

    await expect(resolveAgentEntrySessionId({ allowLatest: false })).resolves.toBeNull()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('returns null when no sessions exist', async () => {
    mocks.getPersist.mockReturnValue(null)
    mocks.get.mockResolvedValue({ session: null })

    await expect(resolveAgentEntrySessionId({ allowLatest: true })).resolves.toBeNull()
  })
})
