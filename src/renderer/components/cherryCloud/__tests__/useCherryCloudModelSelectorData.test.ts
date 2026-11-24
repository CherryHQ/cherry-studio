import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHERRY_CLOUD_PROVIDER_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CherryCloudAccountPlans, CherryCloudPlanModel } from '@shared/ipc/schemas/cherryCloud'

import {
  isCherryCloudChatOffer,
  useCherryCloudModelSelectorData,
  useCherryCloudModelSelectorOffers,
  useCherryCloudModelSelectorPolicy
} from '../useCherryCloudModelSelectorData'

const mocks = vi.hoisted(() => ({
  phase: 'signed-in' as 'signed-in' | 'signed-out',
  data: undefined as CherryCloudAccountPlans | undefined,
  ready: true,
  amdLocked: [] as CherryCloudPlanModel[],
  signInLocked: [] as CherryCloudPlanModel[],
  isModelHidden: vi.fn(() => false),
  isModelFree: vi.fn(() => true),
  isModelUnavailable: vi.fn(() => false),
  getModelDescription: vi.fn(() => 'Limited-time free')
}))
vi.mock('@renderer/hooks/useCherryCloudPlans', () => ({
  useCherryCloudPlans: () => ({
    session: { status: { phase: mocks.phase } },
    plansQuery: { data: mocks.data },
    isPlansReady: mocks.ready,
    activePaid: mocks.ready
      ? mocks.data?.entitlements.find((item) => item.state === 'active' && !item.plan.is_free)
      : undefined,
    upcomingPaid: mocks.ready
      ? mocks.data?.entitlements.find((item) => item.state === 'upcoming' && !item.plan.is_free)
      : undefined
  })
}))
vi.mock('@renderer/hooks/useCherryCloudModelAvailability', () => ({
  useCherryCloudModelAvailability: () => ({
    isModelHidden: mocks.isModelHidden,
    isModelFree: mocks.isModelFree,
    isModelUnavailable: mocks.isModelUnavailable,
    getModelDescription: mocks.getModelDescription,
    isAvailabilityReady: true,
    availabilityError: undefined,
    amdActivationRequiredModels: mocks.amdLocked,
    signInRequiredModels: mocks.signInLocked
  })
}))

const offer = (id: string, available_features: CherryCloudPlanModel['available_features']): CherryCloudPlanModel => ({
  id,
  display_name: id.toUpperCase(),
  capabilities: ['reasoning'],
  available_features
})
const catalog = [
  offer('general', ['agent', 'chat', 'translate']),
  offer('work', ['agent']),
  offer('chat-only', ['chat'])
]
function plans(state?: 'active' | 'upcoming'): CherryCloudAccountPlans {
  const plan = {
    id: 'bb75457d-ed6e-4b10-bb9a-62f9504b03c4',
    display_name: 'Plus',
    is_free: false,
    default_for_new_accounts: false,
    quota_pool_count: 1,
    model_count: 3,
    purchase_available: true,
    models: catalog
  }
  return {
    measured_at: '2026-11-09T00:00:00Z',
    available_plans: [plan, { ...plan, id: '4ac04749-49f0-4930-9f9b-fbfe62999227' }],
    entitlements: state
      ? [
          {
            id: '3f37ec4a-7ca0-4787-b097-4c09c1ca087a',
            source: 'subscription',
            state,
            starts_at: '2026-11-10T00:00:00Z',
            plan,
            quota_pools: []
          }
        ]
      : []
  }
}
function wrapper({ children }: PropsWithChildren) {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children)
}

beforeEach(() => {
  MockUseCacheUtils.resetMocks()
  mocks.data = plans()
  mocks.phase = 'signed-in'
  mocks.ready = true
  mocks.amdLocked = []
  mocks.signInLocked = []
  mocks.isModelHidden.mockReset().mockReturnValue(false)
  mocks.isModelFree.mockReset().mockReturnValue(true)
  mockUseQuery.mockReturnValue({ data: [], isLoading: false, isRefreshing: false, refetch: vi.fn(), mutate: vi.fn() })
})

describe('Cloud selector policy', () => {
  it.each(['active', 'upcoming'] as const)(
    'keeps CherryAI first before sign-in, when a subscription is %s, and after it ends',
    (state) => {
      const providers: Provider[] = ['other-b', CHERRY_CLOUD_PROVIDER_ID, 'other-a', CHERRYAI_PROVIDER_ID].map(
        (id) => ({
          id,
          name: id,
          apiKeys: [],
          authType: 'api-key',
          reportsActualCost: false,
          settings: {},
          isEnabled: true
        })
      )
      const models: Model[] = providers.map(({ id }) => ({
        id: `${id}::model`,
        providerId: id,
        name: id,
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      }))
      mockUseQuery.mockImplementation((path) => ({
        data: path === '/providers' ? providers : path === '/models' ? models : [],
        isLoading: false,
        isRefreshing: false,
        refetch: vi.fn(),
        mutate: vi.fn()
      }))
      mocks.phase = 'signed-out'
      mocks.data = undefined
      const { result, rerender } = renderHook(() =>
        useCherryCloudModelSelectorData({ searchText: '', prioritizedProviderIds: ['other-a'] })
      )
      const groupIds = () =>
        result.current.listItems.flatMap((item) => (item.type === 'group' ? [item.provider?.id] : []))
      expect(groupIds()).toEqual([CHERRYAI_PROVIDER_ID, 'other-a', 'other-b'])

      mocks.phase = 'signed-in'
      mocks.data = plans(state)
      rerender()
      expect(groupIds()).toEqual([CHERRYAI_PROVIDER_ID, 'other-a', 'other-b'])

      mocks.data = plans()
      rerender()
      expect(groupIds()).toEqual([CHERRYAI_PROVIDER_ID, 'other-a', 'other-b'])

      MockUseCacheUtils.setPersistCacheValue('ui.model_selector.cherryai_pinned', false)
      rerender()
      expect(groupIds()).toEqual(['other-a', 'other-b', CHERRYAI_PROVIDER_ID])
    }
  )

  it('projects entitlement Free tags independently of the executable model name', () => {
    const model: Model = {
      id: `${CHERRY_CLOUD_PROVIDER_ID}::gpt-5`,
      providerId: CHERRY_CLOUD_PROVIDER_ID,
      name: 'GPT-5',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }
    const provider: Provider = {
      id: CHERRY_CLOUD_PROVIDER_ID,
      name: 'Cloud',
      apiKeys: [],
      authType: 'api-key',
      reportsActualCost: false,
      settings: {},
      isEnabled: true
    }
    const { result } = renderHook(() => useCherryCloudModelSelectorPolicy({}))
    expect(result.current.getModelPresentation(model, provider).tags).toContain('free')
    expect(result.current.getModelPresentation(model, provider).description).toBe('Limited-time free')
  })

  it('keeps general and agent feature gates separate and deduplicates offers across plans', () => {
    const { result, rerender } = renderHook(
      ({ agent }) => useCherryCloudModelSelectorOffers(true, agent, isCherryCloudChatOffer, true),
      { initialProps: { agent: false }, wrapper }
    )
    expect(result.current.offers.map(({ offer }) => offer.id)).toEqual(['general'])
    rerender({ agent: true })
    expect(result.current.offers.map(({ offer }) => offer.id)).toEqual(['general', 'work'])
  })

  it.each(['active', 'upcoming'] as const)('does not resell an already purchased %s plan', (state) => {
    mocks.data = plans(state)
    const { result } = renderHook(() => useCherryCloudModelSelectorOffers(true, false, isCherryCloudChatOffer, true), {
      wrapper
    })
    expect(result.current.paidPlan?.plan.display_name).toBe('Plus')
    expect(result.current.canOfferSubscription).toBe(false)
    expect(result.current.offers).toEqual([])
  })

  it('does not infer an unsubscribed account from stale or pending plans', () => {
    mocks.ready = false
    const { result } = renderHook(() => useCherryCloudModelSelectorOffers(true, false, isCherryCloudChatOffer, true), {
      wrapper
    })
    expect(result.current.canOfferSubscription).toBe(false)
    expect(result.current.offers).toEqual([])
  })

  it('offers the public paid catalog to a signed-out account without account-plan data', async () => {
    mocks.phase = 'signed-out'
    mocks.data = undefined
    vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({
      ok: true,
      data: {
        measured_at: '2026-11-09T00:00:00Z',
        plans: [{ id: 'bb75457d-ed6e-4b10-bb9a-62f9504b03c4', display_name: 'Plus', is_free: false, models: catalog }]
      }
    })
    const { result } = renderHook(() => useCherryCloudModelSelectorOffers(true, false, isCherryCloudChatOffer, true), {
      wrapper
    })
    await waitFor(() => expect(result.current.offers.map(({ offer }) => offer.id)).toEqual(['general']))
  })

  it('shows a signed-out account the free, standalone, paid and AMD catalogs, each behind its own unlock', async () => {
    mocks.phase = 'signed-out'
    mocks.data = undefined
    mocks.signInLocked = [offer('member-model', ['agent', 'chat', 'translate'])]
    mocks.amdLocked = [offer('amd/qwen', ['chat', 'translate'])]
    const general = ['agent', 'chat', 'translate'] as const
    vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({
      ok: true,
      data: {
        measured_at: '2026-11-09T00:00:00Z',
        plans: [
          {
            id: '4ac04749-49f0-4930-9f9b-fbfe62999227',
            display_name: 'Free',
            is_free: true,
            models: [offer('free-model', [...general]), offer('general', [...general])]
          },
          { id: 'bb75457d-ed6e-4b10-bb9a-62f9504b03c4', display_name: 'Plus', is_free: false, models: catalog }
        ]
      }
    })
    const { result } = renderHook(() => useCherryCloudModelSelectorOffers(true, false, isCherryCloudChatOffer, true), {
      wrapper
    })
    // A model in both a free and a paid plan only needs a sign-in.
    await waitFor(() =>
      expect(result.current.offers.map(({ kind, offer }) => [kind, offer.id])).toEqual([
        ['sign_in', 'free-model'],
        ['sign_in', 'general'],
        ['sign_in', 'member-model'],
        ['amd', 'amd/qwen']
      ])
    )
  })

  it('offers AMD authorization to a signed-in subscriber until the server reports the model authorized', () => {
    mocks.data = plans('active')
    mocks.amdLocked = [offer('amd/qwen', ['chat', 'translate'])]
    const { result, rerender } = renderHook(
      () => useCherryCloudModelSelectorOffers(true, false, isCherryCloudChatOffer, true),
      { wrapper }
    )
    expect(result.current.offers.map(({ kind, offer }) => [kind, offer.id])).toEqual([['amd', 'amd/qwen']])

    mocks.amdLocked = []
    rerender()
    expect(result.current.offers).toEqual([])
  })

  it('keeps every locked row out of pickers that hide offers', () => {
    mocks.amdLocked = [offer('amd/qwen', ['chat', 'translate'])]
    const { result } = renderHook(() => useCherryCloudModelSelectorOffers(true, false, isCherryCloudChatOffer, false), {
      wrapper
    })
    expect(result.current.offers).toEqual([])
  })
})
