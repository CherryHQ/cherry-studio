import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

/**
 * Exercises `ApiGatewayService`'s reconcile-after-settle convergence: a toggle that
 * lands during an in-flight activation must be honoured (no queue, no dropped opposing
 * toggle), and a persistently failing transition must not spin the loop.
 *
 * The inner `ApiGateway` server is mocked so activation timing is controllable; the
 * preference-change handler is captured so the toggle can be driven directly.
 */

const {
  mockStart,
  mockStop,
  mockLanStart,
  mockLanStop,
  mockSetShared,
  mockGetActiveUsageContext,
  mockPreferenceSet,
  mockPreferenceSetMultiple,
  captured
} = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  mockLanStart: vi.fn(),
  mockLanStop: vi.fn(),
  mockSetShared: vi.fn(),
  mockGetActiveUsageContext: vi.fn(),
  mockPreferenceSet: vi.fn<(key: string, value: boolean | string) => Promise<void>>(),
  mockPreferenceSetMultiple: vi.fn<(updates: Record<string, unknown>) => Promise<void>>(),
  captured: {
    prefHandler: undefined as ((enabled: boolean) => void) | undefined,
    enabledPreference: false,
    hostPreference: '127.0.0.1',
    portPreference: 23333
  }
}))

vi.mock('../server', () => ({
  ApiGateway: vi.fn(function ApiGatewayMock(endpoint: { host: string; port: number }) {
    if (endpoint.host === '0.0.0.0') {
      return { start: mockLanStart, stop: mockLanStop, isRunning: () => true, getPort: () => 34444 }
    }
    return { start: mockStart, stop: mockStop, isRunning: () => true }
  })
}))

vi.mock('@data/services/ApiGatewayPairedDeviceService', () => ({
  apiGatewayPairedDeviceService: { create: vi.fn() }
}))

vi.mock('node:os', () => ({
  hostname: () => 'desktop',
  networkInterfaces: () => ({
    en0: [{ address: '192.168.1.8', family: 'IPv4', internal: false }]
  })
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: {
      subscribeChange: vi.fn((_key: string, cb: (enabled: boolean) => void) => {
        captured.prefHandler = cb
        return () => {}
      }),
      get: vi.fn((key: string) => (key.endsWith('api_key') ? 'existing-key' : false)),
      getMultiple: vi.fn(() => ({
        enabled: captured.enabledPreference,
        host: captured.hostPreference,
        port: captured.portPreference,
        apiKey: 'existing-key'
      })),
      set: mockPreferenceSet,
      setMultiple: mockPreferenceSetMultiple
    },
    CacheService: { setShared: mockSetShared },
    AgentSessionRuntimeService: { getActiveUsageContext: mockGetActiveUsageContext }
  } as any)
})

import { ApiGatewayService } from '../ApiGatewayService'
import { ApiGateway } from '../server'

let startResolvers: Array<() => void>
let rejectStart: boolean

beforeEach(() => {
  BaseService.resetInstances()
  captured.prefHandler = undefined
  captured.enabledPreference = false
  captured.hostPreference = '127.0.0.1'
  captured.portPreference = 23333
  mockPreferenceSet.mockReset()
  mockPreferenceSet.mockImplementation(async (key, value) => {
    if (key === 'feature.api_gateway.enabled') captured.enabledPreference = value as boolean
    if (key === 'feature.api_gateway.host') captured.hostPreference = value as string
  })
  mockPreferenceSetMultiple.mockReset()
  mockPreferenceSetMultiple.mockImplementation(async (updates) => {
    const host = updates['feature.api_gateway.host']
    const enabled = updates['feature.api_gateway.enabled']
    if (typeof host === 'string') captured.hostPreference = host
    if (typeof enabled === 'boolean') captured.enabledPreference = enabled
  })
  startResolvers = []
  rejectStart = false
  mockStart.mockReset()
  mockStop.mockReset()
  mockLanStart.mockReset().mockResolvedValue(undefined)
  mockLanStop.mockReset().mockResolvedValue(undefined)
  mockSetShared.mockClear()
  mockGetActiveUsageContext.mockReset()
  mockGetActiveUsageContext.mockReturnValue({
    agentSessionId: 'session-1',
    source: { type: 'agent', id: 'agent-1', name: 'Original Agent', icon: '🧠' }
  })
  mockStart.mockImplementation(() =>
    rejectStart
      ? Promise.reject(new Error('port in use'))
      : new Promise<void>((resolve) => startResolvers.push(resolve))
  )
  mockStop.mockResolvedValue(undefined)
})

describe('ApiGatewayService reconcile', () => {
  it('recognizes an internal agent request when the process-local token matches', () => {
    const service = new ApiGatewayService()
    const headers = new Headers(service.getAgentSessionUsageHeaders('session-1'))

    expect(service.isInternalAgentRequest(headers)).toBe(true)
  })

  it('rejects an internal agent request when the process-local token is wrong or missing', () => {
    const service = new ApiGatewayService()
    const usageHeaders = service.getAgentSessionUsageHeaders('session-1')

    expect(
      service.isInternalAgentRequest(
        new Headers({
          ...usageHeaders,
          'x-cherry-internal-usage-token': 'wrong-proof'
        })
      )
    ).toBe(false)
    expect(service.isInternalAgentRequest(new Headers())).toBe(false)
  })

  it('recognizes an internal agent request without a session id when the process-local token matches', () => {
    const service = new ApiGatewayService()
    const headers = new Headers(service.getAgentSessionUsageHeaders('session-1'))
    headers.delete('x-cherry-agent-session-id')

    expect(service.isInternalAgentRequest(headers)).toBe(true)
  })

  it('accepts agent usage context only with its process-local proof', () => {
    const service = new ApiGatewayService()
    const usageHeaders = service.getAgentSessionUsageHeaders('session-1')

    expect(service.resolveAgentSessionUsage(new Headers(usageHeaders))).toEqual({
      agentSessionId: 'session-1',
      source: { type: 'agent', id: 'agent-1', name: 'Original Agent', icon: '🧠' }
    })
    expect(mockGetActiveUsageContext).toHaveBeenCalledWith('session-1')
    expect(
      service.resolveAgentSessionUsage(
        new Headers({
          ...usageHeaders,
          'x-cherry-internal-usage-token': 'wrong-proof'
        })
      )
    ).toBeUndefined()
    expect(
      service.resolveAgentSessionUsage(
        new Headers({
          'x-cherry-agent-session-id': 'session-1'
        })
      )
    ).toBeUndefined()
  })

  // Regression for #18521: boot used to start the gateway whenever any agent existed, overriding a
  // user who had turned it off — and nothing else may override it either.
  it('stays stopped at boot when the preference is disabled', async () => {
    const service = new ApiGatewayService()

    await service._doInit()

    expect(mockStart).not.toHaveBeenCalled()
    expect(service.isActivated).toBe(false)
  })

  it('starts at boot when the preference is enabled', async () => {
    captured.enabledPreference = true
    const service = new ApiGatewayService()

    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    expect(service.isActivated).toBe(true)
  })

  it('builds pairing offers from the endpoint snapshot that actually started', async () => {
    captured.enabledPreference = true
    captured.hostPreference = '0.0.0.0'
    captured.portPreference = 24444
    const service = new ApiGatewayService()

    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    captured.portPreference = 25555
    expect(service.createPairingOffer()).toMatchObject({
      hostname: 'desktop',
      port: 34444,
      addresses: ['192.168.1.8']
    })
  })

  // The command and the persisted intent must land together: a stop whose preference write never
  // happened comes back on the next launch, which is the whole of #18521.
  it('persists the intent before converging, and reports a failed persist instead of stopping', async () => {
    captured.enabledPreference = true
    const service = new ApiGatewayService()
    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    mockPreferenceSet.mockRejectedValueOnce(new Error('disk full'))
    await expect(service.stop()).rejects.toThrow('disk full')
    expect(service.isActivated).toBe(true)
  })

  it('persists the intent when a start succeeds', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    const started = service.start()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await started

    expect(service.getCurrentConfig().enabled).toBe(true)
    expect(service.isActivated).toBe(true)
  })

  // A re-bind must not resurrect a gateway another window disabled while the restart was queued:
  // that would leave runtime=running with the preference persisted as disabled.
  it('aborts a restart when the gateway was disabled meanwhile', async () => {
    captured.enabledPreference = true
    const service = new ApiGatewayService()
    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    // Another window's stop lands: the preference is already persisted when the restart re-reads it.
    captured.enabledPreference = false
    await expect(service.restart()).rejects.toThrow('disabled while restarting')
    expect(service.isActivated).toBe(false)
    expect(mockStart).toHaveBeenCalledTimes(1)
  })

  it('honors an opposing toggle that lands during an in-flight activation (no dropped toggle)', async () => {
    const service = new ApiGatewayService()
    await service._doInit() // Ready; desiredEnabled=false; reconcile is a no-op.
    expect(service.isActivated).toBe(false)
    expect(captured.prefHandler).toBeDefined()

    // Enable → reconcile starts activating; the inner start() stays pending.
    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false) // still mid-activation

    // Opposing disable lands mid-activation. A queue/short-circuit would drop it;
    // reconcile re-reads the desired state after the activation settles.
    captured.prefHandler!(false)

    // Complete the activation — the loop must now deactivate to converge to `false`.
    startResolvers[0]()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false)
  })

  it('converges to running when the final desired state is enabled', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('does not retry a failed activation for a stable desired state (no spin loop)', async () => {
    rejectStart = true
    const service = new ApiGatewayService()
    await service._doInit()

    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    // Give the loop a chance to (wrongly) retry the same failing target.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(service.isActivated).toBe(false)
  })

  it('converges when a pref change opposes an in-flight direct IPC start (single owner)', async () => {
    // The residual race: a direct IPC start() in flight + an opposing pref change.
    // With start() routed through the same queue, the pref change can't be dropped.
    const service = new ApiGatewayService()
    await service._doInit()

    // Attach the settle handler synchronously so the in-flight rejection (start() ends
    // up !isActivated because desired flipped) is never an unhandled rejection.
    const startSettled = service.start().then(
      () => 'resolved',
      () => 'rejected'
    )
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))

    // Opposing disable lands while the IPC activation is still in flight.
    captured.prefHandler!(false)

    // Complete the activation; the running reconcile must then deactivate to converge.
    startResolvers[0]()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    await startSettled

    expect(service.isActivated).toBe(false) // converged to desiredEnabled === false
  })
})

describe('ApiGatewayService LAN shutdown', () => {
  beforeEach(() => {
    captured.enabledPreference = true
    captured.hostPreference = '0.0.0.0'
    mockStart.mockResolvedValue(undefined)
  })

  it('keeps an ordinary gateway start on loopback after stopping a LAN-enabled gateway', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    await expect(service.stop()).resolves.toBe('stopped')
    expect(service.getCurrentConfig()).toMatchObject({ enabled: false, host: '127.0.0.1' })

    await service.start()

    expect(service.isActivated).toBe(true)
    expect(ApiGateway).toHaveBeenLastCalledWith({ host: '127.0.0.1', port: 23333 })
    expect(() => service.createPairingOffer()).toThrow('LAN access is disabled')
  })

  it('revokes LAN configuration and pairing while a local task defers shutdown', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    const offer = service.createPairingOffer()
    await service.acquireLease()

    await expect(service.stop()).resolves.toBe('deferred')

    expect(service.isActivated).toBe(true)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: false, host: '127.0.0.1' })
    expect(() => service.createPairingOffer()).toThrow('LAN access is disabled')
    expect(service.pairDevice(offer.code, { name: 'Phone', platform: 'android' })).toBeNull()

    service.releaseLease()
    await vi.waitFor(() => expect(service.isActivated).toBe(false))
    await service.start()
    expect(ApiGateway).toHaveBeenLastCalledWith({ host: '127.0.0.1', port: 23333 })
  })

  it('preserves the running LAN service when its stop preferences cannot be saved', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    mockPreferenceSetMultiple.mockRejectedValueOnce(new Error('disk full'))

    await expect(service.stop()).rejects.toThrow('disk full')

    expect(service.isActivated).toBe(true)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '0.0.0.0' })
    expect(service.createPairingOffer().addresses).toEqual(['192.168.1.8'])
  })

  it('retains LAN configuration for an explicit restart', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    await service.restart()

    expect(service.isActivated).toBe(true)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '0.0.0.0' })
    expect(ApiGateway).toHaveBeenLastCalledWith({ host: '0.0.0.0', port: 0 })
    expect(service.createPairingOffer().addresses).toEqual(['192.168.1.8'])
  })
})

describe('ApiGatewayService independent LAN access', () => {
  beforeEach(() => {
    captured.enabledPreference = true
    mockStart.mockResolvedValue(undefined)
  })

  it('enables and disables LAN without changing the local gateway or its enabled intent', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    await service.acquireLease()

    await service.setLanEnabled(true)
    const offer = service.createPairingOffer()
    expect(offer.port).toBe(34444)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '0.0.0.0', port: 23333 })

    await service.setLanEnabled(false)

    expect(service.isActivated).toBe(true)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '127.0.0.1' })
    expect(() => service.createPairingOffer()).toThrow('LAN access is disabled')
    expect(service.pairDevice(offer.code, { name: 'Phone', platform: 'android' })).toBeNull()
    expect(mockStop).not.toHaveBeenCalled()
    service.releaseLease()
  })

  it.each(['listen', 'persist'])('keeps LAN disabled when its %s step fails', async (failure) => {
    const service = new ApiGatewayService()
    await service._doInit()
    if (failure === 'listen') mockLanStart.mockRejectedValueOnce(new Error('bind failed'))
    else mockPreferenceSet.mockRejectedValueOnce(new Error('disk full'))

    await expect(service.setLanEnabled(true)).rejects.toThrow()

    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '127.0.0.1' })
    expect(service.isActivated).toBe(true)
    expect(() => service.createPairingOffer()).toThrow('LAN access is disabled')
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('requires the user to enable the gateway instead of starting it from LAN settings', async () => {
    captured.enabledPreference = false
    const service = new ApiGatewayService()
    await service._doInit()

    await expect(service.setLanEnabled(true)).rejects.toThrow('Start the API Gateway')

    expect(service.getCurrentConfig()).toMatchObject({ enabled: false, host: '127.0.0.1' })
    expect(service.isActivated).toBe(false)
  })

  it('does not restore LAN intent if the user stops the gateway during LAN startup', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    let finishListening!: () => void
    mockLanStart.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishListening = resolve
        })
    )
    const enabling = service.setLanEnabled(true).catch((error) => error)
    await vi.waitFor(() => expect(finishListening).toBeDefined())
    const stopping = service.stop()
    await vi.waitFor(() => expect(service.getCurrentConfig().enabled).toBe(false))
    finishListening()

    expect(await enabling).toBeInstanceOf(Error)
    await stopping
    expect(service.getCurrentConfig()).toMatchObject({ enabled: false, host: '127.0.0.1' })
    expect(service.isActivated).toBe(false)
  })
})

describe('ApiGatewayService lease', () => {
  it('starts the gateway for a lease when disabled, and stops it once released', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    expect(service.isActivated).toBe(false)

    const acquired = service.acquireLease()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await acquired
    expect(service.isActivated).toBe(true)

    service.releaseLease()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false)
  })

  it('does not stop a gateway the user enabled while a lease was held', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    const acquired = service.acquireLease()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await acquired

    // User turns the gateway on mid-lease; releasing the lease must not undo their choice.
    captured.prefHandler!(true)
    service.releaseLease()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockStop).not.toHaveBeenCalled()
    expect(service.isActivated).toBe(true)
  })

  it('keeps the gateway running while a lease is held even if the user disables it', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    // Start from a user-enabled, running gateway.
    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))

    await service.acquireLease()
    // User disables the gateway mid-lease — the lease must keep it up (don't cut off the consumer).
    captured.prefHandler!(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockStop).not.toHaveBeenCalled()
    expect(service.isActivated).toBe(true)

    // Releasing the last lease now lets it converge to the user's disabled state.
    service.releaseLease()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false)
  })

  it('holds the gateway up until the last of several leases is released', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    const first = service.acquireLease()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await first
    await service.acquireLease() // gateway already running → settles without another start
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(service.isActivated).toBe(true)

    service.releaseLease()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockStop).not.toHaveBeenCalled() // one lease still held
    expect(service.isActivated).toBe(true)

    service.releaseLease()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false)
  })

  it('rolls back the lease and throws when the gateway fails to start', async () => {
    rejectStart = true
    const service = new ApiGatewayService()
    await service._doInit()

    await expect(service.acquireLease()).rejects.toThrow('port in use')
    expect(service.isActivated).toBe(false)
  })
})

describe('ApiGatewayService running-state publication', () => {
  /** Latest value published to the shared `feature.api_gateway.running` cache, or undefined. */
  const lastPublishedRunning = (): boolean | undefined => {
    const calls = mockSetShared.mock.calls.filter((call) => call[0] === 'feature.api_gateway.running')
    return calls.length ? (calls[calls.length - 1][1] as boolean) : undefined
  }

  it('publishes running=true for a lease-only activation (running reflects actual listening)', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    const acquired = service.acquireLease()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await acquired
    expect(service.isActivated).toBe(true)

    // `running` tracks the server actually listening — including under a lease — so the settings
    // page disables port / API-key editing while a PDF translation holds the gateway up. The lease
    // is kept out of the persisted `enabled` pref on the renderer side, not by faking `running`.
    expect(lastPublishedRunning()).toBe(true)
  })

  it('returns deferred when stop() clears intent but a lease leaves the server listening', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    // Start from a user-enabled, running gateway, then hold a transient lease on top of it.
    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    await service.acquireLease()

    // A user-driven stop while a lease is held records the intent but must resolve (not throw); the
    // lease keeps the server up (still listening, still `running=true`) until it releases.
    await expect(service.stop()).resolves.toBe('deferred')
    expect(service.isActivated).toBe(true)
    expect(mockStop).not.toHaveBeenCalled()
    expect(lastPublishedRunning()).toBe(true)

    // Releasing the last lease now converges to the stopped state.
    service.releaseLease()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false)
    expect(lastPublishedRunning()).toBe(false)
  })

  it('returns stopped when stop() deactivates the server immediately', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    const started = service.start()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await started

    await expect(service.stop()).resolves.toBe('stopped')
    expect(service.isActivated).toBe(false)
    expect(mockStop).toHaveBeenCalledTimes(1)
  })

  it('refuses restart() while a lease is active (no false-success no-op rebind)', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    // Persistently enabled + running, with a transient lease on top.
    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    await service.acquireLease()

    const startsBefore = mockStart.mock.calls.length

    // A lease pins the reconciler target, so stop→start can't re-bind — restart would silently
    // no-op yet report success. It must refuse (busy) instead, and perform no transition.
    await expect(service.restart()).rejects.toThrow(/busy/i)
    expect(mockStop).not.toHaveBeenCalled()
    expect(mockStart).toHaveBeenCalledTimes(startsBefore)
    expect(service.isActivated).toBe(true)
  })
})
