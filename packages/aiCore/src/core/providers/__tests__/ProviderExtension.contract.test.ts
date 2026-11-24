import type { ProviderV3 } from '@ai-sdk/provider'
import { MockProviderV3 } from 'ai/test'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { ProviderExtension } from '../core/ProviderExtension'

interface Settings {
  apiKey?: string
}

function createBaseProvider(settings?: Settings) {
  return Object.assign(new MockProviderV3({}), {
    apiKey: settings?.apiKey,
    baseOnly: () => 'base'
  })
}

describe('ProviderExtension creation contracts', () => {
  it('retains SDK-specific base members through typed creation and cache reads', async () => {
    const extension = ProviderExtension.create({ name: 'typed-base', create: createBaseProvider })
    const base = await extension.createProvider({ apiKey: 'key' })

    expectTypeOf(base).toEqualTypeOf<ReturnType<typeof createBaseProvider>>()
    expect(base.baseOnly()).toBe('base')
    expect(base.apiKey).toBe('key')
    expect(await extension.getBaseProvider({ apiKey: 'key' })).toBe(base)
    expect(await extension.createProvider({ apiKey: 'key' }, undefined)).toBe(base)
  })

  it('keeps an asynchronous heterogeneous variant separate from its cached base and deduplicates creation', async () => {
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const transformed = Object.assign(new MockProviderV3({}), { variantOnly: () => 'variant' })
    const bases: Array<ReturnType<typeof createBaseProvider>> = []
    let transforms = 0
    const extension = new ProviderExtension<Settings, ReturnType<typeof createBaseProvider>>({
      name: 'heterogeneous',
      create: createBaseProvider,
      variants: [
        {
          suffix: 'other',
          name: 'Other SDK',
          async transform(base) {
            transforms++
            bases.push(base)
            await gate
            return transformed
          }
        }
      ]
    })
    const settings = { apiKey: 'key' }
    const base = await extension.getBaseProvider(settings)
    const first = extension.createProvider(settings, 'other')
    const second = extension.createProvider(settings, 'other')
    finish()
    const [a, b] = await Promise.all([first, second])

    expectTypeOf(a).toEqualTypeOf<ProviderV3>()
    expect(a).toBe(transformed)
    expect(b).toBe(transformed)
    expect(transforms).toBe(1)
    expect(bases).toHaveLength(1)
    expect(bases[0]).not.toBe(base)
    expect(await extension.getBaseProvider(settings)).toBe(base)
    expect(await extension.createProvider(settings, 'other')).toBe(transformed)
    expect(extension.getCacheStats().cachedInstances).toBe(2)
  })

  it('retains the legacy creator import and its settings', async () => {
    const extension = new ProviderExtension<Settings, ReturnType<typeof createBaseProvider>>({
      name: 'legacy',
      defaultOptions: { apiKey: 'default-key' },
      import: async () => ({ createLegacy: createBaseProvider, unrelated: 42 }),
      creatorFunctionName: 'createLegacy'
    })
    const provider = await extension.createProvider({ apiKey: 'caller-key' })

    expect(provider.apiKey).toBe('caller-key')
    expect(provider.baseOnly()).toBe('base')
  })

  it('retains the declared heterogeneous variant configuration on lookup', async () => {
    const variantProvider = Object.assign(new MockProviderV3({}), { variantOnly: () => 'variant' })
    const config = {
      name: 'variant-config',
      create: createBaseProvider,
      variants: [{ suffix: 'other', name: 'Other', transform: () => variantProvider }] as const
    }
    const extension = ProviderExtension.create(config)
    const variant = extension.getVariant('other')

    expectTypeOf(variant).toEqualTypeOf<(typeof config.variants)[number] | undefined>()
    const resolved = await variant?.transform()
    expect(resolved?.variantOnly()).toBe('variant')
  })

  it.each(['constructor', 'toString'])('rejects inherited properties as dynamic module exports: %s', async (name) => {
    const extension = new ProviderExtension({
      name: 'invalid-export',
      import: async () => ({}),
      creatorFunctionName: name
    })

    await expect(extension.createProvider()).rejects.toThrow('not found in imported module')
  })
})
