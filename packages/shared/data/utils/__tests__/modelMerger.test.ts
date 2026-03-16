import type { ProtoModelConfig, ProtoProviderConfig, ProtoProviderModelOverride } from '@cherrystudio/provider-catalog'
import { ENDPOINT_TYPE, MODALITY, MODEL_CAPABILITY } from '@cherrystudio/provider-catalog'
import { describe, expect, it } from 'vitest'

import {
  applyCapabilityOverride,
  DEFAULT_API_FEATURES,
  mergeModelConfig,
  mergeProviderConfig
} from '../modelMerger'

// ═══════════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Proto Message<T> types require $typeName which can't be set from plain objects.
 * All fixture factories accept Record<string, unknown> and cast through unknown.
 */

function makePresetModel(overrides: Record<string, unknown> & { id: string }): ProtoModelConfig {
  return {
    capabilities: [],
    inputModalities: [],
    outputModalities: [],
    alias: [],
    ...overrides
  } as unknown as ProtoModelConfig
}

function makeCatalogOverride(
  overrides: Record<string, unknown> & { providerId: string; modelId: string }
): ProtoProviderModelOverride {
  return {
    priority: 0,
    endpointTypes: [],
    inputModalities: [],
    outputModalities: [],
    ...overrides
  } as unknown as ProtoProviderModelOverride
}

function makePresetProvider(
  overrides: Record<string, unknown> & { id: string; name: string }
): ProtoProviderConfig {
  return {
    baseUrls: {},
    ...overrides
  } as unknown as ProtoProviderConfig
}

function makeUserModelRow(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'test-provider',
    modelId: 'test-model',
    presetModelId: 'test-model',
    name: null,
    description: null,
    group: null,
    capabilities: null,
    inputModalities: null,
    outputModalities: null,
    endpointTypes: null,
    customEndpointUrl: null,
    contextWindow: null,
    maxOutputTokens: null,
    supportsStreaming: null,
    reasoning: null,
    parameterSupport: null,
    isEnabled: true,
    isHidden: false,
    sortOrder: 0,
    notes: null,
    ...overrides
  }
}

function makeUserProviderRow(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'test-provider',
    presetProviderId: 'test-provider',
    name: 'Test Provider',
    baseUrls: null,
    defaultChatEndpoint: null,
    apiKeys: [],
    authConfig: { type: 'api-key' },
    apiFeatures: null,
    providerSettings: null,
    isEnabled: true,
    sortOrder: 0,
    ...overrides
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// applyCapabilityOverride
// ═══════════════════════════════════════════════════════════════════════════════

describe('applyCapabilityOverride', () => {
  const base = [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL]

  it('should return copy of base when override is null', () => {
    const result = applyCapabilityOverride(base, null)
    expect(result).toEqual(base)
    expect(result).not.toBe(base)
  })

  it('should add capabilities', () => {
    const result = applyCapabilityOverride(base, {
      add: [MODEL_CAPABILITY.WEB_SEARCH],
      remove: [],
      force: []
    })
    expect(result).toEqual([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.WEB_SEARCH])
  })

  it('should remove capabilities', () => {
    const result = applyCapabilityOverride(base, {
      add: [],
      remove: [MODEL_CAPABILITY.FUNCTION_CALL],
      force: []
    })
    expect(result).toEqual([MODEL_CAPABILITY.REASONING])
  })

  it('should force-replace capabilities entirely', () => {
    const result = applyCapabilityOverride(base, {
      add: [MODEL_CAPABILITY.WEB_SEARCH],
      remove: [],
      force: [MODEL_CAPABILITY.EMBEDDING]
    })
    expect(result).toEqual([MODEL_CAPABILITY.EMBEDDING])
  })

  it('should deduplicate when adding existing capability', () => {
    const result = applyCapabilityOverride(base, {
      add: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.WEB_SEARCH],
      remove: [],
      force: []
    })
    expect(result).toEqual([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.WEB_SEARCH])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// mergeModelConfig
// ═══════════════════════════════════════════════════════════════════════════════

describe('mergeModelConfig', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Case 1: Fully custom model (no presetModelId)
  // ─────────────────────────────────────────────────────────────────────────

  describe('custom model (no preset)', () => {
    it('should build model from user row only', () => {
      const userModel = makeUserModelRow({
        presetModelId: null,
        modelId: 'my-custom-model',
        name: 'Custom Model',
        description: 'A custom model',
        capabilities: [MODEL_CAPABILITY.REASONING],
        contextWindow: 8192,
        supportsStreaming: true
      })

      const result = mergeModelConfig(userModel, null, null, 'test-provider')

      expect(result.id).toBe('test-provider::my-custom-model')
      expect(result.name).toBe('Custom Model')
      expect(result.description).toBe('A custom model')
      expect(result.capabilities).toEqual([MODEL_CAPABILITY.REASONING])
      expect(result.contextWindow).toBe(8192)
      expect(result.supportsStreaming).toBe(true)
      expect(result.isEnabled).toBe(true)
    })

    it('should fallback name to modelId when name is null', () => {
      const userModel = makeUserModelRow({
        presetModelId: null,
        modelId: 'gpt-4o',
        name: null
      })

      const result = mergeModelConfig(userModel, null, null, 'test-provider')
      expect(result.name).toBe('gpt-4o')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Case 2: Preset model only (no user override, no catalog override)
  // ─────────────────────────────────────────────────────────────────────────

  describe('preset model only', () => {
    it('should use preset values directly', () => {
      const preset = makePresetModel({
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'OpenAI GPT-4o',
        capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL],
        inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
        outputModalities: [MODALITY.TEXT],
        contextWindow: 128000,
        maxOutputTokens: 16384,
        family: 'gpt-4o',
        ownedBy: 'openai'
      })

      const result = mergeModelConfig(null, null, preset, 'openai')

      expect(result.id).toBe('openai::gpt-4o')
      expect(result.name).toBe('GPT-4o')
      expect(result.description).toBe('OpenAI GPT-4o')
      expect(result.capabilities).toEqual([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL])
      expect(result.inputModalities).toEqual([MODALITY.TEXT, MODALITY.IMAGE])
      expect(result.outputModalities).toEqual([MODALITY.TEXT])
      expect(result.contextWindow).toBe(128000)
      expect(result.maxOutputTokens).toBe(16384)
      expect(result.family).toBe('gpt-4o')
      expect(result.ownedBy).toBe('openai')
      expect(result.isEnabled).toBe(true)
      expect(result.isHidden).toBe(false)
    })

    it('should throw when preset is missing for non-custom model', () => {
      const userModel = makeUserModelRow({ presetModelId: 'gpt-4o' })
      expect(() => mergeModelConfig(userModel, null, null, 'openai')).toThrow('Preset model not found')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Case 3: Preset + catalog override
  // ─────────────────────────────────────────────────────────────────────────

  describe('preset + catalog override', () => {
    const preset = makePresetModel({
      id: 'gpt-4o',
      name: 'GPT-4o',
      capabilities: [MODEL_CAPABILITY.REASONING],
      inputModalities: [MODALITY.TEXT],
      outputModalities: [MODALITY.TEXT],
      contextWindow: 128000,
      maxOutputTokens: 16384
    })

    it('should apply capability override (add)', () => {
      const override = makeCatalogOverride({
        providerId: 'openai',
        modelId: 'gpt-4o',
        capabilities: {
          add: [MODEL_CAPABILITY.FUNCTION_CALL],
          remove: [],
          force: []
        }
      })

      const result = mergeModelConfig(null, override, preset, 'openai')
      expect(result.capabilities).toEqual([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL])
    })

    it('should apply limits override', () => {
      const override = makeCatalogOverride({
        providerId: 'silicon',
        modelId: 'gpt-4o',
        limits: { contextWindow: 64000, maxOutputTokens: 8192, maxInputTokens: 60000 }
      })

      const result = mergeModelConfig(null, override, preset, 'silicon')
      expect(result.contextWindow).toBe(64000)
      expect(result.maxOutputTokens).toBe(8192)
      expect(result.maxInputTokens).toBe(60000)
    })

    it('should apply endpointTypes override', () => {
      const override = makeCatalogOverride({
        providerId: 'openai',
        modelId: 'gpt-4o',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
      })

      const result = mergeModelConfig(null, override, preset, 'openai')
      expect(result.endpointTypes).toEqual([ENDPOINT_TYPE.OPENAI_RESPONSES])
    })

    it('should apply modalities override', () => {
      const override = makeCatalogOverride({
        providerId: 'openai',
        modelId: 'gpt-4o',
        inputModalities: [MODALITY.TEXT, MODALITY.IMAGE, MODALITY.AUDIO],
        outputModalities: [MODALITY.TEXT, MODALITY.AUDIO]
      })

      const result = mergeModelConfig(null, override, preset, 'openai')
      expect(result.inputModalities).toEqual([MODALITY.TEXT, MODALITY.IMAGE, MODALITY.AUDIO])
      expect(result.outputModalities).toEqual([MODALITY.TEXT, MODALITY.AUDIO])
    })

    it('should apply replaceWith', () => {
      const override = makeCatalogOverride({
        providerId: 'openai',
        modelId: 'gpt-4o',
        replaceWith: 'gpt-4o-2024-11-20'
      })

      const result = mergeModelConfig(null, override, preset, 'openai')
      expect(result.replaceWith).toBe('openai::gpt-4o-2024-11-20')
    })

    it('should apply apiModelId from override', () => {
      const override = makeCatalogOverride({
        providerId: 'silicon',
        modelId: 'gpt-4o',
        apiModelId: 'openai/gpt-4o'
      })

      const result = mergeModelConfig(null, override, preset, 'silicon')
      expect(result.apiModelId).toBe('openai/gpt-4o')
    })

    it('should disable model when override.disabled is true', () => {
      const override = makeCatalogOverride({
        providerId: 'openai',
        modelId: 'gpt-4o',
        disabled: true
      })

      const result = mergeModelConfig(null, override, preset, 'openai')
      expect(result.isEnabled).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Case 4: Preset + user override (user wins)
  // ─────────────────────────────────────────────────────────────────────────

  describe('preset + user override', () => {
    const preset = makePresetModel({
      id: 'gpt-4o',
      name: 'GPT-4o',
      description: 'Original description',
      capabilities: [MODEL_CAPABILITY.REASONING],
      inputModalities: [MODALITY.TEXT],
      outputModalities: [MODALITY.TEXT],
      contextWindow: 128000,
      maxOutputTokens: 16384
    })

    it('should let user override capabilities', () => {
      const userModel = makeUserModelRow({
        capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.WEB_SEARCH]
      })

      const result = mergeModelConfig(userModel, null, preset, 'openai')
      expect(result.capabilities).toEqual([
        MODEL_CAPABILITY.REASONING,
        MODEL_CAPABILITY.FUNCTION_CALL,
        MODEL_CAPABILITY.WEB_SEARCH
      ])
    })

    it('should let user override name and description', () => {
      const userModel = makeUserModelRow({
        name: 'My GPT-4o',
        description: 'My custom description'
      })

      const result = mergeModelConfig(userModel, null, preset, 'openai')
      expect(result.name).toBe('My GPT-4o')
      expect(result.description).toBe('My custom description')
    })

    it('should let user override contextWindow and maxOutputTokens', () => {
      const userModel = makeUserModelRow({
        contextWindow: 64000,
        maxOutputTokens: 4096
      })

      const result = mergeModelConfig(userModel, null, preset, 'openai')
      expect(result.contextWindow).toBe(64000)
      expect(result.maxOutputTokens).toBe(4096)
    })

    it('should let user override endpointTypes', () => {
      const userModel = makeUserModelRow({
        endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
      })

      const result = mergeModelConfig(userModel, null, preset, 'openai')
      expect(result.endpointTypes).toEqual([ENDPOINT_TYPE.OPENAI_RESPONSES])
    })

    it('should preserve user isEnabled=false', () => {
      const userModel = makeUserModelRow({ isEnabled: false })
      const result = mergeModelConfig(userModel, null, preset, 'openai')
      expect(result.isEnabled).toBe(false)
    })

    it('should preserve user isHidden=true', () => {
      const userModel = makeUserModelRow({ isHidden: true })
      const result = mergeModelConfig(userModel, null, preset, 'openai')
      expect(result.isHidden).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Case 5: Full three-layer merge (user > catalogOverride > preset)
  // ─────────────────────────────────────────────────────────────────────────

  describe('three-layer merge', () => {
    it('user overrides take priority over catalog override', () => {
      const preset = makePresetModel({
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: [MODEL_CAPABILITY.REASONING],
        inputModalities: [MODALITY.TEXT],
        outputModalities: [MODALITY.TEXT],
        contextWindow: 128000,
        maxOutputTokens: 16384
      })

      const catalogOverride = makeCatalogOverride({
        providerId: 'silicon',
        modelId: 'gpt-4o',
        limits: { contextWindow: 64000, maxOutputTokens: 8192 },
        capabilities: {
          add: [MODEL_CAPABILITY.FUNCTION_CALL],
          remove: [],
          force: []
        }
      })

      const userModel = makeUserModelRow({
        capabilities: [MODEL_CAPABILITY.WEB_SEARCH],
        contextWindow: 32000
      })

      const result = mergeModelConfig(userModel, catalogOverride, preset, 'silicon')

      // User capabilities override everything
      expect(result.capabilities).toEqual([MODEL_CAPABILITY.WEB_SEARCH])
      // User contextWindow overrides catalog override
      expect(result.contextWindow).toBe(32000)
      // Catalog override applied (not overridden by user)
      expect(result.maxOutputTokens).toBe(8192)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Pricing from preset
  // ─────────────────────────────────────────────────────────────────────────

  describe('pricing', () => {
    it('should extract pricing from preset model', () => {
      const preset = makePresetModel({
        id: 'gpt-4o',
        capabilities: [],
        pricing: {
          input: { perMillionTokens: 2.5, currency: 1 },
          output: { perMillionTokens: 10, currency: 1 },
          cacheRead: { perMillionTokens: 1.25, currency: 1 }
        }
      })

      const result = mergeModelConfig(null, null, preset, 'openai')

      expect(result.pricing).toEqual({
        input: { perMillionTokens: 2.5, currency: 1 },
        output: { perMillionTokens: 10, currency: 1 },
        cacheRead: { perMillionTokens: 1.25, currency: 1 },
        cacheWrite: undefined
      })
    })

    it('should not have pricing when preset has none', () => {
      const preset = makePresetModel({ id: 'gpt-4o', capabilities: [] })
      const result = mergeModelConfig(null, null, preset, 'openai')
      expect(result.pricing).toBeUndefined()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// mergeProviderConfig
// ═══════════════════════════════════════════════════════════════════════════════

describe('mergeProviderConfig', () => {
  it('should throw when both userProvider and presetProvider are null', () => {
    expect(() => mergeProviderConfig(null, null)).toThrow('At least one')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Preset only
  // ─────────────────────────────────────────────────────────────────────────

  describe('preset only', () => {
    it('should build provider from preset with defaults', () => {
      const preset = makePresetProvider({
        id: 'openai',
        name: 'OpenAI',
        description: 'OpenAI API',
        baseUrls: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'https://api.openai.com/v1'
        },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiFeatures: { arrayContent: true, streamOptions: true }
      })

      const result = mergeProviderConfig(null, preset)

      expect(result.id).toBe('openai')
      expect(result.name).toBe('OpenAI')
      expect(result.description).toBe('OpenAI API')
      expect(result.baseUrls).toEqual({
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'https://api.openai.com/v1'
      })
      expect(result.defaultChatEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
      expect(result.isEnabled).toBe(true)
      expect(result.authType).toBe('api-key')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // User overrides preset
  // ─────────────────────────────────────────────────────────────────────────

  describe('user overrides preset', () => {
    const preset = makePresetProvider({
      id: 'openai',
      name: 'OpenAI',
      baseUrls: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'https://api.openai.com/v1'
      },
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      apiFeatures: { arrayContent: true, streamOptions: true, enableThinking: true }
    })

    it('should let user override baseUrls (merged, user wins)', () => {
      const userProvider = makeUserProviderRow({
        baseUrls: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'https://my-proxy.example.com/v1'
        }
      })

      const result = mergeProviderConfig(userProvider, preset)

      expect(result.baseUrls?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]).toBe('https://my-proxy.example.com/v1')
    })

    it('should let user override name', () => {
      const userProvider = makeUserProviderRow({ name: 'My OpenAI' })
      const result = mergeProviderConfig(userProvider, preset)
      expect(result.name).toBe('My OpenAI')
    })

    it('should let user override isEnabled', () => {
      const userProvider = makeUserProviderRow({ isEnabled: false })
      const result = mergeProviderConfig(userProvider, preset)
      expect(result.isEnabled).toBe(false)
    })

    it('should extract authType from user authConfig', () => {
      const userProvider = makeUserProviderRow({
        authConfig: { type: 'iam-aws', region: 'us-east-1' }
      })
      const result = mergeProviderConfig(userProvider, preset)
      expect(result.authType).toBe('iam-aws')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // apiFeatures three-layer merge (DEFAULT → preset → user)
  // ─────────────────────────────────────────────────────────────────────────

  describe('apiFeatures merge', () => {
    it('should apply DEFAULT → preset → user priority', () => {
      const preset = makePresetProvider({
        id: 'custom',
        name: 'Custom',
        apiFeatures: {
          developerRole: true,
          serviceTier: true
        }
      })

      const userProvider = makeUserProviderRow({
        apiFeatures: { serviceTier: false }
      })

      const result = mergeProviderConfig(userProvider, preset)

      // DEFAULT: arrayContent=true, streamOptions=true, developerRole=false, ...
      // preset overrides: developerRole=true, serviceTier=true
      // user overrides: serviceTier=false
      expect(result.apiFeatures.arrayContent).toBe(DEFAULT_API_FEATURES.arrayContent) // from DEFAULT
      expect(result.apiFeatures.streamOptions).toBe(DEFAULT_API_FEATURES.streamOptions) // from DEFAULT
      expect(result.apiFeatures.developerRole).toBe(true) // from preset
      expect(result.apiFeatures.serviceTier).toBe(false) // from user (overrides preset)
      expect(result.apiFeatures.enableThinking).toBe(DEFAULT_API_FEATURES.enableThinking) // from DEFAULT
    })

    it('should use all defaults when neither preset nor user set features', () => {
      const preset = makePresetProvider({ id: 'test', name: 'Test' })
      const userProvider = makeUserProviderRow()

      const result = mergeProviderConfig(userProvider, preset)

      expect(result.apiFeatures).toEqual(DEFAULT_API_FEATURES)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Provider settings
  // ─────────────────────────────────────────────────────────────────────────

  describe('providerSettings', () => {
    it('should include user provider settings', () => {
      const preset = makePresetProvider({ id: 'anthropic', name: 'Anthropic' })
      const userProvider = makeUserProviderRow({
        providerSettings: {
          rateLimit: 10,
          notes: 'My notes',
          cacheControl: {
            enabled: true,
            tokenThreshold: 1000,
            cacheSystemMessage: true,
            cacheLastNMessages: 3
          }
        }
      })

      const result = mergeProviderConfig(userProvider, preset)

      expect(result.settings.rateLimit).toBe(10)
      expect(result.settings.notes).toBe('My notes')
      expect(result.settings.cacheControl).toEqual({
        enabled: true,
        tokenThreshold: 1000,
        cacheSystemMessage: true,
        cacheLastNMessages: 3
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // API keys
  // ─────────────────────────────────────────────────────────────────────────

  describe('apiKeys', () => {
    it('should strip key values from output', () => {
      const userProvider = makeUserProviderRow({
        apiKeys: [
          { id: 'key-1', key: 'sk-secret-key', isEnabled: true },
          { id: 'key-2', key: 'sk-another-key', label: 'Backup', isEnabled: false }
        ]
      })

      const result = mergeProviderConfig(userProvider, null)

      expect(result.apiKeys).toHaveLength(2)
      expect(result.apiKeys[0].id).toBe('key-1')
      expect(result.apiKeys[0]).not.toHaveProperty('key')
      expect(result.apiKeys[1].id).toBe('key-2')
      expect(result.apiKeys[1].label).toBe('Backup')
      expect(result.apiKeys[1].isEnabled).toBe(false)
    })

    it('should return empty array when no apiKeys', () => {
      const userProvider = makeUserProviderRow({ apiKeys: null })
      const result = mergeProviderConfig(userProvider, null)
      expect(result.apiKeys).toEqual([])
    })
  })
})
