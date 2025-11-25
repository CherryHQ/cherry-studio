import type { Provider } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { getAiSdkProviderId } from '../factory'

// Mock the external dependencies
vi.mock('@cherrystudio/ai-core', () => ({
  registerMultipleProviders: vi.fn(() => 4), // Mock successful registration of 4 providers
  getProviderMapping: vi.fn((id: string) => {
    // Mock dynamic mappings
    const mappings: Record<string, string> = {
      openrouter: 'openrouter',
      'google-vertex': 'google-vertex',
      vertexai: 'google-vertex',
      bedrock: 'bedrock',
      'aws-bedrock': 'bedrock',
      zhipu: 'zhipu'
    }
    return mappings[id]
  }),
  AiCore: {
    isSupported: vi.fn(() => true)
  }
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn(),
  getAssistantSettings: vi.fn(),
  getDefaultAssistant: vi.fn().mockReturnValue({
    id: 'default',
    name: 'Default Assistant',
    prompt: '',
    settings: {}
  })
}))

vi.mock('@renderer/store/settings', () => ({
  default: {},
  settingsSlice: {
    name: 'settings',
    reducer: vi.fn(),
    actions: {}
  }
}))

// Mock the provider configs
vi.mock('../providerConfigs', () => ({
  initializeNewProviders: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

function createTestProvider(id: string, type: string): Provider {
  return {
    id,
    type,
    name: `Test ${id}`,
    apiKey: 'test-key',
    apiHost: 'test-host'
  } as Provider
}

describe('Integrated Provider Registry', () => {
  describe('Provider ID Resolution', () => {
    it('should resolve openrouter provider correctly', () => {
      const provider = createTestProvider('openrouter', 'openrouter')
      const result = getAiSdkProviderId(provider)
      expect(result).toBe('openrouter')
    })

    it('should resolve google-vertex provider correctly', () => {
      const provider = createTestProvider('google-vertex', 'vertexai')
      const result = getAiSdkProviderId(provider)
      expect(result).toBe('google-vertex')
    })

    it('should resolve bedrock provider correctly', () => {
      const provider = createTestProvider('bedrock', 'aws-bedrock')
      const result = getAiSdkProviderId(provider)
      expect(result).toBe('bedrock')
    })

    it('should resolve zhipu provider correctly', () => {
      const provider = createTestProvider('zhipu', 'zhipu')
      const result = getAiSdkProviderId(provider)
      expect(result).toBe('zhipu')
    })

    it('should resolve provider type mapping correctly', () => {
      const provider = createTestProvider('vertex-test', 'vertexai')
      const result = getAiSdkProviderId(provider)
      expect(result).toBe('google-vertex')
    })

    it('should handle static provider mappings', () => {
      const geminiProvider = createTestProvider('gemini', 'gemini')
      const result = getAiSdkProviderId(geminiProvider)
      expect(result).toBe('google')
    })

    it('should fallback to provider.id for unknown providers', () => {
      const unknownProvider = createTestProvider('unknown-provider', 'unknown-type')
      const result = getAiSdkProviderId(unknownProvider)
      expect(result).toBe('unknown-provider')
    })
  })

  describe('Backward Compatibility', () => {
    it('should maintain compatibility with existing providers', () => {
      const grokProvider = createTestProvider('grok', 'grok')
      const result = getAiSdkProviderId(grokProvider)
      expect(result).toBe('xai')
    })
  })
})
