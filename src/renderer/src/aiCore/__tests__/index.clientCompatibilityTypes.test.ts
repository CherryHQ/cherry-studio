import { AihubmixAPIClient } from '@renderer/aiCore/clients/AihubmixAPIClient'
import { AnthropicAPIClient } from '@renderer/aiCore/clients/anthropic/AnthropicAPIClient'
import { ApiClientFactory } from '@renderer/aiCore/clients/ApiClientFactory'
import { GeminiAPIClient } from '@renderer/aiCore/clients/gemini/GeminiAPIClient'
import { VertexAPIClient } from '@renderer/aiCore/clients/gemini/VertexAPIClient'
import { NewAPIClient } from '@renderer/aiCore/clients/NewAPIClient'
import { OpenAIAPIClient } from '@renderer/aiCore/clients/openai/OpenAIApiClient'
import { OpenAIResponseAPIClient } from '@renderer/aiCore/clients/openai/OpenAIResponseAPIClient'
import { EndpointType, Model, Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/config/models', () => ({
  SYSTEM_MODELS: {
    defaultModel: [
      { id: 'gpt-4', name: 'GPT-4' },
      { id: 'gpt-4', name: 'GPT-4' },
      { id: 'gpt-4', name: 'GPT-4' }
    ],
    silicon: [],
    openai: [],
    anthropic: [],
    gemini: []
  },
  isOpenAILLMModel: vi.fn().mockReturnValue(true),
  isOpenAIChatCompletionOnlyModel: vi.fn().mockReturnValue(false),
  isAnthropicLLMModel: vi.fn().mockReturnValue(false),
  isGeminiLLMModel: vi.fn().mockReturnValue(false),
  isSupportedReasoningEffortOpenAIModel: vi.fn().mockReturnValue(false),
  isVisionModel: vi.fn().mockReturnValue(false),
  isClaudeReasoningModel: vi.fn().mockReturnValue(false),
  isReasoningModel: vi.fn().mockReturnValue(false),
  isWebSearchModel: vi.fn().mockReturnValue(false),
  findTokenLimit: vi.fn().mockReturnValue(4096),
  isFunctionCallingModel: vi.fn().mockReturnValue(false),
  DEFAULT_MAX_TOKENS: 4096
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

vi.mock('@renderer/services/FileManager', () => ({
  default: class {
    static async read() {
      return 'test content'
    }
    static async write() {
      return true
    }
  }
}))

vi.mock('@renderer/services/TokenService', () => ({
  estimateTextTokens: vi.fn().mockReturnValue(100)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      silly: vi.fn()
    })
  }
}))

// Mock additional services and hooks that might be imported
vi.mock('@renderer/hooks/useVertexAI', () => ({
  getVertexAILocation: vi.fn().mockReturnValue('us-central1'),
  getVertexAIProjectId: vi.fn().mockReturnValue('test-project'),
  getVertexAIServiceAccount: vi.fn().mockReturnValue({
    privateKey: 'test-key',
    clientEmail: 'test@example.com'
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: vi.fn().mockReturnValue({}),
  useSettings: vi.fn().mockReturnValue([{}, vi.fn()])
}))

vi.mock('@renderer/store/settings', () => ({
  default: {},
  settingsSlice: {
    name: 'settings',
    reducer: vi.fn(),
    actions: {}
  }
}))

vi.mock('@renderer/utils/abortController', () => ({
  addAbortController: vi.fn(),
  removeAbortController: vi.fn()
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('@anthropic-ai/vertex-sdk', () => ({
  default: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({})),
  AzureOpenAI: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('@google-cloud/vertexai', () => ({
  VertexAI: vi.fn().mockImplementation(() => ({}))
}))

// Mock the circular dependency between VertexAPIClient and AnthropicVertexClient
vi.mock('@renderer/aiCore/clients/anthropic/AnthropicVertexClient', () => {
  const MockAnthropicVertexClient = vi.fn()
  MockAnthropicVertexClient.prototype.getClientCompatibilityType = vi.fn().mockReturnValue(['AnthropicVertexAPIClient'])
  return {
    AnthropicVertexClient: MockAnthropicVertexClient
  }
})

// Helper to create test provider
const createTestProvider = (id: string, type: string): Provider => ({
  id,
  type: type as Provider['type'],
  name: 'Test Provider',
  apiKey: 'test-key',
  apiHost: 'https://api.test.com',
  models: []
})

// Helper to create test model
const createTestModel = (id: string, provider?: string, endpointType?: string): Model => ({
  id,
  name: 'Test Model',
  provider: provider || 'test',
  type: [],
  group: 'test',
  endpoint_type: endpointType as EndpointType
})

describe('Client Compatibility Types', () => {
  let openaiProvider: Provider
  let anthropicProvider: Provider
  let geminiProvider: Provider
  let azureProvider: Provider
  let aihubmixProvider: Provider
  let newApiProvider: Provider
  let vertexProvider: Provider

  beforeEach(() => {
    vi.clearAllMocks()

    openaiProvider = createTestProvider('openai', 'openai')
    anthropicProvider = createTestProvider('anthropic', 'anthropic')
    geminiProvider = createTestProvider('gemini', 'gemini')
    azureProvider = createTestProvider('azure-openai', 'azure-openai')
    aihubmixProvider = createTestProvider('aihubmix', 'openai')
    newApiProvider = createTestProvider('new-api', 'openai')
    vertexProvider = createTestProvider('vertex', 'vertexai')
  })

  describe('Direct API Clients', () => {
    it('should return correct compatibility type for OpenAIAPIClient', () => {
      const client = new OpenAIAPIClient(openaiProvider)
      const compatibilityTypes = client.getClientCompatibilityType()

      expect(compatibilityTypes).toEqual(['OpenAIAPIClient'])
    })

    it('should return correct compatibility type for AnthropicAPIClient', () => {
      const client = new AnthropicAPIClient(anthropicProvider)
      const compatibilityTypes = client.getClientCompatibilityType()

      expect(compatibilityTypes).toEqual(['AnthropicAPIClient'])
    })

    it('should return correct compatibility type for GeminiAPIClient', () => {
      const client = new GeminiAPIClient(geminiProvider)
      const compatibilityTypes = client.getClientCompatibilityType()

      expect(compatibilityTypes).toEqual(['GeminiAPIClient'])
    })
  })

  describe('Decorator Pattern API Clients', () => {
    it('should return OpenAIResponseAPIClient for OpenAIResponseAPIClient without model', () => {
      const client = new OpenAIResponseAPIClient(azureProvider)
      const compatibilityTypes = client.getClientCompatibilityType()

      expect(compatibilityTypes).toEqual(['OpenAIResponseAPIClient'])
    })

    it('should delegate to underlying client for OpenAIResponseAPIClient with model', () => {
      const client = new OpenAIResponseAPIClient(azureProvider)
      const testModel = createTestModel('gpt-4', 'azure-openai')

      // Get the actual client selected for this model
      const actualClient = client.getClient(testModel)
      const compatibilityTypes = actualClient.getClientCompatibilityType(testModel)

      // Should return OpenAIResponseAPIClient for non-chat-completion-only models
      expect(compatibilityTypes).toEqual(['OpenAIAPIClient'])
    })

    it('should return AihubmixAPIClient for AihubmixAPIClient without model', () => {
      const client = new AihubmixAPIClient(aihubmixProvider)
      const compatibilityTypes = client.getClientCompatibilityType()

      expect(compatibilityTypes).toEqual(['AihubmixAPIClient'])
    })

    it('should delegate to underlying client for AihubmixAPIClient with model', () => {
      const client = new AihubmixAPIClient(aihubmixProvider)
      const testModel = createTestModel('gpt-4', 'openai')

      // Get the actual client selected for this model
      const actualClient = client.getClientForModel(testModel)
      const compatibilityTypes = actualClient.getClientCompatibilityType(testModel)

      // Should return the actual underlying client type based on model (OpenAI models use OpenAIResponseAPIClient in Aihubmix)
      expect(compatibilityTypes).toEqual(['OpenAIResponseAPIClient'])
    })

    it('should return NewAPIClient for NewAPIClient without model', () => {
      const client = new NewAPIClient(newApiProvider)
      const compatibilityTypes = client.getClientCompatibilityType()

      expect(compatibilityTypes).toEqual(['NewAPIClient'])
    })

    it('should delegate to underlying client for NewAPIClient with model', () => {
      const client = new NewAPIClient(newApiProvider)
      const testModel = createTestModel('gpt-4', 'openai', 'openai-response')

      // Get the actual client selected for this model
      const actualClient = client.getClientForModel(testModel)
      const compatibilityTypes = actualClient.getClientCompatibilityType(testModel)

      // Should return the actual underlying client type based on model
      expect(compatibilityTypes).toEqual(['OpenAIResponseAPIClient'])
    })

    it('should return VertexAPIClient for VertexAPIClient without model', () => {
      const client = new VertexAPIClient(vertexProvider)
      const compatibilityTypes = client.getClientCompatibilityType()

      expect(compatibilityTypes).toEqual(['VertexAPIClient'])
    })

    it('should delegate to underlying client for VertexAPIClient with model', () => {
      const client = new VertexAPIClient(vertexProvider)
      const testModel = createTestModel('claude-3-5-sonnet', 'vertexai')

      // Get the actual client selected for this model
      const actualClient = client.getClient(testModel)
      const compatibilityTypes = actualClient.getClientCompatibilityType(testModel)

      // Should return the actual underlying client type based on model (Claude models use AnthropicVertexClient)
      expect(compatibilityTypes).toEqual(['AnthropicVertexAPIClient'])
    })
  })

  describe('Middleware Compatibility Logic', () => {
    it('should correctly identify OpenAI compatible clients', () => {
      const openaiClient = new OpenAIAPIClient(openaiProvider)
      const openaiResponseClient = new OpenAIResponseAPIClient(azureProvider)

      const openaiTypes = openaiClient.getClientCompatibilityType()
      const responseTypes = openaiResponseClient.getClientCompatibilityType()

      // Test the logic from completions method line 94
      const isOpenAICompatible = (types: string[]) =>
        types.includes('OpenAIAPIClient') || types.includes('OpenAIResponseAPIClient')

      expect(isOpenAICompatible(openaiTypes)).toBe(true)
      expect(isOpenAICompatible(responseTypes)).toBe(true)
    })

    it('should correctly identify Anthropic or OpenAIResponse compatible clients', () => {
      const anthropicClient = new AnthropicAPIClient(anthropicProvider)
      const openaiResponseClient = new OpenAIResponseAPIClient(azureProvider)
      const openaiClient = new OpenAIAPIClient(openaiProvider)

      const anthropicTypes = anthropicClient.getClientCompatibilityType()
      const responseTypes = openaiResponseClient.getClientCompatibilityType()
      const openaiTypes = openaiClient.getClientCompatibilityType()

      // Test the logic from completions method line 101
      const isAnthropicOrOpenAIResponseCompatible = (types: string[]) =>
        types.includes('AnthropicAPIClient') || types.includes('OpenAIResponseAPIClient')

      expect(isAnthropicOrOpenAIResponseCompatible(anthropicTypes)).toBe(true)
      expect(isAnthropicOrOpenAIResponseCompatible(responseTypes)).toBe(true)
      expect(isAnthropicOrOpenAIResponseCompatible(openaiTypes)).toBe(false)
    })

    it('should handle non-compatible clients correctly', () => {
      const geminiClient = new GeminiAPIClient(geminiProvider)
      const geminiTypes = geminiClient.getClientCompatibilityType()

      // Test that Gemini is not OpenAI compatible
      const isOpenAICompatible = (types: string[]) =>
        types.includes('OpenAIAPIClient') || types.includes('OpenAIResponseAPIClient')

      // Test that Gemini is not Anthropic/OpenAIResponse compatible
      const isAnthropicOrOpenAIResponseCompatible = (types: string[]) =>
        types.includes('AnthropicAPIClient') || types.includes('OpenAIResponseAPIClient')

      expect(isOpenAICompatible(geminiTypes)).toBe(false)
      expect(isAnthropicOrOpenAIResponseCompatible(geminiTypes)).toBe(false)
    })
  })

  describe('Factory Integration', () => {
    it('should return correct compatibility types for factory-created clients', () => {
      const testCases = [
        { provider: openaiProvider, expectedType: 'OpenAIAPIClient' },
        { provider: anthropicProvider, expectedType: 'AnthropicAPIClient' },
        { provider: azureProvider, expectedType: 'OpenAIResponseAPIClient' },
        { provider: aihubmixProvider, expectedType: 'AihubmixAPIClient' },
        { provider: newApiProvider, expectedType: 'NewAPIClient' },
        { provider: vertexProvider, expectedType: 'VertexAPIClient' }
      ]

      testCases.forEach(({ provider, expectedType }) => {
        const client = ApiClientFactory.create(provider)
        const compatibilityTypes = client.getClientCompatibilityType()

        expect(compatibilityTypes).toContain(expectedType)
      })
    })
  })
})
