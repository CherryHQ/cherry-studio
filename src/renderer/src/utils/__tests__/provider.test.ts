import { OpenAIServiceTiers, Provider, SystemProvider } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { cleanupProviders } from '../provider'

// Mock the config to avoid dependency issues in tests
vi.mock('@renderer/config/providers', () => ({
  SYSTEM_PROVIDERS_CONFIG: {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      type: 'openai-response',
      apiKey: '',
      apiHost: 'https://api.openai.com',
      models: [],
      isSystem: true,
      enabled: false,
      serviceTier: 'auto'
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'anthropic',
      apiKey: '',
      apiHost: 'https://api.anthropic.com/',
      models: [],
      isSystem: true,
      enabled: false
    }
  }
}))

// Mock SystemProviderIds to avoid dependency issues
vi.mock('@renderer/types', async () => {
  const actual = await vi.importActual('@renderer/types')
  return {
    ...actual,
    SystemProviderIds: {
      openai: 'openai',
      anthropic: 'anthropic'
    }
  }
})

// Mock system providers for testing
const mockSystemProvider1: SystemProvider = {
  id: 'openai',
  name: 'OpenAI',
  type: 'openai-response',
  apiKey: '',
  apiHost: 'https://api.openai.com',
  models: [],
  isSystem: true,
  enabled: false,
  serviceTier: OpenAIServiceTiers.auto
}

const mockSystemProvider2: SystemProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  type: 'anthropic',
  apiKey: '',
  apiHost: 'https://api.anthropic.com/',
  models: [],
  isSystem: true,
  enabled: false
}

const mockCustomProvider: Provider = {
  id: 'custom-provider',
  name: 'Custom Provider',
  type: 'openai',
  apiKey: 'custom-key',
  apiHost: 'https://custom.com',
  models: [],
  enabled: true
}

describe('cleanupProviders', () => {
  it('should return original providers when no duplicates or missing providers', () => {
    const providers = [mockCustomProvider]
    const result = cleanupProviders(providers)

    expect(result.cleanedProviders).toHaveLength(3) // 1 custom + 2 mocked system providers
    expect(result.hasChanges).toBe(true) // Should be true because missing system providers were added
  })

  it('should remove duplicate providers', () => {
    const duplicate1 = { ...mockSystemProvider1, apiKey: '' }
    const duplicate2 = { ...mockSystemProvider1, apiKey: 'test-key' }
    const providers = [duplicate1, duplicate2]

    const result = cleanupProviders(providers)

    // Should keep the one with apiKey
    const openaiProvider = result.cleanedProviders.find((p) => p.id === 'openai')
    expect(openaiProvider?.apiKey).toBe('test-key')
    expect(result.hasChanges).toBe(true)
  })

  it('should prefer enabled provider when both have empty apiKey', () => {
    const duplicate1 = { ...mockSystemProvider1, apiKey: '', enabled: false }
    const duplicate2 = { ...mockSystemProvider1, apiKey: '', enabled: true }
    const providers = [duplicate1, duplicate2]

    const result = cleanupProviders(providers)

    const openaiProvider = result.cleanedProviders.find((p) => p.id === 'openai')
    expect(openaiProvider?.enabled).toBe(true)
    expect(result.hasChanges).toBe(true)
  })

  it('should keep first occurrence when both have same priority', () => {
    const duplicate1 = { ...mockSystemProvider1, apiKey: '', enabled: false, name: 'First' }
    const duplicate2 = { ...mockSystemProvider1, apiKey: '', enabled: false, name: 'Second' }
    const providers = [duplicate1, duplicate2]

    const result = cleanupProviders(providers)

    const openaiProvider = result.cleanedProviders.find((p) => p.id === 'openai')
    expect(openaiProvider?.name).toBe('First')
    expect(result.hasChanges).toBe(true)
  })

  it('should add missing system providers', () => {
    const providers: Provider[] = []
    const result = cleanupProviders(providers)

    expect(result.cleanedProviders.length).toBe(2) // 2 mocked system providers
    expect(result.hasChanges).toBe(true)
  })

  it('should preserve custom providers', () => {
    const providers = [mockCustomProvider]
    const result = cleanupProviders(providers)

    const customProvider = result.cleanedProviders.find((p) => p.id === 'custom-provider')
    expect(customProvider).toEqual(mockCustomProvider)
    expect(result.hasChanges).toBe(true) // Because system providers were added
  })

  it('should handle mixed duplicates correctly', () => {
    const systemDuplicate1 = { ...mockSystemProvider1, apiKey: '', enabled: false }
    const systemDuplicate2 = { ...mockSystemProvider1, apiKey: 'test-key', enabled: false }
    const systemDuplicate3 = { ...mockSystemProvider2, apiKey: '', enabled: true }
    const systemDuplicate4 = { ...mockSystemProvider2, apiKey: '', enabled: false }

    const providers = [mockCustomProvider, systemDuplicate1, systemDuplicate2, systemDuplicate3, systemDuplicate4]

    const result = cleanupProviders(providers)

    // Should keep custom provider
    expect(result.cleanedProviders.find((p) => p.id === 'custom-provider')).toEqual(mockCustomProvider)

    // Should keep system provider with apiKey
    const openaiProvider = result.cleanedProviders.find((p) => p.id === 'openai')
    expect(openaiProvider?.apiKey).toBe('test-key')

    // Should keep enabled system provider
    const anthropicProvider = result.cleanedProviders.find((p) => p.id === 'anthropic')
    expect(anthropicProvider?.enabled).toBe(true)

    expect(result.hasChanges).toBe(true)
  })

  it('should handle non-system provider duplicates', () => {
    const custom1 = { ...mockCustomProvider, name: 'First Custom' }
    const custom2 = { ...mockCustomProvider, name: 'Second Custom' }
    const providers = [custom1, custom2]

    const result = cleanupProviders(providers)

    // Should keep first occurrence of custom provider
    const customProvider = result.cleanedProviders.find((p) => p.id === 'custom-provider')
    expect(customProvider?.name).toBe('First Custom')
    expect(result.hasChanges).toBe(true)
  })

  it('should return hasChanges false when no changes needed', () => {
    const providers = [mockSystemProvider1, mockSystemProvider2]

    const result = cleanupProviders(providers)

    expect(result.hasChanges).toBe(false)
    expect(result.cleanedProviders).toHaveLength(2)
  })

  it('should prioritize apiKey over enabled status', () => {
    const duplicate1 = { ...mockSystemProvider1, apiKey: '', enabled: true }
    const duplicate2 = { ...mockSystemProvider1, apiKey: 'test-key', enabled: false }
    const providers = [duplicate1, duplicate2]

    const result = cleanupProviders(providers)

    const openaiProvider = result.cleanedProviders.find((p) => p.id === 'openai')
    expect(openaiProvider?.apiKey).toBe('test-key')
    expect(openaiProvider?.enabled).toBe(false)
    expect(result.hasChanges).toBe(true)
  })
})
