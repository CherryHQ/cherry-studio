/**
 * Unit tests for lookupRegistryModel and buildRuntimeEndpointConfigs.
 * Pure functions — no mocking required.
 */

import { describe, expect, it } from 'vitest'

import { buildRuntimeEndpointConfigs, lookupRegistryModel } from '../registry-utils'
import type { ModelConfig } from '../schemas/model'
import type { RegistryEndpointConfig } from '../schemas/provider'
import type { ProviderModelOverride } from '../schemas/provider-models'

function makeModel(id: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
  return { id, name: id, ...overrides } as ModelConfig
}

function makeOverride(providerId: string, modelId: string, extra: Record<string, unknown> = {}): ProviderModelOverride {
  return { providerId, modelId, ...extra } as ProviderModelOverride
}

// ─────────────────────────────────────────────────────────────────────────────
// lookupRegistryModel
// ─────────────────────────────────────────────────────────────────────────────

describe('lookupRegistryModel', () => {
  it('exact match for both presetModel and override', () => {
    const models = [makeModel('gpt-4o')]
    const overrides = [makeOverride('openai', 'gpt-4o')]

    const result = lookupRegistryModel(models, overrides, 'openai', 'gpt-4o')

    expect(result.presetModel).not.toBeNull()
    expect(result.presetModel!.id).toBe('gpt-4o')
    expect(result.registryOverride).not.toBeNull()
    expect(result.registryOverride!.modelId).toBe('gpt-4o')
  })

  it('no match → both null', () => {
    const result = lookupRegistryModel([makeModel('gpt-4o')], [], 'openai', 'unknown-model')
    expect(result.presetModel).toBeNull()
    expect(result.registryOverride).toBeNull()
  })

  it('model match but no override for this provider', () => {
    const result = lookupRegistryModel(
      [makeModel('gpt-4o')],
      [makeOverride('other-provider', 'gpt-4o')],
      'openai',
      'gpt-4o'
    )
    expect(result.presetModel!.id).toBe('gpt-4o')
    expect(result.registryOverride).toBeNull()
  })

  // Normalized fallback scenarios

  it('aggregator prefix fallback: aihubmix-gpt-4o → gpt-4o', () => {
    const result = lookupRegistryModel([makeModel('gpt-4o')], [], 'aihubmix', 'aihubmix-gpt-4o')
    expect(result.presetModel).not.toBeNull()
    expect(result.presetModel!.id).toBe('gpt-4o')
  })

  it('variant suffix fallback: gpt-4o:free → gpt-4o', () => {
    const result = lookupRegistryModel([makeModel('gpt-4o')], [], 'openrouter', 'gpt-4o:free')
    expect(result.presetModel!.id).toBe('gpt-4o')
  })

  it('version separator fallback: claude-3.5-sonnet → claude-3-5-sonnet', () => {
    const result = lookupRegistryModel([makeModel('claude-3-5-sonnet')], [], 'anthropic', 'claude-3.5-sonnet')
    expect(result.presetModel!.id).toBe('claude-3-5-sonnet')
  })

  it('combined prefix + suffix: aihubmix-gpt-4o:free → gpt-4o', () => {
    const result = lookupRegistryModel([makeModel('gpt-4o')], [], 'aihubmix', 'aihubmix-gpt-4o:free')
    expect(result.presetModel!.id).toBe('gpt-4o')
  })

  it('override also uses normalized fallback', () => {
    const result = lookupRegistryModel([], [makeOverride('openrouter', 'gpt-4o')], 'openrouter', 'gpt-4o:free')
    expect(result.registryOverride!.modelId).toBe('gpt-4o')
  })

  it('override for different provider does not match even via normalization', () => {
    const result = lookupRegistryModel([], [makeOverride('openai', 'gpt-4o')], 'azure', 'aihubmix-gpt-4o')
    expect(result.registryOverride).toBeNull()
  })

  it('exact match takes priority over normalized match', () => {
    const exact = makeModel('gpt-4o', { name: 'Exact' })
    const aggregator = makeModel('aihubmix-gpt-4o', { name: 'Aggregator' })
    // Put aggregator first to prove exact wins regardless of order
    const result = lookupRegistryModel([aggregator, exact], [], 'openai', 'gpt-4o')
    expect(result.presetModel!.name).toBe('Exact')
  })

  it('returns the complete object, not a partial copy', () => {
    const model = makeModel('gpt-4o', {
      name: 'GPT-4o',
      description: 'Flagship',
      capabilities: ['function-call'] as any,
      contextWindow: 128000
    })
    const result = lookupRegistryModel([model], [], 'openai', 'gpt-4o')
    expect(result.presetModel).toEqual(model)
  })

  it('empty arrays → both null', () => {
    const result = lookupRegistryModel([], [], 'openai', 'gpt-4o')
    expect(result.presetModel).toBeNull()
    expect(result.registryOverride).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildRuntimeEndpointConfigs
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRuntimeEndpointConfigs', () => {
  it('undefined → null', () => {
    expect(buildRuntimeEndpointConfigs(undefined)).toBeNull()
  })

  it('empty object → null', () => {
    expect(buildRuntimeEndpointConfigs({})).toBeNull()
  })

  it('baseUrl only', () => {
    const result = buildRuntimeEndpointConfigs({
      'openai-chat-completions': { baseUrl: 'https://api.openai.com/v1' }
    } as Record<string, RegistryEndpointConfig>)

    expect(result).not.toBeNull()
    expect(result!['openai-chat-completions'].baseUrl).toBe('https://api.openai.com/v1')
    expect(result!['openai-chat-completions'].reasoningFormatType).toBeUndefined()
  })

  it('reasoningFormat.type → reasoningFormatType', () => {
    const result = buildRuntimeEndpointConfigs({
      'openai-chat-completions': { reasoningFormat: { type: 'openai-chat' } }
    } as Record<string, RegistryEndpointConfig>)

    expect(result!['openai-chat-completions'].reasoningFormatType).toBe('openai-chat')
  })

  it('all fields present', () => {
    const urls = { default: 'https://api.example.com/models', embedding: 'https://api.example.com/embed' }
    const result = buildRuntimeEndpointConfigs({
      'openai-chat-completions': {
        baseUrl: 'https://api.example.com/v1',
        modelsApiUrls: urls,
        reasoningFormat: { type: 'openai-responses' }
      }
    } as Record<string, RegistryEndpointConfig>)

    const config = result!['openai-chat-completions']
    expect(config.baseUrl).toBe('https://api.example.com/v1')
    expect(config.modelsApiUrls).toEqual(urls)
    expect(config.reasoningFormatType).toBe('openai-responses')
  })

  it('multiple endpoints mapped independently', () => {
    const result = buildRuntimeEndpointConfigs({
      'openai-chat-completions': { baseUrl: 'https://api.openai.com/v1' },
      'anthropic-messages': { reasoningFormat: { type: 'anthropic' } }
    } as Record<string, RegistryEndpointConfig>)

    expect(Object.keys(result!)).toHaveLength(2)
    expect(result!['openai-chat-completions'].baseUrl).toBe('https://api.openai.com/v1')
    expect(result!['anthropic-messages'].reasoningFormatType).toBe('anthropic')
  })

  it('empty endpoint config excluded', () => {
    const result = buildRuntimeEndpointConfigs({
      'openai-chat-completions': {},
      'anthropic-messages': { baseUrl: 'https://api.anthropic.com' }
    } as Record<string, RegistryEndpointConfig>)

    expect(Object.keys(result!)).toHaveLength(1)
    expect(result!['openai-chat-completions']).toBeUndefined()
    expect(result!['anthropic-messages'].baseUrl).toBe('https://api.anthropic.com')
  })

  it('all empty endpoints → null', () => {
    const result = buildRuntimeEndpointConfigs({
      'openai-chat-completions': {},
      'anthropic-messages': {}
    } as Record<string, RegistryEndpointConfig>)
    expect(result).toBeNull()
  })
})
