import type { CherryUIMessage } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appendMessageMock = vi.fn()

vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: {
    appendMessage: appendMessageMock
  }
}))

const { TemporaryPersistenceListener } = await import('../TemporaryPersistenceListener')

function makeFinalMessage(partsText = 'hello'): CherryUIMessage {
  return {
    id: 'ignored',
    role: 'assistant',
    parts: [{ type: 'text', text: partsText }]
  } as unknown as CherryUIMessage
}

describe('TemporaryPersistenceListener', () => {
  beforeEach(() => {
    appendMessageMock.mockReset()
    appendMessageMock.mockResolvedValue({ id: 'msg-a' })
  })

  it('appends the assistant message on onDone with status=success', async () => {
    const listener = new TemporaryPersistenceListener({
      topicId: 'temp:abc',
      modelId: 'openai::gpt-4o',
      modelSnapshot: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }
    })

    await listener.onDone({ finalMessage: makeFinalMessage(), status: 'success', modelId: 'openai::gpt-4o' })

    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    const [topicId, payload] = appendMessageMock.mock.calls[0]
    expect(topicId).toBe('temp:abc')
    expect(payload.role).toBe('assistant')
    expect(payload.status).toBe('success')
    expect(payload.modelId).toBe('openai::gpt-4o')
    // No `id` field — the service allocates it
    expect(payload.id).toBeUndefined()
  })

  it('multi-model filter: skips events from a different execution', async () => {
    const listener = new TemporaryPersistenceListener({
      topicId: 'temp:abc',
      modelId: 'openai::gpt-4o'
    })

    await listener.onDone({
      finalMessage: makeFinalMessage(),
      status: 'success',
      modelId: 'anthropic::claude-sonnet'
    })

    expect(appendMessageMock).not.toHaveBeenCalled()
  })

  it('onPaused writes status=paused', async () => {
    const listener = new TemporaryPersistenceListener({ topicId: 'temp:abc' })

    await listener.onPaused({ finalMessage: makeFinalMessage(), status: 'paused' })

    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    expect(appendMessageMock.mock.calls[0][1].status).toBe('paused')
  })

  it('onError appends a message with an error part + status=error', async () => {
    const listener = new TemporaryPersistenceListener({ topicId: 'temp:abc' })

    const err: SerializedError = { name: 'Error', message: 'boom', stack: null }
    const partial = {
      id: 'partial-id',
      role: 'assistant',
      parts: [{ type: 'text', text: 'so far so good' }]
    } as unknown as UIMessage

    await listener.onError(err, partial)

    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    const payload = appendMessageMock.mock.calls[0][1]
    expect(payload.status).toBe('error')
    const parts = payload.data.parts as Array<{ type: string }>
    expect(parts.some((p) => p.type === 'data-error')).toBe(true)
    expect(parts.some((p) => p.type === 'text')).toBe(true)
  })

  it('skips persistence when onDone arrives without a finalMessage', async () => {
    const listener = new TemporaryPersistenceListener({ topicId: 'temp:abc' })

    await listener.onDone({ finalMessage: undefined, status: 'success' })

    expect(appendMessageMock).not.toHaveBeenCalled()
  })

  it('swallows append errors so stream teardown is not disrupted', async () => {
    appendMessageMock.mockRejectedValueOnce(new Error('write failed'))
    const listener = new TemporaryPersistenceListener({ topicId: 'temp:abc' })

    await expect(listener.onDone({ finalMessage: makeFinalMessage(), status: 'success' })).resolves.toBeUndefined()
  })
})
