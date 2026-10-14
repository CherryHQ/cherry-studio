import { describe, expect, it, vi } from 'vitest'

// Evaluating large module graphs (icon barrels, chat chain) under full-suite
// concurrency can blow past the global testTimeout — pin a generous bound.
const PROBE_TIMEOUT = 45_000

const providerCatalogEvaluated = vi.hoisted(() => vi.fn())
const providerLoadersEvaluated = vi.hoisted(() => vi.fn())
const modelLoadersEvaluated = vi.hoisted(() => vi.fn())
const providerBarrelEvaluated = vi.hoisted(() => vi.fn())
const loadOpenai = vi.hoisted(() => vi.fn(async () => ({ colorPrimary: '#000' }) as never))

vi.mock('../providers/catalog', () => {
  providerCatalogEvaluated()
  return { PROVIDER_ICON_CATALOG: { openai: { colorPrimary: '#000' } } }
})

vi.mock('../providers/loaders', () => {
  providerLoadersEvaluated()
  return { PROVIDER_ICON_LOADERS: { openai: loadOpenai } }
})

vi.mock('../models/loaders', () => {
  modelLoadersEvaluated()
  return { MODEL_ICON_LOADERS: { claude: vi.fn() } }
})

vi.mock('../providers', () => {
  providerBarrelEvaluated()
  return { Openai: vi.fn() }
})

describe('icons public entry lazy boundary', () => {
  it(
    'does not evaluate the bulk catalog, loader maps, or the provider barrel when the public entry loads',
    async () => {
      const icons = await import('../index')
      // Touch the sync surface to prove it works catalog-free.
      expect(icons.resolveIconRef('claude-sonnet-5', 'openai')?.key).toBe('claude')
      expect(Object.keys(icons.PROVIDER_ICON_META_CATALOG).length).toBeGreaterThan(100)
      expect(providerCatalogEvaluated).not.toHaveBeenCalled()
      expect(providerLoadersEvaluated).not.toHaveBeenCalled()
      expect(modelLoadersEvaluated).not.toHaveBeenCalled()
      expect(providerBarrelEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'positive control: loading an icon invokes only its matching implementation loader',
    async () => {
      const { loadProviderIcon } = await import('../loader')
      await loadProviderIcon('openai')
      expect(providerLoadersEvaluated).toHaveBeenCalledTimes(1)
      expect(loadOpenai).toHaveBeenCalledTimes(1)
      expect(providerCatalogEvaluated).not.toHaveBeenCalled()
      expect(modelLoadersEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )
})
