import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import type { AdvertisedRemoteEndpoint } from '@shared/data/preference/preferenceTypes'

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
  mockRebind,
  mockSetShared,
  mockGetActiveUsageContext,
  mockPreferenceSet,
  mockPreferenceSetMultiple,
  captured
} = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  mockRebind: vi.fn(),
  mockSetShared: vi.fn(),
  mockGetActiveUsageContext: vi.fn(),
  mockPreferenceSet: vi.fn<(key: string, value: boolean | string) => Promise<void>>(),
  mockPreferenceSetMultiple: vi.fn<(updates: Record<string, unknown>) => Promise<void>>(),
  captured: {
    prefHandler: undefined as ((enabled: boolean) => void) | undefined,
    enabledPreference: false,
    hostPreference: '127.0.0.1',
    portPreference: 23333,
    ipv6Addresses: [] as string[],
    advertisedEndpoint: null as AdvertisedRemoteEndpoint | null,
    ipv6Listening: true
  }
}))

vi.mock('../server', () => ({
  ApiGateway: vi.fn(function ApiGatewayMock(endpoint: { host: string; port: number }) {
    let host: string | undefined = endpoint.host
    return {
      start: mockStart,
      stop: mockStop,
      isRunning: () => host !== undefined,
      getPort: () => endpoint.port,
      getHost: () => host,
      getHosts: () => (host ? [host, ...(captured.ipv6Listening ? [host === '0.0.0.0' ? '::' : '::1'] : [])] : []),
      rebind: async (nextHost: string) => {
        host = undefined
        await mockRebind(nextHost)
        host = nextHost
      }
    }
  })
}))

vi.mock('@data/services/ApiGatewayPairedDeviceService', () => ({
  apiGatewayPairedDeviceService: { create: vi.fn() }
}))

vi.mock('systeminformation', () => ({ networkInterfaces: async () => [] }))

vi.mock('node:os', () => ({
  hostname: () => 'desktop',
  networkInterfaces: () => ({
    en0: [
      { address: '192.168.1.8', family: 'IPv4', internal: false },
      ...captured.ipv6Addresses.map((address) => ({ address, family: 'IPv6', internal: false }))
    ]
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
      get: vi.fn((key: string) => {
        if (key === 'app.language') return 'en-US'
        if (key.endsWith('advertised_endpoint')) return captured.advertisedEndpoint
        return key.endsWith('api_key') ? 'existing-key' : false
      }),
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
    AgentSessionRuntimeService: { getActiveUsageContext: mockGetActiveUsageContext },
    RemoteAccessService: {
      updateDirectEndpoint: vi.fn(),
      closeIngress: vi.fn(),
      createInvitation: vi.fn(async () => ({
        invitationId: 'invitation',
        invitationSecret: 'secret',
        expiresAt: '2026-09-22T00:02:00.000Z',
        desktopIdentity: '12D3KooWDesktop',
        protocolVersions: [1]
      }))
    }
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
  captured.ipv6Addresses = []
  captured.advertisedEndpoint = null
  captured.ipv6Listening = true
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
  mockRebind.mockReset().mockResolvedValue(undefined)
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

async function startInternalGateway(service: ApiGatewayService) {
  const pending = service.ensureInternalGateway()
  await vi.waitFor(() => expect(startResolvers.length).toBeGreaterThan(0))
  startResolvers.at(-1)!()
  return pending
}

const CHAT_SCOPE = { path: '/v1/chat/completions', model: 'openai:gpt-4o' }

describe('ApiGatewayService internal gateway', () => {
  it('shares bounded permission retries across consumers and returns usable credentials after recovery', async () => {
    const service = new ApiGatewayService()
    const original = Object.assign(new Error('denied'), { code: 'EACCES', syscall: 'listen' })
    mockStart.mockRejectedValueOnce(original).mockRejectedValueOnce(original).mockResolvedValueOnce(undefined)
    const config = service.getCurrentConfig()
    const [internal, scoped] = await Promise.all([
      service.ensureInternalGateway(),
      service.createScopedCredential(CHAT_SCOPE)
    ])

    expect(mockStart).toHaveBeenCalledTimes(3)
    expect(vi.mocked(ApiGateway).mock.calls).toEqual(
      Array.from({ length: 3 }, () => [{ host: '127.0.0.1', port: 0 }, 'internal'])
    )
    expect(scoped.baseUrl).toBe(internal.baseUrl)
    expect(service.getInternalGatewayOrigin()).toBe(internal.baseUrl)
    expect(service.isInternalRequest(new Headers({ 'x-api-key': internal.apiKey }))).toBe(true)
    expect(service.getCredentialScope(new Headers({ 'x-api-key': scoped.apiKey }))).toEqual(CHAT_SCOPE)
    expect(service.getCurrentConfig()).toEqual(config)
    expect(service.isActivated).toBe(false)
  })

  it.each([
    { code: 'EADDRINUSE', syscall: 'listen' },
    { code: 'EACCES', syscall: 'open' },
    { code: 'EAFNOSUPPORT', syscall: 'listen' }
  ])('does not automatically retry unrelated failures: $code / $syscall', async (fields) => {
    const service = new ApiGatewayService()
    const original = Object.assign(new Error('failed'), fields)
    mockStart.mockRejectedValue(original)

    await expect(service.ensureInternalGateway()).rejects.toBe(original)
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(service.getInternalGatewayOrigin()).toBeUndefined()
  })

  it('reports internal permission recovery to concurrent consumers and allows a later retry without public changes', async () => {
    const service = new ApiGatewayService()
    const original = Object.assign(new Error('denied'), {
      code: 'EACCES',
      syscall: 'listen',
      address: '::1',
      port: 49152
    })
    mockStart.mockRejectedValueOnce(original).mockRejectedValueOnce(original).mockRejectedValueOnce(original)
    const config = service.getCurrentConfig()
    const results = await Promise.allSettled([
      service.ensureInternalGateway(),
      service.createScopedCredential(CHAT_SCOPE)
    ])
    for (const result of results) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') {
        expect(result.reason.message).toContain('internal API Gateway')
        expect(result.reason.message).toContain('::1, requested TCP port 49152')
        expect(result.reason.message).toContain('Retry the request')
        expect(result.reason.cause).toBe(original)
      }
    }
    expect(mockStart).toHaveBeenCalledTimes(3)
    expect(service.getInternalGatewayOrigin()).toBeUndefined()
    expect(service.getCurrentConfig()).toEqual(config)
    expect(mockSetShared).not.toHaveBeenCalled()
    expect(mockPreferenceSet).not.toHaveBeenCalled()
    await expect(startInternalGateway(service)).resolves.toMatchObject({ baseUrl: expect.any(String) })
    expect(service.getInternalGatewayOrigin()).toBeDefined()
  })

  it('serves internal consumers from one loopback listener without enabling the user-facing gateway', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    const internal = await startInternalGateway(service)
    const scoped = await service.createScopedCredential(CHAT_SCOPE)

    expect(vi.mocked(ApiGateway)).toHaveBeenCalledOnce()
    expect(vi.mocked(ApiGateway)).toHaveBeenCalledWith({ host: '127.0.0.1', port: 0 }, 'internal')
    expect(scoped.baseUrl).toBe(internal.baseUrl)
    expect(service.getInternalGatewayOrigin()).toBe(internal.baseUrl)
    expect(service.isActivated).toBe(false)
    expect(captured.enabledPreference).toBe(false)
  })

  it('retries the internal listener after a failed start', async () => {
    const service = new ApiGatewayService()
    rejectStart = true
    await expect(service.ensureInternalGateway()).rejects.toThrow('port in use')

    rejectStart = false
    await expect(startInternalGateway(service)).resolves.toMatchObject({ baseUrl: expect.any(String) })
    expect(vi.mocked(ApiGateway)).toHaveBeenCalledTimes(2)
  })

  it('recognizes internal credentials in every header dialect and never the user key', async () => {
    const service = new ApiGatewayService()
    const internal = await startInternalGateway(service)
    const scoped = await service.createScopedCredential(CHAT_SCOPE)

    expect(service.isInternalRequest(new Headers({ 'x-api-key': internal.apiKey }))).toBe(true)
    expect(service.isInternalRequest(new Headers({ authorization: `Bearer ${scoped.apiKey}` }))).toBe(true)
    expect(service.isInternalRequest(new Headers({ 'x-goog-api-key': internal.apiKey }))).toBe(true)
    expect(service.isInternalRequest(new Headers({ 'x-api-key': 'existing-key' }))).toBe(false)
    expect(service.isInternalRequest(new Headers())).toBe(false)
  })

  it('binds each scoped credential to its own scope and revokes it on dispose', async () => {
    const service = new ApiGatewayService()
    const internal = await startInternalGateway(service)
    const first = await service.createScopedCredential(CHAT_SCOPE)
    const second = await service.createScopedCredential({ ...CHAT_SCOPE, model: 'cherryai-subscription:qwen3.8-flash' })
    const headers = (apiKey: string) => new Headers({ authorization: `Bearer ${apiKey}` })

    expect(first.apiKey).not.toBe(second.apiKey)
    expect(service.getCredentialScope(headers(first.apiKey))).toEqual(CHAT_SCOPE)
    expect(service.getCredentialScope(headers(second.apiKey))?.model).toBe('cherryai-subscription:qwen3.8-flash')
    expect(service.getCredentialScope(headers(internal.apiKey))).toBeUndefined()

    first.dispose()
    expect(service.isInternalRequest(headers(first.apiKey))).toBe(false)
    expect(service.getCredentialScope(headers(first.apiKey))).toBeUndefined()
    expect(service.isInternalRequest(headers(second.apiKey))).toBe(true)
  })

  it('attributes usage to an Agent session only for the unrestricted internal key', async () => {
    const service = new ApiGatewayService()
    const internal = await startInternalGateway(service)
    const scoped = await service.createScopedCredential(CHAT_SCOPE)
    const sessionHeaders = service.getAgentSessionUsageHeaders('session-1')

    expect(service.resolveAgentSessionUsage(new Headers({ ...sessionHeaders, 'x-api-key': internal.apiKey }))).toEqual({
      agentSessionId: 'session-1',
      source: { type: 'agent', id: 'agent-1', name: 'Original Agent', icon: '🧠' }
    })
    expect(mockGetActiveUsageContext).toHaveBeenCalledWith('session-1')
    expect(service.getAgentSessionId(new Headers({ ...sessionHeaders, 'x-api-key': scoped.apiKey }))).toBeUndefined()
    expect(service.getAgentSessionId(new Headers({ ...sessionHeaders, 'x-api-key': 'existing-key' }))).toBeUndefined()
  })
})

describe('ApiGatewayService reconcile', () => {
  it('keeps a denied public start stopped without spinning and uses the edited port on explicit retry', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    const original = Object.assign(new Error('denied'), { code: 'EACCES', syscall: 'listen' })
    mockStart.mockRejectedValueOnce(original)
    await expect(service.start()).rejects.toMatchObject({
      message: expect.stringContaining('different Port'),
      cause: original
    })
    expect(service.isActivated).toBe(false)
    expect(service.isRunning()).toBe(false)
    expect(captured.enabledPreference).toBe(true)
    expect(mockSetShared).toHaveBeenCalledWith('feature.api_gateway.running', false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockStart).toHaveBeenCalledTimes(1)
    captured.portPreference = 24444
    mockStart.mockResolvedValueOnce(undefined)
    await service.start()
    expect(ApiGateway).toHaveBeenLastCalledWith({ host: '127.0.0.1', port: 24444 })
    expect(service.isActivated).toBe(true)
    expect(service.isRunning()).toBe(true)
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

  it('builds remote invitations from the endpoint snapshot that actually started', async () => {
    captured.enabledPreference = true
    captured.hostPreference = '0.0.0.0'
    captured.portPreference = 24444
    const service = new ApiGatewayService()

    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    captured.portPreference = 25555
    await expect(service.createRemoteInvitation()).resolves.toMatchObject({
      hostname: 'desktop',
      port: 24444,
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
    expect(mockSetShared).toHaveBeenLastCalledWith('feature.api_gateway.lan_running', false)
    await expect(service.createRemoteInvitation()).rejects.toThrow('Device connections are disabled')
  })

  it('limits invitations to 32 sorted addresses while retaining every selectable interface address', async () => {
    captured.ipv6Addresses = Array.from({ length: 40 }, (_, i) => `2001:db8::${(i + 1).toString(16)}`)
    const service = new ApiGatewayService()
    await service._doInit()
    const invitation = await service.createRemoteInvitation()
    expect(invitation.addresses).toHaveLength(32)
    expect(invitation.addresses[0]).toBe('192.168.1.8')
    expect(invitation.addressOptions).toHaveLength(41)
    expect(invitation.addressOptions[0]).toEqual({ address: '192.168.1.8', interfaceName: 'en0' })
  })

  it('advertises an external endpoint and restores the actual bound port without rebinding', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    captured.advertisedEndpoint = { host: 'Desktop.example.com', port: 443, security: 'wss' }
    captured.portPreference = 24444
    expect(await service.createRemoteInvitation()).toMatchObject({
      port: 23333,
      endpoints: [{ host: 'desktop.example.com', port: 443, security: 'wss' }],
      desktopIdentity: '12D3KooWDesktop',
      invitationId: 'invitation'
    })
    captured.advertisedEndpoint = null
    expect(await service.getRemoteEndpoint()).toMatchObject({
      advertisedEndpoint: null,
      endpoints: [{ host: '192.168.1.8', port: 23333, security: 'ws' }]
    })
  })

  it('keeps the saved input URL out of invitation transport endpoints', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    captured.advertisedEndpoint = {
      host: 'desktop.example.com',
      port: 443,
      security: 'wss',
      inputUrl: 'https://Desktop.example.com'
    }
    const invitation = await service.createRemoteInvitation()
    const endpoint = { host: 'desktop.example.com', port: 443, security: 'wss' }
    expect(invitation.advertisedEndpoint).toEqual(endpoint)
    expect(invitation.endpoints).toEqual([endpoint])
  })

  it('rejects invalid persisted destinations instead of issuing an unusable invitation', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    captured.advertisedEndpoint = { host: '127.0.0.1', port: 443, security: 'wss' }
    await expect(service.createRemoteInvitation()).rejects.toThrow('Invalid remote destination')
  })

  it('offers routable IPv6 candidates only while IPv6 is actually listening', async () => {
    captured.ipv6Addresses = ['fd7a::2', '2001:db8::2', 'fe80::2', 'fe80::2%en0']
    const service = new ApiGatewayService()
    await service._doInit()
    expect((await service.getRemoteEndpoint()).addresses).toEqual(['192.168.1.8', '2001:db8::2', 'fd7a::2'])
    captured.ipv6Listening = false
    expect((await service.getRemoteEndpoint()).addresses).toEqual(['192.168.1.8'])
  })

  it('preserves the running LAN service when its stop preferences cannot be saved', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    mockPreferenceSetMultiple.mockRejectedValueOnce(new Error('disk full'))

    await expect(service.stop()).rejects.toThrow('disk full')

    expect(service.isActivated).toBe(true)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '0.0.0.0' })
    expect((await service.createRemoteInvitation()).addresses).toEqual(['192.168.1.8'])
  })

  it('retains LAN configuration for an explicit restart', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    await service.restart()

    expect(service.isActivated).toBe(true)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '0.0.0.0' })
    expect(ApiGateway).toHaveBeenLastCalledWith({ host: '0.0.0.0', port: 23333 })
    expect((await service.createRemoteInvitation()).addresses).toEqual(['192.168.1.8'])
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

    await service.setLanEnabled(true)
    expect((await service.createRemoteInvitation()).port).toBe(23333)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '0.0.0.0', port: 23333 })

    expect(mockSetShared).toHaveBeenLastCalledWith('feature.api_gateway.lan_running', true)
    await service.setLanEnabled(false)
    expect(mockSetShared).toHaveBeenLastCalledWith('feature.api_gateway.lan_running', false)

    expect(service.isActivated).toBe(true)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '127.0.0.1' })
    await expect(service.createRemoteInvitation()).rejects.toThrow('Device connections are disabled')
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('restores loopback and reports failure when opening network access fails', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    mockRebind.mockRejectedValueOnce(new Error('address in use'))

    await expect(service.setLanEnabled(true)).rejects.toThrow('address in use')

    expect(service.isRunning()).toBe(true)
    expect(service.getCurrentConfig().host).toBe('127.0.0.1')
    expect(mockSetShared).toHaveBeenLastCalledWith('feature.api_gateway.lan_running', false)
    await expect(service.createRemoteInvitation()).rejects.toThrow('Device connections are disabled')
  })

  it('leaves no network listener when closing access cannot bind loopback, and permits recovery', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    await service.setLanEnabled(true)
    mockRebind.mockRejectedValueOnce(new Error('address in use'))

    await expect(service.setLanEnabled(false)).rejects.toThrow('address in use')

    expect(service.isRunning()).toBe(false)
    expect(service.getCurrentConfig().host).toBe('127.0.0.1')
    expect(mockSetShared).toHaveBeenLastCalledWith('feature.api_gateway.lan_running', false)
    await service.start()
    expect(service.isRunning()).toBe(true)
    expect(mockSetShared).toHaveBeenLastCalledWith('feature.api_gateway.lan_running', false)
  })

  it('keeps LAN disabled when its preference cannot be saved', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    mockPreferenceSet.mockRejectedValueOnce(new Error('disk full'))

    await expect(service.setLanEnabled(true)).rejects.toThrow()

    expect(service.getCurrentConfig()).toMatchObject({ enabled: true, host: '127.0.0.1' })
    expect(service.isActivated).toBe(true)
    await expect(service.createRemoteInvitation()).rejects.toThrow('Device connections are disabled')
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

  it('reports a superseded enable when the gateway stops during rebinding', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    let finishRebinding!: () => void
    mockRebind.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRebinding = resolve
        })
    )

    const enabling = service.setLanEnabled(true).catch((error) => error)
    await vi.waitFor(() => expect(finishRebinding).toBeDefined())
    const stopping = service.stop()
    await vi.waitFor(() => expect(service.getCurrentConfig().enabled).toBe(false))
    finishRebinding()

    expect(await enabling).toBeInstanceOf(Error)
    await expect(stopping).resolves.toBe('stopped')
    expect(service.isRunning()).toBe(false)
    expect(service.getCurrentConfig()).toMatchObject({ enabled: false, host: '127.0.0.1' })
    expect(mockSetShared).toHaveBeenLastCalledWith('feature.api_gateway.lan_running', false)
  })

  it('does not restore LAN intent if the user stops the gateway while enabling LAN', async () => {
    const service = new ApiGatewayService()
    await service._doInit()
    let finishSaving!: () => void
    mockPreferenceSet.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSaving = () => {
            captured.hostPreference = '0.0.0.0'
            resolve()
          }
        })
    )
    const enabling = service.setLanEnabled(true).catch((error) => error)
    await vi.waitFor(() => expect(finishSaving).toBeDefined())
    const stopping = service.stop()
    await vi.waitFor(() => expect(service.getCurrentConfig().enabled).toBe(false))
    finishSaving()

    expect(await enabling).toBeInstanceOf(Error)
    await stopping
    expect(service.getCurrentConfig()).toMatchObject({ enabled: false, host: '127.0.0.1' })
    expect(service.isActivated).toBe(false)
  })
})

describe('ApiGatewayService running-state publication', () => {
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
})
