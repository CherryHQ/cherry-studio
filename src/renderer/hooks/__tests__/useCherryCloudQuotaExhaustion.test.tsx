import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import type { CherryCloudAccountPlans } from '@shared/ipc/schemas/cherryCloud'

import { useCherryCloudQuotaExhaustion } from '../useCherryCloudQuotaExhaustion'

const request = vi.mocked(window.api.ipcApi.request)
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

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
)

beforeEach(() => {
  vi.clearAllMocks()
  request.mockImplementation(async (route) => {
    if (route === 'cherry_cloud.status.get') {
      return { ok: true, data: { phase: 'signed-in', accountId: 'account-1', displayName: null } }
    }
    if (route === 'cherry_cloud.models.sync') {
      return {
        ok: true,
        data: {
          entitledModelIds: [freeModel.id, paidModel.id],
          freeModelIds: [freeModel.id],
          availableModelIds: { agent: [freeModel.id, paidModel.id], general: [freeModel.id, paidModel.id] },
          quotaExhaustedModelIds: [freeModel.id]
        }
      }
    }
    if (route === 'cherry_cloud.account_plans.get') return { ok: true, data: plans }
    return { ok: true, data: undefined }
  })
})

describe('useCherryCloudQuotaExhaustion', () => {
  it('reports an exhausted free model with the earliest time any pool serves it again', async () => {
    const { result } = renderHook(() => useCherryCloudQuotaExhaustion(freeModel), { wrapper })

    await waitFor(() =>
      expect(result.current).toEqual({ isFreeModel: true, isSubscribed: false, recoversAt: '2026-10-27T11:00:00.000Z' })
    )
  })

  it('reports nothing for a model with quota left', async () => {
    const { result } = renderHook(() => useCherryCloudQuotaExhaustion(paidModel), { wrapper })

    await waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.models.sync', undefined))
    expect(result.current).toBeNull()
  })
})
