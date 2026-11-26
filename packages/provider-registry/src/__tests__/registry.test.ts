import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry, parseModelSnapshot, type RegistryCatalog } from '../registry'

const catalog = (): RegistryCatalog => ({
  providers: { version: 'providers-v1', providers: [] },
  models: {
    version: 'models-v1',
    models: [
      { id: 'gpt-oss-120b', name: 'GPT OSS 120B' },
      { id: 'gpt-oss-20b', name: 'GPT OSS 20B' }
    ]
  },
  providerModels: {
    version: 'overrides-v1',
    overrides: [
      { providerId: 'gateway', modelId: 'gpt-oss-120b', apiModelId: 'large-deployment' },
      { providerId: 'gateway', modelId: 'gpt-oss-20b', apiModelId: 'small-deployment' }
    ]
  }
})

describe('portable registry', () => {
  it('ships Rapid-MLX as a keyless local provider with all three chat protocols', () => {
    const provider = createRegistry(bundledCatalog).findProvider('rapid-mlx')

    expect(provider).toMatchObject({
      name: 'Rapid-MLX',
      availableInEditions: ['global', 'cn'],
      authOptional: true,
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': {
          adapterFamily: 'openai-compatible',
          baseUrl: 'http://localhost:8000',
          reasoningFormat: { type: 'openai-chat' }
        },
        'openai-responses': { adapterFamily: 'open-responses', baseUrl: 'http://localhost:8000' },
        'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'http://localhost:8000' }
      },
      metadata: {
        website: { docs: 'https://github.com/raullenchai/Rapid-MLX', official: 'https://rapidmlx.com' }
      }
    })
  })

  it('preserves parameter size across namespaced and registry-tag IDs', () => {
    const registry = createRegistry(catalog())

    expect(registry.findModel('nvidia/gpt-oss-20b')?.id).toBe('gpt-oss-20b')
    expect(registry.findModel('gpt-oss:20b')?.id).toBe('gpt-oss-20b')
    expect(registry.findModel('gpt-oss:9b')).toBeNull()
    expect(registry.findOverride('gateway', 'nvidia/gpt-oss-9b')).toBeNull()
  })

  it('resolves provider API aliases without changing their request IDs', () => {
    const registry = createRegistry(catalog())

    expect(registry.findOverride('gateway', 'small-deployment')).toMatchObject({
      modelId: 'gpt-oss-20b',
      apiModelId: 'small-deployment'
    })
    expect(registry.findOverride('other', 'small-deployment')).toBeNull()
    expect(registry.getOverridesForProvider('gateway').map((row) => row.apiModelId)).toEqual([
      'large-deployment',
      'small-deployment'
    ])
  })

  it.each([false, true])(
    'keeps canonical and dated provider variants independently addressable (reverse=%s)',
    (reverse) => {
      const canonical = { providerId: 'gateway', modelId: 'gpt-4o', apiModelId: 'gpt-4o' }
      const dated = { providerId: 'gateway', modelId: 'gpt-4o', apiModelId: 'gpt-4o-20240513' }
      const registry = createRegistry({
        ...catalog(),
        providerModels: { version: 'v1', overrides: reverse ? [dated, canonical] : [canonical, dated] }
      })

      expect(registry.findOverride('gateway', 'gpt-4o')?.apiModelId).toBe('gpt-4o')
      expect(registry.findOverride('gateway', 'gpt-4o-20240513')?.apiModelId).toBe('gpt-4o-20240513')
    }
  )

  it.each([false, true])('prefers the untagged dated offer on canonical lookup (reverse=%s)', (reverse) => {
    const dated = { providerId: '302ai', modelId: 'claude-opus-4-1', apiModelId: 'claude-opus-4-1-20250805' }
    const thinking = { ...dated, apiModelId: 'claude-opus-4-1-20250805-thinking' }
    const registry = createRegistry({
      ...catalog(),
      providerModels: { version: 'v1', overrides: reverse ? [thinking, dated] : [dated, thinking] }
    })

    expect(registry.findOverride(dated.providerId, dated.modelId)?.apiModelId).toBe(dated.apiModelId)
    expect(registry.findOverride(thinking.providerId, thinking.apiModelId)?.apiModelId).toBe(thinking.apiModelId)
  })

  it('creates independent views when an application activates a new snapshot', () => {
    const original = createRegistry(catalog())
    const replacement = createRegistry({
      ...catalog(),
      models: { version: 'models-v2', models: [{ id: 'new-model', name: 'New model' }] }
    })

    expect(original.findModel('gpt-oss-20b')?.name).toBe('GPT OSS 20B')
    expect(original.findModel('new-model')).toBeNull()
    expect(replacement.findModel('gpt-oss-20b')).toBeNull()
    expect(replacement.findModel('new-model')?.name).toBe('New model')
  })

  it('provides usable bundled providers, models and overrides without a download', () => {
    const registry = createRegistry(bundledCatalog)

    expect(registry.findProvider('openai')?.name).toBe('OpenAI')
    expect(registry.listProviders().some((provider) => provider.id === 'openai')).toBe(true)
    expect(registry.listModels().some((model) => model.id === 'gpt-6-1-sol')).toBe(true)
    expect(registry.findModel('gpt-6.1-sol')?.reasoning?.controls).toContainEqual(
      expect.objectContaining({ kind: 'effort', values: expect.arrayContaining(['low', 'max']) })
    )
    expect(registry.findOverride('cherryin', 'qwen/qwen3.5-9b')?.modelId).toBe('qwen3-5-9b')
  })

  it('keeps CherryIN free prices on the exact free IDs', () => {
    const registry = createRegistry(bundledCatalog)
    const free = registry.findOverride('cherryin', 'deepseek/deepseek-v3.2(free)')

    expect(free).toMatchObject({
      apiModelId: 'deepseek/deepseek-v3.2(free)',
      pricing: {
        input: { perMillionTokens: 0 },
        output: { perMillionTokens: 0 },
        cacheRead: { perMillionTokens: 0 }
      }
    })
    expect(registry.findOverride('cherryin', 'deepseek/deepseek-v3.2')?.pricing).toMatchObject({
      input: { perMillionTokens: null },
      output: { perMillionTokens: null }
    })
    expect(registry.findOverride('cherryin', 'qwen/qwen3.5-4b')).toBeNull()
  })

  it('resolves CherryIN generation models with their advertised per-image prices', () => {
    const registry = createRegistry(bundledCatalog)
    expect(registry.findOverride('cherryin', 'qwen/z-image-turbo')).toMatchObject({
      endpointTypes: ['openai-image-generation'],
      imageGeneration: { modes: { generate: { supports: {} } } },
      pricing: { perImage: { price: 0.013698630137, currency: 'USD', unit: 'image' } }
    })
  })

  it('preserves the different 200K pricing thresholds for CherryIN Gemini and Grok', () => {
    const registry = createRegistry(bundledCatalog)
    expect(registry.findOverride('cherryin', 'google/gemini-3-pro-preview')?.pricing).toMatchObject({
      input: { perMillionTokens: 2 },
      inputTokenTiers: [{ minInputTokens: 200_001, input: { perMillionTokens: 4 } }]
    })
    expect(registry.findOverride('cherryin', 'x-ai/grok-4.2-agents')?.pricing).toMatchObject({
      input: { perMillionTokens: 1.25 },
      inputTokenTiers: [{ minInputTokens: 200_000, input: { perMillionTokens: 2.5 } }]
    })
  })

  it('retains standard CherryIN capabilities for bare IDs without inheriting their exact price', () => {
    const registry = createRegistry(bundledCatalog)

    expect(registry.findOverride('cherryin', 'qwen3.5-122b-a10b')).toMatchObject({
      capabilities: { remove: ['audio-recognition'] },
      apiModelId: undefined,
      pricing: undefined
    })
  })

  it('keeps CherryIN paid aliases from supplying prices to a different API ID', () => {
    const registry = createRegistry(bundledCatalog)
    const agent = registry.findOverride('cherryin', 'agent/glm-5')
    const standard = registry.findOverride('cherryin', 'z-ai/glm-5')

    expect(agent?.apiModelId).toBe('agent/glm-5')
    expect(standard?.apiModelId).toBe('z-ai/glm-5')
    expect(agent?.pricing?.input?.perMillionTokens).toBe(0.86)
    expect(standard?.pricing?.input?.perMillionTokens).toBeGreaterThan(0)
    expect(registry.findOverride('cherryin', 'unknown/glm-5')).toBeNull()
  })
})

describe('parseModelSnapshot', () => {
  it('keeps valid entries and known vocabulary when a newer catalog contains incompatible entries', () => {
    const parsed = parseModelSnapshot({
      models: {
        version: 'models-v2',
        models: [{ id: 'known', name: 'Known', capabilities: ['reasoning', 'telepathy'] }, { id: 'invalid' }]
      },
      providerModels: { version: 'overrides-v2', overrides: [{ providerId: 'missing-model' }] }
    })

    expect(parsed.models.models).toEqual([{ id: 'known', name: 'Known', capabilities: ['reasoning'] }])
    expect(parsed.providerModels.overrides).toEqual([])
    expect(parsed.models.version).toBe('models-v2')
  })

  it('rejects an incomplete snapshot instead of activating one valid half', () => {
    expect(() => parseModelSnapshot({ models: catalog().models, providerModels: null })).toThrow()
    expect(() => parseModelSnapshot({ models: {}, providerModels: catalog().providerModels })).toThrow()
  })

  it('does not introduce provider connection definitions from model metadata', () => {
    const parsed = parseModelSnapshot({
      models: { ...catalog().models, providers: [{ id: 'injected', baseUrl: 'https://untrusted.invalid' }] },
      providerModels: catalog().providerModels
    })
    const registry = createRegistry({ ...parsed, providers: catalog().providers })

    expect(registry.findProvider('injected')).toBeNull()
    expect(parsed.models).not.toHaveProperty('providers')
  })
})
