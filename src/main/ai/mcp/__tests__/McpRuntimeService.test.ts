import { BaseService } from '@main/core/lifecycle'
import type { McpServer } from '@shared/data/types/mcpServer'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mcpCatalogMock = vi.hoisted(() => ({
  clearSharedToolsCache: vi.fn(),
  refreshTools: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ McpCatalogService: mcpCatalogMock } as Record<string, unknown>)
})

const getByIdMock = vi.fn<(id: string) => McpServer>()
vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: {
    getById: (id: string) => getByIdMock(id)
  }
}))

// Mock the MCP SDK transports + Client so we can drive the transport-fallback path without
// a real network server. SSE connect throws a 405 (mirrors the issue); streamableHttp succeeds.
const mcpSdkMock = vi.hoisted(() => {
  class SseError extends Error {
    code: number
    constructor(code: number, message: string) {
      super(`SSE error: ${message}`)
      this.code = code
    }
  }
  class SSEClientTransport {
    kind = 'sse' as const
    close = vi.fn().mockResolvedValue(undefined)
    constructor(url: unknown, opts?: unknown) {
      void url
      void opts
    }
  }
  class StreamableHTTPClientTransport {
    kind = 'streamableHttp' as const
    close = vi.fn().mockResolvedValue(undefined)
    constructor(url: unknown, opts?: unknown) {
      void url
      void opts
    }
  }
  const clients: Array<{ connectCalls: Array<{ kind: string }>; close: ReturnType<typeof vi.fn> }> = []
  class Client {
    setNotificationHandler = vi.fn()
    _transport: { kind: string; close?: ReturnType<typeof vi.fn> } | undefined = undefined
    close = vi.fn().mockImplementation(async () => {
      this._transport = undefined
    })
    ping = vi.fn().mockResolvedValue(true)
    connectCalls: Array<{ kind: string }> = []
    constructor() {
      clients.push(this)
    }
    async connect(transport: { kind: string; close?: ReturnType<typeof vi.fn> }) {
      // Mirror MCP SDK Protocol.connect: _transport is set before start() runs, and a failed
      // start() leaves it set. This is what makes the fallback retry fail unless client.close()
      // resets it — the test would not catch that regression otherwise.
      if (this._transport) {
        throw new Error('Already connected to a transport. Call close() before connecting to a new transport')
      }
      this._transport = transport
      this.connectCalls.push({ kind: transport.kind })
      mcpSdkMock.state.onAfterConnect?.()
      if (transport.kind === 'sse') {
        throw new SseError(405, 'Non-200 status code (405)')
      }
      if (mcpSdkMock.state.failStreamable) {
        throw new StreamableHTTPError(mcpSdkMock.state.failStreamableCode ?? 503, 'boom')
      }
    }
  }
  class StreamableHTTPError extends Error {
    code: number
    constructor(code: number, message?: string) {
      super(message ?? 'boom')
      this.code = code
    }
  }
  return {
    SseError,
    SSEClientTransport,
    StreamableHTTPClientTransport,
    Client,
    StreamableHTTPError,
    clients,
    state: {
      failStreamable: false,
      failStreamableCode: 503,
      onAfterConnect: null as null | (() => void)
    }
  }
})

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SseError: mcpSdkMock.SseError,
  SSEClientTransport: mcpSdkMock.SSEClientTransport
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mcpSdkMock.StreamableHTTPClientTransport,
  StreamableHTTPError: mcpSdkMock.StreamableHTTPError
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mcpSdkMock.Client
}))

const { McpRuntimeService, redactSensitive, McpCallToolPayloadSchema, McpGetResourcePayloadSchema } = await import(
  '../McpRuntimeService'
)

/** Build the JSON server key the service uses internally (only `id` is read by close logic). */
function serverKeyFor(id: string): string {
  return JSON.stringify({
    baseUrl: undefined,
    command: undefined,
    args: [],
    registryUrl: undefined,
    env: undefined,
    headers: undefined,
    id
  })
}

/** A deferred whose resolution mirrors the real connect: it lands the client in `this.clients`. */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('McpRuntimeService.setServerStatus', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
  })

  it('broadcasts on the first status write', () => {
    const service = new McpRuntimeService()

    service.setServerStatus('server-1', 'connected')

    expect(MockMainCacheServiceUtils.getMockCallCounts().setShared).toBe(1)
  })

  it('does not re-broadcast when the state is unchanged', () => {
    const service = new McpRuntimeService()

    service.setServerStatus('server-1', 'connected')
    service.setServerStatus('server-1', 'connected')
    service.setServerStatus('server-1', 'connected')

    expect(MockMainCacheServiceUtils.getMockCallCounts().setShared).toBe(1)
  })

  it('broadcasts again when the state changes', () => {
    const service = new McpRuntimeService()

    service.setServerStatus('server-1', 'connecting')
    service.setServerStatus('server-1', 'connected')

    expect(MockMainCacheServiceUtils.getMockCallCounts().setShared).toBe(2)
  })

  it('re-broadcasts only when the error message changes', () => {
    const service = new McpRuntimeService()

    service.setServerStatus('server-1', 'error', new Error('boom'))
    service.setServerStatus('server-1', 'error', new Error('boom')) // same message → no broadcast
    service.setServerStatus('server-1', 'error', new Error('different')) // changed → broadcast

    expect(MockMainCacheServiceUtils.getMockCallCounts().setShared).toBe(2)
  })
})

describe('McpRuntimeService.closeClientsForServer', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
  })

  it('closes a client that is already connected for the server', async () => {
    const service = new McpRuntimeService()
    const close = vi.fn().mockResolvedValue(undefined)
    const key = serverKeyFor('server-1')
    ;(service as any).clients.set(key, { close })

    await (service as any).closeClientsForServer('server-1')

    expect(close).toHaveBeenCalledTimes(1)
    expect((service as any).clients.size).toBe(0)
  })

  it('awaits an in-flight connect and closes the client it resolves into clients', async () => {
    const service = new McpRuntimeService()
    const close = vi.fn().mockResolvedValue(undefined)
    const key = serverKeyFor('server-1')
    const client = { close }

    // Mirror the real connect path: the pending promise, once awaited, lands the
    // client in `this.clients` so the subsequent close loop can find and close it.
    const deferred = createDeferred<{ close: typeof close }>()
    const pending = deferred.promise.then((c) => {
      ;(service as any).clients.set(key, c)
      return c
    })
    ;(service as any).pendingClients.set(key, pending)

    const closePromise = (service as any).closeClientsForServer('server-1')

    // The close must not have happened yet — it is still awaiting the in-flight connect.
    expect(close).not.toHaveBeenCalled()

    deferred.resolve(client)
    await closePromise

    expect(close).toHaveBeenCalledTimes(1)
    expect((service as any).clients.size).toBe(0)
  })

  it('does not throw when an in-flight connect rejects', async () => {
    const service = new McpRuntimeService()
    const key = serverKeyFor('server-1')
    const pending = Promise.reject(new Error('connect failed'))
    ;(service as any).pendingClients.set(key, pending)

    await expect((service as any).closeClientsForServer('server-1')).resolves.toBeUndefined()
    expect((service as any).clients.size).toBe(0)
  })

  it('only closes clients whose key matches the target server id', async () => {
    const service = new McpRuntimeService()
    const closeA = vi.fn().mockResolvedValue(undefined)
    const closeB = vi.fn().mockResolvedValue(undefined)
    ;(service as any).clients.set(serverKeyFor('server-1'), { close: closeA })
    ;(service as any).clients.set(serverKeyFor('server-2'), { close: closeB })

    await (service as any).closeClientsForServer('server-1')

    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
    expect((service as any).clients.has(serverKeyFor('server-2'))).toBe(true)
  })
})

describe('McpRuntimeService.closeAllForDevReset', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    mcpSdkMock.state.failStreamable = false
    mcpSdkMock.state.failStreamableCode = 503
    mcpSdkMock.state.onAfterConnect = null
    mcpSdkMock.clients.length = 0
  })

  it('closes all connected clients and rejects new transports while the latch is held', async () => {
    const service = new McpRuntimeService()
    const close = vi.fn().mockResolvedValue(undefined)
    const key = serverKeyFor('server-1')
    ;(service as any).clients.set(key, { close })

    await service.closeAllForDevReset()

    expect(close).toHaveBeenCalledOnce()
    expect((service as any).clients.size).toBe(0)
    await (service as any).onInit()
    await expect(
      (service as any).getOrCreateClient({ id: 'server-1', name: 'server', isActive: true } as McpServer)
    ).rejects.toThrow('closed for dev reset')
  })

  it('keeps the reset latch after a failed close so cached clients cannot be reused', async () => {
    const service = new McpRuntimeService()
    const close = vi.fn().mockRejectedValueOnce(new Error('close failed'))
    const key = serverKeyFor('server-1')
    ;(service as any).clients.set(key, { close })

    await expect(service.closeAllForDevReset()).rejects.toThrow('close failed')
    service.releaseDevResetLatch()
    await expect(
      (service as any).getOrCreateClient({ id: 'server-1', name: 'server', isActive: true } as McpServer)
    ).rejects.toThrow('closed for dev reset')
    expect((service as any).clients.has(key)).toBe(true)
  })

  it('awaits active tool-call settlement after aborting them', async () => {
    const service = new McpRuntimeService()
    let resolveTool!: () => void
    const toolPromise = new Promise<void>((resolve) => {
      resolveTool = resolve
    })
    ;(service as any).activeToolCallSettlements.add(toolPromise)
    ;(service as any).activeToolCalls.set('call-1', new AbortController())

    let closeResolved = false
    const closePromise = service.closeAllForDevReset().then(() => {
      closeResolved = true
    })

    await Promise.resolve()
    expect(closeResolved).toBe(false)

    resolveTool()
    await closePromise
    expect(closeResolved).toBe(true)
  })

  it('F1: times out a stuck tool-call settlement against the absolute deadline', async () => {
    const service = new McpRuntimeService()
    ;(service as any).devResetTimeoutMs = 30
    ;(service as any).activeToolCallSettlements.add(new Promise<void>(() => {}))

    await expect(service.closeAllForDevReset()).rejects.toThrow(/active-tool-settlement.*deadline/)
    expect((service as any).closeAllSucceeded).toBe(false)
    service.releaseDevResetLatch()
    await expect(
      (service as any).getOrCreateClient({ id: 'server-1', name: 'server', isActive: true } as McpServer)
    ).rejects.toThrow('closed for dev reset')
  })

  it('F1: times out a pending client acquire against the absolute deadline', async () => {
    const service = new McpRuntimeService()
    ;(service as any).devResetTimeoutMs = 30
    ;(service as any).pendingClients.set(serverKeyFor('server-1'), new Promise(() => {}))

    await expect(service.closeAllForDevReset()).rejects.toThrow(/pending-clients.*deadline/)
    expect((service as any).closeAllSucceeded).toBe(false)
    service.releaseDevResetLatch()
    expect((service as any).closedForDevReset).toBe(true)
  })

  it('F1: times out a hung client.close against the absolute deadline', async () => {
    const service = new McpRuntimeService()
    ;(service as any).devResetTimeoutMs = 30
    const key = serverKeyFor('server-1')
    ;(service as any).clients.set(key, {
      close: () => new Promise<void>(() => {})
    })

    await expect(service.closeAllForDevReset()).rejects.toThrow(/close-clients.*deadline/)
    expect((service as any).closeAllSucceeded).toBe(false)
    expect((service as any).clients.has(key)).toBe(true)
    service.releaseDevResetLatch()
    expect((service as any).closedForDevReset).toBe(true)
  })

  it('F1: ping-failed cached client with failing close stays tracked (no overwrite)', async () => {
    const service = new McpRuntimeService()
    const server = { id: 'server-1', name: 'server', isActive: true } as McpServer
    const key = serverKeyFor('server-1')
    // Cached client whose ping returns false AND whose close keeps failing. closeClient must
    // NOT delete the maps (close failed), and getOrCreateClient must propagate the failure
    // instead of swallowing + overwriting with a replacement (the round-4 regression).
    const cachedClient = {
      ping: vi.fn().mockResolvedValue(false),
      close: vi.fn().mockRejectedValue(new Error('close failed'))
    }
    ;(service as any).clients.set(key, cachedClient)

    await expect((service as any).getOrCreateClient(server)).rejects.toThrow(/close failed/)

    // Fail-closed: the orphaned entry stays tracked; no replacement overwrote it.
    expect((service as any).clients.get(key)).toBe(cachedClient)
  })

  it('F2: closes local client/transport when reset cancels after connect', async () => {
    const service = new McpRuntimeService()
    mcpSdkMock.state.failStreamable = false
    mcpSdkMock.state.onAfterConnect = () => {
      // Simulate closeAllForDevReset racing a successful connect: generation flips
      // before clients.set, so assertResetGeneration throws with local handles live.
      ;(service as any).closedForDevReset = true
      ;(service as any).resetGeneration += 1
    }

    const server = {
      id: 'oauth-race-server',
      name: 'oauth-race',
      type: 'streamableHttp',
      baseUrl: 'https://mcp.example.com/mcp',
      isActive: true
    } as unknown as McpServer

    await expect((service as any).getOrCreateClient(server)).rejects.toThrow(/closed for dev reset/)

    const client = mcpSdkMock.clients.at(-1)
    expect(client?.close).toHaveBeenCalled()
    expect((service as any).clients.size).toBe(0)
    expect((service as any).clientTransports.size).toBe(0)
    expect((service as any).pendingClients.size).toBe(0)
    // Empty maps alone must not claim success — latch stays until verified drain.
    ;(service as any).closeAllSucceeded = false
    service.releaseDevResetLatch()
    expect((service as any).closedForDevReset).toBe(true)
  })

  it('F2: closeAllForDevReset refuses success while clientTransports remain', async () => {
    const service = new McpRuntimeService()
    const key = serverKeyFor('server-1')
    ;(service as any).clientTransports.set(key, { close: vi.fn() })

    await expect(service.closeAllForDevReset()).rejects.toThrow(/transports=1/)
    expect((service as any).closeAllSucceeded).toBe(false)
  })

  it('F3: drains withClient operations before closing clients', async () => {
    const service = new McpRuntimeService()
    ;(service as any).devResetTimeoutMs = 200
    getByIdMock.mockReturnValue({ id: 'server-1', name: 'server', isActive: true } as McpServer)

    let resolveOp!: (value: string) => void
    const opGate = new Promise<string>((resolve) => {
      resolveOp = resolve
    })
    const key = serverKeyFor('server-1')
    ;(service as any).clients.set(key, { close: vi.fn().mockResolvedValue(undefined) })
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue({ close: vi.fn() })

    const withClientPromise = service.withClient('server-1', async () => opGate)
    // Lease is registered after getOrCreateClient resolves.
    await vi.waitFor(() => {
      expect((service as any).activeOperations.size).toBe(1)
    })

    let closeSettled = false
    const closePromise = service.closeAllForDevReset().then(() => {
      closeSettled = true
    })
    await Promise.resolve()
    expect(closeSettled).toBe(false)
    expect((service as any).activeOperations.size).toBe(1)

    resolveOp('done')
    await expect(withClientPromise).resolves.toBe('done')
    await closePromise
    expect(closeSettled).toBe(true)
    expect((service as any).activeOperations.size).toBe(0)
    expect((service as any).closeAllSucceeded).toBe(true)
  })
})

describe('McpRuntimeService.onStop', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
  })

  it('F3: uncooperative tool settlement does not hang onStop', async () => {
    const service = new McpRuntimeService()
    ;(service as any).shutdownTimeoutMs = 30
    ;(service as any).activeToolCallSettlements.add(new Promise<void>(() => {}))
    const close = vi.fn().mockResolvedValue(undefined)
    const key = serverKeyFor('server-1')
    ;(service as any).clients.set(key, { close })

    await expect((service as any).onStop()).resolves.toBeUndefined()

    expect(close).toHaveBeenCalledOnce()
    expect((service as any).clients.size).toBe(0)
  })

  it('F3: cooperative tool settlement still closes clients onStop', async () => {
    const service = new McpRuntimeService()
    ;(service as any).shutdownTimeoutMs = 200
    ;(service as any).activeToolCallSettlements.add(Promise.resolve())
    const close = vi.fn().mockResolvedValue(undefined)
    const key = serverKeyFor('server-1')
    ;(service as any).clients.set(key, { close })

    await expect((service as any).onStop()).resolves.toBeUndefined()

    expect(close).toHaveBeenCalledOnce()
    expect((service as any).clients.size).toBe(0)
  })

  it('F3: a hung client.close does not hang onStop (deadline-bounded closeAllClients)', async () => {
    const service = new McpRuntimeService()
    ;(service as any).shutdownTimeoutMs = 30
    const key = serverKeyFor('server-1')
    // client.close never settles — without the deadline, closeAllClients would hang onStop.
    ;(service as any).clients.set(key, { close: vi.fn().mockReturnValue(new Promise(() => {})) })

    await expect((service as any).onStop()).resolves.toBeUndefined()

    // Despite the hung close, onStop completed (deadline + warn) and cleared the maps.
    expect((service as any).clients.size).toBe(0)
    expect((service as any).clientTransports.size).toBe(0)
  })
})

describe('MCP IPC payload validation (mcp-services-5)', () => {
  it('rejects a malformed callTool payload (missing serverId/name)', () => {
    expect(McpCallToolPayloadSchema.safeParse({}).success).toBe(false)
    expect(McpCallToolPayloadSchema.safeParse({ serverId: 's1', name: '' }).success).toBe(false)
  })

  it('accepts a well-formed callTool payload (args passthrough)', () => {
    const parsed = McpCallToolPayloadSchema.safeParse({ serverId: 's1', name: 'tool', args: { q: 1 }, callId: 'c1' })
    expect(parsed.success).toBe(true)
  })

  it('rejects a getResource payload missing uri', () => {
    expect(McpGetResourcePayloadSchema.safeParse({ serverId: 's1' }).success).toBe(false)
    expect(McpGetResourcePayloadSchema.safeParse({ serverId: 's1', uri: 'res://x' }).success).toBe(true)
  })
})

describe('McpRuntimeService.getServerLogs (mcp-env)', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getByIdMock.mockReset()
  })

  // Regression: connect used to mutate `server.env` in place before emitServerLog recomputed
  // the server key, so connect-time logs landed under a post-mutation key that getServerLogs
  // (which reads a fresh, un-mutated server → pre-mutation key) never queried. emitServerLog
  // and getServerLogs must agree on the key for the same logical server.
  it('returns connect-time logs appended under the server key', async () => {
    const service = new McpRuntimeService()
    const server = { id: 'server-1', name: 'srv', env: { REGISTRY: 'x' } } as unknown as McpServer
    getByIdMock.mockReturnValue(server)

    const entry = { timestamp: 1, level: 'info' as const, message: 'Server connected', source: 'client' }
    ;(service as any).emitServerLog(server, entry)

    const logs = await service.getServerLogs('server-1')
    expect(logs).toContainEqual(entry)
  })

  // The env-shifting key was the root cause: a registry/DXT merge into env changes the key.
  // The service must NOT mutate server.env during a connect-style merge, so the key the buffer
  // was written under stays the one getServerLogs resolves.
  it('keeps the server key stable when registry env would be merged (no in-place mutation)', () => {
    const service = new McpRuntimeService()
    const server = { id: 'server-1', name: 'srv', command: 'npx', registryUrl: 'https://r' } as unknown as McpServer

    const keyBefore = service.getServerKey(server)
    // Simulate the merge the old code performed; the fix builds a local env instead, leaving server.env intact.
    const merged = { ...server.env, NPM_CONFIG_REGISTRY: server.registryUrl }
    expect(service.getServerKey(server)).toBe(keyBefore)
    // A mutation WOULD have changed the key — this documents why the bug surfaced.
    expect(service.getServerKey({ ...server, env: merged } as McpServer)).not.toBe(keyBefore)
  })
})

describe('redactSensitive (mcp-services-3)', () => {
  it('redacts sensitive keys', () => {
    const out = redactSensitive({ authorization: 'Bearer x', apiKey: 'k', keep: 'ok' })
    expect(out.authorization).toBe('<redacted>')
    expect(out.apiKey).toBe('<redacted>')
    expect(out.keep).toBe('ok')
  })

  it('does not stack-overflow on a circular enumerable graph', () => {
    const a: Record<string, unknown> = { name: 'a' }
    const b: Record<string, unknown> = { name: 'b', a }
    a.b = b // a -> b -> a cycle
    expect(() => redactSensitive(a)).not.toThrow()
    expect(redactSensitive(a)).toMatchObject({ name: 'a', b: { name: 'b', a: '[Circular]' } })
  })
})

describe('McpRuntimeService.restartServer (issue #16242)', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getByIdMock.mockReset()
    mcpCatalogMock.clearSharedToolsCache.mockReset()
    mcpCatalogMock.refreshTools.mockReset().mockResolvedValue(undefined)
    getByIdMock.mockReturnValue({ id: 'server-1', name: 'docs', isActive: true } as McpServer)
  })

  // listTools is cache-only, so a failed restart must clear the shared tools cache —
  // otherwise the old config's tools would stay visible to agents/chat forever.
  it('clears the shared tools cache and does not refresh when restart fails', async () => {
    const service = new McpRuntimeService()
    vi.spyOn(service as any, 'getOrCreateClient').mockRejectedValue(new Error('bad config'))

    await expect(service.restartServer('server-1')).rejects.toThrow('bad config')

    expect(mcpCatalogMock.clearSharedToolsCache).toHaveBeenCalledWith('server-1')
    expect(mcpCatalogMock.refreshTools).not.toHaveBeenCalled()
  })

  it('clears then repopulates the shared tools cache on a successful restart', async () => {
    const service = new McpRuntimeService()
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue({})

    await service.restartServer('server-1')

    expect(mcpCatalogMock.clearSharedToolsCache).toHaveBeenCalledWith('server-1')
    expect(mcpCatalogMock.refreshTools).toHaveBeenCalledWith('server-1')
  })
})

describe('McpRuntimeService transport fallback (issue #16891)', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    mcpSdkMock.state.failStreamable = false
    mcpSdkMock.state.failStreamableCode = 503
    mcpSdkMock.state.onAfterConnect = null
    mcpSdkMock.clients.length = 0
  })

  function urlServer(type: 'sse' | 'streamableHttp'): McpServer {
    return {
      id: 'sse-server',
      name: 'actuarymcp',
      type,
      baseUrl: 'https://mcp.actuary.meridianbridgegroup.com/mcp',
      isActive: true
    } as unknown as McpServer
  }

  type MockClient = InstanceType<typeof mcpSdkMock.Client>

  it('falls back to Streamable HTTP when an sse-typed server rejects the SSE GET with 405', async () => {
    const service = new McpRuntimeService()
    const client = (await (service as any).getOrCreateClient(urlServer('sse'))) as unknown as MockClient

    // SSE attempt (405) then Streamable HTTP attempt (success) — exactly two connect calls.
    expect(client.connectCalls.map((c) => c.kind)).toEqual(['sse', 'streamableHttp'])
  })

  it('connects on the first try for a correctly configured streamableHttp server (no fallback)', async () => {
    const service = new McpRuntimeService()
    const client = (await (service as any).getOrCreateClient(urlServer('streamableHttp'))) as unknown as MockClient

    expect(client.connectCalls.map((c) => c.kind)).toEqual(['streamableHttp'])
  })

  it('propagates the error when both transports fail', async () => {
    // Force the Streamable HTTP attempt to also fail (5xx) so the fallback exhausts both candidates.
    mcpSdkMock.state.failStreamable = true
    mcpSdkMock.state.failStreamableCode = 503

    const service = new McpRuntimeService()
    await expect((service as any).getOrCreateClient(urlServer('sse'))).rejects.toThrow()
  })

  it('does NOT fall back when a streamableHttp server returns 401 (auth must surface, not SSE)', async () => {
    // A 401 from the Streamable HTTP transport is an auth/permission error, not a transport
    // mismatch — it must not be masked by falling back to the SSE transport.
    mcpSdkMock.state.failStreamable = true
    mcpSdkMock.state.failStreamableCode = 401

    const service = new McpRuntimeService()
    await expect((service as any).getOrCreateClient(urlServer('streamableHttp'))).rejects.toThrow()

    // The only connect attempt is the configured streamableHttp one — no SSE fallback happened.
    expect(mcpSdkMock.clients.at(-1)?.connectCalls).toEqual([{ kind: 'streamableHttp' }])
  })
})
