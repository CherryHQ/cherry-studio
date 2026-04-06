import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { mockUsePreference } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDefaultModel } from '../useDefaultModel.v2'

// Mock model data
const mockDefaultModel = {
  id: 'openai::gpt-4o',
  providerId: 'openai',
  name: 'GPT-4o',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}
const mockQuickModel = {
  id: 'openai::gpt-4o-mini',
  providerId: 'openai',
  name: 'GPT-4o Mini',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}
const mockTranslateModel = {
  id: 'anthropic::claude-3-haiku',
  providerId: 'anthropic',
  name: 'Claude 3 Haiku',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

describe('useDefaultModel.v2', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: usePreference returns empty strings (no model set)
    mockUsePreference.mockImplementation((key: string) => {
      const setFn = vi.fn().mockResolvedValue(undefined)
      switch (key) {
        case 'model.default_id':
          return ['', setFn]
        case 'model.quick_id':
          return ['', setFn]
        case 'model.translate_id':
          return ['', setFn]
        default:
          return ['', setFn]
      }
    })

    // Default: useQuery returns undefined data when enabled is false
    mockUseQuery.mockImplementation((_path: string, options?: { enabled?: boolean }) => ({
      data: options?.enabled === false ? undefined : undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))
  })

  it('should return empty state when no models are configured', () => {
    const { result } = renderHook(() => useDefaultModel())

    expect(result.current.defaultModel).toBeUndefined()
    expect(result.current.defaultModelId).toBe('')
    expect(result.current.quickModel).toBeUndefined()
    expect(result.current.quickModelId).toBe('')
    expect(result.current.translateModel).toBeUndefined()
    expect(result.current.translateModelId).toBe('')
    expect(result.current.isLoading).toBe(false)
  })

  it('should resolve models when preference IDs are set', () => {
    mockUsePreference.mockImplementation((key: string) => {
      const setFn = vi.fn().mockResolvedValue(undefined)
      switch (key) {
        case 'model.default_id':
          return ['openai::gpt-4o', setFn]
        case 'model.quick_id':
          return ['openai::gpt-4o-mini', setFn]
        case 'model.translate_id':
          return ['anthropic::claude-3-haiku', setFn]
        default:
          return ['', setFn]
      }
    })

    mockUseQuery.mockImplementation((path: string, options?: { enabled?: boolean }) => {
      if (options?.enabled === false) {
        return {
          data: undefined,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }
      }
      if (path.includes('openai') && path.includes('gpt-4o-mini')) {
        return {
          data: mockQuickModel,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }
      }
      if (path.includes('openai') && path.includes('gpt-4o')) {
        return {
          data: mockDefaultModel,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }
      }
      if (path.includes('anthropic') && path.includes('claude-3-haiku')) {
        return {
          data: mockTranslateModel,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }
      }
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    })

    const { result } = renderHook(() => useDefaultModel())

    expect(result.current.defaultModel).toEqual(mockDefaultModel)
    expect(result.current.defaultModelId).toBe('openai::gpt-4o')
    expect(result.current.quickModel).toEqual(mockQuickModel)
    expect(result.current.quickModelId).toBe('openai::gpt-4o-mini')
    expect(result.current.translateModel).toEqual(mockTranslateModel)
    expect(result.current.translateModelId).toBe('anthropic::claude-3-haiku')
  })

  it('should show isLoading when any model is being resolved', () => {
    mockUsePreference.mockImplementation((key: string) => {
      const setFn = vi.fn().mockResolvedValue(undefined)
      if (key === 'model.default_id') return ['openai::gpt-4o', setFn]
      return ['', setFn]
    })

    mockUseQuery.mockImplementation((_path: string, options?: { enabled?: boolean }) => {
      if (options?.enabled === false) {
        return {
          data: undefined,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }
      }
      // Simulate loading
      return {
        data: undefined,
        isLoading: true,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    })

    const { result } = renderHook(() => useDefaultModel())
    expect(result.current.isLoading).toBe(true)
  })

  it('should disable queries when preference is empty string', () => {
    renderHook(() => useDefaultModel())

    // All 3 useQuery calls should have enabled: false (since preference values are '')
    const queryCallsWithEnabledFalse = mockUseQuery.mock.calls.filter((call) => call[1]?.enabled === false)
    expect(queryCallsWithEnabledFalse.length).toBe(3)
  })

  it('should provide setter functions for each model', async () => {
    const mockSetDefault = vi.fn().mockResolvedValue(undefined)
    const mockSetQuick = vi.fn().mockResolvedValue(undefined)
    const mockSetTranslate = vi.fn().mockResolvedValue(undefined)

    mockUsePreference.mockImplementation((key: string) => {
      switch (key) {
        case 'model.default_id':
          return ['', mockSetDefault]
        case 'model.quick_id':
          return ['', mockSetQuick]
        case 'model.translate_id':
          return ['', mockSetTranslate]
        default:
          return ['', vi.fn()]
      }
    })

    const { result } = renderHook(() => useDefaultModel())

    await act(async () => {
      await result.current.setDefaultModel('openai::gpt-4o' as any)
    })
    expect(mockSetDefault).toHaveBeenCalledWith('openai::gpt-4o')

    await act(async () => {
      await result.current.setQuickModel('openai::gpt-4o-mini' as any)
    })
    expect(mockSetQuick).toHaveBeenCalledWith('openai::gpt-4o-mini')

    await act(async () => {
      await result.current.setTranslateModel('anthropic::claude-3-haiku' as any)
    })
    expect(mockSetTranslate).toHaveBeenCalledWith('anthropic::claude-3-haiku')
  })

  it('should call usePreference with correct keys', () => {
    renderHook(() => useDefaultModel())

    const calledKeys = mockUsePreference.mock.calls.map((call) => call[0])
    expect(calledKeys).toContain('model.default_id')
    expect(calledKeys).toContain('model.quick_id')
    expect(calledKeys).toContain('model.translate_id')
  })
})
