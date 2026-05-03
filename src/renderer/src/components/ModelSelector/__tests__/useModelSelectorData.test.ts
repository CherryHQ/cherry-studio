import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelSelectorModelItem } from '../types'
import { useModelSelectorData } from '../useModelSelectorData'

// ─── Mock hook deps ───────────────────────────────────────────────────
const mockUseModelsFn = vi.fn()
const mockUseProvidersFn = vi.fn()
const mockUsePinsFn = vi.fn()

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: unknown[]) => mockUseModelsFn(...args)
}))
vi.mock('@renderer/hooks/useProviders', () => ({
  useProviders: (...args: unknown[]) => mockUseProvidersFn(...args)
}))
vi.mock('@renderer/hooks/usePins', () => ({
  usePins: (...args: unknown[]) => mockUsePinsFn(...args)
}))
vi.mock('@renderer/i18n/label', () => ({
  getProviderLabel: (id: string) => `label(${id})`
}))

// ─── Fixtures ─────────────────────────────────────────────────────────
function makeProvider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: `name(${id})`,
    apiKeys: [],
    authType: 'apiKey',
    apiFeatures: {} as Provider['apiFeatures'],
    settings: {} as Provider['settings'],
    isEnabled: true,
    ...overrides
  } as Provider
}

function makeModel(id: string, providerId: string, overrides: Partial<Model> = {}): Model {
  return {
    id: `${providerId}::${id}`,
    providerId,
    name: id,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

function wireDeps(opts: {
  providers: Provider[]
  models: Model[]
  pinnedIds?: string[]
  isModelsLoading?: boolean
  isPinsLoading?: boolean
  isPinsRefreshing?: boolean
  isPinsMutating?: boolean
}) {
  mockUseProvidersFn.mockReturnValue({
    providers: opts.providers,
    isLoading: false,
    refetch: vi.fn(),
    createProvider: vi.fn(),
    isCreating: false,
    createError: undefined
  })
  mockUseModelsFn.mockReturnValue({
    models: opts.models,
    isLoading: opts.isModelsLoading ?? false,
    refetch: vi.fn()
  })
  mockUsePinsFn.mockReturnValue({
    isLoading: opts.isPinsLoading ?? false,
    isRefreshing: opts.isPinsRefreshing ?? false,
    isMutating: opts.isPinsMutating ?? false,
    error: undefined,
    pinnedIds: opts.pinnedIds ?? [],
    refetch: vi.fn(),
    togglePin: vi.fn()
  })
}

beforeEach(() => {
  mockUseModelsFn.mockReset()
  mockUseProvidersFn.mockReset()
  mockUsePinsFn.mockReset()
})

// ─── Tests ────────────────────────────────────────────────────────────
describe('useModelSelectorData', () => {
  it('groups models by their enabled provider', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic')],
      models: [makeModel('gpt-4', 'openai'), makeModel('gpt-3.5', 'openai'), makeModel('claude-3', 'anthropic')]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    const groups = result.current.listItems.filter((i) => i.type === 'group')
    expect(groups.map((g) => g.key)).toEqual(['provider-openai', 'provider-anthropic'])
    expect(result.current.modelItems).toHaveLength(3)
  })

  it('prefers caller-provided provider and model overrides over shared hook data', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')]
    })

    const { result } = renderHook(() =>
      useModelSelectorData({
        searchText: '',
        providersOverride: [makeProvider('painting-provider', { isEnabled: false })],
        modelsOverride: [makeModel('image-model', 'painting-provider')],
        isDataLoadingOverride: true
      })
    )

    expect(result.current.sortedProviders.map((provider) => provider.id)).toEqual(['painting-provider'])
    expect(result.current.modelItems.map((item) => item.modelId)).toEqual(['painting-provider::image-model'])
    expect(result.current.isLoading).toBe(true)
    expect(mockUseProvidersFn).toHaveBeenCalledWith({ enabled: true }, { fetchEnabled: false })
    expect(mockUseModelsFn).toHaveBeenCalledWith({ enabled: true }, { fetchEnabled: false })
  })

  it('drops orphan models whose providerId is not in the providers list', () => {
    // Cross-filter invariant: a model whose provider is disabled/missing must not appear
    wireDeps({
      providers: [makeProvider('openai')], // anthropic removed
      models: [makeModel('gpt-4', 'openai'), makeModel('claude-3', 'anthropic')]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.modelItems.map((m) => m.modelId)).toEqual(['openai::gpt-4'])
    expect(result.current.selectableModelsById.has('anthropic::claude-3')).toBe(false)
  })

  it('honors prioritizedProviderIds ordering', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic'), makeProvider('google')],
      models: [makeModel('gpt-4', 'openai'), makeModel('claude-3', 'anthropic'), makeModel('gemini-pro', 'google')]
    })

    const { result } = renderHook(() =>
      useModelSelectorData({ searchText: '', prioritizedProviderIds: ['google', 'anthropic'] })
    )

    expect(result.current.sortedProviders.map((p) => p.id)).toEqual(['google', 'anthropic', 'openai'])
  })

  it('emits pinned group above provider groups and excludes pinned models from their provider group', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic')],
      models: [makeModel('gpt-4', 'openai'), makeModel('gpt-3.5', 'openai'), makeModel('claude-3', 'anthropic')],
      pinnedIds: ['openai::gpt-4']
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    const keys = result.current.listItems.map((i) => i.key)
    expect(keys[0]).toBe('pinned-group')
    // Pinned entry appears once in pinned group; the openai group should not duplicate it
    const openaiModelRows = result.current.listItems.filter(
      (i): i is ModelSelectorModelItem => i.type === 'model' && i.provider.id === 'openai' && !i.isPinned
    )
    expect(openaiModelRows.map((r) => r.modelId)).toEqual(['openai::gpt-3.5'])
  })

  it('keeps pinned group rows in pin table order instead of provider order', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic')],
      models: [makeModel('gpt-4', 'openai'), makeModel('claude-3', 'anthropic')],
      pinnedIds: ['anthropic::claude-3', 'openai::gpt-4']
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    const pinnedRows = result.current.listItems.filter(
      (item): item is ModelSelectorModelItem => item.type === 'model' && item.isPinned
    )
    expect(pinnedRows.map((row) => row.modelId)).toEqual(['anthropic::claude-3', 'openai::gpt-4'])
  })

  it('keeps selector loading until model pins are ready', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')],
      isPinsLoading: true
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.isLoading).toBe(true)
  })

  it('disables pin actions during refresh or mutation without blocking the full selector', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')],
      isPinsRefreshing: true,
      isPinsMutating: true
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.isLoading).toBe(false)
    expect(result.current.isPinActionDisabled).toBe(true)
  })

  it('drops non-UniqueModelId values returned from model pins before rendering pinned rows', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')],
      pinnedIds: ['not-a-model-id', 'openai::gpt-4']
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    const pinnedRows = result.current.modelItems.filter((item) => item.isPinned)
    expect(result.current.pinnedIds).toEqual(['openai::gpt-4'])
    expect(pinnedRows.map((row) => row.modelId)).toEqual(['openai::gpt-4'])
  })

  it('collapses pinned group back into provider group while searching', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai'), makeModel('gpt-3.5', 'openai')],
      pinnedIds: ['openai::gpt-4']
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: 'gpt' }))

    expect(result.current.listItems.some((i) => i.key === 'pinned-group')).toBe(false)
    // gpt-4 still selectable; search branch bypasses the pinned-exclusion rule
    expect(result.current.modelItems.map((m) => m.modelId).sort()).toEqual(['openai::gpt-3.5', 'openai::gpt-4'])
  })

  it('filters models by search text against name, id, provider name', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic')],
      models: [makeModel('gpt-4', 'openai'), makeModel('claude-3', 'anthropic', { name: 'Claude 3' })]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: 'claude' }))

    expect(result.current.modelItems.map((m) => m.modelId)).toEqual(['anthropic::claude-3'])
  })

  it('resolvedSelectedModelIds keeps order, dedupes, and drops non-selectable ids', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')]
    })

    const { result } = renderHook(() =>
      useModelSelectorData({
        searchText: '',
        selectedModelIds: ['openai::gpt-4', 'openai::gpt-4', 'anthropic::stale-id']
      })
    )

    // Stale id (not in selectableModels) is dropped; dupes deduped; order preserved.
    expect(result.current.resolvedSelectedModelIds).toEqual(['openai::gpt-4'])
  })

  it('maxSelectedCount only affects which rows render as selected, not resolvedSelectedModelIds', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai'), makeModel('gpt-3.5', 'openai')]
    })

    const { result } = renderHook(() =>
      useModelSelectorData({
        searchText: '',
        maxSelectedCount: 1,
        selectedModelIds: ['openai::gpt-4', 'openai::gpt-3.5']
      })
    )

    // resolved list keeps both ids — business data is never truncated by the UI cap
    expect(result.current.resolvedSelectedModelIds).toEqual(['openai::gpt-4', 'openai::gpt-3.5'])

    // but only the first one is rendered as `isSelected`
    const selectedRows = result.current.modelItems.filter((m) => m.isSelected).map((m) => m.modelId)
    expect(selectedRows).toEqual(['openai::gpt-4'])
  })

  it('applies caller-provided filter predicate', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [
        makeModel('gpt-4', 'openai', { capabilities: [MODEL_CAPABILITY.REASONING] }),
        makeModel('gpt-3.5', 'openai')
      ]
    })

    const { result } = renderHook(() =>
      useModelSelectorData({
        searchText: '',
        filter: (model) => model.capabilities.includes(MODEL_CAPABILITY.REASONING)
      })
    )

    expect(result.current.modelItems.map((m) => m.modelId)).toEqual(['openai::gpt-4'])
  })

  it('exposes availableTags that are actually represented in the filtered model pool', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [
        makeModel('gpt-4', 'openai', { capabilities: [MODEL_CAPABILITY.REASONING] }),
        makeModel('embed', 'openai', { capabilities: [MODEL_CAPABILITY.EMBEDDING] })
      ]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.availableTags).toContain(MODEL_CAPABILITY.REASONING)
    expect(result.current.availableTags).toContain(MODEL_CAPABILITY.EMBEDDING)
    expect(result.current.availableTags).not.toContain(MODEL_CAPABILITY.IMAGE_RECOGNITION)
  })

  it('marks duplicate model names with showIdentifier so users can disambiguate', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [
        makeModel('variant-a', 'openai', { name: 'GPT-4', apiModelId: 'gpt-4-variant-a' }),
        makeModel('variant-b', 'openai', { name: 'GPT-4', apiModelId: 'gpt-4-variant-b' }),
        makeModel('unique', 'openai', { name: 'GPT-3.5' })
      ]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    const byModelId = new Map(result.current.modelItems.map((m) => [m.modelId, m]))
    expect(byModelId.get('openai::variant-a')?.showIdentifier).toBe(true)
    expect(byModelId.get('openai::variant-b')?.showIdentifier).toBe(true)
    expect(byModelId.get('openai::unique')?.showIdentifier).toBe(false)
  })
})
