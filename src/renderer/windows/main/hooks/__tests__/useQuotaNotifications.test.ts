import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { Provider } from '@shared/data/types/provider'

import { useQuotaNotifications } from '../useQuotaNotifications'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}::${JSON.stringify(params)}` : key)
  })
}))

function makeProvider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: id,
    apiKeys: [],
    authType: 'api-key',
    reportsActualCost: false,
    settings: {} as Provider['settings'],
    isEnabled: true,
    ...overrides
  } as Provider
}

/** Combined dispatcher for the two paths this hook queries — `mockQueryData` only supports one
 *  path at a time since each call replaces the whole implementation. */
function seedQueries(providers: Provider[], usageBuckets: Array<{ apiKeyId: string; requestCount: number }> = []) {
  mockUseQuery.mockImplementation((path: string) => {
    const base = { isLoading: false, isRefreshing: false, error: undefined, refetch: vi.fn(), mutate: vi.fn() }
    if (path === '/providers') return { ...base, data: providers }
    if (path === '/ai-usage-records/stats') {
      return { ...base, data: { buckets: usageBuckets.map((b) => ({ groupBy: 'apiKey', ...b })) } }
    }
    return { ...base, data: undefined }
  })
}

describe('useQuotaNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-19T08:00:00Z'))
    MockUseDataApiUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
  })

  it('records a baseline for a first-seen limit without showing a toast', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.api_key_limits', {
      'openrouter::key1': { limit: 20, period: 'daily' }
    })
    seedQueries([makeProvider('openrouter', { apiKeys: [{ id: 'key1', isEnabled: true, tier: 'free' }] })])

    renderHook(() => useQuotaNotifications())

    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.routing.quota_notice_state')).toEqual({
      'openrouter::key1': { lastPeriodStart: new Date('2026-09-19T00:00:00Z').getTime() }
    })
  })

  it('shows a new_period toast once the period has rolled over since the last recorded start', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.api_key_limits', {
      'openrouter::key1': { limit: 20, period: 'daily' }
    })
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.quota_notice_state', {
      'openrouter::key1': { lastPeriodStart: new Date('2026-09-18T00:00:00Z').getTime() }
    })
    seedQueries([
      makeProvider('openrouter', { name: 'OpenRouter', apiKeys: [{ id: 'key1', isEnabled: true, label: 'Main' }] })
    ])

    renderHook(() => useQuotaNotifications())

    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(toast.warning).not.toHaveBeenCalled()
    const call = vi.mocked(toast.info).mock.calls[0][0] as { title: string; description: string }
    expect(call.title).toBe('notification.quota.new_period.title')
    expect(call.description).toContain('notification.quota.new_period.description')
    expect(call.description).toContain('OpenRouter')
    expect(call.description).toContain('Main')
  })

  it('does not fire new_period again once the rollover has already been recorded', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.api_key_limits', {
      'openrouter::key1': { limit: 20, period: 'daily' }
    })
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.quota_notice_state', {
      'openrouter::key1': { lastPeriodStart: new Date('2026-09-19T00:00:00Z').getTime() }
    })
    seedQueries([makeProvider('openrouter', { apiKeys: [{ id: 'key1', isEnabled: true }] })])

    renderHook(() => useQuotaNotifications())

    expect(toast.info).not.toHaveBeenCalled()
  })

  it('shows a trial_exhausted toast once usage reaches a trial total-period limit', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.api_key_limits', {
      'siliconflow::trialkey': { limit: 10, period: 'total' }
    })
    seedQueries(
      [
        makeProvider('siliconflow', {
          name: 'SiliconFlow',
          apiKeys: [{ id: 'trialkey', isEnabled: true, label: 'Trial', tier: 'trial' }]
        })
      ],
      [{ apiKeyId: 'trialkey', requestCount: 10 }]
    )

    renderHook(() => useQuotaNotifications())

    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.info).not.toHaveBeenCalled()
    const call = vi.mocked(toast.warning).mock.calls[0][0] as { title: string; description: string }
    expect(call.title).toBe('notification.quota.trial_exhausted.title')
    expect(call.description).toContain('SiliconFlow')
    expect(call.description).toContain('Trial')
  })

  it('never fires trial_exhausted again for the same key, even across a simulated restart', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.api_key_limits', {
      'siliconflow::trialkey': { limit: 10, period: 'total' }
    })
    const providers = [makeProvider('siliconflow', { apiKeys: [{ id: 'trialkey', isEnabled: true, tier: 'trial' }] })]
    seedQueries(providers, [{ apiKeyId: 'trialkey', requestCount: 10 }])

    const first = renderHook(() => useQuotaNotifications())
    expect(toast.warning).toHaveBeenCalledTimes(1)
    first.unmount()

    // Simulate the app restarting: a fresh mount reading the persisted notice state.
    seedQueries(providers, [{ apiKeyId: 'trialkey', requestCount: 10 }])
    renderHook(() => useQuotaNotifications())

    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  it('does not query usage stats or fire trial_exhausted for a non-trial total-period key', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.api_key_limits', {
      'siliconflow::paidkey': { limit: 10, period: 'total' }
    })
    seedQueries([makeProvider('siliconflow', { apiKeys: [{ id: 'paidkey', isEnabled: true, tier: 'paid' }] })])

    renderHook(() => useQuotaNotifications())

    expect(mockUseQuery).not.toHaveBeenCalledWith(
      '/ai-usage-records/stats',
      expect.objectContaining({ query: expect.anything() })
    )
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
