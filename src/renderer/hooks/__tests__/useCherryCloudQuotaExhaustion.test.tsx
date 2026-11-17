import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import type { CherryCloudAccountPlans } from '@shared/ipc/schemas/cherryCloud'

import { useCherryCloudQuotaExhaustion } from '../useCherryCloudQuotaExhaustion'

const facts = vi.hoisted(() => ({
  freshness: 'fresh' as 'fresh' | 'unknown' | 'stale',
  availabilityError: undefined as Error | undefined,
  exhausted: true,
  locked: false,
  phase: 'signed-in' as 'signed-in' | 'signed-out' | undefined,
  loadState: 'ready' as 'ready' | 'loading' | 'error',
  plansReady: true,
  plansFreshness: 'fresh' as 'fresh' | 'unknown' | 'stale',
  plansError: undefined as Error | undefined,
  plans: undefined as CherryCloudAccountPlans | undefined,
  activePaid: undefined as CherryCloudAccountPlans['entitlements'][number] | undefined,
  upcomingPaid: undefined as CherryCloudAccountPlans['entitlements'][number] | undefined
}))

vi.mock('../useCherryCloudModelAvailability', () => ({
  useCherryCloudModelAvailability: () => ({
    availabilityFreshness: facts.freshness,
    availabilityError: facts.availabilityError,
    isModelFree: (model: Model) => model.id.endsWith('free-model'),
    isModelLocked: () => facts.freshness === 'fresh' && facts.locked,
    isModelUnavailable: () => facts.freshness === 'fresh' && facts.exhausted
  })
}))
vi.mock('../useCherryCloudPlans', () => ({
  useCherryCloudPlans: () => ({
    session: { status: facts.phase ? { phase: facts.phase } : null, loadState: facts.loadState },
    plansQuery: { data: facts.plans, error: facts.plansError },
    isPlansReady: facts.plansReady,
    plansFreshness: facts.plansFreshness,
    activePaid: facts.activePaid,
    upcomingPaid: facts.upcomingPaid
  })
}))

const freeModel = {
  id: createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, 'free-model'),
  providerId: CHERRY_CLOUD_PROVIDER_ID
} as Model
const paidModel = {
  id: createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, 'paid-model'),
  providerId: CHERRY_CLOUD_PROVIDER_ID
} as Model

const window_ = (remaining: number, nextRecoveryAt?: string) => ({
  window_type: 'rolling' as const,
  duration_seconds: 18_000,
  limit_units: 100,
  used_units: 100 - remaining,
  active_reserved_units: 0,
  remaining_units: remaining,
  next_recovery_at: nextRecoveryAt
})
const pool = (modelIds: string[], windows: ReturnType<typeof window_>[]) => ({
  allocation_id: crypto.randomUUID(),
  display_name: 'pool',
  measurement_kind: 'requests' as const,
  model_ids: modelIds,
  windows
})

const plans: CherryCloudAccountPlans = {
  measured_at: '2026-10-27T00:00:00Z',
  available_plans: [],
  entitlements: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      source: 'grant',
      plan: {
        id: '22222222-2222-4222-8222-222222222222',
        display_name: 'Free',
        is_free: true,
        default_for_new_accounts: true,
        quota_pool_count: 2,
        model_count: 1,
        purchase_available: false
      },
      state: 'active',
      starts_at: '2026-10-01T00:00:00Z',
      quota_pools: [
        // This pool needs both windows back: it serves again at 12:00.
        pool(['free-model'], [window_(0, '2026-10-27T10:00:00Z'), window_(0, '2026-10-27T12:00:00Z')]),
        // A second pool recovering at 11:00 frees the model first.
        pool(['free-model'], [window_(0, '2026-10-27T11:00:00Z'), window_(5)])
      ]
    }
  ]
}

const paidPlan = (): CherryCloudAccountPlans['entitlements'][number] => ({
  ...plans.entitlements[0],
  id: '33333333-3333-4333-8333-333333333333',
  plan: {
    ...plans.entitlements[0].plan,
    id: '44444444-4444-4444-8444-444444444444',
    display_name: 'Plus',
    is_free: false
  },
  quota_pools: []
})

beforeEach(() => {
  Object.assign(facts, {
    freshness: 'fresh',
    availabilityError: undefined,
    exhausted: true,
    locked: false,
    phase: 'signed-in',
    loadState: 'ready',
    plansReady: true,
    plansFreshness: 'fresh',
    plansError: undefined,
    plans,
    activePaid: undefined,
    upcomingPaid: undefined
  })
})

describe('useCherryCloudQuotaExhaustion', () => {
  it('uses the first recovering pool after every exhausted window in that pool has recovered', () => {
    const { result } = renderHook(() => useCherryCloudQuotaExhaustion(freeModel))
    expect(result.current).toEqual({
      reason: 'quota_exhausted',
      isFreeModel: true,
      isSubscribed: false,
      recoversAt: '2026-10-27T11:00:00.000Z'
    })
  })

  it('does not invent recovery time from an exhausted monthly period without a reported recovery', () => {
    facts.plans = {
      ...plans,
      entitlements: [
        {
          ...plans.entitlements[0],
          quota_pools: [
            {
              ...pool(['free-model'], []),
              windows: [
                {
                  window_type: 'subscription_month',
                  duration_seconds: 2_628_000,
                  limit_units: 100,
                  used_units: 100,
                  active_reserved_units: 0,
                  remaining_units: 0,
                  period_start: '2026-10-03T00:00:00Z',
                  period_end: '2026-11-03T00:00:00Z'
                }
              ]
            }
          ]
        }
      ]
    }
    const { result } = renderHook(() => useCherryCloudQuotaExhaustion(freeModel))
    expect(result.current).toMatchObject({ reason: 'quota_exhausted', recoversAt: undefined })
  })

  it.each(['loading', 'error', 'stale'] as const)(
    'keeps %s account plans unknown instead of offering another subscription',
    (state) => {
      facts.plansReady = false
      facts.plansFreshness = state === 'stale' ? 'stale' : 'unknown'
      facts.plansError = state === 'error' ? new Error('offline') : undefined
      const { result, rerender } = renderHook(() => useCherryCloudQuotaExhaustion(freeModel))
      expect(result.current).toMatchObject({
        reason: 'quota_exhausted',
        isSubscribed: undefined,
        recoversAt: undefined
      })
      facts.locked = true
      facts.exhausted = false
      rerender()
      expect(result.current).toMatchObject({ reason: 'unknown', state, isSubscribed: undefined })
    }
  )

  it('does not turn an unobserved session into signed-out', () => {
    Object.assign(facts, { phase: undefined, loadState: 'loading', locked: true, exhausted: false, plansReady: false })
    const { result } = renderHook(() => useCherryCloudQuotaExhaustion(paidModel, true))
    expect(result.current).toMatchObject({ reason: 'unknown', state: 'loading', isSubscribed: undefined })
  })

  it.each(['unknown', 'stale'] as const)(
    'does not use %s model facts as a quota or permission decision',
    (freshness) => {
      facts.freshness = freshness
      const { result } = renderHook(() => useCherryCloudQuotaExhaustion(freeModel))
      expect(result.current).toMatchObject({ reason: 'unknown', state: freshness === 'stale' ? 'stale' : 'loading' })
    }
  )

  it.each([
    ['signed-out', undefined, 'sign_in_required'],
    ['signed-in', undefined, 'subscription_required'],
    ['signed-in', 'active', 'not_in_plan'],
    ['signed-in', 'upcoming', 'not_in_plan']
  ] as const)('uses confirmed account and purchase facts (%s/%s)', (phase, paid, reason) => {
    Object.assign(facts, {
      phase,
      locked: true,
      exhausted: false,
      activePaid: paid === 'active' ? paidPlan() : undefined,
      upcomingPaid: paid === 'upcoming' ? { ...paidPlan(), state: 'upcoming' } : undefined
    })
    const { result } = renderHook(() => useCherryCloudQuotaExhaustion(paidModel, true))
    expect(result.current?.reason).toBe(reason)
  })

  it('reports no obstacle for a current model with quota left', () => {
    facts.exhausted = false
    const { result } = renderHook(() => useCherryCloudQuotaExhaustion(paidModel))
    expect(result.current).toBeNull()
  })
})
