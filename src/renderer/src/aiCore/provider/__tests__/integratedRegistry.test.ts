import type { Model, Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAiSdkProvider, getAiSdkProviderId } from '../factory'

// Mock the external dependencies
const mockCreateProviderCore = vi.fn().mockResolvedValue({ id: 'mock-provider' })

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

vi.mock('@cherrystudio/ai-core/provider', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createProvider: (...args: unknown[]) => mockCreateProviderCore(...args)
  }
})

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
      debug: vi.fn(),
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

function createAzureProvider(id: string, apiVersion?: string, model?: string): Provider {
  return {
    id,
    type: 'azure-openai',
    name: `Azure Test ${id}`,
    apiKey: 'azure-test-key',
    apiHost: 'azure-test-host',
    apiVersion,
    models: [{ id: model || 'gpt-4' } as Model]
  }
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

    it('should handle Azure OpenAI providers with dated API version correctly', () => {
      const azureProvider = createAzureProvider('azure-test', '2024-02-15', 'gpt-4o')
      const result = getAiSdkProviderId(azureProvider)
      expect(result).toBe('azure-chat')
    })

    it('should handle Azure OpenAI providers response endpoint correctly', () => {
      const azureProvider = createAzureProvider('azure-test', 'v1', 'gpt-4o')
      const result = getAiSdkProviderId(azureProvider)
      expect(result).toBe('azure')
    })

    it('should handle Azure provider Claude Models', () => {
      const provider = createTestProvider('azure-anthropic', 'anthropic')
      const result = getAiSdkProviderId(provider)
      expect(result).toBe('azure-anthropic')
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

describe('createAiSdkProvider providerId redirection', () => {
  beforeEach(() => {
    mockCreateProviderCore.mockClear()
    mockCreateProviderCore.mockResolvedValue({ id: 'mock-provider' })
  })

  it('should keep azure providerId when mode is responses', async () => {
    await createAiSdkProvider({
      providerId: 'azure',
      options: { mode: 'responses', apiKey: 'test', baseURL: 'https://test.openai.azure.com' }
    })

    expect(mockCreateProviderCore).toHaveBeenCalledWith('azure', expect.objectContaining({ mode: 'responses' }))
  })

  it('should redirect azure with mode chat to azure-chat', async () => {
    await createAiSdkProvider({
      providerId: 'azure',
      options: { mode: 'chat', apiKey: 'test', baseURL: 'https://test.openai.azure.com' }
    })

    expect(mockCreateProviderCore).toHaveBeenCalledWith('azure-chat', expect.objectContaining({ mode: 'chat' }))
  })

  it('should pass azure-chat providerId through without redirection', async () => {
    await createAiSdkProvider({
      providerId: 'azure-chat',
      options: { mode: 'chat', apiKey: 'test', baseURL: 'https://test.openai.azure.com' }
    })

    expect(mockCreateProviderCore).toHaveBeenCalledWith('azure-chat', expect.objectContaining({ mode: 'chat' }))
  })

  it('should redirect openai with mode chat to openai-chat', async () => {
    await createAiSdkProvider({
      providerId: 'openai',
      options: { mode: 'chat', apiKey: 'test', baseURL: 'https://api.openai.com' }
    })

    expect(mockCreateProviderCore).toHaveBeenCalledWith('openai-chat', expect.objectContaining({ mode: 'chat' }))
  })

  it('should redirect cherryin with mode chat to cherryin-chat', async () => {
    await createAiSdkProvider({
      providerId: 'cherryin',
      options: { mode: 'chat', apiKey: 'test', baseURL: 'https://api.cherryin.com' }
    })

    expect(mockCreateProviderCore).toHaveBeenCalledWith('cherryin-chat', expect.objectContaining({ mode: 'chat' }))
  })
})
