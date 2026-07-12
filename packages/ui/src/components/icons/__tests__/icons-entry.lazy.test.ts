import { describe, expect, it, vi } from 'vitest'

// Evaluating large module graphs (icon barrels, chat chain) under full-suite
// concurrency can blow past the global testTimeout — pin a generous bound.
const PROBE_TIMEOUT = 45_000

const providerCatalogEvaluated = vi.hoisted(() => vi.fn())
const modelCatalogEvaluated = vi.hoisted(() => vi.fn())

vi.mock('../providers/catalog', () => {
  providerCatalogEvaluated()
  return { PROVIDER_ICON_CATALOG: { openai: { colorPrimary: '#000' } } }
})

vi.mock('../models/catalog', () => {
  modelCatalogEvaluated()
  return { MODEL_ICON_CATALOG: { claude: { colorPrimary: '#000' } } }
})

describe('icons public entry lazy boundary', () => {
  it(
    'does not evaluate the component catalogs when the public entry loads',
    async () => {
      const icons = await import('../index')
      // Touch the sync surface to prove it works catalog-free.
      expect(icons.resolveIconRef('claude-sonnet-5', 'openai')?.key).toBe('claude')
      expect(Object.keys(icons.PROVIDER_ICON_META_CATALOG).length).toBeGreaterThan(100)
      expect(providerCatalogEvaluated).not.toHaveBeenCalled()
      expect(modelCatalogEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'positive control: loading an icon pulls in exactly the matching catalog',
    async () => {
      const { loadProviderIcon } = await import('../loader')
      await loadProviderIcon('openai')
      expect(providerCatalogEvaluated).toHaveBeenCalledTimes(1)
      expect(modelCatalogEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )
})
