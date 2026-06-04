import { DEFAULT_ASSISTANT_ID } from '@shared/data/types/assistant'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAssistant, useDefaultAssistant } from '../useAssistant'

function queryResult(data?: unknown) {
  return {
    data,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn().mockResolvedValue(data),
    mutate: vi.fn().mockResolvedValue(data)
  } as never
}

describe('useDefaultAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
  })

  it('returns an assistant with the sentinel default id', () => {
    const { result } = renderHook(() => useDefaultAssistant())
    expect(result.current.assistant.id).toBe(DEFAULT_ASSISTANT_ID)
  })

  it('reflects the chat.default_model_id preference in assistant.modelId', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.assistant.modelId).toBe('openai::gpt-4o')
  })

  it('returns null modelId when preference is unset', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', null)

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.assistant.modelId).toBeNull()
  })

  it('always returns a defined assistant — no loading state', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', null)

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.assistant).toBeDefined()
    expect(result.current.assistant.settings).toBeDefined()
    expect(result.current.assistant.mcpServerIds).toEqual([])
    expect(result.current.assistant.knowledgeBaseIds).toEqual([])
  })
})

describe('useAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
  })

  it('disables the DataApi query when id is null', () => {
    renderHook(() => useAssistant(null))

    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', {
      params: { id: '' },
      enabled: false,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('disables the DataApi query when id is undefined', () => {
    renderHook(() => useAssistant(undefined))

    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', {
      params: { id: '' },
      enabled: false,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('returns assistant: undefined for a topic without an assistant', () => {
    const { result } = renderHook(() => useAssistant(null))

    expect(result.current.assistant).toBeUndefined()
  })

  it('uses the default model only when the topic has no persisted assistant', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'provider::default-model')

    renderHook(() => useAssistant(null))

    expect(mockUseQuery).toHaveBeenCalledWith('/models/provider::default-model', {
      enabled: true,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('does not fall back to the default model when a persisted assistant has no model', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'provider::default-model')
    mockUseQuery.mockImplementation((path, options) => {
      if (options?.enabled === false) return queryResult()
      if (path === '/assistants/:id') {
        return queryResult({
          id: 'assistant-1',
          name: 'Assistant 1',
          modelId: null,
          settings: {},
          mcpServerIds: [],
          knowledgeBaseIds: []
        })
      }
      if (String(path).startsWith('/models/provider::default-model')) {
        return queryResult({ id: 'provider::default-model', name: 'Default Model' })
      }
      return queryResult()
    })

    const { result } = renderHook(() => useAssistant('assistant-1'))

    expect(result.current.assistant).toBeDefined()
    expect(result.current.model).toBeUndefined()
    expect(mockUseQuery).toHaveBeenCalledWith('/models/', {
      enabled: false,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('disables previous data for assistant identity switches', () => {
    renderHook(() => useAssistant('assistant-new'))

    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', {
      params: { id: 'assistant-new' },
      enabled: true,
      swrOptions: { keepPreviousData: false }
    })
  })
})
