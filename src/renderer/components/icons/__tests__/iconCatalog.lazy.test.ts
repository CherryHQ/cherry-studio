import { describe, expect, it, vi } from 'vitest'

// Evaluating large module graphs (icon barrels, chat chain) under full-suite
// concurrency can blow past the global testTimeout — pin a generous bound.
const PROBE_TIMEOUT = 45_000

const providerCatalogEvaluated = vi.hoisted(() => vi.fn())
const modelCatalogEvaluated = vi.hoisted(() => vi.fn())

vi.mock('@cherrystudio/ui/components/icons/providers/catalog', () => {
  providerCatalogEvaluated()
  return { PROVIDER_ICON_CATALOG: { openai: { colorPrimary: '#000' } } }
})

vi.mock('@cherrystudio/ui/components/icons/models/catalog', () => {
  modelCatalogEvaluated()
  return { MODEL_ICON_CATALOG: { claude: { colorPrimary: '#000' } } }
})

/**
 * First-paint boundary probes (S6a): these light modules sit in every window's
 * static import graph, so evaluating them must NOT pull in the generated icon
 * component catalogs (~4 MB). The loader is the only sanctioned route.
 */
describe('icon catalog lazy boundary', () => {
  it(
    'the @renderer/utils/model barrel stays catalog-free',
    async () => {
      const { getModelLogoRef } = await import('@renderer/utils/model')
      expect(getModelLogoRef({ id: 'claude-sonnet-5', name: 'Claude' })?.key).toBe('claude')
      expect(providerCatalogEvaluated).not.toHaveBeenCalled()
      expect(modelCatalogEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'miniAppsLogo stays catalog-free',
    async () => {
      const { getMiniAppsLogoRef } = await import('@renderer/components/icons/miniAppsLogo')
      expect(getMiniAppsLogoRef('doubao')?.key).toBe('doubao')
      expect(providerCatalogEvaluated).not.toHaveBeenCalled()
      expect(modelCatalogEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'the @cherrystudio/ui/icons public entry stays catalog-free',
    async () => {
      await import('@cherrystudio/ui/icons')
      expect(providerCatalogEvaluated).not.toHaveBeenCalled()
      expect(modelCatalogEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'positive control: loading the catalog pulls it in',
    async () => {
      const { loadProviderIconCatalog } = await import('@cherrystudio/ui/icons')
      await loadProviderIconCatalog()
      expect(providerCatalogEvaluated).toHaveBeenCalledTimes(1)
    },
    PROBE_TIMEOUT
  )
})
