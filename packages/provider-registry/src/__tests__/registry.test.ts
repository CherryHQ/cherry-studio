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
