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
    expect(model.capabilities).toContain(CAPABILITY.REASONING)
    expect(model.capabilities).toContain(CAPABILITY.IMAGE_RECOGNITION)
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
})
