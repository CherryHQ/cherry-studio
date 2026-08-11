import { describe, expect, it, vi } from 'vitest'

const providerCatalogEvaluated = vi.hoisted(() => vi.fn())
const modelCatalogEvaluated = vi.hoisted(() => vi.fn())

const fakeProviderIcon = vi.hoisted(() => ({ colorPrimary: '#111' }) as never)
const fakeModelIcon = vi.hoisted(() => ({ colorPrimary: '#222' }) as never)

vi.mock('../providers/catalog', () => {
  providerCatalogEvaluated()
  return { PROVIDER_ICON_CATALOG: { openai: fakeProviderIcon } }
})

vi.mock('../models/catalog', () => {
  modelCatalogEvaluated()
  return { MODEL_ICON_CATALOG: { claude: fakeModelIcon } }
})

describe('icon loader', () => {
  it('loads a provider icon without touching the model catalog', async () => {
    const { loadProviderIcon } = await import('../loader')
    const icon = await loadProviderIcon('openai')
    expect(icon).toBe(fakeProviderIcon)
    expect(modelCatalogEvaluated).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent loads of the same catalog', async () => {
    const { loadProviderIcon, loadProviderIconCatalog } = await import('../loader')
    const [a, b, catalog] = await Promise.all([
      loadProviderIcon('openai'),
      loadProviderIcon('openai'),
      loadProviderIconCatalog()
    ])
    expect(a).toBe(fakeProviderIcon)
    expect(b).toBe(fakeProviderIcon)
    expect(catalog.openai).toBe(fakeProviderIcon)
    expect(providerCatalogEvaluated).toHaveBeenCalledTimes(1)
  })

  it('exposes loaded icons synchronously via getLoadedIcon', async () => {
    const { getLoadedIcon, loadIcon } = await import('../loader')
    const modelRef = { kind: 'model', key: 'claude', meta: { id: 'claude', colorPrimary: '#222' } } as never
    expect(getLoadedIcon(modelRef)).toBeUndefined()
    const icon = await loadIcon(modelRef)
    expect(icon).toBe(fakeModelIcon)
    expect(getLoadedIcon(modelRef)).toBe(fakeModelIcon)
  })
})
