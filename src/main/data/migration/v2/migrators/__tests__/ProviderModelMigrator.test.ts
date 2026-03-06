import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@cherrystudio/provider-catalog'
import type { Model as LegacyModel, Provider as LegacyProvider, ProviderType as LegacyProviderType } from '@types'
import { describe, expect, it } from 'vitest'

import { type OldLlmSettings, transformModel, transformProvider } from '../mappings/ProviderModelMappings'

/** Build a minimal LegacyProvider with sensible defaults */
function makeLegacyProvider(overrides: Partial<LegacyProvider> = {}): LegacyProvider {
  return {
    id: 'test-provider',
    type: 'openai',
    name: 'Test Provider',
    apiKey: '',
    apiHost: '',
    models: [],
    ...overrides
  }
}

/** Build a minimal LegacyModel with sensible defaults */
function makeLegacyModel(overrides: Partial<LegacyModel> = {}): LegacyModel {
  return {
    id: 'test-model',
    provider: 'test-provider',
    name: 'Test Model',
    group: 'test',
    ...overrides
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// transformProvider
// ═══════════════════════════════════════════════════════════════════════════════

describe('transformProvider', () => {
  it('should transform a basic OpenAI provider', () => {
    const legacy = makeLegacyProvider({
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-test-key',
      apiHost: 'https://api.openai.com/v1',
      enabled: true
    })

    const result = transformProvider(legacy, {}, 0)

    expect(result.providerId).toBe('openai')
    expect(result.presetProviderId).toBe('openai')
    expect(result.name).toBe('OpenAI')
    expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.CHAT_COMPLETIONS)
    expect(result.isEnabled).toBe(true)
    expect(result.sortOrder).toBe(0)

    // baseUrls should map apiHost to the correct endpoint key
    expect(result.baseUrls).toEqual({
      [ENDPOINT_TYPE.CHAT_COMPLETIONS]: 'https://api.openai.com/v1'
    })

    // apiKeys should be parsed from the comma-separated string
    expect(result.apiKeys).toHaveLength(1)
    expect(result.apiKeys![0].key).toBe('sk-test-key')
    expect(result.apiKeys![0].isEnabled).toBe(true)
  })

  it('should transform an Anthropic provider with anthropicApiHost', () => {
    const legacy = makeLegacyProvider({
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      apiKey: 'sk-ant-key',
      apiHost: 'https://api.anthropic.com',
      anthropicApiHost: 'https://custom-anthropic.example.com'
    })

    const result = transformProvider(legacy, {}, 1)

    expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.MESSAGES)
    // anthropicApiHost should override the messages endpoint
    expect(result.baseUrls?.[ENDPOINT_TYPE.MESSAGES]).toBe('https://custom-anthropic.example.com')
  })

  it('should split comma-separated API keys', () => {
    const legacy = makeLegacyProvider({
      apiKey: 'key1, key2, key3'
    })

    const result = transformProvider(legacy, {}, 0)

    expect(result.apiKeys).toHaveLength(3)
    expect(result.apiKeys![0].key).toBe('key1')
    expect(result.apiKeys![1].key).toBe('key2')
    expect(result.apiKeys![2].key).toBe('key3')
    result.apiKeys!.forEach((k) => {
      expect(k.isEnabled).toBe(true)
      expect(k.id).toBeTruthy()
      expect(k.createdAt).toBeGreaterThan(0)
    })
  })

  it('should handle empty API key string', () => {
    const legacy = makeLegacyProvider({ apiKey: '' })
    const result = transformProvider(legacy, {}, 0)
    expect(result.apiKeys).toHaveLength(0)
  })

  it('should set presetProviderId for system providers', () => {
    const systemIds = ['openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'ollama']
    for (const id of systemIds) {
      const legacy = makeLegacyProvider({ id, type: 'openai' })
      const result = transformProvider(legacy, {}, 0)
      expect(result.presetProviderId).toBe(id)
    }
  })

  it('should set presetProviderId to null for custom providers', () => {
    const legacy = makeLegacyProvider({ id: 'my-custom-provider' })
    const result = transformProvider(legacy, {}, 0)
    expect(result.presetProviderId).toBeNull()
  })

  it('should set baseUrls to null when no apiHost and no endpoint mapping', () => {
    const legacy = makeLegacyProvider({
      id: 'azure-openai',
      type: 'azure-openai',
      apiHost: ''
    })
    const result = transformProvider(legacy, {}, 0)
    expect(result.baseUrls).toBeNull()
  })

  it('should default isEnabled to true when not set', () => {
    const legacy = makeLegacyProvider({ enabled: undefined })
    const result = transformProvider(legacy, {}, 0)
    expect(result.isEnabled).toBe(true)
  })

  it('should preserve isEnabled=false', () => {
    const legacy = makeLegacyProvider({ enabled: false })
    const result = transformProvider(legacy, {}, 0)
    expect(result.isEnabled).toBe(false)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // AuthConfig
  // ─────────────────────────────────────────────────────────────────────────

  describe('authConfig', () => {
    it('should build VertexAI auth from settings', () => {
      const legacy = makeLegacyProvider({
        id: 'vertexai',
        type: 'vertexai',
        isVertex: true
      })
      const settings: OldLlmSettings = {
        vertexai: {
          projectId: 'my-project',
          location: 'us-central1',
          serviceAccount: {
            privateKey: 'pk',
            clientEmail: 'sa@test.iam.gserviceaccount.com'
          }
        }
      }

      const result = transformProvider(legacy, settings, 0)

      expect(result.authConfig).toEqual({
        type: 'iam-gcp',
        project: 'my-project',
        location: 'us-central1',
        credentials: {
          privateKey: 'pk',
          clientEmail: 'sa@test.iam.gserviceaccount.com'
        }
      })
    })

    it('should build AWS Bedrock auth from settings', () => {
      const legacy = makeLegacyProvider({
        id: 'aws-bedrock',
        type: 'aws-bedrock'
      })
      const settings: OldLlmSettings = {
        awsBedrock: {
          region: 'us-east-1',
          accessKeyId: 'AKIA...',
          secretAccessKey: 'secret'
        }
      }

      const result = transformProvider(legacy, settings, 0)

      expect(result.authConfig).toEqual({
        type: 'iam-aws',
        region: 'us-east-1',
        accessKeyId: 'AKIA...',
        secretAccessKey: 'secret'
      })
    })

    it('should build Azure OpenAI auth with apiVersion', () => {
      const legacy = makeLegacyProvider({
        id: 'azure-openai',
        type: 'azure-openai',
        apiVersion: '2024-02-01'
      })

      const result = transformProvider(legacy, {}, 0)

      expect(result.authConfig).toEqual({
        type: 'iam-azure',
        apiVersion: '2024-02-01'
      })
    })

    it('should build OAuth auth config', () => {
      const legacy = makeLegacyProvider({ authType: 'oauth' })
      const result = transformProvider(legacy, {}, 0)
      expect(result.authConfig).toEqual({ type: 'oauth', clientId: '' })
    })

    it('should default to api-key auth for standard providers', () => {
      const legacy = makeLegacyProvider()
      const result = transformProvider(legacy, {}, 0)
      expect(result.authConfig).toEqual({ type: 'api-key' })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // ApiCompatibility
  // ─────────────────────────────────────────────────────────────────────────

  describe('apiCompatibility', () => {
    it('should map apiOptions correctly', () => {
      const legacy = makeLegacyProvider({
        apiOptions: {
          isNotSupportArrayContent: true,
          isNotSupportStreamOptions: false,
          isSupportDeveloperRole: true,
          isSupportServiceTier: false
        }
      })

      const result = transformProvider(legacy, {}, 0)

      expect(result.apiCompatibility).toEqual({
        arrayContent: false,
        streamOptions: true,
        developerRole: true,
        serviceTier: false
      })
    })

    it('should map deprecated top-level fields as fallback', () => {
      const legacy = makeLegacyProvider({
        isNotSupportArrayContent: true,
        isNotSupportDeveloperRole: true
      })

      const result = transformProvider(legacy, {}, 0)

      expect(result.apiCompatibility?.arrayContent).toBe(false)
      expect(result.apiCompatibility?.developerRole).toBe(false)
    })

    it('should return null when no apiOptions set', () => {
      const legacy = makeLegacyProvider()
      const result = transformProvider(legacy, {}, 0)
      expect(result.apiCompatibility).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // ProviderSettings
  // ─────────────────────────────────────────────────────────────────────────

  describe('providerSettings', () => {
    it('should migrate serviceTier', () => {
      const legacy = makeLegacyProvider({ serviceTier: 'auto' })
      const result = transformProvider(legacy, {}, 0)
      expect(result.providerSettings?.serviceTier).toBe('auto')
    })

    it('should migrate verbosity', () => {
      const legacy = makeLegacyProvider({ verbosity: 'high' })
      const result = transformProvider(legacy, {}, 0)
      expect(result.providerSettings?.verbosity).toBe('high')
    })

    it('should migrate rateLimit', () => {
      const legacy = makeLegacyProvider({ rateLimit: 5 })
      const result = transformProvider(legacy, {}, 0)
      expect(result.providerSettings?.rateLimit).toBe(5)
    })

    it('should migrate extra_headers', () => {
      const legacy = makeLegacyProvider({
        extra_headers: { 'X-Custom': 'value' }
      })
      const result = transformProvider(legacy, {}, 0)
      expect(result.providerSettings?.extraHeaders).toEqual({ 'X-Custom': 'value' })
    })

    it('should migrate anthropicCacheControl', () => {
      const legacy = makeLegacyProvider({
        anthropicCacheControl: {
          tokenThreshold: 1000,
          cacheSystemMessage: true,
          cacheLastNMessages: 5
        }
      })
      const result = transformProvider(legacy, {}, 0)
      expect(result.providerSettings?.cacheControl).toEqual({
        enabled: true,
        tokenThreshold: 1000,
        cacheSystemMessage: true,
        cacheLastNMessages: 5
      })
    })

    it('should return null when no settings present', () => {
      const legacy = makeLegacyProvider()
      const result = transformProvider(legacy, {}, 0)
      expect(result.providerSettings).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Endpoint mapping
  // ─────────────────────────────────────────────────────────────────────────

  describe('endpoint mapping', () => {
    const cases: Array<[LegacyProviderType, EndpointType]> = [
      ['openai', ENDPOINT_TYPE.CHAT_COMPLETIONS],
      ['openai-response', ENDPOINT_TYPE.RESPONSES],
      ['anthropic', ENDPOINT_TYPE.MESSAGES],
      ['gemini', ENDPOINT_TYPE.GENERATE_CONTENT],
      ['ollama', ENDPOINT_TYPE.OLLAMA_CHAT],
      ['new-api', ENDPOINT_TYPE.CHAT_COMPLETIONS],
      ['gateway', ENDPOINT_TYPE.CHAT_COMPLETIONS]
    ]

    it.each(cases)('should map provider type "%s" to endpoint %s', (type, expectedEndpoint) => {
      const legacy = makeLegacyProvider({ type: type, apiHost: 'https://api.example.com' })
      const result = transformProvider(legacy, {}, 0)
      expect(result.defaultChatEndpoint).toBe(expectedEndpoint)
      expect(result.baseUrls?.[expectedEndpoint]).toBe('https://api.example.com')
    })

    it('should return null defaultChatEndpoint for unmapped types', () => {
      const legacy = makeLegacyProvider({ type: 'azure-openai', apiHost: '' })
      const result = transformProvider(legacy, {}, 0)
      expect(result.defaultChatEndpoint).toBeNull()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// transformModel
// ═══════════════════════════════════════════════════════════════════════════════

describe('transformModel', () => {
  it('should transform a basic model', () => {
    const legacy = makeLegacyModel({
      id: 'gpt-4o',
      name: 'GPT-4o',
      group: 'openai',
      description: 'A great model'
    })

    const result = transformModel(legacy, 'openai', 3)

    expect(result.providerId).toBe('openai')
    expect(result.modelId).toBe('gpt-4o')
    expect(result.modelApiId).toBe('gpt-4o')
    expect(result.name).toBe('GPT-4o')
    expect(result.group).toBe('openai')
    expect(result.description).toBe('A great model')
    expect(result.sortOrder).toBe(3)
    expect(result.isEnabled).toBe(true)
    expect(result.isHidden).toBe(false)
    expect(result.presetModelId).toBeNull()
  })

  it('should map capabilities correctly', () => {
    const legacy = makeLegacyModel({
      capabilities: [
        { type: 'vision' },
        { type: 'reasoning' },
        { type: 'function_calling' },
        { type: 'embedding' },
        { type: 'web_search' }
      ]
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.capabilities).toEqual([
      MODEL_CAPABILITY.IMAGE_RECOGNITION,
      MODEL_CAPABILITY.REASONING,
      MODEL_CAPABILITY.FUNCTION_CALL,
      MODEL_CAPABILITY.EMBEDDING,
      MODEL_CAPABILITY.WEB_SEARCH
    ])
  })

  it('should skip "text" capability (base capability)', () => {
    const legacy = makeLegacyModel({
      capabilities: [{ type: 'text' }, { type: 'vision' }]
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.capabilities).toEqual([MODEL_CAPABILITY.IMAGE_RECOGNITION])
  })

  it('should return null capabilities when empty or absent', () => {
    expect(transformModel(makeLegacyModel({ capabilities: [] }), 'test', 0).capabilities).toBeNull()
    expect(transformModel(makeLegacyModel({ capabilities: undefined }), 'test', 0).capabilities).toBeNull()
  })

  it('should map endpoint types', () => {
    const legacy = makeLegacyModel({
      supported_endpoint_types: ['openai', 'anthropic']
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.endpointTypes).toEqual([ENDPOINT_TYPE.CHAT_COMPLETIONS, ENDPOINT_TYPE.MESSAGES])
  })

  it('should fall back to single endpoint_type when supported_endpoint_types is absent', () => {
    const legacy = makeLegacyModel({
      endpoint_type: 'gemini',
      supported_endpoint_types: undefined
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.endpointTypes).toEqual([ENDPOINT_TYPE.GENERATE_CONTENT])
  })

  it('should return null endpointTypes when none set', () => {
    const legacy = makeLegacyModel({
      endpoint_type: undefined,
      supported_endpoint_types: undefined
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.endpointTypes).toBeNull()
  })

  it('should map supported_text_delta to supportsStreaming', () => {
    expect(transformModel(makeLegacyModel({ supported_text_delta: true }), 'test', 0).supportsStreaming).toBe(true)
    expect(transformModel(makeLegacyModel({ supported_text_delta: false }), 'test', 0).supportsStreaming).toBe(false)
    expect(transformModel(makeLegacyModel({ supported_text_delta: undefined }), 'test', 0).supportsStreaming).toBeNull()
  })

  it('should set null for fields not present in legacy model', () => {
    const legacy = makeLegacyModel({
      name: '',
      description: undefined,
      group: ''
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.name).toBeNull()
    expect(result.description).toBeNull()
    expect(result.group).toBeNull()
    expect(result.contextWindow).toBeNull()
    expect(result.maxOutputTokens).toBeNull()
    expect(result.reasoning).toBeNull()
    expect(result.parameters).toBeNull()
    expect(result.inputModalities).toBeNull()
    expect(result.outputModalities).toBeNull()
  })
})
