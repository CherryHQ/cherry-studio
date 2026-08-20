import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const fakeOpenaiIcon = { colorPrimary: '#111' } as never
  const fakeAnthropicIcon = { colorPrimary: '#333' } as never
  const fakeModelIcon = { colorPrimary: '#222' } as never

  return {
    fakeOpenaiIcon,
    fakeAnthropicIcon,
    fakeModelIcon,
    providerCatalogEvaluated: vi.fn(),
    providerLoadersEvaluated: vi.fn(),
    modelLoadersEvaluated: vi.fn(),
    loadOpenai: vi.fn(async () => fakeOpenaiIcon),
    loadAnthropic: vi.fn(async () => fakeAnthropicIcon),
    loadClaude: vi.fn(async () => fakeModelIcon)
  }
})

vi.mock('../providers/catalog', () => {
  state.providerCatalogEvaluated()
  return {
    PROVIDER_ICON_CATALOG: {
      openai: state.fakeOpenaiIcon,
      anthropic: state.fakeAnthropicIcon
    }
  }
})

vi.mock('../providers/loaders', () => {
  state.providerLoadersEvaluated()
  return {
    PROVIDER_ICON_LOADERS: {
      openai: state.loadOpenai,
      anthropic: state.loadAnthropic
    }
  }
})

vi.mock('../models/loaders', () => {
  state.modelLoadersEvaluated()
  return { MODEL_ICON_LOADERS: { claude: state.loadClaude } }
})

describe('icon loader', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('loads only the requested provider implementation', async () => {
    const { loadProviderIcon } = await import('../loader')
    const icon = await loadProviderIcon('openai')
    expect(icon).toBe(state.fakeOpenaiIcon)
    expect(state.providerLoadersEvaluated).toHaveBeenCalledTimes(1)
    expect(state.loadOpenai).toHaveBeenCalledTimes(1)
    expect(state.loadAnthropic).not.toHaveBeenCalled()
    expect(state.providerCatalogEvaluated).not.toHaveBeenCalled()
    expect(state.modelLoadersEvaluated).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent loads of the same icon', async () => {
    const { loadProviderIcon } = await import('../loader')
    const [a, b] = await Promise.all([loadProviderIcon('openai'), loadProviderIcon('openai')])
    expect(a).toBe(state.fakeOpenaiIcon)
    expect(b).toBe(state.fakeOpenaiIcon)
    expect(state.loadOpenai).toHaveBeenCalledTimes(1)
  })

  it('loads model icons independently and exposes them synchronously', async () => {
    const { getLoadedIcon, loadIcon } = await import('../loader')
    const modelRef = { kind: 'model', key: 'claude', meta: { id: 'claude', colorPrimary: '#222' } } as never
    expect(getLoadedIcon(modelRef)).toBeUndefined()
    const icon = await loadIcon(modelRef)
    expect(icon).toBe(state.fakeModelIcon)
    expect(getLoadedIcon(modelRef)).toBe(state.fakeModelIcon)
    expect(state.loadClaude).toHaveBeenCalledTimes(1)
    expect(state.providerLoadersEvaluated).not.toHaveBeenCalled()
    expect(state.providerCatalogEvaluated).not.toHaveBeenCalled()
  })

  it('keeps the explicit provider bulk catalog compatible and seeds the icon cache', async () => {
    const { getLoadedIcon, loadProviderIcon, loadProviderIconCatalog } = await import('../loader')
    const catalog = await loadProviderIconCatalog()
    const openaiRef = { kind: 'provider', key: 'openai', meta: { id: 'openai', colorPrimary: '#111' } } as never

    expect(catalog.openai).toBe(state.fakeOpenaiIcon)
    expect(getLoadedIcon(openaiRef)).toBe(state.fakeOpenaiIcon)
    expect(await loadProviderIcon('anthropic')).toBe(state.fakeAnthropicIcon)
    expect(state.providerCatalogEvaluated).toHaveBeenCalledTimes(1)
    expect(state.providerLoadersEvaluated).not.toHaveBeenCalled()
    expect(state.loadAnthropic).not.toHaveBeenCalled()
  })

  it('keeps per-icon loading available after the provider catalog fails', async () => {
    // The top-level vi.mock factory result is cached across vi.resetModules(),
    // so a state flag can't flip it; vi.doMock re-registers the factory each
    // call. Vitest also wraps factory throws in its own error, hence the
    // message-less rejects.toThrow().
    vi.doMock('../providers/catalog', () => {
      throw new Error('provider catalog chunk failed')
    })
    const { loadProviderIcon, loadProviderIconCatalog } = await import('../loader')

    await expect(loadProviderIconCatalog()).rejects.toThrow()

    vi.doMock('../providers/catalog', () => ({
      PROVIDER_ICON_CATALOG: {
        openai: state.fakeOpenaiIcon,
        anthropic: state.fakeAnthropicIcon
      }
    }))

    await expect(loadProviderIcon('openai')).resolves.toBe(state.fakeOpenaiIcon)
    expect(state.loadOpenai).toHaveBeenCalledTimes(1)
    // The failed catalog promise was reset, so a later bulk load retries the chunk.
    const catalog = await loadProviderIconCatalog()
    expect(catalog.openai).toBe(state.fakeOpenaiIcon)
  })
})
