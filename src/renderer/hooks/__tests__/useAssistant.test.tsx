import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAssistant, useDefaultAssistant } from '../useAssistant'

function queryResult(data?: unknown, options: { isLoading?: boolean } = {}) {
  return {
    data,
    isLoading: options.isLoading ?? false,
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

  it('returns the runtime default assistant with a null id', () => {
    const { result } = renderHook(() => useDefaultAssistant())
    expect(result.current.assistant.id).toBeNull()
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

  it('returns the synthesized default assistant for a topic without an assistant', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'provider::default-model')
    const { result } = renderHook(() => useAssistant(null))

    expect(result.current.assistant?.id).toBeNull()
    expect(result.current.assistant?.modelId).toBe('provider::default-model')
  })

  it('does not synthesize the runtime default assistant for an undefined assistant id', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'provider::default-model')
    mockUseQuery.mockImplementation((path, options) => {
      if (options?.enabled === false) return queryResult()
      if (path === '/models/provider::default-model') {
        return queryResult({ id: 'provider::default-model', name: 'Default Model' })
      }
      return queryResult()
    })

    const { result } = renderHook(() => useAssistant(undefined))

    expect(result.current.assistant).toBeUndefined()
    expect(result.current.model).toBeUndefined()
    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', {
      params: { id: '' },
      enabled: false,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('uses the default model only when the topic has no persisted assistant', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'provider::default-model')

    renderHook(() => useAssistant(null))

    expect(mockUseQuery).toHaveBeenCalledWith('/models/provider::default-model', {
      enabled: true,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('keeps the default model lookup for the runtime default assistant', () => {
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
    expect(result.current.isModelPending).toBe(false)
    expect(result.current.isModelMissing).toBe(true)
    expect(mockUseQuery).toHaveBeenCalledWith('/models/', {
      enabled: false,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('updates chat.default_model_id for the runtime default assistant model switch', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'provider::default-model')

    const { result } = renderHook(() => useAssistant(null))

    await act(async () => {
      await result.current.setModel({
        id: 'provider::next-model',
        providerId: 'provider',
        name: 'Next Model',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false,
        isDeprecated: false
      })
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.default_model_id')).toBe('provider::next-model')
  })

  it('marks the model pending while a persisted assistant is loading', () => {
    mockUseQuery.mockImplementation((path, options) => {
      if (options?.enabled === false) return queryResult()
      if (path === '/assistants/:id') return queryResult(undefined, { isLoading: true })
      return queryResult()
    })

    const { result } = renderHook(() => useAssistant('assistant-1'))

    expect(result.current.isModelPending).toBe(true)
    expect(result.current.isModelMissing).toBe(false)
  })

  it('marks the model pending while the assistant model record is loading', () => {
    mockUseQuery.mockImplementation((path, options) => {
      if (options?.enabled === false) return queryResult()
      if (path === '/assistants/:id') {
        return queryResult({
          id: 'assistant-1',
          name: 'Assistant 1',
          modelId: 'provider::model-a',
          settings: {},
          mcpServerIds: [],
          knowledgeBaseIds: []
        })
      }
      if (path === '/models/provider::model-a') return queryResult(undefined, { isLoading: true })
      return queryResult()
    })

    const { result } = renderHook(() => useAssistant('assistant-1'))

    expect(result.current.isModelPending).toBe(true)
    expect(result.current.isModelMissing).toBe(false)
  })

  it('disables previous data for assistant identity switches', () => {
    renderHook(() => useAssistant('assistant-new'))

    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', {
      params: { id: 'assistant-new' },
      enabled: true,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('keeps assistant mutation callbacks stable across rerenders', () => {
    mockUseQuery.mockImplementation((path, options) => {
      if (options?.enabled === false) return queryResult()
      if (path === '/assistants/:id') {
        return queryResult({
          id: 'assistant-1',
          name: 'Assistant 1',
          modelId: 'provider::model-a',
          settings: {},
          mcpServerIds: [],
          knowledgeBaseIds: []
        })
      }
      if (path === '/models/provider::model-a') return queryResult({ id: 'provider::model-a', name: 'Model A' })
      return queryResult()
    })

    const { rerender, result } = renderHook(() => useAssistant('assistant-1'))
    const firstSetModel = result.current.setModel
    const firstUpdateAssistant = result.current.updateAssistant
    const firstUpdateAssistantSettings = result.current.updateAssistantSettings

    rerender()

    expect(result.current.setModel).toBe(firstSetModel)
    expect(result.current.updateAssistant).toBe(firstUpdateAssistant)
    expect(result.current.updateAssistantSettings).toBe(firstUpdateAssistantSettings)
  })
})
