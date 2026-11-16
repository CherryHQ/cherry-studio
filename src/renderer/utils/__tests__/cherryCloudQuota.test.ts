import { describe, expect, it } from 'vitest'

import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { createUniqueModelId } from '@shared/data/types/model'
import type { CherryCloudAccountReceipt } from '@shared/ipc/schemas/cherryCloud'

import {
  type CherryCloudEntitlement,
  type CherryCloudQuotaWindow,
  formatQuotaPercent,
  getLowestRemainingPercent,
  getQuotaPoolDisplay,
  getQuotaRemainingPercent
} from '../cherryCloudQuota'

const window_: CherryCloudQuotaWindow = {
  window_type: 'rolling',
  duration_seconds: 604800,
  limit_units: 100,
  used_units: 21,
  active_reserved_units: 0,
  remaining_units: 79
}
const entitlement: CherryCloudEntitlement = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'stripe',
  plan: {
    id: '22222222-2222-4222-8222-222222222222',
    display_name: 'Plus',
    is_free: false,
    default_for_new_accounts: false,
    quota_pool_count: 1,
    model_count: 1,
    purchase_available: true
  },
  state: 'active',
  starts_at: '2026-09-01T00:00:00Z',
  quota_pools: [
    {
      allocation_id: '33333333-3333-4333-8333-333333333333',
      display_name: 'Plan quota',
      measurement_kind: 'requests',
      model_ids: ['test-model'],
      windows: [window_]
    }
  ]
}
const pool = entitlement.quota_pools[0]
const receipt: CherryCloudAccountReceipt = {
  status: { phase: 'signed-in', scopeId: 'account-1', accountId: 'account-1', displayName: 'User', revision: 1 },
  reason: 'models',
  account: { freshness: 'fresh' },
  plans: {
    freshness: 'fresh',
    value: { measured_at: '2026-09-21T00:00:00Z', entitlements: [entitlement], available_plans: [] },
    observedRevision: 1
  },
  models: {
    freshness: 'fresh',
    observedRevision: 1,
    value: {
      entitledModelIds: [],
      freeModelIds: [],
      availableModelIds: { agent: [], general: [] },
      quotaExhaustedModelIds: [createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, 'test-model')]
    }
  }
}

describe('Cherry Cloud quota display', () => {
  it.each([
    [100, 0, 0, 0, '0.00'],
    [100, 21, 0, 79, '79.00'],
    [20, 13, 2, 5, '25.00'],
    [100, 100, 0, 75, '75.00'],
    [100, 0, 0, 101, '100.00'],
    [0, 0, 0, 10, '0.00'],
    [-1, 0, 0, 10, '0.00']
  ])(
    'uses remaining units for limit/used/reserved/remaining = %s/%s/%s/%s',
    (limit, used, reserved, remaining, expected) => {
      expect(
        formatQuotaPercent(
          getQuotaRemainingPercent({
            ...window_,
            limit_units: limit,
            used_units: used,
            active_reserved_units: reserved,
            remaining_units: remaining
          })
        )
      ).toBe(expected)
    }
  )

  it('does not infer exhaustion from a percentage that floors to zero', () => {
    const tinyPool = { ...pool, windows: [{ ...window_, limit_units: 1_000_000, remaining_units: 1 }] }
    const display = getQuotaPoolDisplay(entitlement, tinyPool, {
      ...receipt,
      models: { freshness: 'unknown', error: null }
    })
    expect(display).toEqual({ exhausted: false, snapshotOutOfDate: false, remainingPercent: 0 })
    expect(formatQuotaPercent(display.remainingPercent!)).toBe('0.00')
  })

  it('marks zero windows exhausted only when the fresh decision names their model', () => {
    const emptyPool = { ...pool, windows: [{ ...window_, used_units: 0, remaining_units: 0 }] }
    expect(getQuotaPoolDisplay(entitlement, emptyPool, receipt)).toEqual({
      exhausted: true,
      snapshotOutOfDate: false,
      remainingPercent: 0
    })
    expect(
      getQuotaPoolDisplay(entitlement, emptyPool, { ...receipt, models: { freshness: 'unknown', error: null } })
    ).toEqual({ exhausted: false, snapshotOutOfDate: false, remainingPercent: 0 })
  })

  it('overrides contradictory usage and the summary without changing the plan windows', () => {
    const fullWindow = { ...window_, used_units: 0, remaining_units: 100 }
    const fullPool = { ...pool, windows: [fullWindow] }
    const fullEntitlement = { ...entitlement, quota_pools: [fullPool] }
    const before = { ...fullWindow }
    const display = getQuotaPoolDisplay(fullEntitlement, fullPool, receipt)
    expect(display).toEqual({
      exhausted: true,
      snapshotOutOfDate: true,
      remainingPercent: 0
    })
    expect(formatQuotaPercent(display.remainingPercent!)).toBe('0.00')
    expect(getLowestRemainingPercent(fullEntitlement, receipt)).toBe(0)
    expect(fullWindow).toEqual(before)
    expect(getQuotaPoolDisplay(entitlement, { ...pool, model_ids: ['other-model'] }, receipt)).toEqual({
      exhausted: false,
      snapshotOutOfDate: false,
      remainingPercent: 79
    })
  })

  it('ignores exhausted ids belonging to a different provider', () => {
    if (receipt.models.freshness !== 'fresh') throw new Error('Expected a fresh fixture')
    expect(
      getQuotaPoolDisplay(entitlement, pool, {
        ...receipt,
        models: {
          ...receipt.models,
          value: { ...receipt.models.value, quotaExhaustedModelIds: [createUniqueModelId('other', 'test-model')] }
        }
      })
    ).toEqual({ exhausted: false, snapshotOutOfDate: false, remainingPercent: 79 })
  })

  it.each(['upcoming', 'expired', 'disabled'] as const)('does not override a %s entitlement', (state) => {
    expect(getQuotaPoolDisplay({ ...entitlement, state }, pool, receipt)).toEqual({
      exhausted: false,
      snapshotOutOfDate: false,
      remainingPercent: 79
    })
  })

  it('ignores stale and unknown model decisions', () => {
    if (receipt.models.freshness !== 'fresh') throw new Error('Expected a fresh fixture')
    const facts: CherryCloudAccountReceipt['models'][] = [
      { ...receipt.models, freshness: 'stale', error: 'offline' },
      { freshness: 'unknown', error: null }
    ]
    for (const models of facts) {
      expect(getQuotaPoolDisplay(entitlement, pool, { ...receipt, models })).toEqual({
        exhausted: false,
        snapshotOutOfDate: false,
        remainingPercent: 79
      })
    }
  })

  it('takes the minimum of windows and pools, leaving absent usage undefined', () => {
    const noDecision = { ...receipt, models: { freshness: 'unknown' as const, error: null } }
    const tightPool = { ...pool, windows: [window_, { ...window_, remaining_units: 5 }] }
    expect(getQuotaPoolDisplay(entitlement, tightPool, noDecision).remainingPercent).toBe(5)
    expect(getLowestRemainingPercent({ ...entitlement, quota_pools: [pool, tightPool] }, noDecision)).toBe(5)
    expect(getQuotaPoolDisplay(entitlement, { ...pool, windows: [] }, noDecision).remainingPercent).toBeUndefined()
    expect(getLowestRemainingPercent({ ...entitlement, quota_pools: [] }, noDecision)).toBeUndefined()
    expect(
      getLowestRemainingPercent({ ...entitlement, quota_pools: [{ ...pool, windows: [] }] }, noDecision)
    ).toBeUndefined()
  })
})
