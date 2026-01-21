import type { WebSearchProviderUserConfig } from '@shared/data/preference/preferenceTypes'
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

// Helper to create mock user configs (sparse object)
const createMockUserConfig = (overrides: Partial<WebSearchProviderUserConfig> = {}): WebSearchProviderUserConfig => ({
  id: 'test-provider',
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
      it('should return providers merged from templates and user configs', () => {
        // User configs (sparse object - only store modified fields)
        const mockUserConfigs: WebSearchProviderUserConfig[] = [
          createMockUserConfig({ id: 'tavily', apiKey: 'my-tavily-key' }),
          createMockUserConfig({ id: 'exa', apiKey: 'my-exa-key' })
        ]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockUserConfigs)

        const { result } = renderHook(() => useWebSearchProviders())

        // Should return all template providers (9 total), merged with user configs
        expect(result.current.providers.length).toBe(9)

        // Tavily should have user's apiKey merged with template
        const tavily = result.current.providers.find((p) => p.id === 'tavily')
        expect(tavily?.apiKey).toBe('my-tavily-key')
        expect(tavily?.apiHost).toBe('https://api.tavily.com') // from template
        expect(tavily?.name).toBe('Tavily') // from template
      })

      it('should return correct total count from templates', () => {
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

        const { result } = renderHook(() => useWebSearchProviders())

        // Total is always template count (9 providers)
        expect(result.current.total).toBe(9)
      })
    })

    describe('getProvider', () => {
      it('should return provider for existing template ID', () => {
        const mockUserConfigs: WebSearchProviderUserConfig[] = [createMockUserConfig({ id: 'tavily', apiKey: 'key1' })]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockUserConfigs)

        const { result } = renderHook(() => useWebSearchProviders())
        const provider = result.current.getProvider('tavily')

        expect(provider?.id).toBe('tavily')
        expect(provider?.apiKey).toBe('key1')
        expect(provider?.apiHost).toBe('https://api.tavily.com') // from template
      })

      it('should return undefined for non-existing template ID', () => {
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

        const { result } = renderHook(() => useWebSearchProviders())
        const provider = result.current.getProvider('non-existent')

        expect(provider).toBeUndefined()
      })
    })

    describe('updateProvider', () => {
      it('should update provider with partial data (sparse object)', async () => {
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

        const { result } = renderHook(() => useWebSearchProviders())

        await act(async () => {
          await result.current.updateProvider('tavily', { apiKey: 'new-key' })
        })

        await waitFor(() => {
          const updatedValue = MockUsePreferenceUtils.getPreferenceValue('chat.websearch.providers')
          // Should only store the modified field (sparse object)
          expect(updatedValue).toEqual([{ id: 'tavily', apiKey: 'new-key' }])
        })
      })

      it('should throw error for non-existing template ID', async () => {
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

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
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

        const { result } = renderHook(() => useWebSearchProviders())

        // local-google is a local provider in templates
        expect(result.current.isProviderEnabled('local-google')).toBe(true)
      })

      it('should return true for api provider with apiKey', () => {
        const mockUserConfigs: WebSearchProviderUserConfig[] = [
          createMockUserConfig({ id: 'tavily', apiKey: 'some-key' })
        ]
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockUserConfigs)

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.isProviderEnabled('tavily')).toBe(true)
      })

      it('should return true for api provider with apiHost (template default)', () => {
        // Tavily template has defaultApiHost, so it's enabled even without user config
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

        const { result } = renderHook(() => useWebSearchProviders())

        // Tavily has defaultApiHost in template, so apiHost is not empty
        expect(result.current.isProviderEnabled('tavily')).toBe(true)
      })

      it('should return false for api provider without apiKey and empty template apiHost', () => {
        // searxng template has empty defaultApiHost
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

        const { result } = renderHook(() => useWebSearchProviders())

        // searxng has empty defaultApiHost and no user config, so not enabled
        expect(result.current.isProviderEnabled('searxng')).toBe(false)
      })

      it('should return false for non-existing provider', () => {
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.isProviderEnabled('non-existent')).toBe(false)
      })

      it('should return false for undefined providerId', () => {
        MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

        const { result } = renderHook(() => useWebSearchProviders())

        expect(result.current.isProviderEnabled(undefined)).toBe(false)
      })
    })
  })

  // ============================================================================
  // useWebSearchProvider
  // ============================================================================

  describe('useWebSearchProvider', () => {
    it('should return provider merged from template and user config', () => {
      const mockUserConfigs: WebSearchProviderUserConfig[] = [createMockUserConfig({ id: 'tavily', apiKey: 'key1' })]
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', mockUserConfigs)

      const { result } = renderHook(() => useWebSearchProvider('tavily'))

      expect(result.current.provider).toEqual({
        id: 'tavily',
        name: 'Tavily',
        type: 'api',
        apiKey: 'key1',
        apiHost: 'https://api.tavily.com', // from template
        engines: [],
        usingBrowser: false,
        basicAuthUsername: '',
        basicAuthPassword: ''
      })
    })

    it('should return undefined for non-existing template ID', () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

      const { result } = renderHook(() => useWebSearchProvider('non-existent'))

      expect(result.current.provider).toBeUndefined()
    })

    it('should update provider through updateProvider function', async () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.websearch.providers', [])

      const { result } = renderHook(() => useWebSearchProvider('tavily'))

      await act(async () => {
        await result.current.updateProvider({ apiKey: 'new-api-key' })
      })

      await waitFor(() => {
        const updatedProviders = MockUsePreferenceUtils.getPreferenceValue('chat.websearch.providers')
        expect(updatedProviders).toEqual([{ id: 'tavily', apiKey: 'new-api-key' }])
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
