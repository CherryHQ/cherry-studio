/**
 * websearch.ts Unit Tests
 * Tests for web search parameters generation utilities
 */

import type { CherryWebSearchConfig } from '@renderer/store/websearch'
import type { Model } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { buildProviderBuiltinWebSearchConfig, getWebSearchParams } from '../websearch'

// Mock dependencies
vi.mock('@renderer/config/models', () => ({
  isOpenAIWebSearchChatCompletionOnlyModel: vi.fn((model) => model?.id?.includes('o1-pro') ?? false),
  isOpenAIDeepResearchModel: vi.fn((model) => model?.id?.includes('o3-mini') ?? false)
}))

vi.mock('@renderer/utils/blacklistMatchPattern', () => ({
  mapRegexToPatterns: vi.fn((patterns) => patterns || [])
}))

describe('websearch utils', () => {
  describe('getWebSearchParams', () => {
    it('should return enhancement params for hunyuan provider', () => {
      const model: Model = {
        id: 'hunyuan-model',
        name: 'Hunyuan Model',
        provider: 'hunyuan'
      } as Model

      const result = getWebSearchParams(model)

      expect(result).toEqual({
        enable_enhancement: true,
        citation: true,
        search_info: true
      })
    })

    it('should return search params for dashscope provider', () => {
      const model: Model = {
        id: 'qwen-model',
        name: 'Qwen Model',
        provider: 'dashscope'
      } as Model

      const result = getWebSearchParams(model)

      expect(result).toEqual({
        enable_search: true,
        search_options: {
          forced_search: true
        }
      })
    })

    it('should return web_search_options for OpenAI web search models', () => {
      const model: Model = {
        id: 'o1-pro',
        name: 'O1 Pro',
        provider: 'openai'
      } as Model

      const result = getWebSearchParams(model)

      expect(result).toEqual({
        web_search_options: {}
      })
    })

    it('should return empty object for other providers', () => {
      const model: Model = {
        id: 'gpt-4',
        name: 'GPT-4',
        provider: 'openai'
      } as Model

      const result = getWebSearchParams(model)

      expect(result).toEqual({})
    })

    it('should return empty object for custom provider', () => {
      const model: Model = {
        id: 'custom-model',
        name: 'Custom Model',
        provider: 'custom-provider'
      } as Model

      const result = getWebSearchParams(model)

      expect(result).toEqual({})
    })
  })

  describe('buildProviderBuiltinWebSearchConfig', () => {
    const defaultWebSearchConfig: CherryWebSearchConfig = {
      searchWithTime: true,
      maxResults: 50,
      excludeDomains: []
    }

    describe('openai provider', () => {
      it('should return low search context size for low maxResults', () => {
        const config: CherryWebSearchConfig = {
          searchWithTime: true,
          maxResults: 20,
          excludeDomains: []
        }

        const result = buildProviderBuiltinWebSearchConfig('openai', config)

        expect(result).toEqual({
          openai: {
            searchContextSize: 'low'
          }
        })
      })

      it('should return medium search context size for medium maxResults', () => {
        const config: CherryWebSearchConfig = {
          searchWithTime: true,
          maxResults: 50,
          excludeDomains: []
        }

        const result = buildProviderBuiltinWebSearchConfig('openai', config)

        expect(result).toEqual({
          openai: {
            searchContextSize: 'medium'
          }
        })
      })

      it('should return high search context size for high maxResults', () => {
        const config: CherryWebSearchConfig = {
          searchWithTime: true,
          maxResults: 80,
          excludeDomains: []
        }

        const result = buildProviderBuiltinWebSearchConfig('openai', config)

        expect(result).toEqual({
          openai: {
            searchContextSize: 'high'
          }
        })
      })

      it('should use medium for deep research models regardless of maxResults', () => {
        const config: CherryWebSearchConfig = {
          searchWithTime: true,
          maxResults: 100,
          excludeDomains: []
        }

        const model: Model = {
          id: 'o3-mini',
          name: 'O3 Mini',
          provider: 'openai'
        } as Model

        const result = buildProviderBuiltinWebSearchConfig('openai', config, model)

        expect(result).toEqual({
          openai: {
            searchContextSize: 'medium'
          }
        })
      })
    })

    describe('openai-chat provider', () => {
      it('should return correct search context size', () => {
        const config: CherryWebSearchConfig = {
          searchWithTime: true,
          maxResults: 50,
          excludeDomains: []
        }

        const result = buildProviderBuiltinWebSearchConfig('openai-chat', config)

        expect(result).toEqual({
          'openai-chat': {
            searchContextSize: 'medium'
          }
        })
      })

      it('should handle deep research models', () => {
        const config: CherryWebSearchConfig = {
          searchWithTime: true,
          maxResults: 100,
          excludeDomains: []
        }

        const model: Model = {
          id: 'o3-mini',
          name: 'O3 Mini',
          provider: 'openai'
        } as Model

        const result = buildProviderBuiltinWebSearchConfig('openai-chat', config, model)

        expect(result).toEqual({
          'openai-chat': {
            searchContextSize: 'medium'
          }
        })
      })
    })

    describe('anthropic provider', () => {
      it('should return anthropic search options with maxUses', () => {
        const result = buildProviderBuiltinWebSearchConfig('anthropic', defaultWebSearchConfig)

        expect(result).toEqual({
          anthropic: {
            maxUses: 50,
            blockedDomains: undefined
          }
        })
      })

      it('should include blockedDomains when excludeDomains provided', () => {
        const config: CherryWebSearchConfig = {
          searchWithTime: true,
          maxResults: 30,
          excludeDomains: ['example.com', 'test.com']
        }

        const result = buildProviderBuiltinWebSearchConfig('anthropic', config)

        expect(result).toEqual({
          anthropic: {
            maxUses: 30,
            blockedDomains: ['example.com', 'test.com']
          }
        })
      })

      it('should not include blockedDomains when empty', () => {
        const result = buildProviderBuiltinWebSearchConfig('anthropic', defaultWebSearchConfig)

        expect(result).toEqual({
          anthropic: {
            maxUses: 50,
            blockedDomains: undefined
          }
        })
      })
    })

    describe('xai provider', () => {
      it('should return xai search options', () => {
        const result = buildProviderBuiltinWebSearchConfig('xai', defaultWebSearchConfig)

        expect(result).toEqual({
          xai: {
            maxSearchResults: 30,
            returnCitations: true,
            sources: [{ type: 'web', excludedWebsites: [] }, { type: 'news' }, { type: 'x' }],
            mode: 'on'
          }
        })
      })

      it('should limit excluded websites to 5', () => {
        const config: CherryWebSearchConfig = {
          searchWithTime: true,
          maxResults: 40,
          excludeDomains: ['site1.com', 'site2.com', 'site3.com', 'site4.com', 'site5.com', 'site6.com', 'site7.com']
        }

        const result = buildProviderBuiltinWebSearchConfig('xai', config)

        expect(result?.xai?.sources).toBeDefined()
        const webSource = result?.xai?.sources?.[0]
        if (webSource && webSource.type === 'web') {
          expect(webSource.excludedWebsites).toHaveLength(5)
        }
      })

      it('should include all sources types', () => {
        const result = buildProviderBuiltinWebSearchConfig('xai', defaultWebSearchConfig)

        expect(result?.xai?.sources).toHaveLength(3)
        expect(result?.xai?.sources?.[0].type).toBe('web')
        expect(result?.xai?.sources?.[1].type).toBe('news')
        expect(result?.xai?.sources?.[2].type).toBe('x')
      })
    })

    describe('openrouter provider', () => {
      it('should return openrouter plugins config', () => {
        const result = buildProviderBuiltinWebSearchConfig('openrouter', defaultWebSearchConfig)

        expect(result).toEqual({
          openrouter: {
            plugins: [
              {
                id: 'web',
                max_results: 50
              }
            ]
          }
        })
      })

      it('should respect custom maxResults', () => {
        const config: CherryWebSearchConfig = {
          searchWithTime: true,
          maxResults: 75,
          excludeDomains: []
        }

        const result = buildProviderBuiltinWebSearchConfig('openrouter', config)

        expect(result).toEqual({
          openrouter: {
            plugins: [
              {
                id: 'web',
                max_results: 75
              }
            ]
          }
        })
      })
    })

    describe('unsupported provider', () => {
      it('should return empty object for unsupported provider', () => {
        const result = buildProviderBuiltinWebSearchConfig('unsupported' as any, defaultWebSearchConfig)

        expect(result).toEqual({})
      })

      it('should return empty object for google provider', () => {
        const result = buildProviderBuiltinWebSearchConfig('google', defaultWebSearchConfig)

        expect(result).toEqual({})
      })
    })

    describe('edge cases', () => {
      it('should handle maxResults at boundary values', () => {
        // Test boundary at 33 (low/medium)
        const config33: CherryWebSearchConfig = { searchWithTime: true, maxResults: 33, excludeDomains: [] }
        const result33 = buildProviderBuiltinWebSearchConfig('openai', config33)
        expect(result33?.openai?.searchContextSize).toBe('low')

        // Test boundary at 34 (medium)
        const config34: CherryWebSearchConfig = { searchWithTime: true, maxResults: 34, excludeDomains: [] }
        const result34 = buildProviderBuiltinWebSearchConfig('openai', config34)
        expect(result34?.openai?.searchContextSize).toBe('medium')

        // Test boundary at 66 (medium)
        const config66: CherryWebSearchConfig = { searchWithTime: true, maxResults: 66, excludeDomains: [] }
        const result66 = buildProviderBuiltinWebSearchConfig('openai', config66)
        expect(result66?.openai?.searchContextSize).toBe('medium')

        // Test boundary at 67 (high)
        const config67: CherryWebSearchConfig = { searchWithTime: true, maxResults: 67, excludeDomains: [] }
        const result67 = buildProviderBuiltinWebSearchConfig('openai', config67)
        expect(result67?.openai?.searchContextSize).toBe('high')
      })

      it('should handle zero maxResults', () => {
        const config: CherryWebSearchConfig = { searchWithTime: true, maxResults: 0, excludeDomains: [] }
        const result = buildProviderBuiltinWebSearchConfig('openai', config)
        expect(result?.openai?.searchContextSize).toBe('low')
      })

      it('should handle very large maxResults', () => {
        const config: CherryWebSearchConfig = { searchWithTime: true, maxResults: 1000, excludeDomains: [] }
        const result = buildProviderBuiltinWebSearchConfig('openai', config)
        expect(result?.openai?.searchContextSize).toBe('high')
      })
    })
  })
})
