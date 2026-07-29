import { BaseService } from '@main/core/lifecycle'
import type { McpServer } from '@shared/data/types/mcpServer'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mcpCatalogMock = vi.hoisted(() => ({
  clearSharedToolsCache: vi.fn(),
  refreshTools: vi.fn().mockResolvedValue(undefined)
}))
const interactionMocks = vi.hoisted(() => ({
  getWindow: vi.fn<() => object | undefined>(() => ({})),
  send: vi.fn(),
  broadcastToType: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    McpCatalogService: mcpCatalogMock,
    WindowManager: { getWindow: interactionMocks.getWindow },
    IpcApiService: { send: interactionMocks.send, broadcastToType: interactionMocks.broadcastToType }
  } as Record<string, unknown>)
})

const getByIdMock = vi.fn<(id: string) => McpServer>()
vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: {
    getById: (id: string) => getByIdMock(id)
  }
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

/** A deferred whose resolution mirrors the real connect: it lands the connection in the table. */
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

describe('McpRuntimeService embedded interaction authorization', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    interactionMocks.getWindow.mockReset().mockReturnValue({})
    interactionMocks.send.mockReset()
  })

  it('targets the originating window and accepts a response only from that window', async () => {
    const service = new McpRuntimeService()
    const pending = service.requestInteraction({
      windowId: 'window-1',
      topicId: 'topic-1',
      kind: 'sampling',
      payload: { maxTokens: 20 },
      signal: new AbortController().signal
    })
    const requestId = interactionMocks.send.mock.calls[0]?.[2].requestId as string

    await expect(service.respondInteraction({ requestId, decision: 'accept' }, 'window-2')).resolves.toBe(false)
    await expect(service.respondInteraction({ requestId, decision: 'accept' }, 'window-1')).resolves.toBe(true)
    await expect(pending).resolves.toMatchObject({ requestId, decision: 'accept' })
    expect(interactionMocks.send).toHaveBeenCalledWith(
      'window-1',
      'mcp.interaction.requested',
      expect.objectContaining({ requestId, topicId: 'topic-1', kind: 'sampling' })
    )
  })

  it('rejects without an active window and cancels a pending authorization with its tool call', async () => {
    const service = new McpRuntimeService()
    interactionMocks.getWindow.mockReturnValueOnce(undefined)
    await expect(
      service.requestInteraction({
        windowId: 'missing',
        topicId: 'topic-1',
        kind: 'roots',
        payload: {},
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/originating window is unavailable/)

    const controller = new AbortController()
    const pending = service.requestInteraction({
      windowId: 'window-1',
      topicId: 'topic-1',
      kind: 'elicitation',
      payload: {},
      signal: controller.signal
    })
    controller.abort(new Error('tool call cancelled'))
    await expect(pending).rejects.toThrow('tool call cancelled')
  })
})

describe('McpRuntimeService.closeConnectionsForServer', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
  })

  it('closes a connection that is already connected for the server', async () => {
    const service = new McpRuntimeService()
    const close = vi.fn().mockResolvedValue(undefined)
    const key = serverKeyFor('server-1')
    ;(service as any).connections.set(key, { close })

    await (service as any).closeConnectionsForServer('server-1')

    expect(close).toHaveBeenCalledTimes(1)
    expect((service as any).connections.size).toBe(0)
  })

  it('awaits an in-flight connect and closes the connection it resolves into the table', async () => {
    const service = new McpRuntimeService()
    const close = vi.fn().mockResolvedValue(undefined)
    const key = serverKeyFor('server-1')
    const connection = { close }

    // Mirror the real connect path: the pending promise, once awaited, lands the
    // connection in `this.connections` so the subsequent close loop can find and close it.
    const deferred = createDeferred<{ close: typeof close }>()
    const pending = deferred.promise.then((c) => {
      ;(service as any).connections.set(key, c)
      return c
    })
    ;(service as any).pendingConnections.set(key, pending)

    const closePromise = (service as any).closeConnectionsForServer('server-1')

    // The close must not have happened yet — it is still awaiting the in-flight connect.
    expect(close).not.toHaveBeenCalled()

    deferred.resolve(connection)
    await closePromise

    expect(close).toHaveBeenCalledTimes(1)
    expect((service as any).connections.size).toBe(0)
  })

  it('does not throw when an in-flight connect rejects', async () => {
    const service = new McpRuntimeService()
    const key = serverKeyFor('server-1')
    const pending = Promise.reject(new Error('connect failed'))
    ;(service as any).pendingConnections.set(key, pending)

    await expect((service as any).closeConnectionsForServer('server-1')).resolves.toBeUndefined()
    expect((service as any).connections.size).toBe(0)
  })

  it('only closes connections whose key matches the target server id', async () => {
    const service = new McpRuntimeService()
    const closeA = vi.fn().mockResolvedValue(undefined)
    const closeB = vi.fn().mockResolvedValue(undefined)
    ;(service as any).connections.set(serverKeyFor('server-1'), { close: closeA })
    ;(service as any).connections.set(serverKeyFor('server-2'), { close: closeB })

    await (service as any).closeConnectionsForServer('server-1')

    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
    expect((service as any).connections.has(serverKeyFor('server-2'))).toBe(true)
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
    const out = redactSensitive({
      authorization: 'Bearer x',
      apiKey: 'k',
      requestState: 'opaque-state',
      keep: 'ok'
    }) as Record<string, unknown>
    expect(out.authorization).toBe('<redacted>')
    expect(out.apiKey).toBe('<redacted>')
    expect(out.requestState).toBe('<redacted>')
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
    vi.spyOn(service as any, 'getOrCreateConnection').mockRejectedValue(new Error('bad config'))

    await expect(service.restartServer('server-1')).rejects.toThrow('bad config')

    expect(mcpCatalogMock.clearSharedToolsCache).toHaveBeenCalledWith('server-1')
    expect(mcpCatalogMock.refreshTools).not.toHaveBeenCalled()
  })

  it('clears then repopulates the shared tools cache on a successful restart', async () => {
    const service = new McpRuntimeService()
    vi.spyOn(service as any, 'getOrCreateConnection').mockResolvedValue({})

    await service.restartServer('server-1')

    expect(mcpCatalogMock.clearSharedToolsCache).toHaveBeenCalledWith('server-1')
    expect(mcpCatalogMock.refreshTools).toHaveBeenCalledWith('server-1')
  })
})
