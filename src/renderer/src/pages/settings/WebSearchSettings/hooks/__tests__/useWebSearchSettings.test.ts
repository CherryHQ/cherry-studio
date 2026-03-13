import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseAppSelector, mockUseMultiplePreferences } = vi.hoisted(() => ({
  mockUseAppSelector: vi.fn(),
  mockUseMultiplePreferences: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: mockUseMultiplePreferences
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: mockUseAppSelector
}))

vi.mock('@renderer/config/providers', () => ({
  CHERRYAI_PROVIDER: {
    id: 'cherryai',
    models: []
  }
}))

import { useWebSearchSettings } from '../useWebSearchSettings'

describe('useWebSearchSettings', () => {
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
