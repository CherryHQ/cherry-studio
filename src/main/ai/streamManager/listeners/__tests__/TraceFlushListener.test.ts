import { ConversationOutcomeKind } from '@shared/ai/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applicationGet: vi.fn(),
  saveSpans: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: mocks.applicationGet }
}))

const { TraceFlushListener } = await import('../TraceFlushListener')

describe('TraceFlushListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'TraceStorageService') return { saveSpans: mocks.saveSpans }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.saveSpans.mockResolvedValue(undefined)
  })

  it('flushes the topic trace cache when the topic turn is done', async () => {
    const listener = new TraceFlushListener('topic-1')

    await listener.onTopicQuiesced({ status: ConversationOutcomeKind.Success })

    expect(mocks.saveSpans).toHaveBeenCalledWith('topic-1')
  })

  it('flushes when the cleanup port is invoked for a paused topic', async () => {
    const listener = new TraceFlushListener('topic-1')

    await listener.onTopicQuiesced({ status: ConversationOutcomeKind.Paused })

    expect(mocks.saveSpans).toHaveBeenCalledWith('topic-1')
  })

  it('does not throw when trace persistence fails', async () => {
    mocks.saveSpans.mockRejectedValueOnce(new Error('trace write failed'))
    const listener = new TraceFlushListener('topic-1')

    await expect(
      listener.onTopicQuiesced({
        status: ConversationOutcomeKind.Error,
        error: { name: 'Error', message: 'boom', stack: null }
      })
    ).resolves.toBe(undefined)

    expect(mocks.saveSpans).toHaveBeenCalledWith('topic-1')
  })
})
