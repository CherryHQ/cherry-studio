import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
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
    MockAnalyticsClient: vi.fn(function AnalyticsClientMock(options: { fetch?: typeof fetch }) {
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
      clientOptions
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
  captured.prefHandlers[key]?.(value)
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

    expect(mockDestroy).toHaveBeenCalledWith({ flush: false })
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
