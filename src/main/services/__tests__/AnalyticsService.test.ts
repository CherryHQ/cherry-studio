import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises `AnalyticsService`'s reconcile-after-settle convergence. The reachable race lives in the
 * ASYNC `onDeactivate` (`await client.destroy()`): a re-enable that lands while the deactivation is
 * in flight must be honoured, not dropped by the shared `_activating` guard. This is the mirror of
 * `ApiGatewayService`, whose race is in async activation.
 *
 * `AnalyticsClient` is mocked so `destroy()` timing is controllable; the preference-change handler
 * is captured so the toggle can be driven directly.
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
      captured: { prefHandler: undefined as ((enabled: boolean) => void) | undefined }
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
      subscribeChange: vi.fn((_key: string, cb: (enabled: boolean) => void) => {
        captured.prefHandler = cb
        return () => {}
      }),
      get: vi.fn(() => true)
    }
  })
})

import { AnalyticsService } from '../AnalyticsService'

let destroyResolvers: Array<() => void>

beforeEach(() => {
  BaseService.resetInstances()
  captured.prefHandler = undefined
  destroyResolvers = []
  mockTrackAppLaunch.mockReset()
  mockTrackTokenUsage.mockReset()
  mockTrackAppUpdate.mockReset()
  mockDestroy.mockReset()
  MockAnalyticsClient.mockClear()
  // destroy() stays pending until the test resolves it — opens the in-flight deactivate window.
  mockDestroy.mockImplementation(() => new Promise<void>((resolve) => destroyResolvers.push(resolve)))
})

describe('AnalyticsService reconcile', () => {
  it('re-activates when re-enabled during an in-flight async deactivate (no dropped toggle)', async () => {
    const service = new AnalyticsService()
    // onReady auto-activates because the preference is enabled — client #1 is the baseline.
    await service._doInit()
    expect(captured.prefHandler).toBeDefined()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    expect(MockAnalyticsClient).toHaveBeenCalledTimes(1)

    // Disable → onDeactivate awaits client.destroy(), which we keep pending.
    captured.prefHandler!(false)
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(true) // still mid-deactivation

    // Re-enable mid-destroy. The shared `_activating` guard would drop this; the reconciler
    // re-reads the desired state after the deactivation settles.
    captured.prefHandler!(true)

    // Complete the destroy — the loop must now re-activate to converge to enabled.
    destroyResolvers[0]()
    await vi.waitFor(() => expect(MockAnalyticsClient).toHaveBeenCalledTimes(2))
    expect(service.isActivated).toBe(true)
  })

  it('converges to deactivated when the final desired state is disabled', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    captured.prefHandler!(false)
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))

    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))
    expect(MockAnalyticsClient).toHaveBeenCalledTimes(1) // no spurious re-activation
  })
})
