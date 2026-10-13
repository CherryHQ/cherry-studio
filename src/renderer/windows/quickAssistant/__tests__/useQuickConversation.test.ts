import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@renderer/hooks/useTemporaryTopic', () => ({
  useTemporaryTopic: () => ({
    topicId: 'temp-topic',
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

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({
    liveAssistants: [],
    reset: vi.fn(),
    clear: vi.fn()
  })
}))

describe('finalizeLiveMessages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    streamStatus.isPending = false
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
