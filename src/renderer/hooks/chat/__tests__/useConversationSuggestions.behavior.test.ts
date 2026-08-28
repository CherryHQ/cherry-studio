import type { ConversationSuggestions } from '@renderer/utils/conversationSuggestions'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
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
const generatedFromDefault: ConversationSuggestions = ['Default one', 'Default two', 'Default three']
const fallback: ConversationSuggestions = ['Fallback one', 'Fallback two', 'Fallback three']
const chatFocus = 'conversation, learning, creativity, reflection, and planning'

const createChatModel = (apiModelId: string, name: string): Model => ({
  id: `openai::${apiModelId}`,
  providerId: 'openai',
  apiModelId,
  name,
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})

const defaultModel = createChatModel('default-model-1', 'Default 1')
const suggestionsModel = createChatModel('suggestions-model-1', 'Suggestions')
const embeddingModel = {
  ...createChatModel('embedding-model-1', 'Embedding 1'),
  capabilities: [MODEL_CAPABILITY.EMBEDDING]
}
const embeddingModel2 = {
  ...createChatModel('embedding-model-2', 'Embedding 2'),
  capabilities: [MODEL_CAPABILITY.EMBEDDING]
}

function modelPath(id: string) {
  return `/models/${id}`
}

function stubModelQueries(
  models: Record<string, Model | undefined>,
  options?: { errors?: Record<string, Error>; loading?: string[] }
) {
  mockUseQuery.mockImplementation((path, queryOptions) => {
    const idle = {
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }
    if (queryOptions?.enabled === false) {
      return { data: undefined, isLoading: false, isRefreshing: false, error: undefined, ...idle }
    }
    const key = path as string
    if (options?.loading?.includes(key)) {
      return { data: undefined, isLoading: true, isRefreshing: false, error: undefined, ...idle }
    }
    const error = options?.errors?.[key]
    if (error) {
      return { data: undefined, isLoading: false, isRefreshing: false, error, ...idle }
    }
    return {
      data: models[key],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      ...idle
    }
  })
}

function createWrapper(cache = new Map()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(SWRConfig, { value: { provider: () => cache } }, children)
  }
}

function enableSuggestions(modelId: string | null = null, defaultModelId = defaultModel.id) {
  MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.enabled', true)
  MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.model_id', modelId)
  MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', defaultModelId)
}

describe('useConversationSuggestions behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    stubModelQueries({
      [modelPath(defaultModel.id)]: defaultModel,
      [modelPath(suggestionsModel.id)]: suggestionsModel,
      [modelPath(embeddingModel.id)]: embeddingModel,
      [modelPath(embeddingModel2.id)]: embeddingModel2
    })
    enableSuggestions()
    mocks.generateConversationSuggestions.mockResolvedValue(generated)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('invalidates cached suggestions when a dedicated model becomes non-chat', async () => {
    const wrapper = createWrapper()
    const options = {
      focus: chatFocus,
      conversationId: 'topic-model-record-change',
      outputLanguage: 'en-US',
      fallback
    }

    stubModelQueries({
      [modelPath(suggestionsModel.id)]: suggestionsModel,
      [modelPath(defaultModel.id)]: defaultModel
    })
    enableSuggestions(suggestionsModel.id, defaultModel.id)
    const { rerender, result } = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(result.current.suggestions).toEqual(generated))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)

    stubModelQueries({
      [modelPath(suggestionsModel.id)]: { ...suggestionsModel, capabilities: [MODEL_CAPABILITY.EMBEDDING] },
      [modelPath(defaultModel.id)]: defaultModel
    })
    mocks.generateConversationSuggestions.mockResolvedValue(generatedFromDefault)
    rerender()
    await waitFor(() => expect(result.current.suggestions).toEqual(generatedFromDefault))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(2)
  })

  it('does not generate against the default model while the dedicated model is still resolving', async () => {
    stubModelQueries({ [modelPath(defaultModel.id)]: defaultModel }, { loading: [modelPath(suggestionsModel.id)] })
    enableSuggestions(suggestionsModel.id, defaultModel.id)

    const { result } = renderHook(
      () =>
        useConversationSuggestions({
          focus: chatFocus,
          conversationId: 'topic-pending-dedicated',
          outputLanguage: 'en-US',
          fallback
        }),
      { wrapper: createWrapper() }
    )

    expect(result.current).toEqual({ suggestions: undefined, isLoading: true, suggestionsEnabled: true })
    expect(mocks.generateConversationSuggestions).not.toHaveBeenCalled()
  })

  it('does not generate until Conversation Suggestions is enabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.enabled', false)
    MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.model_id', suggestionsModel.id)
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', defaultModel.id)
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

  it('does not generate against a non-chat default model', async () => {
    stubModelQueries({ [modelPath(embeddingModel.id)]: embeddingModel })
    enableSuggestions(null, embeddingModel.id)

    const { result } = renderHook(
      () =>
        useConversationSuggestions({
          focus: chatFocus,
          conversationId: 'topic-non-chat-default',
          outputLanguage: 'en-US',
          fallback
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.suggestions).toEqual(fallback))
    expect(mocks.generateConversationSuggestions).not.toHaveBeenCalled()
  })

  it('does not fall back to a non-chat default when the dedicated model is also non-chat', async () => {
    stubModelQueries({
      [modelPath(embeddingModel.id)]: embeddingModel,
      [modelPath(embeddingModel2.id)]: embeddingModel2
    })
    enableSuggestions(embeddingModel.id, embeddingModel2.id)

    const { result } = renderHook(
      () =>
        useConversationSuggestions({
          focus: chatFocus,
          conversationId: 'topic-non-chat-both',
          outputLanguage: 'en-US',
          fallback
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.suggestions).toEqual(fallback))
    expect(mocks.generateConversationSuggestions).not.toHaveBeenCalled()
  })
})
