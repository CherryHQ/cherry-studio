import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applicationGet: vi.fn(),
  saveSpans: vi.fn()
}))

vi.mock('@main/core/application', () => ({
  application: { get: mocks.applicationGet }
}))

const { TraceFlushListener } = await import('../TraceFlushListener')

describe('TraceFlushListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'SpanCacheService') return { saveSpans: mocks.saveSpans }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.saveSpans.mockResolvedValue(undefined)
  })

  it('flushes the topic trace cache when the topic turn is done', async () => {
    const listener = new TraceFlushListener('topic-1')

    await listener.onDone({ status: 'success', isTopicDone: true })

    expect(mocks.saveSpans).toHaveBeenCalledWith('topic-1')
  })

  it('waits for the topic-level terminal event before flushing', async () => {
    const listener = new TraceFlushListener('topic-1')

    await listener.onDone({ status: 'success', isTopicDone: false })

    expect(mocks.saveSpans).not.toHaveBeenCalled()
  })

  it('does not throw when trace persistence fails', async () => {
    mocks.saveSpans.mockRejectedValueOnce(new Error('trace write failed'))
    const listener = new TraceFlushListener('topic-1')

    await expect(
      listener.onError({ status: 'error', isTopicDone: true, error: { name: 'Error', message: 'boom', stack: null } })
    ).resolves.toBe(undefined)

    expect(mocks.saveSpans).toHaveBeenCalledWith('topic-1')
  })
})
