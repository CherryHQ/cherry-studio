import { ENDPOINT_TYPE, type EndpointType, MODEL_CAPABILITY, normalizeModelId } from '@cherrystudio/provider-catalog'
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
    expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(result.isEnabled).toBe(true)
    expect(result.sortOrder).toBe(0)

    // baseUrls should map apiHost to the correct endpoint key
    expect(result.baseUrls).toEqual({
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'https://api.openai.com/v1'
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

    expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    // anthropicApiHost should override the messages endpoint
    expect(result.baseUrls?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).toBe('https://custom-anthropic.example.com')
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

    it('should build CherryIn OAuth auth from settings', () => {
      const legacy = makeLegacyProvider({
        id: 'cherryin',
        type: 'openai'
      })
      const settings: OldLlmSettings = {
        cherryIn: {
          accessToken: 'at-123',
          refreshToken: 'rt-456'
        }
      }

      const result = transformProvider(legacy, settings, 0)

      expect(result.authConfig).toEqual({
        type: 'oauth',
        clientId: '',
        accessToken: 'at-123',
        refreshToken: 'rt-456'
      })
    })

    it('should not set OAuth for cherryin without tokens', () => {
      const legacy = makeLegacyProvider({ id: 'cherryin', type: 'openai' })
      const result = transformProvider(legacy, {}, 0)
      expect(result.authConfig).toEqual({ type: 'api-key' })
    })

    it('should default to api-key auth for standard providers', () => {
      const legacy = makeLegacyProvider()
      const result = transformProvider(legacy, {}, 0)
      expect(result.authConfig).toEqual({ type: 'api-key' })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // ApiFeatures
  // ─────────────────────────────────────────────────────────────────────────

  describe('apiFeatures', () => {
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

      expect(result.apiFeatures).toEqual({
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

      expect(result.apiFeatures?.arrayContent).toBe(false)
      expect(result.apiFeatures?.developerRole).toBe(false)
    })

    it('should map isNotSupportEnableThinking to enableThinking (inverted)', () => {
      const legacy = makeLegacyProvider({
        apiOptions: { isNotSupportEnableThinking: true }
      })
      const result = transformProvider(legacy, {}, 0)
      expect(result.apiFeatures?.enableThinking).toBe(false)
    })

    it('should map isNotSupportVerbosity to verbosity (inverted)', () => {
      const legacy = makeLegacyProvider({
        apiOptions: { isNotSupportVerbosity: true }
      })
      const result = transformProvider(legacy, {}, 0)
      expect(result.apiFeatures?.verbosity).toBe(false)
    })

    it('should return null when no apiOptions set', () => {
      const legacy = makeLegacyProvider()
      const result = transformProvider(legacy, {}, 0)
      expect(result.apiFeatures).toBeNull()
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

    it('should migrate notes', () => {
      const legacy = makeLegacyProvider({ notes: 'My custom provider notes' })
      const result = transformProvider(legacy, {}, 0)
      expect(result.providerSettings?.notes).toBe('My custom provider notes')
    })

    it('should return null when no settings present', () => {
      const legacy = makeLegacyProvider()
      const result = transformProvider(legacy, {}, 0)
      expect(result.providerSettings).toBeNull()
    })

    it('should migrate ollama keepAliveTime from llm.settings', () => {
      const legacy = makeLegacyProvider({ id: 'ollama', type: 'ollama' })
      const settings: OldLlmSettings = { ollama: { keepAliveTime: 3600 } }
      const result = transformProvider(legacy, settings, 0)
      expect(result.providerSettings?.keepAliveTime).toBe(3600)
    })

    it('should migrate lmstudio keepAliveTime from llm.settings', () => {
      const legacy = makeLegacyProvider({ id: 'lmstudio' })
      const settings: OldLlmSettings = { lmstudio: { keepAliveTime: 1800 } }
      const result = transformProvider(legacy, settings, 0)
      expect(result.providerSettings?.keepAliveTime).toBe(1800)
    })

    it('should migrate gpustack keepAliveTime from llm.settings', () => {
      const legacy = makeLegacyProvider({ id: 'gpustack' })
      const settings: OldLlmSettings = { gpustack: { keepAliveTime: 7200 } }
      const result = transformProvider(legacy, settings, 0)
      expect(result.providerSettings?.keepAliveTime).toBe(7200)
    })

    it('should not set keepAliveTime for non-local providers', () => {
      const legacy = makeLegacyProvider({ id: 'openai', type: 'openai' })
      const settings: OldLlmSettings = { ollama: { keepAliveTime: 3600 } }
      const result = transformProvider(legacy, settings, 0)
      expect(result.providerSettings).toBeNull()
    })

    it('should not set keepAliveTime when value is 0', () => {
      const legacy = makeLegacyProvider({ id: 'ollama', type: 'ollama' })
      const settings: OldLlmSettings = { ollama: { keepAliveTime: 0 } }
      const result = transformProvider(legacy, settings, 0)
      // 0 is a valid value (keepAliveTime: 0 means don't keep alive)
      expect(result.providerSettings?.keepAliveTime).toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // reasoningFormatType
  // ─────────────────────────────────────────────────────────────────────────

  describe('reasoningFormatType', () => {
    const cases: Array<[string, string]> = [
      ['openai', 'openai-chat'],
      ['openai-response', 'openai-responses'],
      ['anthropic', 'anthropic'],
      ['gemini', 'gemini'],
      ['new-api', 'openai-chat'],
      ['gateway', 'openai-chat'],
      ['ollama', 'openai-chat']
    ]

    it.each(cases)('should map provider type "%s" to reasoningFormatType "%s"', (type, expected) => {
      const legacy = makeLegacyProvider({ type: type as LegacyProviderType })
      const result = transformProvider(legacy, {}, 0)
      expect(result.reasoningFormatType).toBe(expected)
    })

    it('should return null for unmapped provider types', () => {
      const unmapped = ['azure-openai', 'vertexai', 'aws-bedrock', 'mistral'] as LegacyProviderType[]
      for (const type of unmapped) {
        const legacy = makeLegacyProvider({ type })
        const result = transformProvider(legacy, {}, 0)
        expect(result.reasoningFormatType).toBeNull()
      }
    })

    it('should return null for custom providers with unknown type', () => {
      const legacy = makeLegacyProvider({ id: 'my-custom', type: 'unknown-type' as LegacyProviderType })
      const result = transformProvider(legacy, {}, 0)
      expect(result.reasoningFormatType).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Endpoint mapping
  // ─────────────────────────────────────────────────────────────────────────

  describe('endpoint mapping', () => {
    const cases: Array<[LegacyProviderType, EndpointType]> = [
      ['openai', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      ['openai-response', ENDPOINT_TYPE.OPENAI_RESPONSES],
      ['anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
      ['gemini', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT],
      ['ollama', ENDPOINT_TYPE.OLLAMA_CHAT],
      ['new-api', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      ['gateway', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
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
    expect(result.presetModelId).toBe('gpt-4o')
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

    expect(result.endpointTypes).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES])
  })

  it('should fall back to single endpoint_type when supported_endpoint_types is absent', () => {
    const legacy = makeLegacyModel({
      endpoint_type: 'gemini',
      supported_endpoint_types: undefined
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.endpointTypes).toEqual([ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT])
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

  // ─────────────────────────────────────────────────────────────────────────
  // isUserSelected → userOverrides
  // ─────────────────────────────────────────────────────────────────────────

  it('should set userOverrides to ["capabilities"] when any capability has isUserSelected: true', () => {
    const legacy = makeLegacyModel({
      capabilities: [{ type: 'vision', isUserSelected: true }, { type: 'reasoning' }]
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.userOverrides).toEqual(['capabilities'])
  })

  it('should set userOverrides to ["capabilities"] when any capability has isUserSelected: false', () => {
    const legacy = makeLegacyModel({
      capabilities: [{ type: 'vision', isUserSelected: false }, { type: 'reasoning' }]
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.userOverrides).toEqual(['capabilities'])
  })

  it('should set userOverrides to null when no capabilities have isUserSelected', () => {
    const legacy = makeLegacyModel({
      capabilities: [{ type: 'vision' }, { type: 'reasoning' }]
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.userOverrides).toBeNull()
  })

  it('should set userOverrides to null when capabilities are absent', () => {
    const legacy = makeLegacyModel({ capabilities: undefined })

    const result = transformModel(legacy, 'test', 0)

    expect(result.userOverrides).toBeNull()
  })

  it('should map pricing correctly', () => {
    const legacy = makeLegacyModel({
      pricing: {
        input_per_million_tokens: 2.5,
        output_per_million_tokens: 10
      }
    })

    const result = transformModel(legacy, 'test', 0)

    expect(result.pricing).toEqual({
      input: { perMillionTokens: 2.5 },
      output: { perMillionTokens: 10 }
    })
  })

  it('should return null pricing when not set', () => {
    const legacy = makeLegacyModel({ pricing: undefined })
    const result = transformModel(legacy, 'test', 0)
    expect(result.pricing).toBeNull()
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

// ═══════════════════════════════════════════════════════════════════════════════
// Column consistency: modelId / modelApiId / presetModelId
// ═══════════════════════════════════════════════════════════════════════════════

describe('transformModel column consistency', () => {
  it('should use legacy.id as both modelId (PK) and modelApiId', () => {
    const legacy = makeLegacyModel({ id: 'agent/deepseek-v3.1-terminus' })
    const result = transformModel(legacy, 'silicon', 0)

    expect(result.modelId).toBe('agent/deepseek-v3.1-terminus')
    expect(result.modelApiId).toBe('agent/deepseek-v3.1-terminus')
  })

  it('should set presetModelId via normalizeModelId for catalog matching', () => {
    const legacy = makeLegacyModel({ id: 'gpt-4o' })
    const result = transformModel(legacy, 'openai', 0)

    expect(result.presetModelId).toBe(normalizeModelId('gpt-4o'))
  })

  // ─────────────────────────────────────────────────────────────────────────
  // presetModelId normalization patterns
  // ─────────────────────────────────────────────────────────────────────────

  describe('presetModelId normalization', () => {
    it('should strip provider/aggregator prefix from modelId', () => {
      const legacy = makeLegacyModel({ id: 'openai/gpt-4o' })
      const result = transformModel(legacy, 'openai', 0)

      expect(result.modelId).toBe('openai/gpt-4o')
      expect(result.presetModelId).toBe('gpt-4o')
    })

    it('should strip variant suffix like (free)', () => {
      const legacy = makeLegacyModel({ id: 'agent/deepseek-v3(free)' })
      const result = transformModel(legacy, 'silicon', 0)

      expect(result.modelId).toBe('agent/deepseek-v3(free)')
      expect(result.presetModelId).toBe(normalizeModelId('agent/deepseek-v3(free)'))
    })

    it('should normalize version separators (dots to dashes)', () => {
      const legacy = makeLegacyModel({ id: 'gpt-3.5-turbo' })
      const result = transformModel(legacy, 'openai', 0)

      expect(result.modelId).toBe('gpt-3.5-turbo')
      expect(result.presetModelId).toBe(normalizeModelId('gpt-3.5-turbo'))
    })

    it('should strip parameter size like -72b', () => {
      const legacy = makeLegacyModel({ id: 'qwen3-coder-30b-a3b-instruct' })
      const result = transformModel(legacy, 'alibaba', 0)

      expect(result.modelId).toBe('qwen3-coder-30b-a3b-instruct')
      expect(result.presetModelId).toBe(normalizeModelId('qwen3-coder-30b-a3b-instruct'))
    })

    it('should handle combined normalization (prefix + suffix + version)', () => {
      const legacy = makeLegacyModel({ id: 'agent/glm-4.6(free)' })
      const result = transformModel(legacy, 'silicon', 0)

      expect(result.modelId).toBe('agent/glm-4.6(free)')
      expect(result.presetModelId).toBe(normalizeModelId('agent/glm-4.6(free)'))
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Variant models: same presetModelId, different modelId (no PK conflict)
  // ─────────────────────────────────────────────────────────────────────────

  describe('variant models share presetModelId but have unique modelId', () => {
    it('base and (free) variant should have different modelId but same presetModelId', () => {
      const base = transformModel(makeLegacyModel({ id: 'agent/deepseek-v3.1-terminus' }), 'silicon', 0)
      const free = transformModel(makeLegacyModel({ id: 'agent/deepseek-v3.1-terminus(free)' }), 'silicon', 1)

      // PK (modelId) is unique — no collision
      expect(base.modelId).toBe('agent/deepseek-v3.1-terminus')
      expect(free.modelId).toBe('agent/deepseek-v3.1-terminus(free)')
      expect(base.modelId).not.toBe(free.modelId)

      // presetModelId matches — both link to same catalog preset
      expect(base.presetModelId).toBe(free.presetModelId)
    })

    it('base and -thinking variant should have different modelId but same presetModelId', () => {
      const base = transformModel(makeLegacyModel({ id: 'agent/kimi-k2' }), 'silicon', 0)
      const thinking = transformModel(makeLegacyModel({ id: 'agent/kimi-k2-thinking' }), 'silicon', 1)

      expect(base.modelId).not.toBe(thinking.modelId)
      expect(base.presetModelId).toBe(thinking.presetModelId)
    })

    it('multiple (free) variants of same base model all have unique modelId for PK', () => {
      const variants = ['agent/glm-4.6', 'agent/glm-4.6(free)']

      const results = variants.map((id, idx) => transformModel(makeLegacyModel({ id }), 'silicon', idx))

      // All modelIds are unique (safe for composite PK)
      const modelIds = results.map((r) => r.modelId)
      expect(new Set(modelIds).size).toBe(variants.length)

      // All presetModelIds converge to same normalized form
      const presetIds = new Set(results.map((r) => r.presetModelId))
      expect(presetIds.size).toBe(1)
    })

    it('-thinking variants may normalize separately from base depending on normalizeModelId rules', () => {
      const base = transformModel(makeLegacyModel({ id: 'agent/glm-4.6' }), 'silicon', 0)
      const thinking = transformModel(makeLegacyModel({ id: 'agent/glm-4.6-thinking' }), 'silicon', 1)
      const thinkingFree = transformModel(makeLegacyModel({ id: 'agent/glm-4.6-thinking(free)' }), 'silicon', 2)

      // All modelIds are unique for PK
      expect(new Set([base.modelId, thinking.modelId, thinkingFree.modelId]).size).toBe(3)

      // Normalization behavior matches normalizeModelId
      expect(base.presetModelId).toBe(normalizeModelId('agent/glm-4.6'))
      expect(thinking.presetModelId).toBe(normalizeModelId('agent/glm-4.6-thinking'))
      expect(thinkingFree.presetModelId).toBe(normalizeModelId('agent/glm-4.6-thinking(free)'))
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Model deduplication in ProviderModelMigrator
// ═══════════════════════════════════════════════════════════════════════════════

describe('model deduplication', () => {
  /**
   * Simulates the deduplication logic from ProviderModelMigrator.execute().
   * Extracted here so we can unit-test without needing a real DB transaction.
   */
  function deduplicateModels(models: LegacyModel[], providerId: string) {
    const seen = new Set<string>()
    const result: ReturnType<typeof transformModel>[] = []
    for (let idx = 0; idx < models.length; idx++) {
      const m = models[idx]
      if (seen.has(m.id)) continue
      seen.add(m.id)
      result.push(transformModel(m, providerId, idx))
    }
    return result
  }

  it('should keep only the first occurrence when duplicate model IDs exist', () => {
    const models = [
      makeLegacyModel({ id: 'gpt-4o', name: 'GPT-4o (first)' }),
      makeLegacyModel({ id: 'gpt-4o', name: 'GPT-4o (duplicate)' }),
      makeLegacyModel({ id: 'gpt-4o-mini', name: 'GPT-4o Mini' })
    ]

    const result = deduplicateModels(models, 'openai')

    expect(result).toHaveLength(2)
    expect(result[0].modelId).toBe('gpt-4o')
    expect(result[0].name).toBe('GPT-4o (first)')
    expect(result[1].modelId).toBe('gpt-4o-mini')
  })

  it('should not deduplicate models that only share presetModelId but have different modelId', () => {
    const models = [
      makeLegacyModel({ id: 'agent/deepseek-v3(free)', name: 'Free' }),
      makeLegacyModel({ id: 'agent/deepseek-v3', name: 'Paid' })
    ]

    const result = deduplicateModels(models, 'silicon')

    // Both should be kept — different modelId (PK), even though presetModelId is same
    expect(result).toHaveLength(2)
    expect(result[0].modelId).toBe('agent/deepseek-v3(free)')
    expect(result[1].modelId).toBe('agent/deepseek-v3')
    expect(result[0].presetModelId).toBe(result[1].presetModelId)
  })

  it('should handle all unique models without dropping any', () => {
    const models = [
      makeLegacyModel({ id: 'claude-3-opus' }),
      makeLegacyModel({ id: 'claude-3-sonnet' }),
      makeLegacyModel({ id: 'claude-3-haiku' })
    ]

    const result = deduplicateModels(models, 'anthropic')

    expect(result).toHaveLength(3)
  })

  it('should handle empty model list', () => {
    const result = deduplicateModels([], 'openai')
    expect(result).toHaveLength(0)
  })

  it('should handle multiple duplicates across the list', () => {
    const models = [
      makeLegacyModel({ id: 'model-a', name: 'A1' }),
      makeLegacyModel({ id: 'model-b', name: 'B1' }),
      makeLegacyModel({ id: 'model-a', name: 'A2' }),
      makeLegacyModel({ id: 'model-c', name: 'C1' }),
      makeLegacyModel({ id: 'model-b', name: 'B2' }),
      makeLegacyModel({ id: 'model-a', name: 'A3' })
    ]

    const result = deduplicateModels(models, 'test')

    expect(result).toHaveLength(3)
    expect(result.map((r) => r.modelId)).toEqual(['model-a', 'model-b', 'model-c'])
    // First occurrence is kept
    expect(result[0].name).toBe('A1')
    expect(result[1].name).toBe('B1')
    expect(result[2].name).toBe('C1')
  })

  it('should preserve sortOrder from original index position', () => {
    const models = [
      makeLegacyModel({ id: 'model-a' }),
      makeLegacyModel({ id: 'model-dup' }),
      makeLegacyModel({ id: 'model-b' }),
      makeLegacyModel({ id: 'model-dup' }) // duplicate, skipped
    ]

    const result = deduplicateModels(models, 'test')

    expect(result).toHaveLength(3)
    expect(result[0].sortOrder).toBe(0)
    expect(result[1].sortOrder).toBe(1)
    expect(result[2].sortOrder).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// User data + catalog preset merge scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe('user data and catalog preset merge scenarios', () => {
  it('user-migrated provider preserves apiKeys while catalog fills websites via batchUpsert', () => {
    // Step 1: User migration creates provider with apiKeys, no websites
    const userProvider = transformProvider(
      makeLegacyProvider({
        id: 'openai',
        type: 'openai',
        apiKey: 'sk-user-key',
        apiHost: 'https://api.openai.com/v1'
      }),
      {},
      0
    )

    expect(userProvider.apiKeys).toHaveLength(1)
    expect(userProvider.apiKeys![0].key).toBe('sk-user-key')
    // Migration doesn't set websites (comes from catalog)
    expect(userProvider.websites).toBeUndefined()
  })

  it('user model gets presetModelId for catalog matching while keeping original API id', () => {
    // A model from an aggregator provider like Silicon Flow
    const userModel = transformModel(
      makeLegacyModel({
        id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
        name: 'Qwen3 Coder 30B'
      }),
      'silicon',
      0
    )

    // modelId (PK) and modelApiId both preserve the original ID for API calls
    expect(userModel.modelId).toBe('Qwen/Qwen3-Coder-30B-A3B-Instruct')
    expect(userModel.modelApiId).toBe('Qwen/Qwen3-Coder-30B-A3B-Instruct')

    // presetModelId is normalized for catalog lookup
    expect(userModel.presetModelId).toBe(normalizeModelId('Qwen/Qwen3-Coder-30B-A3B-Instruct'))
  })

  it('custom provider gets null presetProviderId and models still get presetModelId', () => {
    const customProvider = transformProvider(
      makeLegacyProvider({
        id: 'my-custom-llm',
        type: 'openai',
        apiKey: 'sk-custom'
      }),
      {},
      0
    )

    expect(customProvider.presetProviderId).toBeNull()

    // Even custom provider models get presetModelId for potential catalog matching
    const customModel = transformModel(makeLegacyModel({ id: 'my-fine-tuned-gpt-4o' }), 'my-custom-llm', 0)

    expect(customModel.presetModelId).toBe(normalizeModelId('my-fine-tuned-gpt-4o'))
  })

  it('provider with multiple model variants migrates all without PK conflict', () => {
    const provider = makeLegacyProvider({
      id: 'silicon',
      type: 'openai',
      models: [
        makeLegacyModel({ id: 'agent/deepseek-v3', name: 'DeepSeek V3' }),
        makeLegacyModel({ id: 'agent/deepseek-v3(free)', name: 'DeepSeek V3 (Free)' }),
        makeLegacyModel({ id: 'agent/kimi-k2', name: 'Kimi K2' }),
        makeLegacyModel({ id: 'agent/kimi-k2-thinking', name: 'Kimi K2 Thinking' }),
        makeLegacyModel({ id: 'agent/glm-4.6', name: 'GLM 4.6' }),
        makeLegacyModel({ id: 'agent/glm-4.6(free)', name: 'GLM 4.6 (Free)' })
      ]
    })

    const models = provider.models!.map((m, idx) => transformModel(m, provider.id, idx))

    // All modelIds are unique — safe for composite PK (providerId, modelId)
    const modelIds = models.map((m) => m.modelId)
    expect(new Set(modelIds).size).toBe(6)

    // Variant pairs share the same presetModelId for catalog matching
    const deepseekPresets = models.filter((m) => m.modelId.includes('deepseek-v3')).map((m) => m.presetModelId)
    expect(new Set(deepseekPresets).size).toBe(1)

    const kimiPresets = models.filter((m) => m.modelId.includes('kimi-k2')).map((m) => m.presetModelId)
    expect(new Set(kimiPresets).size).toBe(1)

    const glmPresets = models.filter((m) => m.modelId.includes('glm-4')).map((m) => m.presetModelId)
    expect(new Set(glmPresets).size).toBe(1)
  })

  it('provider with duplicate models in legacy data migrates safely after dedup', () => {
    const provider = makeLegacyProvider({
      id: 'openai',
      type: 'openai',
      models: [
        makeLegacyModel({ id: 'gpt-4o', name: 'GPT-4o' }),
        makeLegacyModel({ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }),
        makeLegacyModel({ id: 'gpt-4o', name: 'GPT-4o (stale duplicate)' }) // duplicate
      ]
    })

    // Simulate dedup logic from ProviderModelMigrator
    const seen = new Set<string>()
    const dedupedModels: ReturnType<typeof transformModel>[] = []
    for (let idx = 0; idx < provider.models!.length; idx++) {
      const m = provider.models![idx]
      if (seen.has(m.id)) continue
      seen.add(m.id)
      dedupedModels.push(transformModel(m, provider.id, idx))
    }

    expect(dedupedModels).toHaveLength(2)
    expect(dedupedModels[0].name).toBe('GPT-4o')
    expect(dedupedModels[1].name).toBe('GPT-4o Mini')

    // All modelIds unique for PK
    const ids = new Set(dedupedModels.map((m) => m.modelId))
    expect(ids.size).toBe(2)
  })
})
