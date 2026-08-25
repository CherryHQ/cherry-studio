import type { ConversationSuggestionPersona, ConversationSuggestions } from '@renderer/utils/conversationSuggestions'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useConversationSuggestions } from '../useConversationSuggestions'

const mocks = vi.hoisted(() => ({
  generateConversationSuggestions: vi.fn()
}))

vi.mock('@renderer/utils/aiGeneration', () => ({
  generateConversationSuggestions: mocks.generateConversationSuggestions
}))

const generated: ConversationSuggestions = ['One', 'Two', 'Three']
const fallback: ConversationSuggestions = ['Fallback one', 'Fallback two', 'Fallback three']
const chatFocus = 'conversation, learning, creativity, reflection, and planning'
const agentFocus = 'concrete tasks involving inspection, implementation, review, and verification'

function createWrapper(cache = new Map()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(SWRConfig, { value: { provider: () => cache } }, children)
  }
}

function enableSuggestions(modelId: string | null = null, defaultModelId = 'default-model-1') {
  MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.enabled', true)
  MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.model_id', modelId)
  MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', defaultModelId)
}

describe('useConversationSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    enableSuggestions()
    mocks.generateConversationSuggestions.mockResolvedValue(generated)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds generation context from only locale, local time, seed, focus, language, and persona', async () => {
    const persona: ConversationSuggestionPersona = { name: 'Code Reviewer', description: 'Reviews changes' }
    const { result } = renderHook(
      () =>
        useConversationSuggestions({
          focus: agentFocus,
          conversationId: 'session-1',
          outputLanguage: 'zh-CN',
          persona,
          fallback
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.suggestions).toEqual(generated))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledWith({
      focus: agentFocus,
      outputLanguage: 'zh-CN',
      systemLocale: navigator.language,
      localDateTime: expect.any(String),
      timeZone: expect.any(String),
      randomSeed: expect.any(String),
      persona
    })
  })

  it('reuses suggestions for the same conversation context during the app run', async () => {
    const wrapper = createWrapper()
    const options = {
      focus: chatFocus,
      conversationId: 'topic-1',
      outputLanguage: 'en-US',
      fallback
    }

    const first = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(first.result.current.suggestions).toEqual(generated))
    first.unmount()

    const second = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(second.result.current.suggestions).toEqual(generated))

    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)
  })

  it('generates again when the conversation, language, or persona changes', async () => {
    const { rerender, result } = renderHook(
      ({ conversationId, outputLanguage, persona }) =>
        useConversationSuggestions({
          focus: agentFocus,
          conversationId,
          outputLanguage,
          persona,
          fallback
        }),
      {
        initialProps: {
          conversationId: 'session-1',
          outputLanguage: 'en-US',
          persona: { name: 'Agent One', description: 'First persona' }
        },
        wrapper: createWrapper()
      }
    )

    await waitFor(() => expect(result.current.suggestions).toEqual(generated))
    rerender({
      conversationId: 'session-2',
      outputLanguage: 'en-US',
      persona: { name: 'Agent One', description: 'First persona' }
    })
    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(2))
    rerender({
      conversationId: 'session-2',
      outputLanguage: 'zh-CN',
      persona: { name: 'Agent One', description: 'First persona' }
    })
    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(3))
    rerender({
      conversationId: 'session-2',
      outputLanguage: 'zh-CN',
      persona: { name: 'Agent Two', description: 'Second persona' }
    })
    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(4))
  })

  it('generates again when the effective suggestions model changes', async () => {
    const { rerender } = renderHook(
      () =>
        useConversationSuggestions({
          focus: chatFocus,
          conversationId: 'topic-1',
          outputLanguage: 'en-US',
          fallback
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1))

    MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.model_id', 'suggestions-model-1')
    rerender()
    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(2))

    MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.model_id', null)
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'default-model-2')
    rerender()
    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(3))
  })

  it('does not generate until Conversation Suggestions is enabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.enabled', false)
    const { result } = renderHook(
      () =>
        useConversationSuggestions({
          focus: chatFocus,
          conversationId: 'topic-1',
          outputLanguage: 'en-US',
          fallback
        }),
      { wrapper: createWrapper() }
    )

    expect(result.current).toEqual({ suggestions: undefined, isLoading: true, suggestionsEnabled: false })
    expect(mocks.generateConversationSuggestions).not.toHaveBeenCalled()
  })

  it('waits to expose fallback suggestions until generation is enabled', async () => {
    mocks.generateConversationSuggestions.mockRejectedValue(new Error('No default model'))
    const { rerender, result } = renderHook(
      ({ enabled }) =>
        useConversationSuggestions({
          focus: chatFocus,
          conversationId: 'topic-with-loading-persona',
          outputLanguage: 'en-US',
          fallback,
          enabled
        }),
      { initialProps: { enabled: false }, wrapper: createWrapper() }
    )

    expect(result.current).toEqual({ suggestions: undefined, isLoading: true, suggestionsEnabled: true })
    expect(mocks.generateConversationSuggestions).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.suggestions).toEqual(fallback))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)
  })

  it('does not automatically retry a failed generation', async () => {
    vi.useFakeTimers()
    mocks.generateConversationSuggestions.mockRejectedValue(new Error('No default model'))
    const { result } = renderHook(
      () =>
        useConversationSuggestions({
          focus: chatFocus,
          conversationId: 'topic-without-retry',
          outputLanguage: 'en-US',
          fallback
        }),
      { wrapper: createWrapper() }
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(result.current.suggestions).toEqual(fallback)
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)
  })

  it('does not cache a local fallback as generated suggestions', async () => {
    mocks.generateConversationSuggestions
      .mockRejectedValueOnce(new Error('No default model'))
      .mockResolvedValueOnce(generated)
    const cache = new Map()
    const wrapper = createWrapper(cache)
    const options = {
      focus: chatFocus,
      conversationId: 'topic-without-model',
      outputLanguage: 'en-US',
      fallback
    }
    const first = renderHook(() => useConversationSuggestions(options), { wrapper })

    await waitFor(() => expect(first.result.current.suggestions).toEqual(fallback))
    first.unmount()

    const second = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(second.result.current.suggestions).toEqual(generated))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(2)
  })
})
