import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises `ApiGatewayService`'s reconcile-after-settle convergence: a toggle that
 * lands during an in-flight activation must be honoured (no queue, no dropped opposing
 * toggle), and a persistently failing transition must not spin the loop.
 *
 * The inner `ApiGateway` server is mocked so activation timing is controllable; the
 * preference-change handler is captured so the toggle can be driven directly.
 */

const { mockStart, mockStop, mockSetShared, captured } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  mockSetShared: vi.fn(),
  captured: { prefHandler: undefined as ((enabled: boolean) => void) | undefined }
}))

vi.mock('../server', () => ({
  ApiGateway: vi.fn(() => ({ start: mockStart, stop: mockStop, isRunning: () => true }))
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { listAgents: vi.fn(async () => ({ total: 0 })) }
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
      getMultiple: vi.fn(() => ({ enabled: false, host: '127.0.0.1', port: 23333, apiKey: 'existing-key' })),
      set: vi.fn(async () => {})
    },
    CacheService: { setShared: mockSetShared }
  })
})

import { ApiGatewayService } from '../ApiGatewayService'

let startResolvers: Array<() => void>
let rejectStart: boolean

beforeEach(() => {
  BaseService.resetInstances()
  captured.prefHandler = undefined
  startResolvers = []
  rejectStart = false
  mockStart.mockReset()
  mockStop.mockReset()
  mockSetShared.mockClear()
  mockStart.mockImplementation(() =>
    rejectStart
      ? Promise.reject(new Error('port in use'))
      : new Promise<void>((resolve) => startResolvers.push(resolve))
  )
  mockStop.mockResolvedValue(undefined)
})

describe('ApiGatewayService reconcile', () => {
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

  it('stop() during a lease resolves without throwing and leaves the server listening', async () => {
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
    await expect(service.stop()).resolves.toBeUndefined()
    expect(service.isActivated).toBe(true)
    expect(mockStop).not.toHaveBeenCalled()
    expect(lastPublishedRunning()).toBe(true)

    // Releasing the last lease now converges to the stopped state.
    service.releaseLease()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false)
    expect(lastPublishedRunning()).toBe(false)
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
