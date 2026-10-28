import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { CherryCloudAccountPlans, CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

import { useCherryCloudSubscriptionReminder } from '../useCherryCloudSubscriptionReminder'

const request = vi.mocked(window.api.ipcApi.request)
let status: CherryCloudStatus
let plans: CherryCloudAccountPlans

const signedIn = (accountId: string): CherryCloudStatus => ({ phase: 'signed-in', accountId, displayName: null })
const unpaid = (): CherryCloudAccountPlans => ({
  measured_at: '2026-10-27T00:00:00Z',
  entitlements: [],
  available_plans: []
})
const paid = (planName: string): CherryCloudAccountPlans => ({
  ...unpaid(),
  entitlements: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      source: 'stripe',
      plan: {
        id: '22222222-2222-4222-8222-222222222222',
        display_name: planName,
        is_free: false,
        default_for_new_accounts: false,
        quota_pool_count: 1,
        model_count: 3,
        purchase_available: true
      },
      state: 'active',
      starts_at: '2026-10-27T00:00:00Z',
      quota_pools: []
    }
  ]
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, focusThrottleInterval: 0 }}>{children}</SWRConfig>
)

const plansRequests = () => request.mock.calls.filter(([route]) => route === 'cherry_cloud.account_plans.get').length

// Returning from the browser checkout refocuses the window, which refetches the plans.
async function returnFromBrowser() {
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  request.mockImplementation(async (route) => {
    if (route === 'cherry_cloud.status.get') return { ok: true, data: status }
    if (route === 'cherry_cloud.account_plans.get') return { ok: true, data: plans }
    return { ok: true, data: undefined }
  })
})

describe('useCherryCloudSubscriptionReminder', () => {
  it('announces a plan that becomes active, once', async () => {
    status = signedIn('account-1')
    plans = unpaid()
    renderHook(() => useCherryCloudSubscriptionReminder(), { wrapper })
    await waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.account_plans.get', undefined))

    plans = paid('Plus')
    await returnFromBrowser()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Plus 已生效'))

    await returnFromBrowser()
    await waitFor(() => expect(plansRequests()).toBe(3))
    expect(toast.success).toHaveBeenCalledOnce()
  })

  it('stays quiet for an account that was already subscribed', async () => {
    status = signedIn('account-1')
    plans = paid('Flash')
    renderHook(() => useCherryCloudSubscriptionReminder(), { wrapper })

    await waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.account_plans.get', undefined))
    await returnFromBrowser()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
