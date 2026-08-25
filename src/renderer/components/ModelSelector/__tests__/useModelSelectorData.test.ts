import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { CHERRY_CLOUD_MODEL_GROUP, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelSelectorModelItem } from '../types'
import { useModelSelectorData } from '../useModelSelectorData'

const mockUseModels = vi.fn()
const mockUseProviders = vi.fn()
const mockUsePins = vi.fn()

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: unknown[]) => mockUseModels(...args)
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: (...args: unknown[]) => mockUseProviders(...args)
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: (...args: unknown[]) => mockUsePins(...args)
}))

vi.mock('@renderer/i18n/label', () => ({
  getProviderLabelKey: (id: string) => `label(${id})`
}))

function makeProvider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: `name(${id})`,
    apiKeys: [],
    authType: 'apiKey',
    reportsActualCost: false,
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

function wireDeps({
  providers,
  models,
  pinnedIds = [],
  isModelsLoading = false,
  isPinsLoading = false,
  isPinsRefreshing = false,
  isPinsMutating = false
}: {
  providers: Provider[]
  models: Model[]
  pinnedIds?: string[]
  isModelsLoading?: boolean
  isPinsLoading?: boolean
  isPinsRefreshing?: boolean
  isPinsMutating?: boolean
}) {
  mockUseProviders.mockReturnValue({
    providers,
    isLoading: false,
    refetch: vi.fn(),
    createProvider: vi.fn(),
    isCreating: false,
    createError: undefined
  })
  mockUseModels.mockReturnValue({
    models,
    isLoading: isModelsLoading,
    refetch: vi.fn()
  })
  mockUsePins.mockReturnValue({
    isLoading: isPinsLoading,
    isRefreshing: isPinsRefreshing,
    isMutating: isPinsMutating,
    error: undefined,
    pinnedIds,
    refetch: vi.fn(),
    togglePin: vi.fn()
  })
}

beforeEach(() => {
  mockUseModels.mockReset()
  mockUseProviders.mockReset()
  mockUsePins.mockReset()
})

describe('useModelSelectorData', () => {
  it('passes the selector activation state to every catalog query', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')]
    })

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useModelSelectorData({ enabled, searchText: '' }),
      { initialProps: { enabled: false } }
    )

    expect(mockUseProviders).toHaveBeenLastCalledWith({ enabled: true }, { enabled: false })
    expect(mockUseModels).toHaveBeenLastCalledWith({ enabled: true }, { fetchEnabled: false })
    expect(mockUsePins).toHaveBeenLastCalledWith('model', { enabled: false })

    rerender({ enabled: true })

    expect(mockUseProviders).toHaveBeenLastCalledWith({ enabled: true }, { enabled: true })
    expect(mockUseModels).toHaveBeenLastCalledWith({ enabled: true }, { fetchEnabled: true })
    expect(mockUsePins).toHaveBeenLastCalledWith('model', { enabled: true })
  })

  it('groups models under known providers and drops orphan models', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic')],
      models: [makeModel('gpt-4', 'openai'), makeModel('claude-3', 'anthropic'), makeModel('gemini-pro', 'google')]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.listItems.filter((item) => item.type === 'group').map((item) => item.key)).toEqual([
      'provider-openai',
      'provider-anthropic'
    ])
    expect(result.current.modelItems.map((item) => item.modelId)).toEqual(['openai::gpt-4', 'anthropic::claude-3'])
    expect(result.current.selectableModelsById.has('google::gemini-pro')).toBe(false)
  })

  it.each(['cherryai', LOCAL_EMBEDDING_PROVIDER_ID])('hides the provider settings action for %s', (providerId) => {
    wireDeps({
      providers: [makeProvider(providerId)],
      models: [makeModel('qwen', providerId)]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.listItems.find((item) => item.type === 'group')).toMatchObject({
      key: `provider-${providerId}`,
      canNavigateToSettings: false
    })
  })

  it('places prioritized providers first and preserves the remaining order', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic'), makeProvider('google')],
      models: [makeModel('gpt-4', 'openai'), makeModel('claude-3', 'anthropic'), makeModel('gemini-pro', 'google')]
    })

    const { result } = renderHook(() =>
      useModelSelectorData({ searchText: '', prioritizedProviderIds: ['google', 'anthropic'] })
    )

    expect(result.current.sortedProviders.map((provider) => provider.id)).toEqual(['google', 'anthropic', 'openai'])
  })

  it('does not synthesize a prioritized provider when it is not registered', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')]
    })

    const { result } = renderHook(() =>
      useModelSelectorData({ searchText: '', prioritizedProviderIds: ['local-embedding'] })
    )

    expect(result.current.sortedProviders.map((provider) => provider.id)).toEqual(['openai'])
    expect(result.current.listItems.some((item) => item.key.includes('local-embedding'))).toBe(false)
  })

  it('renders pinned rows first, in pin order, without provider-group duplicates', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic')],
      models: [makeModel('gpt-4', 'openai'), makeModel('gpt-3.5', 'openai'), makeModel('claude-3', 'anthropic')],
      pinnedIds: ['anthropic::claude-3', 'openai::gpt-4']
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))
    const pinnedRows = result.current.modelItems.filter((item) => item.isPinned)
    const providerRows = result.current.modelItems.filter((item) => !item.isPinned)

    expect(result.current.listItems[0].key).toBe('pinned-group')
    expect(pinnedRows.map((item) => item.modelId)).toEqual(['anthropic::claude-3', 'openai::gpt-4'])
    expect(providerRows.map((item) => item.modelId)).toEqual(['openai::gpt-3.5'])
  })

  it('keeps loading and pin-action readiness as separate states', () => {
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

  it('keeps the selector loading until pin data is ready', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')],
      isPinsLoading: true
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isPinActionDisabled).toBe(true)
  })

  it('drops malformed pin values before creating pinned rows', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai')],
      pinnedIds: ['not-a-model-id', 'openai::gpt-4']
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))

    expect(result.current.pinnedIds).toEqual(['openai::gpt-4'])
    expect(result.current.modelItems.filter((item) => item.isPinned).map((item) => item.modelId)).toEqual([
      'openai::gpt-4'
    ])
  })

  it('searches the combined model data and collapses pinned rows into provider groups', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic')],
      models: [makeModel('gpt-4', 'openai'), makeModel('claude-3', 'anthropic', { name: 'Claude 3' })],
      pinnedIds: ['anthropic::claude-3']
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: 'claude' }))

    expect(result.current.listItems.some((item) => item.key === 'pinned-group')).toBe(false)
    expect(result.current.modelItems).toHaveLength(1)
    expect(result.current.modelItems[0]).toMatchObject({
      modelId: 'anthropic::claude-3',
      isPinned: true,
      groupKind: 'provider'
    })
  })

  it('deduplicates selectable ids while applying the selection cap only to row state', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [makeModel('gpt-4', 'openai'), makeModel('gpt-3.5', 'openai')]
    })

    const { result } = renderHook(() =>
      useModelSelectorData({
        searchText: '',
        maxSelectedCount: 1,
        selectedModelIds: ['openai::gpt-4', 'openai::gpt-4', 'openai::gpt-3.5', 'anthropic::stale']
      })
    )

    expect(result.current.resolvedSelectedModelIds).toEqual(['openai::gpt-4', 'openai::gpt-3.5'])
    expect([...result.current.visibleSelectedModelIdSet]).toEqual(['openai::gpt-4'])
  })

  it('hides agent-only providers generally and includes them for a marked agent filter', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('claude-code', { authMethods: ['external-cli'] })],
      models: [makeModel('gpt-4', 'openai'), makeModel('claude-sonnet', 'claude-code')]
    })

    const general = renderHook(() => useModelSelectorData({ searchText: '' }))
    expect(general.result.current.modelItems.map((item) => item.modelId)).toEqual(['openai::gpt-4'])
    general.unmount()

    const agentFilter = renderHook(() => useAgentModelFilter('claude-code'))
    const agent = renderHook(() => useModelSelectorData({ searchText: '', filter: agentFilter.result.current }))

    expect(agent.result.current.modelItems.map((item) => item.modelId).sort()).toEqual([
      'claude-code::claude-sonnet',
      'openai::gpt-4'
    ])
  })

  it('shows Cherry Cloud models only in agent selectors', () => {
    wireDeps({
      providers: [makeProvider(CHERRYAI_PROVIDER_ID)],
      models: [
        makeModel('qwen', CHERRYAI_PROVIDER_ID, { group: 'Qwen' }),
        makeModel('deepseek-free', CHERRYAI_PROVIDER_ID, {
          group: CHERRY_CLOUD_MODEL_GROUP,
          contextWindow: 128_000
        })
      ]
    })

    const general = renderHook(() => useModelSelectorData({ searchText: '' }))
    expect(general.result.current.modelItems.map((item) => item.modelId)).toEqual(['cherryai::qwen'])
    general.unmount()

    for (const agentType of ['claude-code', 'pi', 'dsh'] as const) {
      const agentFilter = renderHook(() => useAgentModelFilter(agentType))
      const agent = renderHook(() => useModelSelectorData({ searchText: '', filter: agentFilter.result.current }))

      expect(agent.result.current.modelItems.map((item) => item.modelId).sort()).toEqual(['cherryai::deepseek-free'])
      agent.unmount()
      agentFilter.unmount()
    }
  })

  it('applies the caller filter before deriving available tags', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [
        makeModel('gpt-4', 'openai', { capabilities: [MODEL_CAPABILITY.REASONING] }),
        makeModel('embed', 'openai', { capabilities: [MODEL_CAPABILITY.EMBEDDING] })
      ]
    })

    const { result } = renderHook(() =>
      useModelSelectorData({
        searchText: '',
        filter: (model) => model.capabilities.includes(MODEL_CAPABILITY.REASONING)
      })
    )

    expect(result.current.modelItems.map((item) => item.modelId)).toEqual(['openai::gpt-4'])
    expect(result.current.availableTags).toContain(MODEL_CAPABILITY.REASONING)
    expect(result.current.availableTags).not.toContain(MODEL_CAPABILITY.EMBEDDING)
  })

  it('marks duplicate model names with identifiers for disambiguation', () => {
    wireDeps({
      providers: [makeProvider('openai')],
      models: [
        makeModel('variant-a', 'openai', { name: 'GPT-4', apiModelId: 'gpt-4-variant-a' }),
        makeModel('variant-b', 'openai', { name: 'GPT-4', apiModelId: 'gpt-4-variant-b' }),
        makeModel('unique', 'openai', { name: 'GPT-3.5' })
      ]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))
    const byModelId = new Map<string, ModelSelectorModelItem>(
      result.current.modelItems.map((item) => [item.modelId, item])
    )

    expect(byModelId.get('openai::variant-a')?.showIdentifier).toBe(true)
    expect(byModelId.get('openai::variant-b')?.showIdentifier).toBe(true)
    expect(byModelId.get('openai::unique')?.showIdentifier).toBe(false)
  })

  it('uses provider groups to disambiguate matching names from different providers', () => {
    wireDeps({
      providers: [makeProvider('openai'), makeProvider('anthropic')],
      models: [
        makeModel('gpt-4', 'openai', { name: 'Shared model' }),
        makeModel('claude-alias', 'anthropic', { name: 'Shared model' })
      ]
    })

    const { result } = renderHook(() => useModelSelectorData({ searchText: '' }))
    const byModelId = new Map<string, ModelSelectorModelItem>(
      result.current.modelItems.map((item) => [item.modelId, item])
    )

    expect(byModelId.get('openai::gpt-4')?.showIdentifier).toBe(false)
    expect(byModelId.get('anthropic::claude-alias')?.showIdentifier).toBe(false)
  })
})
