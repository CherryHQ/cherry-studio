import { BaseService } from '@main/core/lifecycle'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises `ApiGatewayService`'s reconcile-after-settle convergence: a toggle that
 * lands during an in-flight activation must be honoured (no queue, no dropped opposing
 * toggle), and a persistently failing transition must not spin the loop.
 *
 * The inner `ApiGateway` server is mocked so activation timing is controllable; the
 * preference-change handler is captured so the toggle can be driven directly.
 */

const { mockStart, mockStop, mockGetActiveUsageContext, mockGetSession, mockGetAgent, captured } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  mockGetActiveUsageContext: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetAgent: vi.fn(),
  captured: { prefHandler: undefined as ((enabled: boolean) => void) | undefined }
}))

vi.mock('../server', () => ({
  ApiGateway: vi.fn(() => ({ start: mockStart, stop: mockStop, isRunning: () => true }))
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { listAgents: vi.fn(async () => ({ total: 0 })), getAgent: mockGetAgent }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mockGetSession }
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
    CacheService: { setShared: vi.fn() },
    AgentSessionRuntimeService: { getActiveUsageContext: mockGetActiveUsageContext }
  } as any)
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
  mockGetActiveUsageContext.mockReset()
  mockGetSession.mockReset()
  mockGetAgent.mockReset()
  mockGetActiveUsageContext.mockReturnValue({
    agentSessionId: 'session-1',
    source: { type: 'agent', id: 'agent-1', name: 'Original Agent', icon: '🧠' }
  })
  mockGetSession.mockReturnValue({ id: 'session-1', agentId: 'agent-1' })
  mockGetAgent.mockReturnValue({ id: 'agent-1', configuration: { builtin_role: 'support' } })
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

  it('recognizes Support only from the authenticated session builtin role', () => {
    const service = new ApiGatewayService()
    const usageHeaders = service.getAgentSessionUsageHeaders('session-1')

    expect(service.isInternalSupportRequest(new Headers(usageHeaders))).toBe(true)
    expect(mockGetSession).toHaveBeenCalledWith('session-1')
    expect(mockGetAgent).toHaveBeenCalledWith('agent-1')

    mockGetAgent.mockReturnValueOnce({ id: 'agent-1', configuration: { builtin_role: 'assistant' } })
    expect(service.isInternalSupportRequest(new Headers(usageHeaders))).toBe(false)
    expect(
      service.isInternalSupportRequest(new Headers({ ...usageHeaders, 'x-cherry-internal-usage-token': 'wrong-proof' }))
    ).toBe(false)
  })

  it('treats a missing session as non-Support but propagates storage failures', () => {
    const service = new ApiGatewayService()
    const headers = new Headers(service.getAgentSessionUsageHeaders('session-1'))

    mockGetSession.mockImplementationOnce(() => {
      throw DataApiErrorFactory.notFound('Session', 'session-1')
    })
    expect(service.isInternalSupportRequest(headers)).toBe(false)

    const databaseError = DataApiErrorFactory.database(new Error('disk unavailable'))
    mockGetSession.mockImplementationOnce(() => {
      throw databaseError
    })
    expect(() => service.isInternalSupportRequest(headers)).toThrow(databaseError)
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
