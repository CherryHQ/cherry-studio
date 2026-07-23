import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises the privacy gate and reconcile-after-settle convergence. Analytics may run only when
 * data collection is enabled and the latest privacy policy has been acknowledged. The reachable
 * race lives in async deactivation: a re-enable that lands while client.destroy() is pending must
 * still be honoured.
 */

const { mockTrackAppLaunch, mockTrackTokenUsage, mockTrackAppUpdate, mockDestroy, MockAnalyticsClient, captured } =
  vi.hoisted(() => {
    const trackAppLaunch = vi.fn()
    const trackTokenUsage = vi.fn()
    const trackAppUpdate = vi.fn()
    const destroy = vi.fn()
    return {
      mockTrackAppLaunch: trackAppLaunch,
      mockTrackTokenUsage: trackTokenUsage,
      mockTrackAppUpdate: trackAppUpdate,
      mockDestroy: destroy,
      MockAnalyticsClient: vi.fn(() => ({
        trackAppLaunch,
        trackTokenUsage,
        trackAppUpdate,
        destroy
      })),
      captured: {
        prefHandlers: {} as Record<string, (value: never) => void>,
        preferenceValues: {} as Record<string, boolean | string>
      }
    }
  })

vi.mock('@cherrystudio/analytics-client', () => ({
  AnalyticsClient: MockAnalyticsClient
}))

vi.mock('@main/utils/systemInfo', () => ({
  getClientId: vi.fn(() => 'test-client-id'),
  generateUserAgent: vi.fn(() => 'test-user-agent')
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: {
      subscribeChange: vi.fn((key: string, cb: (value: never) => void) => {
        captured.prefHandlers[key] = cb
        return () => {}
      }),
      get: vi.fn((key: string) => captured.preferenceValues[key])
    }
  })
})

import { AnalyticsService } from '../AnalyticsService'

const LATEST_POLICY_VERSION = '20260531'
let destroyResolvers: Array<() => void>

function changePreference(key: string, value: boolean | string): void {
  captured.preferenceValues[key] = value
  captured.prefHandlers[key]?.(value as never)
}

beforeEach(() => {
  BaseService.resetInstances()
  for (const key of Object.keys(captured.prefHandlers)) {
    delete captured.prefHandlers[key]
  }
  captured.preferenceValues['app.privacy.data_collection.enabled'] = true
  captured.preferenceValues['app.privacy.policy_version'] = LATEST_POLICY_VERSION
  destroyResolvers = []
  mockTrackAppLaunch.mockReset()
  mockTrackTokenUsage.mockReset()
  mockTrackAppUpdate.mockReset()
  mockDestroy.mockReset()
  MockAnalyticsClient.mockClear()
  mockDestroy.mockImplementation(() => new Promise<void>((resolve) => destroyResolvers.push(resolve)))
})

describe('AnalyticsService privacy gate', () => {
  it('stays inactive until the latest privacy policy is acknowledged', async () => {
    captured.preferenceValues['app.privacy.policy_version'] = ''

    const service = new AnalyticsService()
    await service._doInit()

    expect(service.isActivated).toBe(false)
    expect(MockAnalyticsClient).not.toHaveBeenCalled()

    await service.trackAppUpdate()
    expect(mockTrackAppUpdate).not.toHaveBeenCalled()

    changePreference('app.privacy.policy_version', LATEST_POLICY_VERSION)

    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    expect(MockAnalyticsClient).toHaveBeenCalledTimes(1)
  })

  it('deactivates when data collection is disabled', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    changePreference('app.privacy.data_collection.enabled', false)
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))

    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))
    expect(MockAnalyticsClient).toHaveBeenCalledTimes(1)
  })

  it('deactivates when the acknowledged policy version becomes outdated', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    changePreference('app.privacy.policy_version', '20240101')
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))

    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))
  })

  it('re-activates when re-enabled during an in-flight async deactivate', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    expect(captured.prefHandlers['app.privacy.data_collection.enabled']).toBeDefined()
    expect(captured.prefHandlers['app.privacy.policy_version']).toBeDefined()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    expect(MockAnalyticsClient).toHaveBeenCalledTimes(1)

    changePreference('app.privacy.data_collection.enabled', false)
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(true)

    changePreference('app.privacy.data_collection.enabled', true)
    destroyResolvers[0]()

    await vi.waitFor(() => expect(MockAnalyticsClient).toHaveBeenCalledTimes(2))
    expect(service.isActivated).toBe(true)
  })
})
