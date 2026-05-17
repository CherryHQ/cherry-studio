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
import type { UIMessage, UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appendMessageMock = vi.fn()

vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: {
    appendMessage: appendMessageMock
  }
}))

const { PersistenceListener } = await import('../PersistenceListener')
const { TemporaryChatBackend } = await import('../../persistence/backends/TemporaryChatBackend')

function makeFinalMessage(partsText = 'hello'): CherryUIMessage {
  return {
    id: 'ignored',
    role: 'assistant',
    parts: [{ type: 'text', text: partsText }]
  } as unknown as CherryUIMessage
}

function makeListener(modelId?: UniqueModelId) {
  return new PersistenceListener({
    topicId: 'abc',
    modelId,
    backend: new TemporaryChatBackend({
      topicId: 'abc',
      modelId,
      modelSnapshot: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }
    })
  })
}

describe('PersistenceListener + TemporaryChatBackend', () => {
  beforeEach(() => {
    appendMessageMock.mockReset()
    appendMessageMock.mockResolvedValue({ id: 'msg-a' })
  })

  it('appends the assistant message on onDone with status=success', async () => {
    const listener = makeListener('openai::gpt-4o')

    await listener.onDone({ finalMessage: makeFinalMessage(), status: 'success', modelId: 'openai::gpt-4o' })

    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    const [topicId, payload] = appendMessageMock.mock.calls[0]
    expect(topicId).toBe('abc')
    expect(payload.role).toBe('assistant')
    expect(payload.status).toBe('success')
    expect(payload.modelId).toBe('openai::gpt-4o')
    // The service allocates the DB id; the listener/backend must not leak the UIMessage id.
    expect(payload.id).toBeUndefined()
  })

  it('derives all token stats fields from finalMessage.metadata', async () => {
    const listener = makeListener()

    const finalMessage = {
      id: 'msg-x',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }],
      // agentLoop.messageMetadata projects AI SDK usage onto these legacy names.
      metadata: {
        totalTokens: 42,
        promptTokens: 30,
        completionTokens: 12,
        thoughtsTokens: 3
      }
    } as unknown as CherryUIMessage

    await listener.onDone({ finalMessage, status: 'success' })

    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    const payload = appendMessageMock.mock.calls[0][1]
    // statsFromTerminal projects 1:1 from UIMessage.metadata to MessageStats.
    // Cache/breakdown fields are tracked in the MessageStats redesign TODO.
    expect(payload.stats).toEqual({
      totalTokens: 42,
      promptTokens: 30,
      completionTokens: 12,
      thoughtsTokens: 3
    })
  })

  it('projects transport+semantic timings onto timeFirstTokenMs / timeCompletionMs', async () => {
    const listener = makeListener()

    // Semantic timings (firstTextAt / reasoning-*) are OWNED by the
    // listener — it watches chunks via `onChunk` rather than trusting the
    // manager to inspect payloads. Drive `performance.now()` so the
    // calculation below is deterministic.
    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValueOnce(1050) // reasoning-start
    nowSpy.mockReturnValueOnce(1250.4) // text-delta → firstTextAt; also sets reasoningEndedAt

    listener.onChunk({ type: 'reasoning-start', id: 'r1' } as UIMessageChunk, undefined)
    listener.onChunk({ type: 'text-delta', id: 't1', delta: 'hi' } as UIMessageChunk, undefined)
    nowSpy.mockRestore()

    const finalMessage = {
      id: 'msg-z',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }]
    } as unknown as CherryUIMessage

    // Transport timings come from the manager's execution loop and only
    // carry loop-lifecycle events. Semantic fields above must NOT appear here.
    await listener.onDone({
      finalMessage,
      status: 'success',
      timings: { startedAt: 1000, completedAt: 2500.9 }
    })

    const payload = appendMessageMock.mock.calls[0][1]
    expect(payload.stats).toEqual({
      // Math.round: 1250.4 - 1000 = 250.4 → 250
      timeFirstTokenMs: 250,
      // Math.round: 2500.9 - 1000 = 1500.9 → 1501
      timeCompletionMs: 1501
    })
    // `timeThinkingMs` is intentionally not projected: wall-clock reasoning
    // may include interleaved tool execution. See stream-stats-followup TODO.
    expect(payload.stats).not.toHaveProperty('timeThinkingMs')
  })

  it('merges token metadata and timings into one stats record', async () => {
    const listener = makeListener()

    const nowSpy = vi.spyOn(performance, 'now').mockReturnValueOnce(100)
    listener.onChunk({ type: 'text-delta', id: 't1', delta: 'h' } as UIMessageChunk, undefined)
    nowSpy.mockRestore()

    const finalMessage = {
      id: 'msg-w',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }],
      metadata: { totalTokens: 7, promptTokens: 5, completionTokens: 2 }
    } as unknown as CherryUIMessage

    await listener.onDone({
      finalMessage,
      status: 'success',
      timings: { startedAt: 0, completedAt: 500 }
    })

    const payload = appendMessageMock.mock.calls[0][1]
    expect(payload.stats).toEqual({
      totalTokens: 7,
      promptTokens: 5,
      completionTokens: 2,
      timeFirstTokenMs: 100,
      timeCompletionMs: 500
    })
  })

  it('only writes firstTextAt once — subsequent text-delta chunks are ignored', async () => {
    const listener = makeListener()

    const nowSpy = vi.spyOn(performance, 'now')
    nowSpy.mockReturnValueOnce(200).mockReturnValueOnce(400).mockReturnValueOnce(600)

    listener.onChunk({ type: 'text-delta', id: 't1', delta: 'a' } as UIMessageChunk, undefined)
    listener.onChunk({ type: 'text-delta', id: 't1', delta: 'b' } as UIMessageChunk, undefined)
    listener.onChunk({ type: 'text-delta', id: 't1', delta: 'c' } as UIMessageChunk, undefined)
    nowSpy.mockRestore()

    const finalMessage = makeFinalMessage()
    await listener.onDone({
      finalMessage,
      status: 'success',
      timings: { startedAt: 0, completedAt: 700 }
    })

    const payload = appendMessageMock.mock.calls[0][1]
    // Only the first text-delta stamp (200) contributes to TTFT.
    expect(payload.stats.timeFirstTokenMs).toBe(200)
  })

  it('multi-model: ignores chunks from a different execution when computing TTFT', async () => {
    const listener = makeListener('anthropic::claude')

    const nowSpy = vi.spyOn(performance, 'now')
    // First text-delta is from a *different* model — listener must skip it.
    // Second text-delta is from our model at t=400 → firstTextAt.
    nowSpy.mockReturnValueOnce(400)

    listener.onChunk({ type: 'text-delta', id: 'x', delta: 'other' } as UIMessageChunk, 'openai::gpt-4o')
    listener.onChunk({ type: 'text-delta', id: 'y', delta: 'ours' } as UIMessageChunk, 'anthropic::claude')
    nowSpy.mockRestore()

    await listener.onDone({
      finalMessage: makeFinalMessage(),
      status: 'success',
      modelId: 'anthropic::claude',
      timings: { startedAt: 100, completedAt: 900 }
    })

    const payload = appendMessageMock.mock.calls[0][1]
    // 400 - 100 = 300 ms
    expect(payload.stats.timeFirstTokenMs).toBe(300)
  })

  it('omits stats entirely when the provider reports no usage and no timings are available', async () => {
    const listener = makeListener()

    const finalMessage = {
      id: 'msg-y',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }]
      // no metadata, no timings
    } as unknown as CherryUIMessage

    await listener.onDone({ finalMessage, status: 'success' })

    const payload = appendMessageMock.mock.calls[0][1]
    expect(payload.stats).toBeUndefined()
  })

  it('multi-model filter: skips events from a different execution', async () => {
    const listener = makeListener('openai::gpt-4o')

    await listener.onDone({
      finalMessage: makeFinalMessage(),
      status: 'success',
      modelId: 'anthropic::claude-sonnet'
    })

    expect(appendMessageMock).not.toHaveBeenCalled()
  })

  it('onPaused writes status=paused', async () => {
    const listener = makeListener()

    await listener.onPaused({ finalMessage: makeFinalMessage(), status: 'paused' })

    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    expect(appendMessageMock.mock.calls[0][1].status).toBe('paused')
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

    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    const payload = appendMessageMock.mock.calls[0][1]
    expect(payload.status).toBe('error')
    // The listener — not the backend — is responsible for appending the
    // error part; the backend just persists whatever `parts` it receives.
    const parts = payload.data.parts as Array<{ type: string }>
    expect(parts.some((p) => p.type === 'text')).toBe(true)
    expect(parts.some((p) => p.type === 'data-error')).toBe(true)
  })

  it('onError with no accumulated content still persists a single error part', async () => {
    const listener = makeListener()
    const err: SerializedError = { name: 'Error', message: 'boom', stack: null }

    await listener.onError({ status: 'error', error: err })

    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    const payload = appendMessageMock.mock.calls[0][1]
    expect(payload.status).toBe('error')
    const parts = payload.data.parts as Array<{ type: string }>
    expect(parts).toHaveLength(1)
    expect(parts[0]).toEqual({ type: 'data-error', data: err })
  })

  it('skips persistence when onDone arrives without a finalMessage', async () => {
    const listener = makeListener()

    await listener.onDone({ finalMessage: undefined, status: 'success' })

    expect(appendMessageMock).not.toHaveBeenCalled()
  })

  it('swallows append errors so stream teardown is not disrupted', async () => {
    appendMessageMock.mockRejectedValueOnce(new Error('write failed'))
    const listener = makeListener()

    await expect(listener.onDone({ finalMessage: makeFinalMessage(), status: 'success' })).resolves.toBeUndefined()
  })
})
