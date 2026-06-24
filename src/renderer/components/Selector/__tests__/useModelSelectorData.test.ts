import { type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelSelectorModelItem } from '../model/types'
import { useModelSelectorData } from '../model/useModelSelectorData'

// ─── Mock hook deps ───────────────────────────────────────────────────
const mockUseModelsFn = vi.fn()
const mockUseProvidersFn = vi.fn()
const mockUsePinsFn = vi.fn()

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: unknown[]) => mockUseModelsFn(...args)
}))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: (...args: unknown[]) => mockUseProvidersFn(...args)
}))
vi.mock('@renderer/hooks/usePins', () => ({
  usePins: (...args: unknown[]) => mockUsePinsFn(...args)
}))
vi.mock('@renderer/i18n/label', () => ({
  getProviderLabelKey: (id: string) => `label(${id})`
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
  refetchModels?: () => Promise<unknown>
  refetchPinnedModels?: () => Promise<unknown>
  refetchProviders?: () => Promise<unknown>
}) {
  mockUseProvidersFn.mockReturnValue({
    providers: opts.providers,
    isLoading: false,
    refetch: opts.refetchProviders ?? vi.fn().mockResolvedValue(undefined),
    createProvider: vi.fn(),
    isCreating: false,
    createError: undefined
  })
  mockUseModelsFn.mockReturnValue({
    models: opts.models,
    isLoading: opts.isModelsLoading ?? false,
    refetch: opts.refetchModels ?? vi.fn().mockResolvedValue(undefined)
  })
  mockUsePinsFn.mockReturnValue({
    isLoading: opts.isPinsLoading ?? false,
    isRefreshing: opts.isPinsRefreshing ?? false,
    isMutating: opts.isPinsMutating ?? false,
    error: undefined,
    pinnedIds: opts.pinnedIds ?? [],
    refetch: opts.refetchPinnedModels ?? vi.fn().mockResolvedValue(undefined),
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
  it('exposes model, provider, and pinned refetch callbacks', () => {
    const refetchModels = vi.fn(async () => undefined)
    const refetchProviders = vi.fn(async () => undefined)
    const refetchPinnedModels = vi.fn(async () => undefined)
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')],
      refetchModels,
      refetchProviders,
      refetchPinnedModels
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.refetchModels).toBe(refetchModels)
    expect(result.current.refetchProviders).toBe(refetchProviders)
    expect(result.current.refetchPinnedModels).toBe(refetchPinnedModels)
  })

  it('enables local focus revalidation for model and provider list queries', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')]
    })

    renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(mockUseProvidersFn).toHaveBeenCalledWith({ enabled: true }, { swrOptions: { revalidateOnFocus: true } })
    expect(mockUseModelsFn).toHaveBeenCalledWith({ enabled: true }, { swrOptions: { revalidateOnFocus: true } })
  })

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

  it('routes the CherryAI provider group settings action to CherryIN settings', () => {
    wireDeps({
      providers: [makeProvider('cherryai')],
      models: [makeModel('qwen', 'cherryai')]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.listItems.find((item) => item.type === 'group')).toMatchObject({
      key: 'provider-cherryai',
      canNavigateToSettings: true,
      settingsProviderId: 'cherryin'
    })
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

  it('matches model abbreviations as ordered characters', () => {
    wireDeps({
      providers: [makeProvider('deepseek')],
      models: [makeModel('deepseek-v4', 'deepseek', { name: 'DeepSeekV4' })]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: 'deepv4' }))

    expect(result.current.modelItems.map((m) => m.modelId)).toEqual(['deepseek::deepseek-v4'])
  })

  it('matches short model abbreviations as ordered characters', () => {
    wireDeps({
      providers: [makeProvider('deepseek')],
      models: [makeModel('deepseek-v4', 'deepseek', { name: 'DeepSeekV4' })]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: 'dv' }))

    expect(result.current.modelItems.map((m) => m.modelId)).toEqual(['deepseek::deepseek-v4'])
  })

  it('ranks separator-insensitive exact matches before loose abbreviation matches', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [
        makeModel('gpt-4', 'openai', { name: 'GPT-4' }),
        makeModel('giant-prompt-tool-4', 'openai', { name: 'A Giant Prompt Tool 4' })
      ]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: 'gpt4' }))

    expect(result.current.modelItems.map((m) => m.modelId)).toEqual(['openai::gpt-4', 'openai::giant-prompt-tool-4'])
  })

  it('ranks token-initial abbreviations before compact loose character matches', () => {
    wireDeps({
      providers: [makeProvider('siliconflow')],
      models: [
        makeModel('funaudio-cosyvoice', 'siliconflow', { name: 'FunAudioLLM/CosyVoice2-0.5' }),
        makeModel('deepseek-v3', 'siliconflow', { name: 'Pro/deepseek-ai/DeepSeek-V3' })
      ]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: 'dsv' }))

    expect(result.current.modelItems.map((m) => m.modelId)).toEqual([
      'siliconflow::deepseek-v3',
      'siliconflow::funaudio-cosyvoice'
    ])
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

    // but only the first one is exposed as visible-selected for row rendering
    expect([...result.current.visibleSelectedModelIdSet]).toEqual(['openai::gpt-4'])
  })

  it('keeps filtered model groups stable when only the selected ids change', () => {
    const filter = vi.fn(() => true)
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai'), makeModel('gpt-3.5', 'openai')],
      pinnedIds: ['openai::gpt-4']
    })

    const { result, rerender } = renderHook(
      ({ selectedModelIds }: { selectedModelIds: UniqueModelId[] }) =>
        useModelSelectorData({ searchText: '', selectedModelIds, filter }),
      { initialProps: { selectedModelIds: [] as UniqueModelId[] } }
    )
    const listItemsBeforeSelection = result.current.listItems
    const modelItemsBeforeSelection = result.current.modelItems

    expect(filter).toHaveBeenCalled()
    filter.mockClear()

    rerender({ selectedModelIds: ['openai::gpt-4'] })

    expect(filter).not.toHaveBeenCalled()
    expect(result.current.listItems).toBe(listItemsBeforeSelection)
    expect(result.current.modelItems).toBe(modelItemsBeforeSelection)
    expect(result.current.visibleSelectedModelIdSet.has('openai::gpt-4')).toBe(true)
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
