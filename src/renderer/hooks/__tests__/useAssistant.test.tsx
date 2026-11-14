import { mockUseMutation, mockUseInvalidateCache, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAssistant, useAssistantMutations, useAssistants } from '../useAssistant'

const updateModelSettings = vi.hoisted(() => vi.fn())
vi.mock('@data/PreferenceService', () => ({ preferenceService: { updateModelSettings } }))

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

function resetQueryMock() {
  mockUseQuery.mockImplementation(() => queryResult())
}

function ipcOk(data: unknown) {
  return { ok: true, data }
}

describe('useAssistantMutations.deleteAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryMock()
    vi.mocked(window.api.ipcApi.request).mockReset()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue(ipcOk(undefined))
  })

  it('returns a committed deletion when refresh fails and refreshes unlinked topics', async () => {
    vi.mocked(window.api.ipcApi.request).mockResolvedValue(ipcOk({ deleted: true }))

    const { result } = renderHook(() => useAssistantMutations())
    const invalidate = mockUseInvalidateCache.mock.results.at(-1)?.value as ReturnType<typeof vi.fn>
    invalidate.mockRejectedValueOnce(new Error('refresh failed'))

    const outcome = await act(async () =>
      result.current.deleteAssistant('assistant-1', { permanent: true, deleteTopics: false })
    )

    expect(window.api.ipcApi.request).toHaveBeenCalledWith('trash.assistant.delete_permanently', {
      assistantId: 'assistant-1',
      deleteTopics: false
    })
    expect(invalidate).toHaveBeenCalledWith(['/assistants', '/assistants/*', '/pins', '/topics'])
    expect(outcome).toEqual({ deleted: true })
  })

  it('keeps archive cascade refresh, including topics and pins', async () => {
    vi.mocked(window.api.ipcApi.request).mockResolvedValue(
      ipcOk({ deleted: true, deletedTopicIds: ['active-topic', 'archived-topic'] })
    )

    const { result } = renderHook(() => useAssistantMutations())
    const invalidate = mockUseInvalidateCache.mock.results.at(-1)?.value as ReturnType<typeof vi.fn>
    const outcome = await act(async () => result.current.deleteAssistant('assistant-1', { deleteTopics: true }))

    expect(window.api.ipcApi.request).toHaveBeenCalledWith('trash.assistant.archive', {
      assistantId: 'assistant-1',
      deleteTopics: true
    })
    expect(invalidate).toHaveBeenCalledWith(['/assistants', '/assistants/*', '/pins', '/topics'])
    expect(outcome).toEqual({ deleted: true, deletedTopicIds: ['active-topic', 'archived-topic'] })
  })

  it('returns a stale assistant deletion after refreshing the topic list', async () => {
    vi.mocked(window.api.ipcApi.request).mockResolvedValue(ipcOk({ deleted: false }))

    const { result } = renderHook(() => useAssistantMutations())
    const invalidate = mockUseInvalidateCache.mock.results.at(-1)?.value as ReturnType<typeof vi.fn>
    const outcome = await act(async () => result.current.deleteAssistant('assistant-1', { permanent: true }))

    expect(outcome).toEqual({ deleted: false })
    expect(invalidate).toHaveBeenCalledWith(['/assistants', '/assistants/*', '/pins', '/topics'])
  })

  it('rethrows the deletion failure after refresh, including when refresh fails', async () => {
    vi.mocked(window.api.ipcApi.request).mockRejectedValue(new Error('delete failed'))

    const { result } = renderHook(() => useAssistantMutations())
    const invalidate = mockUseInvalidateCache.mock.results.at(-1)?.value as ReturnType<typeof vi.fn>
    invalidate.mockRejectedValueOnce(new Error('refresh failed'))

    let caught: unknown
    await act(async () => {
      try {
        await result.current.deleteAssistant('assistant-1', { permanent: true, deleteTopics: true })
      } catch (error) {
        caught = error
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('delete failed')
    expect(invalidate).toHaveBeenCalledWith(['/assistants', '/assistants/*', '/pins', '/topics'])
  })
})

describe('useAssistants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryMock()
    MockUsePreferenceUtils.resetMocks()
  })

  it('queries the assistant list from DataApi', () => {
    const assistant = { id: 'assistant-1', name: 'Assistant 1' }
    mockUseQuery.mockReturnValue(queryResult({ items: [assistant], total: 1 }))

    const { result } = renderHook(() => useAssistants())

    expect(result.current.assistants).toEqual([assistant])
    expect(result.current.hasLoaded).toBe(true)
  })

  it('reports the assistant list as unresolved before DataApi returns data', () => {
    mockUseQuery.mockReturnValue(queryResult(undefined, { isLoading: false }))

    const { result } = renderHook(() => useAssistants())

    expect(result.current.assistants).toEqual([])
    expect(result.current.hasLoaded).toBe(false)
  })
})

describe('useAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryMock()
    MockUsePreferenceUtils.resetMocks()
  })

  it('returns assistant: undefined for a topic without an assistant', () => {
    const { result } = renderHook(() => useAssistant(null))

    expect(result.current.assistant).toBeUndefined()
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

  describe('per-model web search and reasoning effort', () => {
    const modelB = {
      id: 'provider::model-b',
      providerId: 'provider',
      name: 'Model B',
      capabilities: ['function-call']
    } as never

    function setup(savedSettings: Record<string, unknown>, knowledgeBaseIds: string[] = [], total = 1) {
      updateModelSettings.mockImplementation(async (modelId, patch) => {
        const all = MockUsePreferenceUtils.getPreferenceValue('chat.model_settings') as Record<string, object>
        MockUsePreferenceUtils.setPreferenceValue('chat.model_settings', {
          ...all,
          [modelId]: { ...all[modelId], ...patch }
        })
      })
      const trigger = vi.fn().mockResolvedValue({})
      mockUseMutation.mockImplementation(() => ({ trigger, isLoading: false, error: undefined }))
      MockUsePreferenceUtils.setPreferenceValue('chat.model_settings', savedSettings)
      mockUseQuery.mockImplementation((path, options) => {
        if (options?.enabled === false) return queryResult()
        if (path === '/assistants/:id') {
          return queryResult({
            id: 'assistant-1',
            name: 'Assistant 1',
            modelId: 'provider::model-a',
            settings: { enableWebSearch: true, mcpMode: 'disabled' },
            mcpServerIds: [],
            knowledgeBaseIds
          })
        }
        if (path === '/knowledge-bases') return queryResult({ total, items: [] })
        if (path === '/providers')
          return queryResult([
            { id: 'gemini', serverTools: [{ id: 'web-search', modelScope: 'model-dependent', vendors: ['gemini'] }] }
          ])
        return queryResult()
      })
      return { trigger, hook: renderHook(() => useAssistant('assistant-1')) }
    }

    it.each([
      [['kb-1'], 1, false],
      [[], 1, true],
      [['kb-1'], 0, true]
    ] as const)('reconciles restored Gemini search for scoped KBs %j with total %s', async (ids, total, expected) => {
      const remembered = { 'gemini::gemini-2.5-pro': { enableWebSearch: true } }
      const { hook, trigger } = setup(remembered, [...ids], total)
      await act(async () => {
        await hook.result.current.setModel({
          name: 'Gemini 2.5 Pro',
          capabilities: ['function-call'],
          id: 'gemini::gemini-2.5-pro',
          providerId: 'gemini',
          apiModelId: 'gemini-2.5-pro'
        } as never)
      })
      expect(trigger.mock.calls[0][0].body.settings.enableWebSearch).toBe(expected)
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.model_settings')).toEqual(remembered)
      expect(updateModelSettings).not.toHaveBeenCalled()
    })

    it('saves web search changes under the active model', async () => {
      const { hook } = setup({})

      await act(async () => {
        await hook.result.current.updateAssistant({ settings: { enableWebSearch: false } })
      })

      expect(MockUsePreferenceUtils.getPreferenceValue('chat.model_settings')).toEqual({
        'provider::model-a': { enableWebSearch: false }
      })
    })

    it('sends only changed fields from independent hook instances while persistence is pending', async () => {
      const { hook } = setup({ 'provider::model-a': { reasoning_effort: 'high' } })
      const second = renderHook(() => useAssistant('assistant-1'))
      updateModelSettings.mockImplementation(() => new Promise(() => {}))
      await act(async () => {
        await hook.result.current.updateAssistant({ settings: { reasoning_effort: 'low' } })
        await second.result.current.updateAssistant({ settings: { enableWebSearch: false } })
      })
      expect(updateModelSettings.mock.calls).toEqual([
        ['provider::model-a', { reasoning_effort: 'low' }],
        ['provider::model-a', { enableWebSearch: false }]
      ])
    })

    it('restores the saved web search choice when switching to a model', async () => {
      const { hook, trigger } = setup({ 'provider::model-b': { enableWebSearch: true } })
      await act(async () => {
        await hook.result.current.setModel(modelB)
      })

      const body = trigger.mock.calls[0][0].body
      expect(body.modelId).toBe('provider::model-b')
      expect(body.settings.enableWebSearch).toBe(true)
    })

    it('defaults web search to off for a model without saved settings', async () => {
      const { hook, trigger } = setup({})

      await act(async () => {
        await hook.result.current.setModel(modelB)
      })

      expect(trigger.mock.calls[0][0].body.settings.enableWebSearch).toBe(false)
    })
  })
})
