/**
 * Behavior tests for the observer half of PersistenceListener.
 *
 * These tests use `TemporaryChatBackend` as a convenient concrete backend
 * — the observer protocol (modelId filtering, error-part assembly,
 * skip-when-no-finalMessage, swallow-errors) is identical regardless of
 * which backend is wired in.
 */

import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appendAssistantMessageMock = vi.fn()
const messageUpdateMock = vi.fn()
const messageFinalizeMock = vi.fn()

vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: {
    appendAssistantMessage: appendAssistantMessageMock
  }
}))

vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    update: messageUpdateMock,
    finalizeAssistantMessage: messageFinalizeMock
  }
}))

const { PersistenceListener } = await import('../PersistenceListener')
const { TemporaryChatBackend } = await import('../../persistence/backends/TemporaryChatBackend')
const { MessageServiceBackend } = await import('../../persistence/backends/MessageServiceBackend')

function makeFinalMessage(partsText = 'hello'): CherryUIMessage {
  return {
    id: 'ignored',
    role: 'assistant',
    parts: [{ type: 'text', text: partsText }]
  } as unknown as CherryUIMessage
}

function makeStreamingReasoningMessage(startedAt: number): CherryUIMessage {
  return {
    id: 'reasoning-message',
    role: 'assistant',
    parts: [
      {
        type: 'reasoning',
        text: 'thinking...',
        state: 'streaming',
        providerMetadata: { cherry: { startedAt } }
      }
    ]
  } as unknown as CherryUIMessage
}

function makeListener(modelId?: UniqueModelId) {
  return new PersistenceListener({
    topicId: 'abc',
    modelId,
    backend: new TemporaryChatBackend({
      topicId: 'abc',
      messageId: 'assistant-message-id',
      modelId,
      messageSnapshot: { id: 'a1', name: 'A', emoji: '', model: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' } }
    })
  })
}

describe('PersistenceListener + TemporaryChatBackend', () => {
  beforeEach(() => {
    appendAssistantMessageMock.mockReset()
    appendAssistantMessageMock.mockReturnValue({ id: 'msg-a' })
  })

  it('appends the assistant message on onDone with status=success', async () => {
    const listener = makeListener('openai::gpt-4o')

    await listener.onDone({ finalMessage: makeFinalMessage(), status: 'success', modelId: 'openai::gpt-4o' })

    expect(appendAssistantMessageMock).toHaveBeenCalledTimes(1)
    const [topicId, payload, runtimeStats, messageId] = appendAssistantMessageMock.mock.calls[0]
    expect(topicId).toBe('abc')
    expect(payload.role).toBe('assistant')
    expect(payload.status).toBe('success')
    expect(payload.modelId).toBe('openai::gpt-4o')
    // The payload stays a CreateMessageDto while the stable stream id is passed
    // through the service's explicit internal id parameter.
    expect(payload.id).toBeUndefined()
    expect(runtimeStats).toBeUndefined()
    expect(messageId).toBe('assistant-message-id')
  })

  it('strips empty text/reasoning parts before the backend write', async () => {
    const listener = makeListener('openai::gpt-4o')

    const finalMessage = {
      id: 'ignored',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'real thought', state: 'done' },
        { type: 'reasoning', text: '', state: 'done' },
        { type: 'text', text: 'answer' },
        { type: 'text', text: '   \n  ' }
      ]
    } as unknown as CherryUIMessage

    await listener.onDone({ finalMessage, status: 'success', modelId: 'openai::gpt-4o' })

    const payload = appendAssistantMessageMock.mock.calls[0][1]
    const parts = payload.data.parts as Array<{ type: string; text: string }>
    expect(parts).toEqual([
      { type: 'reasoning', text: 'real thought', state: 'done' },
      { type: 'text', text: 'answer' }
    ])
  })

  it('persists an empty terminal stream (step-start only) as status=error, not an empty success', async () => {
    const listener = makeListener('openai::gpt-4o')

    const finalMessage = {
      id: 'ignored',
      role: 'assistant',
      parts: [{ type: 'step-start' }]
    } as unknown as CherryUIMessage

    await listener.onDone({ finalMessage, status: 'success', modelId: 'openai::gpt-4o' })

    expect(appendAssistantMessageMock).toHaveBeenCalledTimes(1)
    const payload = appendAssistantMessageMock.mock.calls[0][1]
    expect(payload.status).toBe('error')
  })

  it('persists a success whose only parts are empty text/reasoning as status=error', async () => {
    const listener = makeListener()

    const finalMessage = {
      id: 'ignored',
      role: 'assistant',
      parts: [
        { type: 'text', text: '' },
        { type: 'reasoning', text: '   \n ', state: 'done' }
      ]
    } as unknown as CherryUIMessage

    await listener.onDone({ finalMessage, status: 'success' })

    const payload = appendAssistantMessageMock.mock.calls[0][1]
    expect(payload.status).toBe('error')
    expect(payload.data.parts).toEqual([])
  })

  it('persists a success with no parts at all as status=error', async () => {
    const listener = makeListener()

    await listener.onDone({
      finalMessage: { id: 'ignored', role: 'assistant', parts: [] } as unknown as CherryUIMessage,
      status: 'success'
    })

    expect(appendAssistantMessageMock).toHaveBeenCalledTimes(1)
    expect(appendAssistantMessageMock.mock.calls[0][1].status).toBe('error')
  })

  it('keeps status=success when hidden markers accompany real content', async () => {
    const listener = makeListener()

    const finalMessage = {
      id: 'ignored',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'a real answer' },
        { type: 'data-citation', data: { title: 'source', url: 'https://example.com' } }
      ]
    } as unknown as CherryUIMessage

    await listener.onDone({ finalMessage, status: 'success' })

    expect(appendAssistantMessageMock.mock.calls[0][1].status).toBe('success')
  })

  it('does not copy cumulative stream metadata into persistence', async () => {
    const listener = makeListener()
    const finalMessage = {
      id: 'msg-x',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }],
      metadata: {
        stats: {
          totalTokens: 42,
          inputTokens: 30,
          outputTokens: 12,
          outputTokenDetails: { reasoningTokens: 3 }
        }
      }
    } as unknown as CherryUIMessage

    await listener.onDone({ finalMessage, status: 'success' })

    expect(appendAssistantMessageMock).toHaveBeenCalledTimes(1)
    expect(appendAssistantMessageMock.mock.calls[0][1]).not.toHaveProperty('stats')
    expect(appendAssistantMessageMock.mock.calls[0][2]).toBeUndefined()
  })

  it('persists runtimeTiming as the only message timing input', async () => {
    const listener = makeListener()
    const runtimeTiming = {
      startedAt: 1_000,
      completedAt: 2_500,
      spans: [
        {
          id: 'tool:1',
          kind: 'tool-execution' as const,
          toolCallId: '1',
          startedAt: 1_500,
          completedAt: 2_000
        }
      ]
    }
    await listener.onDone({
      finalMessage: makeFinalMessage(),
      status: 'success',
      timings: { startedAt: 10, completedAt: 20 },
      runtimeTiming
    })

    expect(appendAssistantMessageMock.mock.calls[0][1]).not.toHaveProperty('stats')
    expect(appendAssistantMessageMock.mock.calls[0][2]).toEqual({ runtimeTiming })
  })

  it('multi-model filter: skips events from a different execution', async () => {
    const listener = makeListener('openai::gpt-4o')

    await listener.onDone({
      finalMessage: makeFinalMessage(),
      status: 'success',
      modelId: 'anthropic::claude-sonnet'
    })

    expect(appendAssistantMessageMock).not.toHaveBeenCalled()
  })

  it('onPaused writes status=paused', async () => {
    const listener = makeListener()

    await listener.onPaused({ finalMessage: makeFinalMessage(), status: 'paused' })

    expect(appendAssistantMessageMock).toHaveBeenCalledTimes(1)
    expect(appendAssistantMessageMock.mock.calls[0][1].status).toBe('paused')
  })

  it('terminalizes interrupted reasoning before composing paused stats', async () => {
    const listener = makeListener()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(7000)

    await listener.onPaused({
      finalMessage: makeStreamingReasoningMessage(2000),
      status: 'paused'
    })
    nowSpy.mockRestore()

    const payload = appendAssistantMessageMock.mock.calls[0][1]
    expect(payload.data.parts[0]).toMatchObject({
      type: 'reasoning',
      state: 'done',
      providerMetadata: { cherry: { startedAt: 2000, thinkingMs: 5000 } }
    })
    expect(appendAssistantMessageMock.mock.calls[0][2]).toBeUndefined()
  })

  it('onError folds the error into finalMessage.parts and persists as status=error', async () => {
    const listener = makeListener()

    const err: SerializedError = { name: 'Error', message: 'boom', stack: null }
    const finalMessage = {
      id: 'partial-id',
      role: 'assistant',
      parts: [{ type: 'text', text: 'so far so good' }]
    } as unknown as UIMessage

    await listener.onError({ status: 'error', error: err, finalMessage: finalMessage as CherryUIMessage })

    expect(appendAssistantMessageMock).toHaveBeenCalledTimes(1)
    const payload = appendAssistantMessageMock.mock.calls[0][1]
    expect(payload.status).toBe('error')
    // The listener — not the backend — is responsible for appending the
    // error part; the backend just persists whatever `parts` it receives.
    const parts = payload.data.parts as Array<{ type: string }>
    expect(parts.some((p) => p.type === 'text')).toBe(true)
    expect(parts.some((p) => p.type === 'data-error')).toBe(true)
  })

  it('terminalizes interrupted reasoning before composing error stats', async () => {
    const listener = makeListener()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(9000)
    const err: SerializedError = { name: 'Error', message: 'boom', stack: null }

    await listener.onError({
      status: 'error',
      error: err,
      finalMessage: makeStreamingReasoningMessage(3000)
    })
    nowSpy.mockRestore()

    const payload = appendAssistantMessageMock.mock.calls[0][1]
    expect(payload.data.parts[0]).toMatchObject({
      type: 'reasoning',
      state: 'done',
      providerMetadata: { cherry: { startedAt: 3000, thinkingMs: 6000 } }
    })
    expect(appendAssistantMessageMock.mock.calls[0][2]).toBeUndefined()
  })

  it('onError with no accumulated content still persists a single error part', async () => {
    const listener = makeListener()
    const err: SerializedError = { name: 'Error', message: 'boom', stack: null }

    await listener.onError({ status: 'error', error: err })

    expect(appendAssistantMessageMock).toHaveBeenCalledTimes(1)
    const payload = appendAssistantMessageMock.mock.calls[0][1]
    expect(payload.status).toBe('error')
    const parts = payload.data.parts as Array<{ type: string }>
    expect(parts).toHaveLength(1)
    expect(parts[0]).toEqual({ type: 'data-error', data: err })
  })

  it('skips persistence when onDone arrives without a finalMessage', async () => {
    const listener = makeListener()

    await listener.onDone({ finalMessage: undefined, status: 'success' })

    expect(appendAssistantMessageMock).not.toHaveBeenCalled()
  })

  it('skips persistence when onPaused arrives without a finalMessage and there is no placeholder row', async () => {
    const listener = makeListener()

    await listener.onPaused({
      finalMessage: undefined,
      status: 'paused',
      timings: { startedAt: 1000, completedAt: 2500.9 }
    })

    expect(appendAssistantMessageMock).not.toHaveBeenCalled()
  })

  it('swallows append errors so stream teardown is not disrupted', async () => {
    appendAssistantMessageMock.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    const listener = makeListener()

    await expect(listener.onDone({ finalMessage: makeFinalMessage(), status: 'success' })).resolves.toBeUndefined()
  })
})

describe('PersistenceListener + MessageServiceBackend — failed persist recovery', () => {
  beforeEach(() => {
    messageUpdateMock.mockReset()
    messageFinalizeMock.mockReset()
  })

  function makeMessageServiceListener() {
    return new PersistenceListener({
      topicId: 'topic-1',
      backend: new MessageServiceBackend({ assistantMessageId: 'assistant-1' })
    })
  }

  it('finalizes an empty paused placeholder instead of leaving it pending', async () => {
    const listener = makeMessageServiceListener()

    await listener.onPaused({ finalMessage: undefined, status: 'paused' })

    expect(messageFinalizeMock).toHaveBeenCalledWith('assistant-1', {
      data: { parts: [] },
      status: 'paused',
      runtimeStats: undefined
    })
    expect(messageUpdateMock).not.toHaveBeenCalled()
  })

  it('drives the placeholder row to status=error when the persist write fails', async () => {
    messageFinalizeMock.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    messageUpdateMock.mockReturnValueOnce({ id: 'assistant-1' })
    const listener = makeMessageServiceListener()

    await expect(listener.onDone({ finalMessage: makeFinalMessage(), status: 'success' })).resolves.toBeUndefined()

    expect(messageFinalizeMock).toHaveBeenCalledTimes(1)
    expect(messageUpdateMock).toHaveBeenCalledTimes(1)
    // The recovery write flips the frozen `pending` placeholder to a terminal `error`.
    expect(messageUpdateMock).toHaveBeenLastCalledWith('assistant-1', { status: 'error' })
  })

  it('retains frozen turn options when finalizing the assistant placeholder', async () => {
    const listener = new PersistenceListener({
      topicId: 'topic-1',
      backend: new MessageServiceBackend({
        assistantMessageId: 'assistant-1',
        turnOptions: { reasoningEffort: 'high', fastMode: true }
      })
    })

    await listener.onDone({ finalMessage: makeFinalMessage(), status: 'success' })

    expect(messageFinalizeMock).toHaveBeenCalledWith('assistant-1', {
      data: {
        parts: makeFinalMessage().parts,
        turnOptions: { reasoningEffort: 'high', fastMode: true }
      },
      status: 'success',
      runtimeStats: undefined
    })
    expect(messageUpdateMock).not.toHaveBeenCalled()
  })

  it('swallows a failure of the terminal-error recovery write itself', async () => {
    messageFinalizeMock.mockImplementation(() => {
      throw new Error('db down')
    })
    messageUpdateMock.mockImplementation(() => {
      throw new Error('db down')
    })
    const listener = makeMessageServiceListener()

    await expect(listener.onDone({ finalMessage: makeFinalMessage(), status: 'success' })).resolves.toBeUndefined()

    expect(messageFinalizeMock).toHaveBeenCalledTimes(1)
    expect(messageUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('notifies onPersistFailed so the live renderer can be corrected (C1)', async () => {
    messageFinalizeMock.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    messageUpdateMock.mockReturnValueOnce({ id: 'assistant-1' })
    const onPersistFailed = vi.fn()
    const listener = new PersistenceListener({
      topicId: 'topic-1',
      backend: new MessageServiceBackend({ assistantMessageId: 'assistant-1' }),
      onPersistFailed
    })

    await listener.onDone({ finalMessage: makeFinalMessage(), status: 'success' })

    expect(onPersistFailed).toHaveBeenCalledTimes(1)
    expect(onPersistFailed).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('write failed') })
    )
  })
})

describe('PersistenceListener + MessageServiceBackend — projection ownership', () => {
  beforeEach(() => {
    messageUpdateMock.mockReset()
    messageFinalizeMock.mockReset()
    messageFinalizeMock.mockReturnValue({ id: 'assistant-1' })
  })

  it('persists runtimeTiming and contextTokens while leaving usage/cost to the record projection', async () => {
    const finalMessage = {
      id: 'msg-x',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }],
      metadata: {
        stats: { inputTokens: 10, outputTokens: 5, totalTokens: 15, contextTokens: 13 }
      }
    } as unknown as CherryUIMessage

    const listener = new PersistenceListener({
      topicId: 'topic-1',
      modelId: 'openrouter::x' as UniqueModelId,
      backend: new MessageServiceBackend({ assistantMessageId: 'assistant-1' })
    })

    const runtimeTiming = { startedAt: 1_000, completedAt: 1_160, spans: [] }
    await listener.onDone({
      finalMessage,
      status: 'success',
      modelId: 'openrouter::x' as UniqueModelId,
      timings: { startedAt: 100, completedAt: 260 },
      runtimeTiming
    })

    expect(messageFinalizeMock).toHaveBeenCalledWith('assistant-1', {
      data: { parts: [{ type: 'text', text: 'hi' }] },
      status: 'success',
      runtimeStats: { runtimeTiming, contextTokens: 13 }
    })
    expect(messageUpdateMock).not.toHaveBeenCalled()
  })

  it('finalizes an empty terminal stream as status=error so the placeholder is never an empty success', async () => {
    const listener = new PersistenceListener({
      topicId: 'topic-1',
      backend: new MessageServiceBackend({ assistantMessageId: 'assistant-1' })
    })

    const finalMessage = {
      id: 'ignored',
      role: 'assistant',
      parts: [{ type: 'step-start' }]
    } as unknown as CherryUIMessage

    await listener.onDone({ finalMessage, status: 'success' })

    expect(messageFinalizeMock).toHaveBeenCalledWith('assistant-1', {
      data: { parts: [{ type: 'step-start' }] },
      status: 'error',
      runtimeStats: undefined
    })
    expect(messageUpdateMock).not.toHaveBeenCalled()
  })
})
