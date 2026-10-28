import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UseExecutionOverlayOptions } from '@renderer/hooks/useExecutionOverlay'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

import { finalizeLiveMessages, useQuickConversation } from '../useQuickConversation'

const conversation = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  stop: vi.fn(),
  setMessages: vi.fn(),
  resetTopic: vi.fn(),
  persistTopic: vi.fn()
}))

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage: conversation.sendMessage,
    stop: conversation.stop,
    setMessages: conversation.setMessages
  })
}))

const lease = vi.hoisted(() => ({ topicId: 'temp-topic' }))

vi.mock('@renderer/hooks/useTemporaryTopic', () => ({
  useTemporaryTopic: () => ({
    topicId: lease.topicId,
    topic: undefined,
    ready: true,
    reset: conversation.resetTopic,
    persist: conversation.persistTopic
  })
}))

const streamStatus = vi.hoisted(() => ({ isPending: false }))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ activeExecutions: [], isPending: streamStatus.isPending })
}))

const overlay = vi.hoisted(() => ({ options: {} as UseExecutionOverlayOptions }))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: (_topicId: string, _executions: unknown, _messages: unknown, options = {}) => {
    overlay.options = options
    return { liveAssistants: [], reset: vi.fn(), clear: vi.fn() }
  }
}))

// A real coordinator with fake playback, so the assertion is what gets spoken.
const voice = vi.hoisted(() => ({ spoken: [] as string[] }))

vi.mock('@renderer/services/voice', async () => {
  const { AutoReadService } = await import('@renderer/services/voice/AutoReadService')
  return {
    autoReadService: new AutoReadService({
      supportsStreaming: async () => false,
      playback: {
        start: async (input: { text: string }) => {
          voice.spoken.push(input.text)
          return { status: 'started' }
        },
        stopAutoRead: async () => true
      } as never
    })
  }
})

describe('finalizeLiveMessages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    streamStatus.isPending = false
    lease.topicId = 'temp-topic'
    voice.spoken = []
    MockUsePreferenceUtils.resetMocks()
  })

  const finishTurn = (attemptId: number, text: string) =>
    act(async () => {
      overlay.options.onFinish?.('provider::model', {
        attemptId,
        message: { id: `answer-${attemptId}`, role: 'assistant', parts: [{ type: 'text', text }] },
        isAbort: false,
        isError: false
      } as never)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

  it('reads a finished answer aloud when auto-read is on', async () => {
    // The legacy quick assistant read replies aloud; the composer rebuild must keep doing so.
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.auto_read.enabled', true)
    renderHook(() => useQuickConversation({}))

    await finishTurn(1, 'Final answer.')

    expect(voice.spoken).toEqual(['Final answer.'])
  })

  it('stays silent when auto-read is off', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.auto_read.enabled', false)
    renderHook(() => useQuickConversation({}))

    await finishTurn(2, 'Final answer.')

    expect(voice.spoken).toEqual([])
  })

  it('drops a submit that was preparing files while the conversation was saved', async () => {
    // The composer awaits attachment preparation, then calls the send it captured before Save.
    // Dispatching it would reach the now-persisted topic with no branch anchor.
    conversation.persistTopic.mockResolvedValue(undefined)
    conversation.sendMessage.mockClear()
    const { result } = renderHook(() => useQuickConversation({}))
    const pendingSend = result.current.send

    await act(async () => {
      await result.current.save()
    })

    act(() => {
      expect(pendingSend('follow-up with attachment')).toBe(false)
    })
    expect(conversation.sendMessage).not.toHaveBeenCalled()
  })

  it('drops a submit that was preparing files across a reset, but sends on the new lease', () => {
    conversation.sendMessage.mockClear()
    const { result, rerender } = renderHook(() => useQuickConversation({}))
    const pendingSend = result.current.send

    lease.topicId = 'temp-topic-2'
    rerender()

    act(() => {
      expect(pendingSend('meant for the old conversation')).toBe(false)
    })
    expect(conversation.sendMessage).not.toHaveBeenCalled()
    act(() => {
      expect(result.current.send('meant for the new one')).toBe(true)
    })
  })

  it('refuses to send while a save is in flight, and sends again once that save fails', async () => {
    // A turn accepted mid-save would dispatch against the promoted topic with no branch
    // anchor, then be stopped when the save ends the conversation.
    let failPersist: (error: Error) => void = () => {}
    conversation.persistTopic.mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          failPersist = reject
        })
    )
    conversation.sendMessage.mockClear()
    const { result } = renderHook(() => useQuickConversation({}))

    let saving: Promise<unknown> = Promise.resolve()
    act(() => {
      saving = result.current.save().catch(() => undefined)
    })
    act(() => {
      expect(result.current.send('follow-up during save')).toBe(false)
    })
    expect(result.current.isSaving).toBe(true)
    expect(conversation.sendMessage).not.toHaveBeenCalled()

    await act(async () => {
      failPersist(new Error('disk full'))
      await saving
    })
    expect(result.current.isSaving).toBe(false)
    act(() => {
      expect(result.current.send('retry after failed save')).toBe(true)
    })
  })

  it('reports a save as done only for the conversation still on screen', async () => {
    // The caller clears the conversation after a save; if the lease turned over mid-request,
    // clearing would wipe a conversation the user started since.
    let finishPersist: () => void = () => {}
    conversation.persistTopic.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishPersist = resolve
        })
    )
    const { result, rerender } = renderHook(() => useQuickConversation({}))

    let saved: boolean | undefined
    await act(async () => {
      const saving = result.current.save().then((value) => {
        saved = value
      })
      finishPersist()
      await saving
    })
    expect(saved).toBe(true)

    let saving: Promise<void> = Promise.resolve()
    act(() => {
      saving = result.current.save().then((value) => {
        saved = value
      })
    })
    // The lease turns over while the request is in flight.
    lease.topicId = 'temp-topic-2'
    act(() => rerender())
    await act(async () => {
      finishPersist()
      await saving
    })
    expect(saved).toBe(false)
  })

  it('refuses a submit while a turn is in flight instead of reporting it as sent', () => {
    // Main rejects busy temporary-chat submits; the stream is fire-and-forget, so without
    // this the composer would drop a steered follow-up that never got an answer.
    streamStatus.isPending = true
    conversation.sendMessage.mockClear()
    const { result } = renderHook(() => useQuickConversation({}))

    act(() => {
      expect(result.current.send('steered follow-up')).toBe(false)
    })
    expect(conversation.sendMessage).not.toHaveBeenCalled()
  })

  it('finalizes streaming content parts without replacing unchanged messages', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1500)
    const liveMessage = {
      id: 'live-message',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'answer', state: 'streaming' },
        {
          type: 'reasoning',
          text: 'thinking',
          state: 'streaming',
          providerMetadata: { cherry: { startedAt: 1000 } }
        }
      ]
    } as CherryUIMessage
    const unchangedMessage = {
      id: 'done-message',
      role: 'assistant',
      parts: [{ type: 'text', text: 'done', state: 'done' }]
    } as CherryUIMessage

    const result = finalizeLiveMessages([liveMessage, unchangedMessage])

    expect(result[0].parts[0]).toMatchObject({ type: 'text', state: 'done' })
    expect(result[0].parts[1]).toMatchObject({ type: 'reasoning', state: 'done' })
    expect(readCherryMeta(result[0].parts[1] as CherryMessagePart)).toMatchObject({
      startedAt: 1000,
      thinkingMs: 500
    })
    expect(result[1]).toBe(unchangedMessage)
  })

  it('keeps a thinking duration the upstream already reported', () => {
    vi.spyOn(Date, 'now').mockReturnValue(9999)
    const message = {
      id: 'live-message',
      role: 'assistant',
      parts: [
        {
          type: 'reasoning',
          text: 'thinking',
          state: 'streaming',
          providerMetadata: { cherry: { startedAt: 1000, thinkingMs: 42 } }
        }
      ]
    } as CherryUIMessage

    const result = finalizeLiveMessages([message])

    expect(readCherryMeta(result[0].parts[0] as CherryMessagePart)).toMatchObject({ thinkingMs: 42 })
  })
})

describe('useQuickConversation', () => {
  afterEach(() => {
    conversation.sendMessage.mockReset()
  })

  it('forwards the selected model and request controls to the temporary conversation', () => {
    const { result } = renderHook(() => useQuickConversation({}))

    act(() => {
      expect(
        result.current.send('hello', {
          mentionedModels: ['provider::model'],
          reasoningEffort: 'high',
          serviceTier: 'flex',
          fastMode: true
        })
      ).toBe(true)
    })

    expect(conversation.sendMessage).toHaveBeenCalledWith(
      { parts: [{ type: 'text', text: 'hello' }] },
      {
        body: {
          mentionedModels: ['provider::model'],
          reasoningEffort: 'high',
          serviceTier: 'flex',
          fastMode: true
        }
      }
    )
  })
})
