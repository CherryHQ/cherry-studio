import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type {
  CherryCloudAccountPlans,
  CherryCloudAccountReceipt,
  CherryCloudStatus
} from '@shared/ipc/schemas/cherryCloud'

import { useCherryCloudSubscriptionReminder } from '../useCherryCloudSubscriptionReminder'

const request = vi.mocked(window.api.ipcApi.request)
let status: CherryCloudStatus
let plans: CherryCloudAccountPlans

const signedIn = (accountId: string): CherryCloudStatus => ({
  phase: 'signed-in',
  accountId,
  displayName: null,
  scopeId: accountId,
  revision: 0
})
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

const listeners = new Set<(receipt: CherryCloudAccountReceipt) => void>()
let revision = 0
function receipt(reason: 'initial' | 'focus_refresh' | 'notification', fresh = true) {
  const next = ++revision
  return {
    status: { ...status, revision: next },
    reason,
    account: { freshness: 'fresh' as const },
    models: { freshness: 'unknown' as const, error: null },
    plans: fresh
      ? { freshness: 'fresh' as const, value: plans, observedRevision: next }
      : { freshness: 'unknown' as const, error: null }
  }
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
async function returnFromBrowser() {
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  listeners.clear()
  revision = 0
  status = signedIn('account-1')
  plans = unpaid()
  vi.mocked(window.api.ipcApi.on).mockImplementation((event, listener) => {
    if (event === 'cherry_cloud.account_changed') listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
  request.mockImplementation(async (route, input) => {
    if (route === 'cherry_cloud.account.get') return { ok: true, data: receipt('initial', false) }
    if (route === 'cherry_cloud.account.refresh') {
      const reason =
        input && typeof input === 'object' && 'reason' in input && input.reason === 'focus_refresh'
          ? 'focus_refresh'
          : 'initial'
      return { ok: true, data: { outcome: 'refreshed', receipt: receipt(reason) } }
    }
    return { ok: true, data: undefined }
  })
})

describe('useCherryCloudSubscriptionReminder', () => {
  it('quietly establishes its first plans baseline and announces one subsequent activation', async () => {
    renderHook(() => useCherryCloudSubscriptionReminder(), { wrapper })
    await waitFor(() =>
      expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(true)
    )
    await act(async () => Promise.resolve())
    expect(toast.success).not.toHaveBeenCalled()
    plans = paid('Plus')
    await returnFromBrowser()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Plus 已生效'))
    await returnFromBrowser()
    expect(toast.success).toHaveBeenCalledOnce()
  })
  it('uses the receipt source for notification detection', async () => {
    renderHook(() => useCherryCloudSubscriptionReminder(), { wrapper })
    await waitFor(() =>
      expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(true)
    )
    await act(async () => Promise.resolve())
    plans = paid('Plus')
    act(() => {
      const next = receipt('notification')
      listeners.forEach((listener) => listener(next))
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
    expect(request.mock.calls).toContainEqual([
      'cherry_cloud.analytics.track',
      {
        payload: {
          event: 'subscription_entitlement_refresh_result',
          result: 'succeeded',
          planId: '22222222-2222-4222-8222-222222222222',
          detectedBy: 'notification',
          sinceClick: 'none'
        },
        scopeId: status.scopeId
      }
    ])
  })
  it('leaves a China-edition activation to the notification center while its stream is live', async () => {
    const edition = (globalThis as { __APP_EDITION__?: string }).__APP_EDITION__
    vi.stubGlobal('__APP_EDITION__', 'cn')
    const fallback = request.getMockImplementation()!
    request.mockImplementation(async (route, input) =>
      route === 'cherry_cloud.notifications.active.get' ? { ok: true, data: true } : fallback(route, input)
    )
    try {
      renderHook(() => useCherryCloudSubscriptionReminder(), { wrapper })
      await waitFor(() =>
        expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(true)
      )
      await act(async () => Promise.resolve())
      plans = paid('Plus')
      act(() => {
        const next = receipt('notification')
        listeners.forEach((listener) => listener(next))
      })
      await waitFor(() =>
        expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.notifications.active.get')).toBe(true)
      )
      await act(async () => Promise.resolve())
      expect(toast.success).not.toHaveBeenCalled()
      expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.analytics.track')).toBe(true)
    } finally {
      vi.stubGlobal('__APP_EDITION__', edition)
    }
  })
  it('keeps a paid login and same-account relogin quiet', async () => {
    plans = paid('Plus')
    renderHook(() => useCherryCloudSubscriptionReminder(), { wrapper })
    await waitFor(() =>
      expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(true)
    )
    await act(async () => Promise.resolve())
    status = { phase: 'signed-out', accountId: null, displayName: null, scopeId: 'out', revision: ++revision }
    act(() => {
      const next = receipt('initial', false)
      listeners.forEach((listener) => listener(next))
    })
    status = { ...signedIn('account-1'), scopeId: 'relogin' }
    act(() => {
      const next = receipt('initial', false)
      listeners.forEach((listener) => listener(next))
    })
    await act(async () => Promise.resolve())
    expect(toast.success).not.toHaveBeenCalled()
  })
})
