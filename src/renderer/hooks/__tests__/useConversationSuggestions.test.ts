import type { ConversationSuggestionPersona, ConversationSuggestions } from '@renderer/utils/conversationSuggestions'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConversationSuggestions } from '../useConversationSuggestions'

const mocks = vi.hoisted(() => ({
  defaultModelId: 'default-model-1' as string | null,
  generateConversationSuggestions: vi.fn(),
  suggestionsModelId: null as string | null
}))

vi.mock('@renderer/utils/aiGeneration', () => ({
  generateConversationSuggestions: mocks.generateConversationSuggestions
}))
vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [
    key === 'chat.suggestions.model_id' ? mocks.suggestionsModelId : mocks.defaultModelId,
    vi.fn()
  ]
}))

const generated: ConversationSuggestions = ['One', 'Two', 'Three']
const fallback: ConversationSuggestions = ['Fallback one', 'Fallback two', 'Fallback three']

function createWrapper(cache = new Map()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(SWRConfig, { value: { provider: () => cache } }, children)
  }
}

describe('useConversationSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.defaultModelId = 'default-model-1'
    mocks.suggestionsModelId = null
    mocks.generateConversationSuggestions.mockResolvedValue(generated)
  })

  it('builds generation context from only locale, local time, seed, mode, language, and persona', async () => {
    const persona: ConversationSuggestionPersona = { name: 'Code Reviewer', description: 'Reviews changes' }
    const { result } = renderHook(
      () =>
        useConversationSuggestions({
          mode: 'agent',
          conversationId: 'session-1',
          outputLanguage: 'zh-CN',
          persona,
          fallback
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.suggestions).toEqual(generated))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledWith({
      mode: 'agent',
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
      mode: 'chat' as const,
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
          mode: 'agent',
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
          mode: 'chat',
          conversationId: 'topic-1',
          outputLanguage: 'en-US',
          fallback
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1))

    mocks.suggestionsModelId = 'suggestions-model-1'
    rerender()
    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(2))

    mocks.suggestionsModelId = null
    mocks.defaultModelId = 'default-model-2'
    rerender()
    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(3))
  })

  it('waits to expose fallback suggestions until generation is enabled', async () => {
    mocks.generateConversationSuggestions.mockRejectedValue(new Error('No default model'))
    const { rerender, result } = renderHook(
      ({ enabled }) =>
        useConversationSuggestions({
          mode: 'chat',
          conversationId: 'topic-with-loading-persona',
          outputLanguage: 'en-US',
          fallback,
          enabled
        }),
      { initialProps: { enabled: false }, wrapper: createWrapper() }
    )

    expect(result.current).toEqual({ suggestions: undefined, isLoading: true })
    expect(mocks.generateConversationSuggestions).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.suggestions).toEqual(fallback))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)
  })

  it('does not cache a local fallback as generated suggestions', async () => {
    mocks.generateConversationSuggestions
      .mockRejectedValueOnce(new Error('No default model'))
      .mockResolvedValueOnce(generated)
    const cache = new Map()
    const wrapper = createWrapper(cache)
    const options = {
      mode: 'chat' as const,
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
