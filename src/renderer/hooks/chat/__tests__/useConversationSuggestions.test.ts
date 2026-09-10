import type { ConversationSuggestionPersona, ConversationSuggestions } from '@renderer/utils/conversationSuggestions'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const agentFocus = 'concrete tasks involving inspection, implementation, review, and verification'

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
const defaultModel2 = createChatModel('default-model-2', 'Default 2')
const suggestionsModel = createChatModel('suggestions-model-1', 'Suggestions')
const embeddingModel = {
  ...createChatModel('embedding-model-1', 'Embedding 1'),
  capabilities: [MODEL_CAPABILITY.EMBEDDING]
}
const embeddingModel2 = {
  ...createChatModel('embedding-model-2', 'Embedding 2'),
  capabilities: [MODEL_CAPABILITY.EMBEDDING]
}

const modelPath = (id: string) => `/models/${id}`

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

function stubResolvedModels() {
  stubModelQueries({
    [modelPath(defaultModel.id)]: defaultModel,
    [modelPath(defaultModel2.id)]: defaultModel2,
    [modelPath(suggestionsModel.id)]: suggestionsModel,
    [modelPath(embeddingModel.id)]: embeddingModel,
    [modelPath(embeddingModel2.id)]: embeddingModel2
  })
}

function createWrapper(cache = new Map()) {
  return ({ children }: { children: ReactNode }) =>
    createElement(SWRConfig, { value: { provider: () => cache } }, children)
}

function enableSuggestions(modelId: string | null = null, defaultModelId = defaultModel.id) {
  MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.enabled', true)
  MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.model_id', modelId)
  MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', defaultModelId)
}

describe('useConversationSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    stubResolvedModels()
    enableSuggestions()
    mocks.generateConversationSuggestions.mockResolvedValue(generated)
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
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledWith(
      {
        focus: agentFocus,
        outputLanguage: 'zh-CN',
        systemLocale: navigator.language,
        localDateTime: expect.any(String),
        timeZone: expect.any(String),
        randomSeed: expect.any(String),
        persona
      },
      defaultModel
    )
  })

  it('does not read the default model when the dedicated model is usable', async () => {
    enableSuggestions(suggestionsModel.id, defaultModel.id)

    const { result } = renderHook(
      () =>
        useConversationSuggestions({
          focus: chatFocus,
          conversationId: 'topic-dedicated-model',
          outputLanguage: 'en-US',
          fallback
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.suggestions).toEqual(generated))
    expect(mockUseQuery.mock.calls.some(([path]) => path === modelPath(defaultModel.id))).toBe(false)
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

    MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.model_id', suggestionsModel.id)
    rerender()
    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(2))
    expect(mocks.generateConversationSuggestions).toHaveBeenLastCalledWith(expect.any(Object), suggestionsModel)

    MockUsePreferenceUtils.setPreferenceValue('chat.suggestions.model_id', null)
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', defaultModel2.id)
    rerender()
    await waitFor(() => expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(3))
    expect(mocks.generateConversationSuggestions).toHaveBeenLastCalledWith(expect.any(Object), defaultModel2)
  })

  it('keys cache to the fallback model when the dedicated model is missing, non-chat, or unreadable', async () => {
    const options = {
      focus: chatFocus,
      conversationId: 'topic-fallback-cache',
      outputLanguage: 'en-US',
      fallback
    }
    const wrapper = createWrapper()

    stubModelQueries(
      {
        [modelPath(defaultModel.id)]: defaultModel,
        [modelPath(defaultModel2.id)]: defaultModel2,
        [modelPath(embeddingModel.id)]: embeddingModel,
        [modelPath(embeddingModel2.id)]: embeddingModel2
      },
      { errors: { [modelPath('broken-model-1')]: new Error('Model not found') } }
    )

    enableSuggestions('missing-model-1', defaultModel.id)
    const missing = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(missing.result.current.suggestions).toEqual(generated))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledWith(expect.any(Object), defaultModel)
    missing.unmount()

    enableSuggestions('missing-model-2', defaultModel.id)
    const otherMissing = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(otherMissing.result.current.suggestions).toEqual(generated))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)
    otherMissing.unmount()

    enableSuggestions(embeddingModel.id, defaultModel.id)
    const nonChat = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(nonChat.result.current.suggestions).toEqual(generated))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)
    nonChat.unmount()

    enableSuggestions(embeddingModel2.id, defaultModel.id)
    const otherNonChat = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(otherNonChat.result.current.suggestions).toEqual(generated))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)
    otherNonChat.unmount()

    enableSuggestions('broken-model-1', defaultModel.id)
    const unreadable = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(unreadable.result.current.suggestions).toEqual(generated))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(1)

    mocks.generateConversationSuggestions.mockResolvedValue(generatedFromDefault)
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', defaultModel2.id)
    unreadable.rerender()
    await waitFor(() => expect(unreadable.result.current.suggestions).toEqual(generatedFromDefault))
    expect(mocks.generateConversationSuggestions).toHaveBeenCalledTimes(2)
  })
})
