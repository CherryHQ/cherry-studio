import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type {
  CherryCloudAccountPlans,
  CherryCloudAccountReceipt,
  CherryCloudModelSyncResult,
  CherryCloudStatus
} from '@shared/ipc/schemas/cherryCloud'

import { useCherryCloudSubscriptionReminder } from '../useCherryCloudSubscriptionReminder'

const request = vi.mocked(window.api.ipcApi.request)
let status: CherryCloudStatus
let plans: CherryCloudAccountPlans
let syncedModels: CherryCloudModelSyncResult | null

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
const planModel = (id: string, features: Array<'agent' | 'chat' | 'translate'> = ['chat', 'translate']) => ({
  id,
  display_name: id,
  available_features: features
})
const paid = (planName: string, models?: ReturnType<typeof planModel>[]): CherryCloudAccountPlans => ({
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
        purchase_available: true,
        ...(models && { models })
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
    models: syncedModels
      ? { freshness: 'fresh' as const, value: syncedModels, observedRevision: next }
      : { freshness: 'unknown' as const, error: null },
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
  syncedModels = null
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
  it('opens the activation guide for the plan chat models already synced, instead of the toast', async () => {
    syncedModels = {
      entitledModelIds: [],
      freeModelIds: [],
      availableModelIds: {
        agent: [],
        general: ['cherryai-subscription::chat-a', 'cherryai-subscription::agent-only', 'cherryai-subscription::chat-b']
      },
      quotaExhaustedModelIds: []
    }
    const { result } = renderHook(() => useCherryCloudSubscriptionReminder(), { wrapper })
    await waitFor(() =>
      expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(true)
    )
    await act(async () => Promise.resolve())
    plans = paid('Plus', [
      planModel('chat-b'),
      planModel('agent-only', ['agent']),
      planModel('not-synced'),
      planModel('chat-a')
    ])
    await returnFromBrowser()

    await waitFor(() =>
      expect(result.current.activation).toEqual({
        modelIds: ['cherryai-subscription::chat-b', 'cherryai-subscription::chat-a'],
        expiresAt: null
      })
    )
    expect(toast.success).not.toHaveBeenCalled()
    act(() => result.current.dismiss())
    expect(result.current.activation).toBeNull()
  })
  it('keeps the toast when none of the plan models are synced locally', async () => {
    syncedModels = {
      entitledModelIds: [],
      freeModelIds: [],
      availableModelIds: { agent: [], general: ['cherryai-subscription::other'] },
      quotaExhaustedModelIds: []
    }
    const { result } = renderHook(() => useCherryCloudSubscriptionReminder(), { wrapper })
    await waitFor(() =>
      expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(true)
    )
    await act(async () => Promise.resolve())
    plans = paid('Plus', [planModel('chat-a')])
    await returnFromBrowser()

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Plus 已生效'))
    expect(result.current.activation).toBeNull()
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
    syncedModels = {
      entitledModelIds: [],
      freeModelIds: [],
      availableModelIds: { agent: [], general: ['cherryai-subscription::chat-a'] },
      quotaExhaustedModelIds: []
    }
    const edition = (globalThis as { __APP_EDITION__?: string }).__APP_EDITION__
    vi.stubGlobal('__APP_EDITION__', 'cn')
    const fallback = request.getMockImplementation()!
    request.mockImplementation(async (route, input) =>
      route === 'cherry_cloud.notifications.active.get' ? { ok: true, data: true } : fallback(route, input)
    )
    try {
      const { result } = renderHook(() => useCherryCloudSubscriptionReminder(), { wrapper })
      await waitFor(() =>
        expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(true)
      )
      await act(async () => Promise.resolve())
      plans = paid('Plus', [planModel('chat-a')])
      act(() => {
        const next = receipt('notification')
        listeners.forEach((listener) => listener(next))
      })
      await waitFor(() =>
        expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.notifications.active.get')).toBe(true)
      )
      await act(async () => Promise.resolve())
      expect(toast.success).not.toHaveBeenCalled()
      expect(result.current.activation).toBeNull()
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
