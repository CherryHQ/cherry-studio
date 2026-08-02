// oxlint-disable typescript/no-unnecessary-type-assertion -- tsgolint 7 false-positives vs tsc 7 (see #17746)
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

/**
 * Exercises the data-collection preference and reconcile-after-settle convergence. The reachable
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
      MockAnalyticsClient: vi.fn(function AnalyticsClientMock() {
        return {
          trackAppLaunch,
          trackTokenUsage,
          trackAppUpdate,
          destroy
        }
      }),
      captured: {
        prefHandlers: {},
        preferenceValues: {}
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
  captured.preferenceValues['app.privacy.policy_version'] = LATEST_PRIVACY_POLICY_VERSION
  destroyResolvers = []
  mockTrackAppLaunch.mockReset()
  mockTrackTokenUsage.mockReset()
  mockTrackAppUpdate.mockReset()
  mockDestroy.mockReset()
  MockAnalyticsClient.mockClear()
  mockDestroy.mockImplementation(() => new Promise<void>((resolve) => destroyResolvers.push(resolve)))
})

describe('AnalyticsService data collection preference', () => {
  it('does not activate before the latest privacy policy is accepted', async () => {
    captured.preferenceValues['app.privacy.policy_version'] = ''

    const service = new AnalyticsService()
    await service._doInit()

    expect(service.isActivated).toBe(false)
    expect(MockAnalyticsClient).not.toHaveBeenCalled()
    expect(captured.prefHandlers['app.privacy.policy_version']).toBeDefined()

    await service.trackAppUpdate()
    expect(mockTrackAppUpdate).not.toHaveBeenCalled()
  })

  it('activates after the latest privacy policy is accepted', async () => {
    captured.preferenceValues['app.privacy.policy_version'] = ''
    const service = new AnalyticsService()
    await service._doInit()

    changePreference('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)

    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    expect(MockAnalyticsClient).toHaveBeenCalledTimes(1)
    expect(mockTrackAppLaunch).toHaveBeenCalledTimes(1)
  })

  it('deactivates when data collection is disabled', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    changePreference('app.privacy.data_collection.enabled', false)
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))

    service.trackTokenUsage({
      provider: 'test-provider',
      model: 'test-model',
      input_tokens: 1,
      output_tokens: 1
    })
    await service.trackAppUpdate()
    expect(mockTrackTokenUsage).not.toHaveBeenCalled()
    expect(mockTrackAppUpdate).not.toHaveBeenCalled()

    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))
    expect(MockAnalyticsClient).toHaveBeenCalledTimes(1)
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

  it('tracks app launch only once when analytics is re-enabled', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    expect(mockTrackAppLaunch).toHaveBeenCalledTimes(1)

    changePreference('app.privacy.data_collection.enabled', false)
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))
    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))

    changePreference('app.privacy.data_collection.enabled', true)
    await vi.waitFor(() => expect(MockAnalyticsClient).toHaveBeenCalledTimes(2))
    expect(mockTrackAppLaunch).toHaveBeenCalledTimes(1)
  })
})

describe('AnalyticsService token usage', () => {
  it('forwards reportable usage without changing its source', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    service.trackTokenUsage({
      provider: 'test-provider',
      model: 'test-model',
      input_tokens: 3,
      output_tokens: 5,
      source: 'agent'
    })

    expect(mockTrackTokenUsage).toHaveBeenCalledWith({
      provider: 'test-provider',
      model: 'test-model',
      input_tokens: 3,
      output_tokens: 5,
      source: 'agent'
    })
  })

  it('forwards embedding usage when output tokens are zero', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    service.trackTokenUsage({
      provider: 'test-provider',
      model: 'test-embedding-model',
      input_tokens: 42,
      output_tokens: 0,
      source: 'chat'
    })

    expect(mockTrackTokenUsage).toHaveBeenCalledWith({
      provider: 'test-provider',
      model: 'test-embedding-model',
      input_tokens: 42,
      output_tokens: 0,
      source: 'chat'
    })
  })

  it('does not forward usage when all token counts are zero', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    service.trackTokenUsage({
      provider: 'test-provider',
      model: 'test-model',
      input_tokens: 0,
      output_tokens: 0,
      source: 'agent'
    })

    expect(mockTrackTokenUsage).not.toHaveBeenCalled()
  })
})
