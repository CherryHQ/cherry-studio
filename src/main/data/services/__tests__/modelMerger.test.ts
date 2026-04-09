import type { EndpointConfig, ReasoningFormatType } from '@shared/data/types/provider'
import {
  applyCapabilityOverride,
  extractReasoningFormatTypes,
  mergeModelConfig,
  mergeProviderConfig
} from '@shared/data/utils/modelMerger'
import { describe, expect, it } from 'vitest'

// Use string literals matching the actual enum values to avoid
// importing @cherrystudio/provider-registry (not aliased in shared tests).
const CAPABILITY = {
  FUNCTION_CALL: 'function-call',
  IMAGE_RECOGNITION: 'image-recognition',
  REASONING: 'reasoning',
  EMBEDDING: 'embedding'
} as const

const ENDPOINT = {
  OPENAI_CHAT: 'openai-chat-completions',
  ANTHROPIC: 'anthropic-messages'
} as const

// ---------- applyCapabilityOverride ----------

describe('applyCapabilityOverride', () => {
  const base = [CAPABILITY.FUNCTION_CALL, CAPABILITY.IMAGE_RECOGNITION] as any[]

  it('returns a copy of base when override is null', () => {
    const result = applyCapabilityOverride(base, null)
    expect(result).toEqual(base)
    expect(result).not.toBe(base)
  })

  it('returns a copy of base when override is undefined', () => {
    expect(applyCapabilityOverride(base, undefined)).toEqual(base)
  })

  it('adds capabilities', () => {
    const result = applyCapabilityOverride(base, { add: [CAPABILITY.REASONING] as any[] })
    expect(result).toContain(CAPABILITY.REASONING)
    expect(result).toContain(CAPABILITY.FUNCTION_CALL)
  })

  it('removes capabilities', () => {
    const result = applyCapabilityOverride(base, { remove: [CAPABILITY.FUNCTION_CALL] as any[] })
    expect(result).not.toContain(CAPABILITY.FUNCTION_CALL)
    expect(result).toContain(CAPABILITY.IMAGE_RECOGNITION)
  })

  it('force replaces all capabilities', () => {
    const result = applyCapabilityOverride(base, { force: [CAPABILITY.EMBEDDING] as any[] })
    expect(result).toEqual([CAPABILITY.EMBEDDING])
  })

  it('force takes precedence over add/remove', () => {
    const result = applyCapabilityOverride(base, {
      force: [CAPABILITY.EMBEDDING] as any[],
      add: [CAPABILITY.REASONING] as any[],
      remove: [CAPABILITY.FUNCTION_CALL] as any[]
    })
    expect(result).toEqual([CAPABILITY.EMBEDDING])
  })

  it('deduplicates when adding existing capabilities', () => {
    const result = applyCapabilityOverride(base, { add: [CAPABILITY.FUNCTION_CALL] as any[] })
    const count = result.filter((c) => c === CAPABILITY.FUNCTION_CALL).length
    expect(count).toBe(1)
  })
})

// ---------- extractReasoningFormatTypes ----------

describe('extractReasoningFormatTypes', () => {
  it('returns undefined for null input', () => {
    expect(extractReasoningFormatTypes(null)).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(extractReasoningFormatTypes(undefined)).toBeUndefined()
  })

  it('returns undefined when no endpoint has reasoningFormatType', () => {
    const configs: Partial<Record<string, EndpointConfig>> = {
      [ENDPOINT.OPENAI_CHAT]: { baseUrl: 'https://api.example.com' }
    }
    expect(extractReasoningFormatTypes(configs)).toBeUndefined()
  })

  it('extracts reasoning format types from endpoint configs', () => {
    const configs: Partial<Record<string, EndpointConfig>> = {
      [ENDPOINT.OPENAI_CHAT]: { reasoningFormatType: 'openai-chat' as ReasoningFormatType },
      [ENDPOINT.ANTHROPIC]: { reasoningFormatType: 'anthropic' as ReasoningFormatType }
    }
    const result = extractReasoningFormatTypes(configs)
    expect(result).toEqual({
      [ENDPOINT.OPENAI_CHAT]: 'openai-chat',
      [ENDPOINT.ANTHROPIC]: 'anthropic'
    })
  })
})

// ---------- mergeModelConfig ----------

describe('mergeModelConfig', () => {
  const presetModel = {
    id: 'gpt-4o',
    name: 'GPT-4o',
    capabilities: [CAPABILITY.IMAGE_RECOGNITION, CAPABILITY.FUNCTION_CALL],
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    contextWindow: 128_000,
    maxOutputTokens: 4096
  } as any

  it('creates a custom model when userModel has no presetModelId', () => {
    const userRow = {
      providerId: 'openai',
      modelId: 'my-custom-model',
      presetModelId: null,
      name: 'Custom Model'
    }
    const model = mergeModelConfig(userRow, null, null, 'openai')
    expect(model.name).toBe('Custom Model')
    expect(model.id).toContain('my-custom-model')
  })

  it('throws when preset is required but null', () => {
    const userRow = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o'
    }
    expect(() => mergeModelConfig(userRow, null, null, 'openai')).toThrow('Preset model not found')
  })

  it('merges from preset when no user model exists', () => {
    const model = mergeModelConfig(null, null, presetModel, 'openai')
    expect(model.name).toBe('GPT-4o')
    expect(model.contextWindow).toBe(128_000)
    expect(model.capabilities).toContain(CAPABILITY.IMAGE_RECOGNITION)
  })

  it('applies catalog override on top of preset', () => {
    const override = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      capabilities: { add: [CAPABILITY.REASONING] }
    } as any
    const model = mergeModelConfig(null, override, presetModel, 'openai')
    expect(model.capabilities).toEqual([CAPABILITY.IMAGE_RECOGNITION, CAPABILITY.FUNCTION_CALL, CAPABILITY.REASONING])
  })

  it('user values take highest priority', () => {
    const userRow = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: 'My GPT-4o',
      contextWindow: 64_000
    }
    const model = mergeModelConfig(userRow, null, presetModel, 'openai')
    expect(model.name).toBe('My GPT-4o')
    expect(model.contextWindow).toBe(64_000)
  })

  it('three-layer conflict: user > catalogOverride > preset', () => {
    const override = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      capabilities: { add: [CAPABILITY.REASONING] },
      limits: { contextWindow: 200_000, maxOutputTokens: 16_384 }
    } as any
    const userRow = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: 'User Override',
      contextWindow: 50_000,
      // user does NOT override maxOutputTokens — catalogOverride should win
      capabilities: [CAPABILITY.EMBEDDING] // user replaces all capabilities
    }
    const model = mergeModelConfig(userRow, override, presetModel, 'openai')

    // user wins
    expect(model.name).toBe('User Override')
    expect(model.contextWindow).toBe(50_000)
    expect(model.capabilities).toEqual([CAPABILITY.EMBEDDING])
    // catalogOverride wins over preset (user didn't set maxOutputTokens)
    expect(model.maxOutputTokens).toBe(16_384)
  })

  it('catalogOverride disabled=true sets isEnabled=false when no user model', () => {
    const override = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      disabled: true
    } as any
    const model = mergeModelConfig(null, override, presetModel, 'openai')
    expect(model.isEnabled).toBe(false)
  })

  it('user isEnabled overrides catalogOverride disabled', () => {
    const override = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      disabled: true
    } as any
    const userRow = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      isEnabled: true
    }
    const model = mergeModelConfig(userRow, override, presetModel, 'openai')
    expect(model.isEnabled).toBe(true)
  })

  it('preset fields carry through when user provides null', () => {
    const userRow = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: null, // null should fall through to preset
      contextWindow: null,
      capabilities: null
    }
    const model = mergeModelConfig(userRow, null, presetModel, 'openai')
    expect(model.name).toBe('GPT-4o') // from preset
    expect(model.contextWindow).toBe(128_000) // from preset
    expect(model.capabilities).toContain(CAPABILITY.IMAGE_RECOGNITION) // from preset
  })
})

// ---------- mergeModelConfig: field completeness ----------

describe('mergeModelConfig — field completeness', () => {
  const fullPreset = {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'A multimodal model',
    capabilities: ['image-recognition', 'function-call'],
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    maxInputTokens: 120_000,
    reasoning: {
      type: 'builtin',
      supportedEfforts: ['low', 'medium', 'high'],
      thinkingTokenLimits: { min: 1024, max: 16384 }
    },
    pricing: {
      input: { perMillionTokens: 2.5, currency: 'USD' },
      output: { perMillionTokens: 10, currency: 'USD' },
      cacheRead: { perMillionTokens: 1.25, currency: 'USD' },
      cacheWrite: { perMillionTokens: 5, currency: 'USD' }
    }
  } as any

  it('all preset fields carry through when no user or override', () => {
    const model = mergeModelConfig(null, null, fullPreset, 'openai')

    expect(model.name).toBe('GPT-4o')
    expect(model.description).toBe('A multimodal model')
    // group is a user-only field, not in preset schema
    expect(model.group).toBeUndefined()
    expect(model.capabilities).toEqual(['image-recognition', 'function-call'])
    expect(model.inputModalities).toEqual(['text', 'image'])
    expect(model.outputModalities).toEqual(['text'])
    expect(model.contextWindow).toBe(128_000)
    expect(model.maxOutputTokens).toBe(4096)
    expect(model.isEnabled).toBe(true)
    expect(model.supportsStreaming).toBe(true)

    // Pricing
    expect(model.pricing).toBeDefined()
    expect(model.pricing!.input.perMillionTokens).toBe(2.5)
    expect(model.pricing!.output.perMillionTokens).toBe(10)
    expect(model.pricing!.cacheRead?.perMillionTokens).toBe(1.25)
    expect(model.pricing!.cacheWrite?.perMillionTokens).toBe(5)

    // Reasoning
    expect(model.reasoning).toBeDefined()
    expect(model.reasoning!.supportedEfforts).toEqual(['low', 'medium', 'high'])
    expect(model.reasoning!.thinkingTokenLimits).toEqual({ min: 1024, max: 16384 })
  })

  it('null user fields do not clobber preset values', () => {
    const userRow = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: null,
      description: null,
      group: null,
      capabilities: null,
      inputModalities: null,
      outputModalities: null,
      contextWindow: null,
      maxOutputTokens: null,
      supportsStreaming: null,
      reasoning: null,
      isEnabled: null,
      isHidden: null
    }
    const model = mergeModelConfig(userRow, null, fullPreset, 'openai')

    expect(model.name).toBe('GPT-4o')
    expect(model.description).toBe('A multimodal model')
    expect(model.capabilities).toEqual(['image-recognition', 'function-call'])
    expect(model.inputModalities).toEqual(['text', 'image'])
    expect(model.outputModalities).toEqual(['text'])
    expect(model.contextWindow).toBe(128_000)
    expect(model.maxOutputTokens).toBe(4096)
  })

  it('catalogOverride fields override preset', () => {
    const override = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      capabilities: { add: ['reasoning'] },
      limits: { contextWindow: 200_000, maxOutputTokens: 16_384 },
      inputModalities: ['text', 'image', 'audio']
    } as any
    const model = mergeModelConfig(null, override, fullPreset, 'openai')

    expect(model.contextWindow).toBe(200_000)
    expect(model.maxOutputTokens).toBe(16_384)
    expect(model.inputModalities).toEqual(['text', 'image', 'audio'])
    expect(model.capabilities).toContain('reasoning')
    expect(model.capabilities).toContain('image-recognition')
    // Non-overridden fields still from preset
    expect(model.description).toBe('A multimodal model')
    expect(model.pricing!.input.perMillionTokens).toBe(2.5)
  })

  it('user fields override both preset and catalogOverride', () => {
    const override = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      limits: { contextWindow: 200_000 }
    } as any
    const userRow = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: 'My Model',
      contextWindow: 50_000,
      capabilities: ['embedding']
    }
    const model = mergeModelConfig(userRow, override, fullPreset, 'openai')

    expect(model.name).toBe('My Model')
    expect(model.contextWindow).toBe(50_000) // user beats override's 200k
    expect(model.capabilities).toEqual(['embedding']) // user replaces all
    // Non-overridden preset fields still flow
    expect(model.description).toBe('A multimodal model')
    expect(model.inputModalities).toEqual(['text', 'image'])
  })
})

// ---------- mergeModelConfig: pricing ----------

describe('mergeModelConfig — pricing', () => {
  it('full pricing structure passes through intact', () => {
    const preset = {
      id: 'claude-4',
      name: 'Claude 4',
      pricing: {
        input: { perMillionTokens: 3, currency: 'USD' },
        output: { perMillionTokens: 15, currency: 'USD' },
        cacheRead: { perMillionTokens: 0.3, currency: 'USD' },
        cacheWrite: { perMillionTokens: 3.75, currency: 'USD' }
      }
    } as any
    const model = mergeModelConfig(null, null, preset, 'anthropic')

    expect(model.pricing).toBeDefined()
    expect(model.pricing!.input).toEqual({ perMillionTokens: 3, currency: 'USD' })
    expect(model.pricing!.output).toEqual({ perMillionTokens: 15, currency: 'USD' })
    expect(model.pricing!.cacheRead).toEqual({ perMillionTokens: 0.3, currency: 'USD' })
    expect(model.pricing!.cacheWrite).toEqual({ perMillionTokens: 3.75, currency: 'USD' })
  })

  it('pricing is undefined when preset has no pricing', () => {
    const preset = { id: 'test', name: 'Test' } as any
    const model = mergeModelConfig(null, null, preset, 'test')
    expect(model.pricing).toBeUndefined()
  })
})

// ---------- mergeModelConfig: reasoning ----------

describe('mergeModelConfig — reasoning', () => {
  it('reasoning from preset flows through', () => {
    const preset = {
      id: 'o1',
      name: 'o1',
      capabilities: ['reasoning'],
      reasoning: {
        type: 'builtin',
        supportedEfforts: ['low', 'medium', 'high'],
        thinkingTokenLimits: { min: 1024, max: 32768 }
      }
    } as any
    const model = mergeModelConfig(null, null, preset, 'openai')

    expect(model.reasoning).toBeDefined()
    // type is derived from provider's reasoningFormatType, not from preset — empty when no provider config
    expect(model.reasoning!.type).toBe('')
    expect(model.reasoning!.supportedEfforts).toEqual(['low', 'medium', 'high'])
    expect(model.reasoning!.thinkingTokenLimits).toEqual({ min: 1024, max: 32768 })
  })

  it('reasoningFormatType applied from provider config', () => {
    const preset = {
      id: 'o1',
      name: 'o1',
      capabilities: ['reasoning'],
      reasoning: {
        type: 'builtin',
        supportedEfforts: ['low', 'medium', 'high']
      }
    } as any
    const override = {
      providerId: 'openai',
      modelId: 'o1',
      endpointTypes: ['openai-chat-completions']
    } as any
    const reasoningFormatTypes = {
      'openai-chat-completions': 'openai-chat'
    } as any

    const model = mergeModelConfig(null, override, preset, 'openai', reasoningFormatTypes)

    expect(model.reasoning).toBeDefined()
    expect(model.reasoning!.type).toBe('openai-chat')
    expect(model.reasoning!.supportedEfforts).toEqual(['low', 'medium', 'high'])
  })
})

// ---------- mergeModelConfig: edge cases ----------

describe('mergeModelConfig — edge cases', () => {
  it('empty capabilities [] from preset → empty array in output', () => {
    const preset = { id: 'test', name: 'Test', capabilities: [] } as any
    const model = mergeModelConfig(null, null, preset, 'test')
    expect(model.capabilities).toEqual([])
  })

  it('empty inputModalities [] from preset → undefined in output', () => {
    const preset = { id: 'test', name: 'Test', inputModalities: [] } as any
    const model = mergeModelConfig(null, null, preset, 'test')
    expect(model.inputModalities).toBeUndefined()
  })

  it('replaceWith from catalogOverride becomes a UniqueModelId', () => {
    const preset = { id: 'gpt-4', name: 'GPT-4' } as any
    const override = {
      providerId: 'openai',
      modelId: 'gpt-4',
      replaceWith: 'gpt-4o'
    } as any
    const model = mergeModelConfig(null, override, preset, 'openai')
    expect(model.replaceWith).toContain('gpt-4o')
  })
})

// ---------- mergeProviderConfig ----------

describe('mergeProviderConfig', () => {
  it('throws when both inputs are null', () => {
    expect(() => mergeProviderConfig(null, null)).toThrow('At least one')
  })

  it('merges from user provider only', () => {
    const userRow = {
      providerId: 'custom',
      name: 'Custom Provider'
    }
    const provider = mergeProviderConfig(userRow, null)
    expect(provider.id).toBe('custom')
    expect(provider.name).toBe('Custom Provider')
  })

  it('user name takes precedence over preset name', () => {
    const userRow = {
      providerId: 'openai',
      name: 'My OpenAI'
    }
    const presetProvider = {
      id: 'openai',
      name: 'OpenAI'
    }
    const provider = mergeProviderConfig(userRow, presetProvider as any)
    expect(provider.name).toBe('My OpenAI')
  })

  it('merges from preset only (no user row)', () => {
    const presetProvider = {
      id: 'openai',
      name: 'OpenAI',
      defaultChatEndpoint: ENDPOINT.OPENAI_CHAT,
      apiFeatures: { arrayContent: false }
    }
    const provider = mergeProviderConfig(null, presetProvider as any)
    expect(provider.id).toBe('openai')
    expect(provider.name).toBe('OpenAI')
    expect(provider.defaultChatEndpoint).toBe(ENDPOINT.OPENAI_CHAT)
    expect(provider.apiFeatures.arrayContent).toBe(false)
  })

  it('user apiFeatures override preset apiFeatures per field', () => {
    const userRow = {
      providerId: 'openai',
      name: 'OpenAI',
      apiFeatures: { arrayContent: false }
    }
    const presetProvider = {
      id: 'openai',
      name: 'OpenAI',
      apiFeatures: { arrayContent: true, developerRole: true }
    }
    const provider = mergeProviderConfig(userRow, presetProvider as any)
    // user overrides arrayContent
    expect(provider.apiFeatures.arrayContent).toBe(false)
    // preset value preserved where user didn't override
    expect(provider.apiFeatures.developerRole).toBe(true)
  })

  it('user defaultChatEndpoint overrides preset', () => {
    const userRow = {
      providerId: 'openai',
      name: 'OpenAI',
      defaultChatEndpoint: ENDPOINT.ANTHROPIC
    }
    const presetProvider = {
      id: 'openai',
      name: 'OpenAI',
      defaultChatEndpoint: ENDPOINT.OPENAI_CHAT
    }
    const provider = mergeProviderConfig(userRow, presetProvider as any)
    expect(provider.defaultChatEndpoint).toBe(ENDPOINT.ANTHROPIC)
  })

  it('deep-merges endpointConfigs: user field wins per-endpoint', () => {
    const userRow = {
      providerId: 'openai',
      name: 'OpenAI',
      endpointConfigs: {
        [ENDPOINT.OPENAI_CHAT]: { baseUrl: 'https://my-proxy.com/v1' }
      }
    }
    const presetProvider = {
      id: 'openai',
      name: 'OpenAI',
      endpointConfigs: {
        [ENDPOINT.OPENAI_CHAT]: {
          baseUrl: 'https://api.openai.com/v1',
          reasoningFormat: { type: 'openai-chat' }
        }
      }
    }
    const provider = mergeProviderConfig(userRow, presetProvider as any)
    const chatConfig = provider.endpointConfigs?.[ENDPOINT.OPENAI_CHAT as keyof typeof provider.endpointConfigs]
    // user baseUrl wins
    expect(chatConfig?.baseUrl).toBe('https://my-proxy.com/v1')
  })
})
