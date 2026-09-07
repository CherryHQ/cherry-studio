import type { ConversationSuggestions } from '@renderer/utils/conversationSuggestions'
import type { Model } from '@shared/data/types/model'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
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

const defaultModel: Model = {
  id: 'openai::default-model-1',
  providerId: 'openai',
  apiModelId: 'default-model-1',
  name: 'Default 1',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

function createWrapper(cache = new Map()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(SWRConfig, { value: { provider: () => cache } }, children)
  }
}

describe('useConversationSuggestions runtime state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    mockUseQuery.mockImplementation((path, queryOptions) => {
      const idle = { refetch: vi.fn().mockResolvedValue(undefined), mutate: vi.fn() }
      if (queryOptions?.enabled === false) {
        return { data: undefined, isLoading: false, isRefreshing: false, error: undefined, ...idle }
      }
      return {
        data: path === `/models/${defaultModel.id}` ? defaultModel : undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        ...idle
      }
    })
    MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.model_id', null)
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', defaultModel.id)
    mocks.generateConversationSuggestions.mockResolvedValue(generated)
  })

  afterEach(() => {
    vi.useRealTimers()
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
    const wrapper = createWrapper()
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
