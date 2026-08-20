import { describe, expect, it, vi } from 'vitest'

// Evaluating large module graphs (icon barrels, chat chain) under full-suite
// concurrency can blow past the global testTimeout — pin a generous bound.
const PROBE_TIMEOUT = 45_000

const providerCatalogEvaluated = vi.hoisted(() => vi.fn())
const providerLoadersEvaluated = vi.hoisted(() => vi.fn())
const modelLoadersEvaluated = vi.hoisted(() => vi.fn())
const providerBarrelEvaluated = vi.hoisted(() => vi.fn())

vi.mock('@cherrystudio/ui/components/icons/providers/catalog', () => {
  providerCatalogEvaluated()
  return { PROVIDER_ICON_CATALOG: { openai: { colorPrimary: '#000' } } }
})

vi.mock('@cherrystudio/ui/components/icons/providers/loaders', () => {
  providerLoadersEvaluated()
  return { PROVIDER_ICON_LOADERS: { openai: vi.fn() } }
})

vi.mock('@cherrystudio/ui/components/icons/models/loaders', () => {
  modelLoadersEvaluated()
  return { MODEL_ICON_LOADERS: { claude: vi.fn() } }
})

vi.mock('@cherrystudio/ui/icons/providers', () => {
  providerBarrelEvaluated()
  return { Exa: vi.fn() }
})

/**
 * First-paint boundary probes (S6a): these light modules sit in every window's
 * static import graph, so evaluating them must NOT pull in the generated provider
 * bulk catalog or per-icon loader maps. The loader is the only sanctioned route.
 */
describe('icon catalog lazy boundary', () => {
  it(
    'the @renderer/utils/model barrel stays catalog-free',
    async () => {
      const { getModelLogoRef } = await import('@renderer/utils/model')
      expect(getModelLogoRef({ id: 'claude-sonnet-5', name: 'Claude' })?.key).toBe('claude')
      expect(providerCatalogEvaluated).not.toHaveBeenCalled()
      expect(providerLoadersEvaluated).not.toHaveBeenCalled()
      expect(modelLoadersEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'miniAppsLogo stays catalog-free',
    async () => {
      const { getMiniAppsLogoRef } = await import('@renderer/components/icons/miniAppsLogo')
      expect(getMiniAppsLogoRef('doubao')?.key).toBe('doubao')
      expect(getMiniAppsLogoRef('github')?.key).toBe('github')
      expect(providerCatalogEvaluated).not.toHaveBeenCalled()
      expect(providerLoadersEvaluated).not.toHaveBeenCalled()
      expect(modelLoadersEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'the @cherrystudio/ui/icons public entry stays catalog-free',
    async () => {
      await import('@cherrystudio/ui/icons')
      expect(providerCatalogEvaluated).not.toHaveBeenCalled()
      expect(providerLoadersEvaluated).not.toHaveBeenCalled()
      expect(modelLoadersEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'web search metadata stays provider-barrel-free',
    async () => {
      const { getWebSearchProviderIconRef } = await import('@renderer/utils/webSearchProviderMeta')
      expect(getWebSearchProviderIconRef('exa-mcp')).toMatchObject({ kind: 'provider', key: 'exa' })
      expect(providerBarrelEvaluated).not.toHaveBeenCalled()
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
