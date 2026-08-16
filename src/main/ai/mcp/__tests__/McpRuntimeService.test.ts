import { BaseService } from '@main/core/lifecycle'
import type { McpServer } from '@shared/data/types/mcpServer'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
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

const shellEnvMock = vi.hoisted(() => ({
  getShellEnv: vi.fn().mockResolvedValue({ Path: 'C:\\Users\\me\\.cherrystudio\\bin;C:\\Windows' })
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: shellEnvMock.getShellEnv
}))

const commandResolverMock = vi.hoisted(() => ({
  findCommandInShellEnv: vi.fn().mockResolvedValue('C:\\Tools\\npx.exe'),
  findExecutableInEnv: vi.fn().mockResolvedValue('C:\\Tools\\npx.exe')
}))
vi.mock('@main/utils/commandResolver', () => ({
  findCommandInShellEnv: commandResolverMock.findCommandInShellEnv,
  findExecutableInEnv: commandResolverMock.findExecutableInEnv
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
    _transport: { kind: string } | undefined = undefined
    close = vi.fn().mockImplementation(async () => {
      this._transport = undefined
    })
    ping = vi.fn().mockResolvedValue(true)
    connectCalls: Array<{ kind: string }> = []
    constructor() {
      clients.push(this)
    }
    async connect(transport: { kind: string }) {
      // Mirror MCP SDK Protocol.connect: _transport is set before start() runs, and a failed
      // start() leaves it set. This is what makes the fallback retry fail unless client.close()
      // resets it — the test would not catch that regression otherwise.
      if (this._transport) {
        throw new Error('Already connected to a transport. Call close() before connecting to a new transport')
      }
      this._transport = transport
      this.connectCalls.push({ kind: transport.kind })
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
  const stdioTransports: Array<{ env?: Record<string, string> }> = []
  class StdioClientTransport {
    kind = 'stdio' as const
    stderr = null
    constructor(params: { env?: Record<string, string> }) {
      stdioTransports.push(params)
    }
  }
  return {
    SseError,
    SSEClientTransport,
    StreamableHTTPClientTransport,
    Client,
    StreamableHTTPError,
    StdioClientTransport,
    stdioTransports,
    clients,
    state: { failStreamable: false, failStreamableCode: 503 }
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
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mcpSdkMock.StdioClientTransport
}))

const { McpRuntimeService, redactSensitive, redactServerKey, McpCallToolPayloadSchema, McpGetResourcePayloadSchema } =
  await import('../McpRuntimeService')

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

describe('McpRuntimeService stdio environment', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    mcpSdkMock.stdioTransports.length = 0
    shellEnvMock.getShellEnv.mockResolvedValue({ Path: 'C:\\Users\\me\\.cherrystudio\\bin;C:\\Windows' })
  })

  it('canonicalizes a mixed-case Windows Path key to PATH before crossing the MCP SDK boundary', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const service = new McpRuntimeService()
    const server = {
      id: 'stdio-server',
      name: 'stdio-server',
      command: 'npx',
      args: ['-y', 'example-mcp'],
      isActive: true
    } as McpServer
    getByIdMock.mockReturnValue(server)

    await service.withClient(server.id, async () => undefined)

    const transportEnv = mcpSdkMock.stdioTransports.at(-1)?.env
    expect(Object.keys(transportEnv ?? {}).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH'])
    expect(transportEnv?.PATH).toBe('C:\\Users\\me\\.cherrystudio\\bin;C:\\Windows')
    platformSpy.mockRestore()
  })

  it('preserves distinct PATH key casing on POSIX', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    shellEnvMock.getShellEnv.mockResolvedValue({ PATH: '/shell/bin', Path: 'shell-metadata' })
    const service = new McpRuntimeService()
    const server = {
      id: 'stdio-server',
      name: 'stdio-server',
      command: 'npx',
      args: ['-y', 'example-mcp'],
      env: { Path: 'server-metadata' },
      isActive: true
    } as McpServer
    getByIdMock.mockReturnValue(server)

    await service.withClient(server.id, async () => undefined)

    const transportEnv = mcpSdkMock.stdioTransports.at(-1)?.env
    expect(transportEnv?.PATH).toBe('/shell/bin')
    expect(transportEnv?.Path).toBe('server-metadata')
    platformSpy.mockRestore()
  })
})

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

describe('McpRuntimeService stale client cleanup (issue #18144)', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getByIdMock.mockReset()
  })

  const server = {
    id: 'server-1',
    name: 'srv',
    command: 'python',
    args: ['server.py'],
    isActive: true
  } as McpServer

  it.each([
    ['ping resolves falsy', vi.fn().mockResolvedValue(false)],
    ['ping throws', vi.fn().mockRejectedValue(new Error('timeout'))]
  ])('closes the dead client instead of orphaning its process when %s', async (_label, ping) => {
    const service = new McpRuntimeService()
    const close = vi.fn().mockResolvedValue(undefined)
    ;(service as any).clients.set(service.getServerKey(server), { close, ping })

    await (service as any).getOrCreateClient(server)

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('still reconnects when closing the dead client throws', async () => {
    const service = new McpRuntimeService()
    const close = vi.fn().mockRejectedValue(new Error('transport already gone'))
    const ping = vi.fn().mockResolvedValue(false)
    const key = service.getServerKey(server)
    ;(service as any).clients.set(key, { close, ping })

    await expect((service as any).getOrCreateClient(server)).resolves.toBeDefined()
    expect((service as any).clients.get(key)?.ping).not.toBe(ping)
  })
})

describe('McpRuntimeService.callTool cancellation', () => {
  const server = { id: 'server-1', name: 'srv', isActive: true } as McpServer

  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getByIdMock.mockReset()
    getByIdMock.mockReturnValue(server)
    mockMainLoggerService.debug.mockClear()
    mockMainLoggerService.error.mockClear()
  })

  function createAbortableCallTool(abortError: Error) {
    return vi.fn((_request: unknown, _resultSchema: unknown, options: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('MCP call did not abort')), 50)
        options.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout)
            reject(abortError)
          },
          { once: true }
        )
      })
    })
  }

  it('aborts the client call and clears the active call when the external signal aborts', async () => {
    const service = new McpRuntimeService()
    const abortError = new Error('MCP call aborted')
    const clientCallTool = createAbortableCallTool(abortError)
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue({ callTool: clientCallTool })
    const controller = new AbortController()

    const call = service.callTool({
      serverId: server.id,
      name: 'tool',
      args: {},
      callId: 'external-call',
      signal: controller.signal
    })

    await vi.waitFor(() => expect(clientCallTool).toHaveBeenCalledOnce(), { interval: 1 })
    expect((service as any).activeToolCalls.has('external-call')).toBe(true)
    const clientSignal = clientCallTool.mock.calls[0][2].signal

    controller.abort()

    await expect(call).rejects.toBe(abortError)
    expect(clientSignal.aborted).toBe(true)
    expect((service as any).activeToolCalls.has('external-call')).toBe(false)
  })

  it('keeps abortTool cancellation working by call id', async () => {
    const service = new McpRuntimeService()
    const abortError = new Error('MCP call aborted')
    const clientCallTool = createAbortableCallTool(abortError)
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue({ callTool: clientCallTool })

    const call = service.callTool({ serverId: server.id, name: 'tool', args: {}, callId: 'internal-call' })

    await vi.waitFor(() => expect(clientCallTool).toHaveBeenCalledOnce(), { interval: 1 })
    expect((service as any).activeToolCalls.has('internal-call')).toBe(true)
    const clientSignal = clientCallTool.mock.calls[0][2].signal

    await expect(service.abortTool('internal-call')).resolves.toBe(true)

    await expect(call).rejects.toBe(abortError)
    expect(clientSignal.aborted).toBe(true)
    expect((service as any).activeToolCalls.has('internal-call')).toBe(false)
  })

  it('rejects promptly and clears the active call when aborted while waiting for the client', async () => {
    const service = new McpRuntimeService()
    // Client init that never settles — the cold-start / hung-connection window.
    vi.spyOn(service as any, 'getOrCreateClient').mockReturnValue(new Promise(() => {}))
    const controller = new AbortController()
    const reason = new Error('stopped during connect')

    const call = service.callTool({
      serverId: server.id,
      name: 'tool',
      args: {},
      callId: 'connecting-call',
      signal: controller.signal
    })
    expect((service as any).activeToolCalls.has('connecting-call')).toBe(true)

    controller.abort(reason)

    await expect(call).rejects.toBe(reason)
    expect((service as any).activeToolCalls.has('connecting-call')).toBe(false)
  })

  it('does not start client init and clears the active call when the signal is already aborted', async () => {
    const service = new McpRuntimeService()
    const getOrCreateClientSpy = vi.spyOn(service as any, 'getOrCreateClient')
    const reason = new Error('aborted before start')
    const controller = new AbortController()
    controller.abort(reason)

    await expect(
      service.callTool({
        serverId: server.id,
        name: 'tool',
        args: {},
        callId: 'pre-aborted-call',
        signal: controller.signal
      })
    ).rejects.toBe(reason)

    expect(getOrCreateClientSpy).not.toHaveBeenCalled()
    expect((service as any).activeToolCalls.has('pre-aborted-call')).toBe(false)
  })

  // Call ids are caller-supplied and not process-wide unique: a duplicate must neither be
  // deregistered by the other call's cleanup nor able to abort only one of the two.
  it('keeps a duplicate call id abortable after the first call with that id settles', async () => {
    const service = new McpRuntimeService()
    const abortError = new Error('MCP call aborted')
    const first = createDeferred<unknown>()
    const clientCallTool = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(
        (_request: unknown, _resultSchema: unknown, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(abortError), { once: true })
          })
      )
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue({ callTool: clientCallTool })

    const firstCall = service.callTool({ serverId: server.id, name: 'tool', args: {}, callId: 'dup-call' })
    await vi.waitFor(() => expect(clientCallTool).toHaveBeenCalledTimes(1), { interval: 1 })
    const secondCall = service.callTool({ serverId: server.id, name: 'tool', args: {}, callId: 'dup-call' })
    await vi.waitFor(() => expect(clientCallTool).toHaveBeenCalledTimes(2), { interval: 1 })

    first.resolve({ content: [] })
    await expect(firstCall).resolves.toEqual({ content: [] })
    // The settled call's cleanup must not deregister the still-running duplicate.
    expect((service as any).activeToolCalls.has('dup-call')).toBe(true)

    await expect(service.abortTool('dup-call')).resolves.toBe(true)
    await expect(secondCall).rejects.toBe(abortError)
    expect((service as any).activeToolCalls.has('dup-call')).toBe(false)
  })

  it('aborts every in-flight call registered under a duplicated call id', async () => {
    const service = new McpRuntimeService()
    const abortError = new Error('MCP call aborted')
    const clientCallTool = createAbortableCallTool(abortError)
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue({ callTool: clientCallTool })

    const firstCall = service.callTool({ serverId: server.id, name: 'tool', args: {}, callId: 'dup-call' })
    const secondCall = service.callTool({ serverId: server.id, name: 'tool', args: {}, callId: 'dup-call' })
    await vi.waitFor(() => expect(clientCallTool).toHaveBeenCalledTimes(2), { interval: 1 })

    await expect(service.abortTool('dup-call')).resolves.toBe(true)

    await expect(firstCall).rejects.toBe(abortError)
    await expect(secondCall).rejects.toBe(abortError)
    expect((service as any).activeToolCalls.has('dup-call')).toBe(false)
  })

  // The abort-wait racer must not leave its listener behind when client init wins: the
  // composed signal is retained by the long-lived stream signal, so a lingering closure
  // would accumulate once per tool call for the stream's whole lifetime.
  it('removes every abort listener it added once the call settles without aborting', async () => {
    const service = new McpRuntimeService()
    const clientCallTool = vi.fn().mockResolvedValue({ content: [] })
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue({ callTool: clientCallTool })
    const controller = new AbortController()

    const added: Array<{ target: AbortSignal; listener: unknown }> = []
    const removed: Array<{ target: AbortSignal; listener: unknown }> = []
    const originalAdd = AbortSignal.prototype.addEventListener
    const originalRemove = AbortSignal.prototype.removeEventListener
    const addSpy = vi.spyOn(AbortSignal.prototype, 'addEventListener').mockImplementation(function (
      this: AbortSignal,
      ...args: Parameters<typeof originalAdd>
    ) {
      if (args[0] === 'abort') added.push({ target: this, listener: args[1] })
      return originalAdd.apply(this, args)
    })
    const removeSpy = vi.spyOn(AbortSignal.prototype, 'removeEventListener').mockImplementation(function (
      this: AbortSignal,
      ...args: Parameters<typeof originalRemove>
    ) {
      if (args[0] === 'abort') removed.push({ target: this, listener: args[1] })
      return originalRemove.apply(this, args)
    })

    try {
      await service.callTool({
        serverId: server.id,
        name: 'tool',
        args: {},
        callId: 'settled-call',
        signal: controller.signal
      })
    } finally {
      addSpy.mockRestore()
      removeSpy.mockRestore()
    }

    expect(added.length).toBeGreaterThan(0)
    for (const { target, listener } of added) {
      expect(removed.some((entry) => entry.target === target && entry.listener === listener)).toBe(true)
    }
  })

  // Provider call ids can collide across topics; an abort scoped to one topic must never
  // cancel the identically-named in-flight call registered under another topic's scope.
  it('scopes abortTool so a colliding call id in another scope is untouched', async () => {
    const service = new McpRuntimeService()
    const abortError = new Error('MCP call aborted')
    const clientCallTool = vi.fn(
      (_request: unknown, _resultSchema: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(abortError), { once: true })
        })
    )
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue({ callTool: clientCallTool })

    const callA = service.callTool({ serverId: server.id, name: 'tool', args: {}, callId: 'call_0', scope: 'topic-a' })
    const callB = service.callTool({ serverId: server.id, name: 'tool', args: {}, callId: 'call_0', scope: 'topic-b' })
    await vi.waitFor(() => expect(clientCallTool).toHaveBeenCalledTimes(2), { interval: 1 })

    // An unscoped abort must not reach into scoped registrations either.
    await expect(service.abortTool('call_0')).resolves.toBe(false)

    await expect(service.abortTool('call_0', 'topic-a')).resolves.toBe(true)
    await expect(callA).rejects.toBe(abortError)

    // The other topic's identically-named call is still running and still abortable.
    expect(clientCallTool.mock.calls[1][2].signal.aborted).toBe(false)
    await expect(service.abortTool('call_0', 'topic-b')).resolves.toBe(true)
    await expect(callB).rejects.toBe(abortError)
  })

  // A genuine transport/server failure whose catch continuation runs after the external
  // abort landed must NOT be downgraded to the debug "Tool call aborted" path.
  it('keeps error-level logging for a genuine failure that races cancellation', async () => {
    const service = new McpRuntimeService()
    const transportError = new Error('connection reset')
    const controller = new AbortController()
    const clientCallTool = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          // Real failure settles the call first; the abort lands before the catch runs.
          reject(transportError)
          controller.abort(new Error('user stopped'))
        })
    )
    vi.spyOn(service as any, 'getOrCreateClient').mockResolvedValue({ callTool: clientCallTool })

    const call = service.callTool({
      serverId: server.id,
      name: 'tool',
      args: {},
      callId: 'racing-call',
      signal: controller.signal
    })

    await expect(call).rejects.toBe(transportError)
    expect(mockMainLoggerService.error).toHaveBeenCalledWith('Error calling tool', transportError)
    expect(mockMainLoggerService.debug).not.toHaveBeenCalledWith('Tool call aborted')
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

  it('redacts sensitive substrings in key names, case-insensitively', () => {
    const out = redactSensitive({
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'github_pat_x', MEMORY_FILE_PATH: '/tmp/mem' },
      headers: { 'X-Api-Key': 'k', Accept: 'application/json' }
    })
    expect(out.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('<redacted>')
    expect(out.env.MEMORY_FILE_PATH).toBe('/tmp/mem')
    expect(out.headers['X-Api-Key']).toBe('<redacted>')
    expect(out.headers.Accept).toBe('application/json')
  })
})

describe('redactServerKey (issue #18648)', () => {
  it('redacts env and headers values from a serialized server key', () => {
    const key = JSON.stringify({
      baseUrl: '',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'github_pat_secret' },
      headers: { Authorization: 'Bearer secret' }
    })
    const out = redactServerKey(key)
    expect(out).not.toContain('github_pat_secret')
    expect(out).not.toContain('Bearer secret')
    expect(out).toContain('<redacted>')
    // non-sensitive fields stay visible for debugging
    expect(out).toContain('@modelcontextprotocol/server-github')
    expect(JSON.parse(out).env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('<redacted>')
  })

  it('fails closed: redacts credential-bearing values whose names match no sensitive pattern', () => {
    // Review regression: DATABASE_URL carries credentials in the VALUE — key-name
    // heuristics must not decide secrecy at this boundary.
    const key = JSON.stringify({
      command: 'npx',
      env: { DATABASE_URL: 'postgresql://user:password@host/db', DEBUG: '1' },
      headers: { 'X-Custom-Trace': 'secret-trace-value' }
    })
    const out = redactServerKey(key)
    expect(out).not.toContain('password')
    expect(out).not.toContain('secret-trace-value')
    const parsed = JSON.parse(out)
    expect(parsed.env.DATABASE_URL).toBe('<redacted>')
    expect(parsed.env.DEBUG).toBe('<redacted>')
    expect(parsed.headers['X-Custom-Trace']).toBe('<redacted>')
  })

  it('returns a placeholder for an unparseable server key', () => {
    expect(redactServerKey('not-json')).toBe('<unparseable-serverKey>')
  })

  it('leaves a key without env or headers untouched', () => {
    const key = JSON.stringify({ baseUrl: 'https://example.com', id: 'a1' })
    expect(redactServerKey(key)).toBe(key)
  })
})

describe('McpRuntimeService logging notification redaction', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getByIdMock.mockReset()
  })

  // Regression: `message` was serialized from the RAW notification data while `data` was
  // redacted, so the secret still reached the debug log, the serverLogs buffer, and the
  // mcp.server.log broadcast the renderer displays.
  it('redacts secrets in both message and data of the emitted log entry', async () => {
    const service = new McpRuntimeService()
    const server = { id: 'server-1', name: 'srv' } as unknown as McpServer
    getByIdMock.mockReturnValue(server)

    const loggingSchema = { sentinel: 'logging' }
    const sdkStub = {
      ToolListChangedNotificationSchema: {},
      ResourceListChangedNotificationSchema: {},
      PromptListChangedNotificationSchema: {},
      ResourceUpdatedNotificationSchema: {},
      CancelledNotificationSchema: {},
      LoggingMessageNotificationSchema: loggingSchema
    }
    const client = { setNotificationHandler: vi.fn() }
    ;(service as any).setupNotificationHandlers(client, server, sdkStub)

    const handler = client.setNotificationHandler.mock.calls.find(([schema]) => schema === loggingSchema)?.[1]
    expect(handler).toBeDefined()
    await handler({
      method: 'notifications/message',
      params: {
        level: 'info',
        logger: 'server',
        data: { GITHUB_PERSONAL_ACCESS_TOKEN: 'github_pat_secret', note: 'visible' }
      }
    })

    const logs = await service.getServerLogs('server-1')
    expect(logs).toHaveLength(1)
    const [entry] = logs
    expect(entry.message).not.toContain('github_pat_secret')
    expect(entry.message).toContain('<redacted>')
    expect(entry.message).toContain('visible')
    expect(entry.data).toMatchObject({ GITHUB_PERSONAL_ACCESS_TOKEN: '<redacted>', note: 'visible' })
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
