import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseAppSelector, mockUseMultiplePreferences, mockUsePreference } = vi.hoisted(() => ({
  mockUseAppSelector: vi.fn(),
  mockUseMultiplePreferences: vi.fn(),
  mockUsePreference: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: mockUseMultiplePreferences,
  usePreference: mockUsePreference
}))

vi.mock('@renderer/store', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: mockUseAppSelector
}))

vi.mock('@renderer/config/providers', () => ({
  CHERRYAI_PROVIDER: {
    id: 'cherryai',
    models: []
  }
}))

import { useWebSearchProviders, useWebSearchSettings } from '../useWebSearchProviders'

describe('useWebSearchProviders', () => {
  beforeEach(() => {
    mockUseAppSelector.mockReset()
    mockUseAppSelector.mockImplementation((selector) =>
      selector({
        llm: {
          providers: [
            {
              id: 'openai',
              models: [
                {
                  id: 'text-embedding-3-large',
                  name: 'text-embedding-3-large',
                  provider: 'openai'
                }
              ]
            }
          ]
        }
      })
    )
    mockUseMultiplePreferences.mockReset()
    mockUsePreference.mockReset()
  })

  it('resolves providers from presets without legacy url fields', () => {
    mockUsePreference.mockReturnValue([{}, vi.fn().mockResolvedValue(undefined)])

    const { result } = renderHook(() => useWebSearchProviders())
    const provider = result.current.providers.find((item) => item.id === 'local-bing')

    expect(provider).toMatchObject({
      id: 'local-bing',
      type: 'local',
      usingBrowser: true,
      apiHost: 'https://cn.bing.com/search?q=%s&ensearch=1'
    })
    expect(provider).not.toHaveProperty('url')
  })

  it('preserves an existing apiKey when updating apiHost', () => {
    const setProviderOverrides = vi.fn().mockResolvedValue(undefined)

    mockUsePreference.mockReturnValue([
      {
        zhipu: {
          apiKey: 'sk-test'
        }
      },
      setProviderOverrides
    ])

    const { result } = renderHook(() => useWebSearchProviders())

    act(() => {
      result.current.updateProvider('zhipu', {
        apiHost: 'https://proxy.example.com'
      })
    })

    expect(setProviderOverrides).toHaveBeenCalledWith({
      zhipu: {
        apiKey: 'sk-test',
        apiHost: 'https://proxy.example.com'
      }
    })
  })

  it('resolves web search settings from preferences and updates flattened compression keys', async () => {
    const updatePreferenceValues = vi.fn().mockResolvedValue(undefined)

    mockUseMultiplePreferences.mockReturnValue([
      {
        compressionMethod: 'rag',
        cutoffLimit: null,
        cutoffUnit: 'char',
        ragDocumentCount: 5,
        ragEmbeddingDimensions: 1536,
        ragEmbeddingModelId: 'openai::text-embedding-3-large',
        ragRerankModelId: null,
        excludeDomains: ['example.com'],
        maxResults: 8,
        searchWithTime: false
      },
      updatePreferenceValues
    ])

    const { result } = renderHook(() => useWebSearchSettings())

    expect(result.current.searchWithTime).toBe(false)
    expect(result.current.maxResults).toBe(8)
    expect(result.current.excludeDomains).toEqual(['example.com'])
    expect(result.current.compressionConfig).toMatchObject({
      method: 'rag',
      cutoffUnit: 'char',
      documentCount: 5,
      embeddingDimensions: 1536,
      embeddingModel: {
        id: 'text-embedding-3-large',
        provider: 'openai'
      }
    })

    await act(async () => {
      await result.current.updateCompressionConfig({
        cutoffLimit: 1000,
        method: 'cutoff'
      })
    })

    expect(updatePreferenceValues).toHaveBeenCalledWith({
      compressionMethod: 'cutoff',
      cutoffLimit: 1000,
      cutoffUnit: 'char',
      ragDocumentCount: 5,
      ragEmbeddingDimensions: 1536,
      ragEmbeddingModelId: 'openai::text-embedding-3-large',
      ragRerankModelId: null
    })
  })
})
