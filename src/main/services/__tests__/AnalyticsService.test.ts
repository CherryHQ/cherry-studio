import { MockMainCacheServiceExport, MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnalyticsClient, AnalyticsClientOptions } from '@cherrystudio/analytics-client'
import { agentService } from '@data/services/AgentService'
import { assistantDataService } from '@data/services/AssistantService'
import { messageService } from '@data/services/MessageService'
import { BaseService } from '@main/core/lifecycle'
import { getAppEdition } from '@main/utils/appEdition'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

/**
 * Exercises the data-collection preference and reconcile-after-settle convergence. The reachable
 * race lives in async deactivation: a re-enable that lands while client.destroy() is pending must
 * still be honoured.
 */

const {
  mockTrackAppLaunch,
  mockTrackTokenUsage,
  mockTrackAppUpdate,
  mockDestroy,
  mockGetQueueSize,
  MockAnalyticsClient,
  captured
} = vi.hoisted(() => {
  const trackAppLaunch = vi.fn()
  const trackTokenUsage = vi.fn()
  const trackAppUpdate = vi.fn()
  const destroy = vi.fn()
  const getQueueSize = vi.fn(() => 0)
  const clientOptions: { fetch?: typeof fetch } = {}
  return {
    mockTrackAppLaunch: trackAppLaunch,
    mockTrackTokenUsage: trackTokenUsage,
    mockTrackAppUpdate: trackAppUpdate,
    mockDestroy: destroy,
    mockGetQueueSize: getQueueSize,
    MockAnalyticsClient: vi.fn(function AnalyticsClientMock(
      options: AnalyticsClientOptions
    ): Pick<AnalyticsClient, 'trackAppLaunch' | 'trackTokenUsage' | 'trackAppUpdate' | 'destroy' | 'getQueueSize'> {
      clientOptions.fetch = options?.fetch
      return {
        trackAppLaunch,
        trackTokenUsage,
        trackAppUpdate,
        destroy,
        getQueueSize
      }
    }),
    captured: {
      prefHandlers: {},
      preferenceValues: {},
      clientOptions,
      rendererPreferenceListener: undefined as ((changes: Array<[string, unknown]>) => void) | undefined
    }
  }
})

const posthog = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  constructor: vi.fn()
}))

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function PostHogMock(key: string, options: unknown) {
    posthog.constructor(key, options)
    return { capture: posthog.capture, shutdown: posthog.shutdown }
  })
}))

vi.mock('@cherrystudio/analytics-client', () => ({
  AnalyticsClient: MockAnalyticsClient
}))

vi.mock('@main/utils/appEdition', () => ({
  getAppEdition: vi.fn(() => 'global')
}))

const launch = vi.hoisted(() => ({
  kind: vi.fn<() => 'first' | 'upgraded' | 'same'>(() => 'same'),
  migratedFromV1: vi.fn(() => false),
  pendingReports: vi.fn((): unknown[] => [])
}))

vi.mock('../VersionService', () => ({ versionService: { getLaunchKind: launch.kind } }))
vi.mock('@data/migration/v1MigrationOrigin', () => ({ isMigratedFromV1: launch.migratedFromV1 }))
vi.mock('../analyticsPendingReports', () => ({ takePendingReports: launch.pendingReports }))

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
      get: vi.fn((key: string) => captured.preferenceValues[key]),
      onRendererPreferencesChanged: vi.fn((listener: (changes: Array<[string, unknown]>) => void) => {
        captured.rendererPreferenceListener = listener
        return { dispose: () => {} }
      })
    }
  })
})

import { application } from '@application'

import { AnalyticsService } from '../AnalyticsService'

let destroyResolvers: Array<() => void>

function changePreference(key: string, value: boolean | string): void {
  captured.preferenceValues[key] = value
  captured.prefHandlers[key]?.(value)
}

beforeEach(() => {
  BaseService.resetInstances()
  MockMainCacheServiceUtils.resetMocks()
  vi.unstubAllEnvs()
  posthog.capture.mockClear()
  posthog.shutdown.mockClear()
  posthog.constructor.mockClear()
  vi.mocked(getAppEdition).mockReturnValue('global')
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
  mockGetQueueSize.mockReset()
  mockGetQueueSize.mockReturnValue(0)
  delete captured.clientOptions.fetch
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

    await service.trackAppUpdate()
    expect(mockTrackAppUpdate).not.toHaveBeenCalled()
  })

  it('sends product events to PostHog anonymously, and only while data collection is consented', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    service.trackEvent('subscription_entry_view', { source: 'settings' })

    expect(posthog.constructor).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({ host: 'https://us.i.posthog.com', disableGeoip: true })
    )
    expect(posthog.capture).toHaveBeenCalledWith({
      distinctId: 'test-client-id',
      event: 'subscription_entry_view',
      properties: expect.objectContaining({
        source: 'settings',
        app_edition: 'global',
        $ip: '0.0.0.0',
        $process_person_profile: false
      })
    })

    // While the revoked client is still shutting down, nothing new may be captured.
    let finishShutdown = () => {}
    posthog.shutdown.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finishShutdown = () => resolve(undefined)))
    )
    changePreference('app.privacy.data_collection.enabled', false)
    await vi.waitFor(() => expect(posthog.shutdown).toHaveBeenCalledWith(1_000))
    posthog.capture.mockClear()
    service.trackEvent('subscription_entry_view', { source: 'settings' })

    expect(posthog.capture).not.toHaveBeenCalled()
    finishShutdown()
  })

  it('preserves a caller-provided identity without interpreting its domain', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    service.trackEvent(
      'feature_used',
      { source: 'settings' },
      { distinctId: 'chosen-identity', processPersonProfile: true }
    )
    expect(posthog.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'chosen-identity',
        properties: expect.objectContaining({ source: 'settings', $process_person_profile: true, $ip: '0.0.0.0' })
      })
    )
  })

  it('sends no product events from a development build without a PostHog key', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', '')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    service.trackEvent('subscription_entry_view', { source: 'settings' })

    expect(posthog.constructor).not.toHaveBeenCalled()
    expect(posthog.capture).not.toHaveBeenCalled()
  })

  it.each(['cn', 'global'] as const)(
    'sends %s release events to the shared production project with their edition',
    async (edition) => {
      vi.stubEnv('DEV', false)
      vi.stubEnv('MAIN_VITE_POSTHOG_KEY', '')
      vi.mocked(getAppEdition).mockReturnValue(edition)
      const service = new AnalyticsService()
      await service._doInit()
      await vi.waitFor(() => expect(service.isActivated).toBe(true))

      service.trackEvent('subscription_entry_view', { source: 'settings' })

      expect(posthog.constructor).toHaveBeenCalledWith(
        'phc_vwsf7qr54Vk2ff23Nj2B4PEYtSkkpheKrb8VcdfDujna',
        expect.objectContaining({ host: 'https://us.i.posthog.com' })
      )
      expect(posthog.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'subscription_entry_view',
          properties: expect.objectContaining({ app_edition: edition })
        })
      )
    }
  )

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

    expect(mockDestroy).toHaveBeenCalledWith({ flush: false })
    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))
    expect(MockAnalyticsClient).toHaveBeenCalledTimes(1)
  })

  it('re-activates when re-enabled during an in-flight async deactivate', async () => {
    const service = new AnalyticsService()
    await service._doInit()

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
    expect(mockDestroy).toHaveBeenCalledWith({ flush: false })
    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))

    changePreference('app.privacy.data_collection.enabled', true)
    await vi.waitFor(() => expect(MockAnalyticsClient).toHaveBeenCalledTimes(2))
    expect(mockTrackAppLaunch).toHaveBeenCalledTimes(1)
  })
})

describe('AnalyticsService consent revocation', () => {
  function isNonRetriable(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    if (error.name === 'AbortError') return false
    if (error.name === 'TypeError' && error.message.includes('fetch')) return false
    return !['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].some((code) =>
      error.message.includes(code)
    )
  }

  it('discards the pending queue without flushing on revoke', async () => {
    mockGetQueueSize.mockReturnValue(3)
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    const injectedFetch = captured.clientOptions.fetch
    expect(injectedFetch).toBeDefined()

    changePreference('app.privacy.data_collection.enabled', false)
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))
    expect(mockDestroy).toHaveBeenCalledWith({ flush: false })
    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))

    expect(mockGetQueueSize).toHaveBeenCalled()
    await expect(injectedFetch!('https://analytics.cherry-ai.com/api/events')).rejects.toSatisfy(isNonRetriable)
  })

  it('still aborts and deactivates when reading the queue size throws', async () => {
    mockGetQueueSize.mockImplementation(() => {
      throw new Error('queue unavailable')
    })
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    const injectedFetch = captured.clientOptions.fetch
    expect(injectedFetch).toBeDefined()

    changePreference('app.privacy.data_collection.enabled', false)
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))
    expect(mockDestroy).toHaveBeenCalledWith({ flush: false })
    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))

    await expect(injectedFetch!('https://analytics.cherry-ai.com/api/events')).rejects.toSatisfy(isNonRetriable)
  })

  it('aborts in-flight requests on revoke with a non-retriable error', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    const injectedFetch = captured.clientOptions.fetch
    expect(injectedFetch).toBeDefined()

    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
              once: true
            })
          })
      )
    )
    const inFlight = injectedFetch!('https://analytics.cherry-ai.com/api/events')
    const assertion = expect(inFlight).rejects.toSatisfy(isNonRetriable)

    changePreference('app.privacy.data_collection.enabled', false)
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))
    destroyResolvers[0]()
    await assertion
    vi.unstubAllGlobals()
  })

  it('treats privacy policy invalidation the same as switching collection off', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    const injectedFetch = captured.clientOptions.fetch

    changePreference('app.privacy.policy_version', '20200101')
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))
    expect(mockDestroy).toHaveBeenCalledWith({ flush: false })
    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))

    await expect(injectedFetch!('https://analytics.cherry-ai.com/api/events')).rejects.toSatisfy(isNonRetriable)
  })

  it('preserves flush behavior on normal stop with consent still valid', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    const injectedFetch = captured.clientOptions.fetch
    expect(injectedFetch).toBeDefined()

    const response = new Response('{}', { status: 200 })
    const baseFetch = vi.fn(async () => response)
    vi.stubGlobal('fetch', baseFetch)
    await expect(injectedFetch!('https://analytics.cherry-ai.com/api/events')).resolves.toBe(response)
    expect(baseFetch).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()

    const stopPromise = service._doStop()
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))
    expect(mockDestroy).toHaveBeenCalledWith()
    destroyResolvers[0]?.()
    await stopPromise
    expect(mockGetQueueSize).not.toHaveBeenCalled()
  })
})

describe('AnalyticsService product events', () => {
  it('sends catalogued events anonymously with snake_case properties', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    service.trackProductEvent({
      event: 'cherryin_sign_in_result',
      source: 'onboarding',
      result: 'success',
      durationMs: 1200
    })

    expect(posthog.capture).toHaveBeenCalledWith({
      distinctId: expect.not.stringMatching(/^test-client-id$/),
      event: 'cherryin_sign_in_result',
      properties: expect.objectContaining({
        source: 'onboarding',
        result: 'success',
        duration_ms: 1200,
        schema_version: 1,
        $ip: '0.0.0.0',
        $process_person_profile: false
      })
    })
  })

  it('stamps product events with the local hour and an ISO weekday', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 15, 23, 30) })

    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'skip' })
    vi.useRealTimers()

    expect(posthog.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'onboarding_option_selected',
        properties: expect.objectContaining({ local_hour: 23, local_weekday: 7 })
      })
    )
  })

  it('stamps a replayed event with the local time it was raised, not when it was sent', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    captured.preferenceValues['app.privacy.policy_version'] = ''
    const service = new AnalyticsService()
    await service._doInit()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 15, 23, 59) })

    changePreference('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'skip' })
    vi.setSystemTime(new Date(2026, 10, 16, 0, 1))
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    vi.useRealTimers()

    expect(posthog.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'onboarding_option_selected',
        properties: expect.objectContaining({ local_hour: 23, local_weekday: 7 })
      })
    )
  })

  it('replays an event raised between consent and client start-up', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    captured.preferenceValues['app.privacy.policy_version'] = ''
    const service = new AnalyticsService()
    await service._doInit()

    changePreference('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'cherryin_login' })
    expect(service.isActivated).toBe(false)

    await vi.waitFor(() =>
      expect(posthog.capture).toHaveBeenCalledWith(expect.objectContaining({ event: 'onboarding_option_selected' }))
    )
  })

  it('reports app_opened once per process, before events replayed from the consent click', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    captured.preferenceValues['app.privacy.policy_version'] = ''
    captured.preferenceValues['app.onboarding.provider_setup.status'] = 'pending'
    const service = new AnalyticsService()
    await service._doInit()

    changePreference('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'cherryin_login' })
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    changePreference('app.privacy.data_collection.enabled', false)
    await vi.waitFor(() => expect(destroyResolvers).toHaveLength(1))
    destroyResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))
    changePreference('app.privacy.data_collection.enabled', true)
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    const events = posthog.capture.mock.calls.map(([call]) => call)
    expect(events.map(({ event }) => event)).toEqual(['app_opened', 'onboarding_option_selected', 'app_active'])
    expect(events[0].properties).toMatchObject({ onboarding_status: 'pending' })
  })

  it('describes the launch in app_opened: first run, v1 origin, and how the previous run ended', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    launch.kind.mockReturnValueOnce('upgraded')
    launch.migratedFromV1.mockReturnValueOnce(true)
    const mutableApplication = application as unknown as { lastExit: string }
    mutableApplication.lastExit = 'unclean'
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    mutableApplication.lastExit = 'unknown'

    const opened = posthog.capture.mock.calls.map(([message]) => message).find(({ event }) => event === 'app_opened')
    expect(opened.properties).toMatchObject({ launch: 'upgraded', migrated_from_v1: true, last_exit: 'unclean' })
  })

  it('still reports app_opened when the v1 migration record cannot be read', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    launch.migratedFromV1.mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    const opened = posthog.capture.mock.calls.map(([message]) => message).find(({ event }) => event === 'app_opened')
    expect(opened.properties).toMatchObject({ migrated_from_v1: false })
  })

  it('sends results saved before a relaunch right after app_opened', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    launch.pendingReports.mockReturnValueOnce([
      { event: 'restore_run', target: 's3', status: 'completed' },
      { event: 'data_relocation_run', copy: true, status: 'failed' }
    ])
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    const sent = posthog.capture.mock.calls.map(([message]) => message)
    expect(sent.slice(0, 3).map(({ event }) => event)).toEqual(['app_opened', 'restore_run', 'data_relocation_run'])
    expect(sent[1].properties).toMatchObject({ target: 's3', status: 'completed' })
    expect(sent[2].properties).toMatchObject({ copy: true, status: 'failed' })
  })

  it('binds product events to a signed-in account and starts a new anonymous id after sign-out', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'cherryin_login' })
    const anonymousBefore = posthog.capture.mock.calls.at(-1)![0].distinctId
    posthog.capture.mockClear()

    service.setProductAccount('cloud-api:global:production:account:a1')
    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'skip' })
    service.setProductAccount(null)
    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'other_provider' })

    const sent = posthog.capture.mock.calls.map(([message]) => message)
    expect(sent.map(({ event, distinctId }) => [event, distinctId])).toEqual([
      ['$identify', 'cloud-api:global:production:account:a1'],
      ['onboarding_option_selected', 'cloud-api:global:production:account:a1'],
      ['onboarding_option_selected', expect.any(String)]
    ])
    expect(sent[0].properties).toMatchObject({ $anon_distinct_id: anonymousBefore, $ip: '0.0.0.0' })
    expect(sent[1].properties.$process_person_profile).toBe(true)
    // The merged id and the device id stay out of later anonymous events.
    expect([anonymousBefore, 'test-client-id']).not.toContain(sent[2].distinctId)
    // The new id is on disk at once, so a crash right after sign-out cannot bring back the merged one.
    const cache = (await import('@application')).application.get('CacheService')
    const rotation = vi.mocked(cache.setPersist).mock.invocationCallOrder.at(-1)!
    expect(vi.mocked(cache.flushPersistForBackup).mock.invocationCallOrder.at(-1)).toBeGreaterThan(rotation)
    expect(sent[2].properties.$process_person_profile).toBe(false)
  })

  it('merges events made while signed out when the same account signs back in', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    const account = 'cloud-api:global:production:account:a1'

    service.setProductAccount(account)
    service.setProductAccount(null)
    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'skip' })
    const signedOutId = posthog.capture.mock.calls.at(-1)![0].distinctId
    service.setProductAccount(account)

    const identifies = posthog.capture.mock.calls
      .map(([message]) => message)
      .filter(({ event }) => event === '$identify')
    expect(identifies).toHaveLength(2)
    expect(identifies[1].properties.$anon_distinct_id).toBe(signedOutId)
  })

  it('identifies an account known before start-up, keeping the launch event on the device id', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    captured.preferenceValues['app.privacy.policy_version'] = ''
    const service = new AnalyticsService()
    await service._doInit()
    service.setProductAccount('cloud-api:cn:production:account:a1')

    changePreference('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    expect(posthog.capture.mock.calls.map(([message]) => [message.event, message.distinctId])).toEqual([
      ['$identify', 'cloud-api:cn:production:account:a1'],
      ['app_opened', 'test-client-id'],
      ['app_active', 'test-client-id']
    ])
    const [identify] = posthog.capture.mock.calls[0]
    expect(identify.properties.$anon_distinct_id).not.toBe('test-client-id')
  })

  it('replays a queued event under the account it was raised under, not one signed in before start-up', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    captured.preferenceValues['app.privacy.policy_version'] = ''
    const service = new AnalyticsService()
    await service._doInit()
    service.setProductAccount('cloud-api:global:production:account:a1')

    changePreference('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'skip' })
    service.setProductAccount('cloud-api:global:production:account:b2')
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    const replayed = posthog.capture.mock.calls.find(([message]) => message.event === 'onboarding_option_selected')
    expect(replayed?.[0].distinctId).toBe('cloud-api:global:production:account:a1')
  })

  it('drops events raised after data collection is turned off, even once it is turned back on', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    destroyResolvers.forEach((resolve) => resolve())
    mockDestroy.mockResolvedValue(undefined)

    changePreference('app.privacy.data_collection.enabled', false)
    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'skip' })
    service.setProductAccount('cloud-api:global:production:account:a1')
    await vi.waitFor(() => expect(service.isActivated).toBe(false))
    changePreference('app.privacy.data_collection.enabled', true)
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    const events = posthog.capture.mock.calls.map(([message]) => message.event)
    expect(events).not.toContain('onboarding_option_selected')
    expect(events.filter((event) => event === '$identify')).toHaveLength(1)
  })

  it('marks development traffic and keeps release traffic unmarked', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', '')
    const release = new AnalyticsService()
    await release._doInit()
    await vi.waitFor(() => expect(release.isActivated).toBe(true))
    release.trackProductEvent({ event: 'onboarding_option_selected', option: 'skip' })
    expect(posthog.capture.mock.calls.at(-1)?.[0].properties.test).toBe(false)

    BaseService.resetInstances()
    vi.stubEnv('DEV', true)
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    const development = new AnalyticsService()
    await development._doInit()
    await vi.waitFor(() => expect(development.isActivated).toBe(true))
    development.trackProductEvent({ event: 'onboarding_option_selected', option: 'skip' })
    expect(posthog.capture.mock.calls.at(-1)?.[0].properties.test).toBe(true)
  })

  it('sends usage-behavior events only when the build enables them', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    const click = {
      event: 'ui_clicked',
      ui: 'chat.message.action.copy',
      page: 'chat',
      element: 'button',
      input: 'pointer'
    } as const

    service.trackProductEvent(click)
    service.trackProductEvent({ event: 'setting_changed', key: 'app.language' })
    expect(posthog.capture).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'ui_clicked' }))
    expect(posthog.capture).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'setting_changed' }))

    vi.stubEnv('MAIN_VITE_ANALYTICS_BEHAVIOR_EVENTS', 'true')
    service.trackProductEvent(click)
    expect(posthog.capture).toHaveBeenCalledWith(expect.objectContaining({ event: 'ui_clicked' }))
  })

  it('drops events raised without consent instead of replaying them later', async () => {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    captured.preferenceValues['app.privacy.policy_version'] = ''
    const service = new AnalyticsService()
    await service._doInit()

    service.trackProductEvent({ event: 'onboarding_option_selected', option: 'skip' })
    changePreference('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    expect(posthog.capture).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'onboarding_option_selected' }))
  })
})

describe('AnalyticsService setting changes', () => {
  const settingEvents = () =>
    posthog.capture.mock.calls
      .map(([message]) => message)
      .filter(({ event }) => event === 'setting_changed')
      .map(({ properties }) => properties)

  async function startService() {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    vi.stubEnv('MAIN_VITE_ANALYTICS_BEHAVIOR_EVENTS', 'true')
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    return (changes: Array<[string, unknown]>) => captured.rendererPreferenceListener?.(changes)
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports rapid writes to one key once, after 2 s, with the last value', async () => {
    const change = await startService()

    change([['app.zoom_factor', 1.1]])
    vi.advanceTimersByTime(1_000)
    change([['app.zoom_factor', 1.3]])
    vi.advanceTimersByTime(1_999)
    expect(settingEvents()).toEqual([])

    vi.advanceTimersByTime(1)
    expect(settingEvents()).toEqual([expect.objectContaining({ key: 'app.zoom_factor', value: 1.3 })])
  })

  it('keeps changes made without consent out, even when consent returns before the report fires', async () => {
    const change = await startService()
    destroyResolvers.forEach((resolve) => resolve())
    mockDestroy.mockResolvedValue(undefined)

    change([['app.tray.enabled', false]])
    changePreference('app.privacy.data_collection.enabled', false)
    change([['app.spell_check.enabled', true]])
    changePreference('app.privacy.data_collection.enabled', true)
    change([['app.zoom_factor', 1.2]])
    vi.advanceTimersByTime(2_000)
    vi.useRealTimers()

    await vi.waitFor(() => expect(settingEvents()).toEqual([expect.objectContaining({ key: 'app.zoom_factor' })]))
  })

  it('coalesces each key independently', async () => {
    const change = await startService()

    change([
      ['app.tray.enabled', false],
      ['app.spell_check.enabled', true]
    ])
    vi.advanceTimersByTime(2_000)

    expect(settingEvents()).toEqual([
      expect.objectContaining({ key: 'app.tray.enabled', value: false }),
      expect.objectContaining({ key: 'app.spell_check.enabled', value: true })
    ])
  })

  it('reports values only for booleans, numbers, and the fixed options of a setting', async () => {
    const change = await startService()

    change([
      ['ui.theme_mode', 'dark'],
      ['app.language', 'xx-XX'],
      ['app.proxy.url', 'http://user:secret@proxy.local'],
      ['app.spell_check.languages', ['en-US']],
      ['app.zoom_factor', Number.NaN],
      ['app.tray.on_close', 0]
    ])
    vi.advanceTimersByTime(2_000)

    const events = settingEvents()
    expect(events[0]).toMatchObject({ key: 'ui.theme_mode', value: 'dark' })
    expect(events.slice(1).map(({ key }) => key)).toEqual([
      'app.language',
      'app.proxy.url',
      'app.spell_check.languages',
      'app.zoom_factor',
      'app.tray.on_close'
    ])
    expect(events.slice(1).every((properties) => !('value' in properties))).toBe(true)
  })
})

describe('AnalyticsService daily snapshots', () => {
  const captures = (event: string) =>
    posthog.capture.mock.calls.map(([message]) => message).filter((message) => message.event === event)

  async function startService(behaviorEvents = 'true') {
    vi.stubEnv('MAIN_VITE_POSTHOG_KEY', 'phc_test')
    vi.stubEnv('MAIN_VITE_ANALYTICS_BEHAVIOR_EVENTS', behaviorEvents)
    const service = new AnalyticsService()
    await service._doInit()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    return service
  }

  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
    vi.spyOn(messageService, 'countTopicBranches').mockReturnValue({
      topicCount: 12,
      branchedTopicCount: 2,
      branchCount: 5
    })
    vi.spyOn(assistantDataService, 'countConfiguredForAnalytics').mockReturnValue({
      assistantCount: 4,
      withPrompt: 3,
      withModel: 2,
      withTemperature: 1,
      withWebSearch: 1,
      withKnowledge: 0
    })
    vi.spyOn(agentService, 'countForAnalytics').mockReturnValue({
      agentCount: 3,
      heartbeatCount: 1,
      withChannelCount: 1,
      'type:claude-code': 2,
      'type:pi': 1,
      'permission:plan': 1,
      'permission:default': 2,
      'kind:builtin': 1,
      'kind:custom': 2
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    for (const key of [
      'ui.theme_mode',
      'app.zoom_factor',
      'app.proxy.url',
      'app.user.name',
      'app.user.avatar',
      'chat.default_model_id',
      'feature.translate.model_id'
    ]) {
      delete captured.preferenceValues[key]
    }
  })

  it('reports current values, with free text reduced to set or not set and the avatar to its kind', async () => {
    Object.assign(captured.preferenceValues, {
      'ui.theme_mode': 'dark',
      'app.zoom_factor': 1.2,
      'app.proxy.url': 'http://user:secret@proxy.local',
      'app.user.name': '',
      'app.user.avatar': 'file:avatar-id'
    })
    await startService()

    const [snapshot] = captures('settings_snapshot')
    expect(snapshot.properties).toMatchObject({
      'setting:ui.theme_mode': 'dark',
      'setting:app.zoom_factor': 1.2,
      'setting:app.proxy.url': true,
      'setting:app.user.name': false,
      'setting:app.user.avatar': 'image'
    })
    expect(Object.values(snapshot.properties).some((value) => String(value).includes('secret'))).toBe(false)
    expect(captures('chat_branch_snapshot')[0].properties).toMatchObject({
      topic_count: 12,
      branched_topic_count: 2,
      branch_count: 5
    })
  })

  it('reports where chosen models come from, never the model or a user-created provider', async () => {
    Object.assign(captured.preferenceValues, {
      'chat.default_model_id': 'my-relay-uuid::gpt-secret-finetune',
      'feature.translate.model_id': 'cherryin::qwen'
    })
    await startService()

    const { properties } = captures('settings_snapshot')[0]
    expect(properties['setting:chat.default_model_id']).toBe('own_key')
    expect(properties['setting:feature.translate.model_id']).toBe('cherryin')
    expect(properties['setting:feature.quick_assistant.model_id']).toBe('none')
    expect(JSON.stringify(properties)).not.toContain('gpt-secret-finetune')
  })

  it('reports where the voice models come from, including on-device ones, never the model', async () => {
    Object.assign(captured.preferenceValues, {
      'feature.voice.recognition.model_id': 'local-voice::qwen3-asr-1.7b',
      'feature.voice.speech.model_id': 'my-relay-uuid::tts-secret'
    })
    await startService()

    const { properties } = captures('settings_snapshot')[0]
    expect(properties['setting:feature.voice.recognition.model_id']).toBe('local')
    expect(properties['setting:feature.voice.speech.model_id']).toBe('own_key')
    expect(JSON.stringify(properties)).not.toMatch(/qwen3-asr|tts-secret/)
  })

  it('reports a hardware acceleration toggle with its value', async () => {
    const service = await startService()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    captured.rendererPreferenceListener?.([['BootConfig.app.disable_hardware_acceleration', true]])
    vi.advanceTimersByTime(2_000)
    captured.rendererPreferenceListener?.([['BootConfig.app.disable_hardware_acceleration', false]])
    vi.advanceTimersByTime(2_000)
    vi.useRealTimers()

    expect(captures('setting_changed').map(({ properties }) => properties.value)).toEqual([true, false])
    expect(service.isActivated).toBe(true)
  })

  it('reports how many assistants use each context option alongside the settings', async () => {
    await startService()

    expect(captures('assistant_snapshot')[0].properties).toMatchObject({
      assistant_count: 4,
      with_prompt: 3,
      with_model: 2,
      with_temperature: 1,
      with_web_search: 1,
      with_knowledge: 0
    })
  })

  it('keeps prefixed ids verbatim while snake-casing field names', async () => {
    const service = await startService()
    service.trackProductEvent({
      event: 'agent_turn_finished',
      status: 'success',
      trigger: 'user',
      agentKind: 'custom',
      agentType: 'claude-code',
      permissionMode: 'acceptEdits',
      modelSource: 'own_key',
      durationMs: 10,
      toolCallCount: 2,
      toolErrorCount: 0,
      subagentCount: 0,
      skillCount: 0,
      'tool:Bash': 1,
      'tool:WebFetch': 1
    })

    expect(captures('agent_turn_finished')[0].properties).toMatchObject({
      permission_mode: 'acceptEdits',
      tool_call_count: 2,
      'tool:Bash': 1,
      'tool:WebFetch': 1
    })
  })

  it('reports Agent counts by runtime and permission mode alongside the settings', async () => {
    await startService()

    expect(captures('agent_snapshot')[0].properties).toMatchObject({
      agent_count: 3,
      heartbeat_count: 1,
      with_channel_count: 1,
      'type:claude-code': 2,
      'permission:plan': 1,
      'kind:builtin': 1
    })
  })

  it("omits a value outside a setting's fixed options", async () => {
    captured.preferenceValues['ui.theme_mode'] = 'sepia'
    await startService()

    expect(captures('settings_snapshot')[0].properties).not.toHaveProperty('setting:ui.theme_mode')
  })

  it('reports once per local day, across restarts and hourly checks', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(2026, 10, 17, 9) })
    await startService()
    BaseService.resetInstances()
    await startService()
    vi.advanceTimersByTime(60 * 60_000)
    expect(captures('settings_snapshot')).toHaveLength(1)

    vi.setSystemTime(new Date(2026, 10, 18, 0, 30))
    vi.advanceTimersByTime(60 * 60_000)
    expect(captures('settings_snapshot')).toHaveLength(2)
  })

  it('sends nothing, and remembers no day, while behavior events are off', async () => {
    await startService('false')

    expect(captures('settings_snapshot')).toEqual([])
    expect(captures('chat_branch_snapshot')).toEqual([])
    expect(captures('assistant_snapshot')).toEqual([])
    expect(captures('agent_snapshot')).toEqual([])
    expect(MockMainCacheServiceExport.cacheService.getPersist('analytics.snapshot.last_day')).toBeNull()
  })

  it('reports daily activity once per local day even while behavior events are off', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(2026, 10, 17, 9) })
    await startService('false')
    BaseService.resetInstances()
    await startService('false')
    vi.advanceTimersByTime(60 * 60_000)
    expect(captures('app_active')).toHaveLength(1)

    // A session left running past midnight counts on the new day without a relaunch.
    vi.setSystemTime(new Date(2026, 10, 18, 0, 30))
    vi.advanceTimersByTime(60 * 60_000)
    expect(captures('app_active')).toHaveLength(2)
  })

  it('reports daily activity even when the behavior snapshot already ran today', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(2026, 10, 17, 9) })
    MockMainCacheServiceExport.cacheService.setPersist('analytics.snapshot.last_day', '2026-11-17')
    await startService()

    expect(captures('settings_snapshot')).toEqual([])
    expect(captures('app_active')).toHaveLength(1)
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

describe('AnalyticsService package edition delivery', () => {
  it.each(['cn', 'global'] as const)(
    'sends %s on both SDK endpoints and stops after consent revocation',
    async (edition) => {
      const { AnalyticsClient } = await vi.importActual<{
        AnalyticsClient: new (options: AnalyticsClientOptions) => AnalyticsClient
      }>('@cherrystudio/analytics-client')
      vi.mocked(getAppEdition).mockReturnValue(edition)
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response(JSON.stringify({ success: true, count: 1 }), { status: 200 })
      )
      vi.stubGlobal('fetch', fetch)
      let sdkClient: InstanceType<typeof AnalyticsClient> | undefined
      MockAnalyticsClient.mockImplementationOnce(function (options) {
        sdkClient = new AnalyticsClient({ ...options, baseUrl: 'http://analytics.test', autoBatch: false })
        return sdkClient
      })
      try {
        const service = new AnalyticsService()
        await service._doInit()
        await vi.waitFor(() => expect(service.isActivated).toBe(true))
        await service.trackAppUpdate()
        await sdkClient!.flush()
        expect(fetch.mock.calls.map(([url]) => url)).toEqual([
          'http://analytics.test/api/track',
          'http://analytics.test/api/events'
        ])
        for (const [, init] of fetch.mock.calls) {
          expect(new Headers(init?.headers).get('X-App-Edition')).toBe(edition)
        }
        changePreference('app.privacy.data_collection.enabled', false)
        await vi.waitFor(() => expect(service.isActivated).toBe(false))
        await service.trackAppUpdate()
        service.trackTokenUsage({ provider: 'openai', model: 'gpt-test', input_tokens: 1, output_tokens: 1 })
        expect(fetch).toHaveBeenCalledTimes(2)
      } finally {
        await sdkClient?.destroy({ flush: false })
        vi.unstubAllGlobals()
      }
    }
  )
})
