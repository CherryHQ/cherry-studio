import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  useBasicWebSearchSettings,
  useCompressionMethod,
  useCutoffCompression,
  useRagCompression,
  useWebSearchProvider,
  useWebSearchProviders
} from '../useWebSearch'

// Helper to create mock providers
const createMockProvider = (overrides: Partial<WebSearchProvider> = {}): WebSearchProvider => ({
  id: 'test-provider',
  name: 'Test Provider',
  type: 'api',
  apiKey: '',
  apiHost: '',
  engines: [],
  usingBrowser: false,
  basicAuthUsername: '',
  basicAuthPassword: '',
  ...overrides
})

describe('useWebSearch hooks', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  // ============================================================================
  // useWebSearchProviders
  // ============================================================================

  describe('useWebSearchProviders', () => {
    describe('providers', () => {
      it('should return providers from preference', () => {
        const mockProviders = [
          createMockProvider({ id: 'tavily', name: 'Tavily' }),
          createMockProvider({ id: 'exa', name: 'Exa' })
        ]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.providers).toEqual(mockProviders)
      })

      it('should return correct total count', () => {
        const mockProviders = [
          createMockProvider({ id: 'p1' }),
          createMockProvider({ id: 'p2' }),
          createMockProvider({ id: 'p3' })
        ]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.total).toBe(3)
      })
    })

    describe('getProvider', () => {
      it('should return provider for existing ID', () => {
        const mockProviders = [
          createMockProvider({ id: 'tavily', name: 'Tavily' }),
          createMockProvider({ id: 'exa', name: 'Exa' })
        ]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())
        const provider = result.current.getProvider('tavily')

        expect(provider).toEqual(mockProviders[0])
      })

      it('should return undefined for non-existing ID', () => {
        const mockProviders = [createMockProvider({ id: 'tavily' })]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())
        const provider = result.current.getProvider('non-existent')

        expect(provider).toBeUndefined()
      })
    })

    describe('updateProvider', () => {
      it('should update provider with partial data', async () => {
        const mockProviders = [createMockProvider({ id: 'tavily', apiKey: '', apiHost: '' })]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        await act(async () => {
          await result.current.updateProvider('tavily', { apiKey: 'new-key' })
        })

        await waitFor(() => {
          const updatedValue = MockUsePreferenceUtils.getPreferenceValue('chat.websearch.providers')
          expect(updatedValue[0].apiKey).toBe('new-key')
          // Other fields should remain unchanged
          expect(updatedValue[0].apiHost).toBe('')
        })
      })

      it('should throw error for non-existing provider ID', async () => {
        const mockProviders = [createMockProvider({ id: 'tavily' })]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        await expect(
          act(async () => {
            await result.current.updateProvider('non-existent', { apiKey: 'key' })
          })
        ).rejects.toThrow('Unknown provider ID: non-existent')
      })
    })

    describe('isProviderEnabled', () => {
      it('should return true for local provider', () => {
        const mockProviders = [createMockProvider({ id: 'local-google', type: 'local' })]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.isProviderEnabled('local-google')).toBe(true)
      })

      it('should return true for api provider with apiKey', () => {
        const mockProviders = [createMockProvider({ id: 'tavily', type: 'api', apiKey: 'some-key' })]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.isProviderEnabled('tavily')).toBe(true)
      })

      it('should return true for api provider with apiHost', () => {
        const mockProviders = [
          createMockProvider({ id: 'searxng', type: 'api', apiKey: '', apiHost: 'https://example.com' })
        ]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.isProviderEnabled('searxng')).toBe(true)
      })

      it('should return false for api provider without apiKey and apiHost', () => {
        const mockProviders = [createMockProvider({ id: 'tavily', type: 'api', apiKey: '', apiHost: '' })]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.isProviderEnabled('tavily')).toBe(false)
      })

      it('should return false for non-existing provider', () => {
        const mockProviders = [createMockProvider({ id: 'tavily' })]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.isProviderEnabled('non-existent')).toBe(false)
      })

      it('should return false for undefined providerId', () => {
        const mockProviders = [createMockProvider({ id: 'tavily' })]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.isProviderEnabled(undefined)).toBe(false)
      })
    })
  })

  // ============================================================================
  // useWebSearchProvider
  // ============================================================================

  describe('useWebSearchProvider', () => {
    it('should return provider for specified ID', () => {
      const mockProviders = [
        createMockProvider({ id: 'tavily', name: 'Tavily', apiKey: 'key1' }),
        createMockProvider({ id: 'exa', name: 'Exa', apiKey: 'key2' })
      ]
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

      const { result } = renderHook(() => useWebSearchProvider('tavily'))

      expect(result.current.provider).toEqual(mockProviders[0])
    })

    it('should return undefined for non-existing ID', () => {
      const mockProviders = [createMockProvider({ id: 'tavily' })]
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

      const { result } = renderHook(() => useWebSearchProvider('non-existent'))

      expect(result.current.provider).toBeUndefined()
    })

    it('should update provider through updateProvider function', async () => {
      const mockProviders = [createMockProvider({ id: 'tavily', apiKey: '' })]
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockProviders)

      const { result } = renderHook(() => useWebSearchProvider('tavily'))

      await act(async () => {
        await result.current.updateProvider({ apiKey: 'new-api-key' })
      })

      await waitFor(() => {
        const updatedProviders = MockUsePreferenceUtils.getPreferenceValue('chat.websearch.providers')
        expect(updatedProviders[0].apiKey).toBe('new-api-key')
      })
    })
  })

  // ============================================================================
  // useBasicWebSearchSettings
  // ============================================================================

  describe('useBasicWebSearchSettings', () => {
    it('should return all basic settings', () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.search_with_time', true)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.max_results', 10)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.exclude_domains', ['example.com'])

      const { result } = renderHook(() => useBasicWebSearchSettings())

      expect(result.current.searchWithTime).toBe(true)
      expect(result.current.maxResults).toBe(10)
      expect(result.current.excludeDomains).toEqual(['example.com'])
    })

    it('should update searchWithTime', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.search_with_time', true)

      const { result } = renderHook(() => useBasicWebSearchSettings())

      await act(async () => {
        await result.current.setSearchWithTime(false)
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.search_with_time')).toBe(false)
      })
    })

    it('should update maxResults', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.max_results', 5)

      const { result } = renderHook(() => useBasicWebSearchSettings())

      await act(async () => {
        await result.current.setMaxResults(15)
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.max_results')).toBe(15)
      })
    })

    it('should update excludeDomains', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.exclude_domains', [])

      const { result } = renderHook(() => useBasicWebSearchSettings())

      await act(async () => {
        await result.current.setExcludeDomains(['*://blocked.com/*'])
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.exclude_domains')).toEqual([
          '*://blocked.com/*'
        ])
      })
    })
  })

  // ============================================================================
  // useCompressionMethod
  // ============================================================================

  describe('useCompressionMethod', () => {
    it('should return current compression method', () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.method', 'rag')

      const { result } = renderHook(() => useCompressionMethod())

      expect(result.current.method).toBe('rag')
    })

    it('should update compression method', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.method', 'none')

      const { result } = renderHook(() => useCompressionMethod())

      await act(async () => {
        await result.current.setMethod('cutoff')
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.method')).toBe('cutoff')
      })
    })
  })

  // ============================================================================
  // useCutoffCompression
  // ============================================================================

  describe('useCutoffCompression', () => {
    it('should return all cutoff settings', () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.cutoff_limit', 2000)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.cutoff_unit', 'token')

      const { result } = renderHook(() => useCutoffCompression())

      expect(result.current.cutoffLimit).toBe(2000)
      expect(result.current.cutoffUnit).toBe('token')
    })

    it('should update cutoff limit only when unit not provided', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.cutoff_limit', 1000)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.cutoff_unit', 'char')

      const { result } = renderHook(() => useCutoffCompression())

      await act(async () => {
        await result.current.updateCutoff(3000)
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.cutoff_limit')).toBe(3000)
        // Unit should remain unchanged
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.cutoff_unit')).toBe('char')
      })
    })

    it('should update both limit and unit when both provided', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.cutoff_limit', 1000)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.cutoff_unit', 'char')

      const { result } = renderHook(() => useCutoffCompression())

      await act(async () => {
        await result.current.updateCutoff(5000, 'token')
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.cutoff_limit')).toBe(5000)
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.cutoff_unit')).toBe('token')
      })
    })

    it('should allow setting cutoff limit to null', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.cutoff_limit', 1000)

      const { result } = renderHook(() => useCutoffCompression())

      await act(async () => {
        await result.current.updateCutoff(null)
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.cutoff_limit')).toBeNull()
      })
    })
  })

  // ============================================================================
  // useRagCompression
  // ============================================================================

  describe('useRagCompression', () => {
    it('should return all RAG settings', () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_document_count', 5)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_embedding_model_id', 'text-embed-3')
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_embedding_provider_id', 'openai')
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_embedding_dimensions', 1536)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_rerank_model_id', 'rerank-v1')
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_rerank_provider_id', 'cohere')

      const { result } = renderHook(() => useRagCompression())

      expect(result.current.ragDocumentCount).toBe(5)
      expect(result.current.ragEmbeddingModelId).toBe('text-embed-3')
      expect(result.current.ragEmbeddingProviderId).toBe('openai')
      expect(result.current.ragEmbeddingDimensions).toBe(1536)
      expect(result.current.ragRerankModelId).toBe('rerank-v1')
      expect(result.current.ragRerankProviderId).toBe('cohere')
    })

    it('should update document count', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_document_count', 1)

      const { result } = renderHook(() => useRagCompression())

      await act(async () => {
        await result.current.setRagDocumentCount(10)
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_document_count')).toBe(10)
      })
    })

    it('should update embedding model without dimensions', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_embedding_model_id', null)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_embedding_provider_id', null)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_embedding_dimensions', null)

      const { result } = renderHook(() => useRagCompression())

      await act(async () => {
        await result.current.updateRagEmbeddingModel('new-model', 'new-provider')
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_embedding_model_id')).toBe(
          'new-model'
        )
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_embedding_provider_id')).toBe(
          'new-provider'
        )
        // Dimensions should remain unchanged when not provided
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_embedding_dimensions')).toBe(
          null
        )
      })
    })

    it('should update embedding model with dimensions', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_embedding_model_id', null)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_embedding_provider_id', null)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_embedding_dimensions', null)

      const { result } = renderHook(() => useRagCompression())

      await act(async () => {
        await result.current.updateRagEmbeddingModel('embed-model', 'openai', 3072)
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_embedding_model_id')).toBe(
          'embed-model'
        )
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_embedding_provider_id')).toBe(
          'openai'
        )
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_embedding_dimensions')).toBe(
          3072
        )
      })
    })

    it('should update rerank model', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_rerank_model_id', null)
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_rerank_provider_id', null)

      const { result } = renderHook(() => useRagCompression())

      await act(async () => {
        await result.current.updateRagRerankModel('rerank-v2', 'cohere')
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_rerank_model_id')).toBe(
          'rerank-v2'
        )
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_rerank_provider_id')).toBe(
          'cohere'
        )
      })
    })

    it('should allow clearing rerank model by setting to null', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.compression.rag_rerank_model_id', 'existing-model')
      MockUsePreferenceUtils.setPreferenceValue(
        'chat.websearch.compression.rag_rerank_provider_id',
        'existing-provider'
      )

      const { result } = renderHook(() => useRagCompression())

      await act(async () => {
        await result.current.updateRagRerankModel(null, null)
      })

      await waitFor(() => {
        expect(MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_rerank_model_id')).toBeNull()
        expect(
          MockUsePreferenceUtils.getPreferenceValue('chat.websearch.compression.rag_rerank_provider_id')
        ).toBeNull()
      })
    })
  })
})
