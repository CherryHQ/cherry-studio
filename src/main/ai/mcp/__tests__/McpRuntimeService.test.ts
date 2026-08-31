import crypto from 'node:crypto'

import { BaseService } from '@main/core/lifecycle'
import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
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
const deleteServerMock = vi.fn<(id: string) => void>()
const listServersMock = vi.fn<(query: { id?: string }) => { items: McpServer[]; total: number; page: number }>()
vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: {
    getById: (id: string) => getByIdMock(id),
    delete: (id: string) => deleteServerMock(id),
    list: (query: { id?: string }) => listServersMock(query)
  }
}))

const shellEnvMock = vi.hoisted(() => ({
  getShellEnv: vi.fn().mockResolvedValue({ Path: 'C:\\Users\\me\\.cherrystudio\\bin;C:\\Windows' }),
  getRawShellEnv: vi.fn().mockResolvedValue({ Path: 'C:\\Users\\me\\.cherrystudio\\bin;C:\\Windows' })
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: shellEnvMock.getShellEnv,
  getRawShellEnv: shellEnvMock.getRawShellEnv
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
    finishAuth = vi.fn().mockResolvedValue(undefined)
    constructor(url: unknown, opts?: unknown) {
      streamableHttpTransports.push({ url, opts })
    }
  }
  const clients: Array<{
    connectCalls: Array<{ kind: string }>
    close: ReturnType<typeof vi.fn>
    listPrompts: ReturnType<typeof vi.fn>
    listResources: ReturnType<typeof vi.fn>
  }> = []
  class Client {
    setNotificationHandler = vi.fn()
    _transport: { kind: string } | undefined = undefined
    close = vi.fn().mockImplementation(async () => {
      this._transport = undefined
    })
    ping = vi.fn().mockResolvedValue(true)
    getServerCapabilities = vi.fn(() => mcpSdkMock.state.capabilities)
    listPrompts = vi.fn().mockResolvedValue({ prompts: [{ name: 'a-prompt' }] })
    listResources = vi.fn().mockResolvedValue({ resources: [{ uri: 'file:///a', name: 'a' }] })
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
        if (mcpSdkMock.state.failStreamableUnauthorized) {
          const error = new Error('Unauthorized')
          error.name = 'UnauthorizedError'
          throw error
        }
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
  const streamableHttpTransports: Array<{ url: unknown; opts?: any }> = []
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
    streamableHttpTransports,
    clients,
    state: {
      failStreamable: false,
      failStreamableUnauthorized: false,
      failStreamableCode: 503,
      capabilities: undefined as Record<string, unknown> | undefined
    }
  }
})

const callbackServerMock = vi.hoisted(() => ({ waitForAuthCode: vi.fn().mockResolvedValue('auth-code') }))
vi.mock('../oauth/callback', () => ({
  CallBackServer: class {
    waitForAuthCode = callbackServerMock.waitForAuthCode
    close = vi.fn().mockResolvedValue(undefined)
  }
}))

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

const { McpRuntimeService, McpCallToolPayloadSchema, McpGetResourcePayloadSchema } = await import(
  '../McpRuntimeService'
)

/** Build the JSON server key shape the service uses internally (only `id` is read by close logic). */
function serverKeyFor(id: string): string {
  const fingerprint = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        baseUrl: undefined,
        command: undefined,
        args: [],
        registryUrl: undefined,
        env: undefined,
        headers: undefined
      })
    )
    .digest('hex')

  return JSON.stringify({
    id,
    fingerprint
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

describe('McpRuntimeService QVeris hosted transport', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getByIdMock.mockReset()
    mcpSdkMock.streamableHttpTransports.length = 0
  })

  it('connects to the hosted endpoint with the configured API key', async () => {
    const service = new McpRuntimeService()
    // The row shape BuiltinMcpServerSeeder migrates every installed QVeris server to.
    const server = {
      id: 'qveris-server',
      name: BuiltinMcpServerNames.qveris,
      type: 'streamableHttp',
      baseUrl: 'https://mcp.qveris.ai/mcp',
      installSource: 'builtin',
      env: { QVERIS_API_KEY: 'qveris-test-key' },
      isActive: true
    } as McpServer
    getByIdMock.mockReturnValue(server)

    await service.withClient(server.id, async () => undefined)

    const transport = mcpSdkMock.streamableHttpTransports.at(-1)
    expect(String(transport?.url)).toBe('https://mcp.qveris.ai/mcp')
    expect(transport?.opts).toEqual(
      expect.objectContaining({
        requestInit: expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer qveris-test-key' })
        })
      })
    )
    expect(transport?.opts).not.toHaveProperty('authProvider')
  })

  it('rejects activation without an API key', async () => {
    const service = new McpRuntimeService()
    const server = {
      id: 'qveris-server',
      name: BuiltinMcpServerNames.qveris,
      type: 'streamableHttp',
      baseUrl: 'https://mcp.qveris.ai/mcp',
      installSource: 'builtin',
      env: { QVERIS_API_KEY: '' },
      isActive: true
    } as McpServer
    getByIdMock.mockReturnValue(server)

    await expect(service.withClient(server.id, async () => undefined)).rejects.toThrow(
      'QVeris MCP requires the QVERIS_API_KEY environment variable'
    )
  })

  it('uses a distinct secret-free key when the API key changes', () => {
    const service = new McpRuntimeService()
    const first = service.getServerKey({
      id: 'qveris-server',
      name: BuiltinMcpServerNames.qveris,
      env: { QVERIS_API_KEY: 'first-key' },
      isActive: true
    } as McpServer)
    const second = service.getServerKey({
      id: 'qveris-server',
      name: BuiltinMcpServerNames.qveris,
      env: { QVERIS_API_KEY: 'second-key' },
      isActive: true
    } as McpServer)

    expect(first).not.toContain('first-key')
    expect(second).not.toContain('second-key')
    expect(first).not.toBe(second)
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

describe('McpRuntimeService connect single-flight', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    mcpSdkMock.clients.length = 0
    getByIdMock.mockReset()
  })

  it('never hands back a cached client another probe closed underneath it', async () => {
    const service = new McpRuntimeService()
    const server = {
      id: 'http-server',
      name: 'http-server',
      type: 'streamableHttp',
      baseUrl: 'https://mcp.example/mcp',
      isActive: true
    } as McpServer
    getByIdMock.mockReturnValue(server)

    // Probe A's ping fails and evicts the client; probe B's ping wins the race and would
    // otherwise return the connection A already closed.
    const close = vi.fn().mockResolvedValue(undefined)
    const stale = { close, ping: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true) }
    ;(service as any).clients.set(service.getServerKey(server), stale)

    const [first, second] = await Promise.all([
      service.withClient(server.id, async (client) => client),
      service.withClient(server.id, async (client) => client)
    ])

    expect(close).toHaveBeenCalled()
    expect(first).not.toBe(stale)
    expect(second).not.toBe(stale)
  })

  it('never hands back a cached client a concurrent restart closed', async () => {
    const service = new McpRuntimeService()
    const server = {
      id: 'http-server',
      name: 'http-server',
      type: 'streamableHttp',
      baseUrl: 'https://mcp.example/mcp',
      isActive: true
    } as McpServer
    getByIdMock.mockReturnValue(server)

    // The probe is deliberately not a pending client, so a restart runs straight through it.
    const pingGate = createDeferred<boolean>()
    const close = vi.fn().mockResolvedValue(undefined)
    const stale = { close, ping: vi.fn(() => pingGate.promise) }
    ;(service as any).clients.set(service.getServerKey(server), stale)

    const probing = service.withClient(server.id, async (client) => client)
    await service.restartServer(server.id)
    pingGate.resolve(true)

    expect(await probing).not.toBe(stale)
    expect(close).toHaveBeenCalled()
  })

  it('does not close the client a concurrent restart installed while its predecessor was probed', async () => {
    const service = new McpRuntimeService()
    const server = {
      id: 'http-server',
      name: 'http-server',
      type: 'streamableHttp',
      baseUrl: 'https://mcp.example/mcp',
      isActive: true
    } as McpServer
    getByIdMock.mockReturnValue(server)

    const serverKey = service.getServerKey(server)
    const pingGate = createDeferred<boolean>()
    const stale = { close: vi.fn().mockResolvedValue(undefined), ping: vi.fn(() => pingGate.promise) }
    const replacement = { close: vi.fn().mockResolvedValue(undefined), ping: vi.fn().mockResolvedValue(true) }
    ;(service as any).clients.set(serverKey, stale)

    const probing = service.withClient(server.id, async (client) => client)
    // A restart swaps the cache entry, then the probed client finally answers "dead".
    ;(service as any).clients.set(serverKey, replacement)
    pingGate.resolve(false)
    await probing

    expect(replacement.close).not.toHaveBeenCalled()
  })

  // Two callers in the same turn must share one connect: registering the pending promise after
  // an await let both miss it, open two clients, and leak the one whose entry was overwritten.
  it('opens a single client for concurrent first-time callers', async () => {
    const service = new McpRuntimeService()
    const server = {
      id: 'http-server',
      name: 'http-server',
      type: 'streamableHttp',
      baseUrl: 'https://mcp.example/mcp',
      isActive: true
    } as McpServer
    getByIdMock.mockReturnValue(server)

    const [first, second] = await Promise.all([
      service.withClient(server.id, async (client) => client),
      service.withClient(server.id, async (client) => client)
    ])

    expect(first).toBe(second)
    expect(mcpSdkMock.clients).toHaveLength(1)
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
    mcpSdkMock.state.failStreamableUnauthorized = false
    mcpSdkMock.state.failStreamableCode = 503
    callbackServerMock.waitForAuthCode.mockReset().mockResolvedValue('auth-code')
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

  it('reconnects after OAuth on a client the failed attempt left a transport on', async () => {
    // The SDK refuses connect() while a transport is installed, and the 401 leaves its own
    // there — without a close in between, every re-auth would die as "Already connected".
    mcpSdkMock.state.failStreamable = true
    mcpSdkMock.state.failStreamableUnauthorized = true
    callbackServerMock.waitForAuthCode.mockImplementation(async () => {
      mcpSdkMock.state.failStreamable = false
      mcpSdkMock.state.failStreamableUnauthorized = false
      return 'auth-code'
    })

    const service = new McpRuntimeService()
    const client = (await (service as any).getOrCreateClient(urlServer('streamableHttp'))) as unknown as MockClient

    expect(client.connectCalls.map((c) => c.kind)).toEqual(['streamableHttp', 'streamableHttp'])
  })

  it('surfaces static Authorization failures without starting OAuth', async () => {
    mcpSdkMock.state.failStreamable = true
    mcpSdkMock.state.failStreamableUnauthorized = true
    const service = new McpRuntimeService()
    const finishOAuth = vi.spyOn(service as any, 'finishOAuth').mockRejectedValue(new Error('OAuth must not start'))
    const server = {
      ...urlServer('streamableHttp'),
      headers: { Authorization: 'Bearer expired' }
    }

    await expect((service as any).getOrCreateClient(server)).rejects.toMatchObject({ name: 'UnauthorizedError' })
    expect(finishOAuth).not.toHaveBeenCalled()
    expect(mcpSdkMock.clients.at(-1)?.connectCalls).toEqual([{ kind: 'streamableHttp' }])
  })
})

// Delete-vs-reconnect race: removeServer (close + row delete) scans pendingClients/clients
// once, so a late or in-flight connect would re-cache a ghost stdio client unless tombstoned.
describe('McpRuntimeService.removeServer vs concurrent connect', () => {
  const server = {
    id: 'server-1',
    name: 'race-server',
    command: 'python',
    args: ['server.py'],
    isActive: true
  } as McpServer

  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getByIdMock.mockReset()
    getByIdMock.mockReturnValue(server)
    deleteServerMock.mockReset()
    listServersMock.mockReset()
    listServersMock.mockReturnValue({ items: [server], total: 1, page: 1 })
    mcpCatalogMock.clearSharedToolsCache.mockReset()
    mcpSdkMock.state.failStreamable = false
  })

  it('rejects a connect attempt made after removeServer instead of resurrecting the server', async () => {
    const service = new McpRuntimeService()
    await service.removeServer('server-1')
    expect(deleteServerMock).toHaveBeenCalledWith('server-1')

    const clientCountBefore = mcpSdkMock.clients.length
    await expect(service.withClient('server-1', async () => 'used')).rejects.toThrow(/removed/)
    expect(mcpSdkMock.clients.length).toBe(clientCountBefore)
  })

  it('self-closes a connect that is in flight when removeServer runs and rejects its caller', async () => {
    const service = new McpRuntimeService()
    const gate = createDeferred<void>()
    const connectSpy = vi.spyOn(mcpSdkMock.Client.prototype, 'connect').mockImplementation(() => gate.promise)
    try {
      const racer = service.withClient('server-1', async () => 'used')
      racer.catch(() => undefined)
      await vi.waitFor(() => expect(connectSpy).toHaveBeenCalledTimes(1))

      const removal = service.removeServer('server-1')
      gate.resolve()
      await removal

      await expect(racer).rejects.toThrow(/removed/)
      expect(mcpSdkMock.clients.at(-1)?.close).toHaveBeenCalled()
    } finally {
      connectSpy.mockRestore()
    }
  })

  it('does not start a fresh connection when removeServer completes during a liveness ping', async () => {
    const service = new McpRuntimeService()
    const pingGate = createDeferred<boolean>()
    const close = vi.fn().mockResolvedValue(undefined)
    ;(service as any).clients.set(service.getServerKey(server), { close, ping: vi.fn(() => pingGate.promise) })

    const racer = (service as any).getOrCreateClient(server) as Promise<unknown>
    racer.catch(() => undefined)

    await service.removeServer('server-1')

    const clientCountBefore = mcpSdkMock.clients.length
    pingGate.resolve(false)

    await expect(racer).rejects.toThrow(/removed/)
    expect(mcpSdkMock.clients.length).toBe(clientCountBefore)
  })

  it('revokes the tombstone when removal fails so the server stays connectable', async () => {
    const service = new McpRuntimeService()
    ;(service as any).clients.set(service.getServerKey(server), {
      close: vi.fn().mockRejectedValue(new Error('close failed')),
      ping: vi.fn().mockResolvedValue(true)
    })

    await expect(service.removeServer('server-1')).rejects.toThrow('close failed')
    expect(deleteServerMock).not.toHaveBeenCalled()
    // A rolled-back removal keeps its row, so the status entry survives as a reset.
    expect(MockMainCacheServiceUtils.getSharedCacheValue('mcp.status.server-1')).toEqual(
      expect.objectContaining({ state: 'disabled' })
    )

    await expect(service.withClient('server-1', async () => 'ok')).resolves.toBe('ok')
  })

  it('collapses concurrent removals of the same server into one flow', async () => {
    const service = new McpRuntimeService()
    const closeGate = createDeferred<void>()
    ;(service as any).clients.set(service.getServerKey(server), {
      close: vi.fn(() => closeGate.promise),
      ping: vi.fn().mockResolvedValue(true)
    })
    // Without single-flight the loser's row delete throws NOT_FOUND and its
    // rollback would wrongly revoke the winner's tombstone.
    deleteServerMock
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw new Error('MCP server not found')
      })

    const first = service.removeServer('server-1')
    const second = service.removeServer('server-1')
    closeGate.resolve()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()

    expect(deleteServerMock).toHaveBeenCalledTimes(1)
    const racer = (service as any).getOrCreateClient(server) as Promise<unknown>
    await expect(racer).rejects.toThrow(/removed/)
  })

  it('keeps the tombstone when removal fails but the row is confirmed gone', async () => {
    const service = new McpRuntimeService()
    deleteServerMock.mockImplementation(() => {
      throw new Error('MCP server not found')
    })
    listServersMock.mockReturnValue({ items: [], total: 0, page: 1 })

    await expect(service.removeServer('server-1')).rejects.toThrow('not found')

    const racer = (service as any).getOrCreateClient(server) as Promise<unknown>
    await expect(racer).rejects.toThrow(/removed/)
  })

  it('revokes the tombstone when the row-existence check itself fails', async () => {
    const service = new McpRuntimeService()
    getByIdMock.mockReturnValueOnce(server).mockImplementation(() => {
      throw new Error('db locked')
    })
    deleteServerMock.mockImplementation(() => {
      throw new Error('db locked')
    })
    listServersMock.mockImplementation(() => {
      throw new Error('db locked')
    })

    await expect(service.removeServer('server-1')).rejects.toThrow('db locked')

    await expect((service as any).getOrCreateClient(server)).resolves.toBeDefined()
  })

  it('drops the status cache entry on removal even when post-delete cache cleanup fails', async () => {
    const service = new McpRuntimeService()
    service.setServerStatus('server-1', 'connected')
    mcpCatalogMock.clearSharedToolsCache.mockImplementation(() => {
      throw new Error('cache backend down')
    })

    await expect(service.removeServer('server-1')).resolves.toBeUndefined()
    expect(deleteServerMock).toHaveBeenCalledWith('server-1')
    // Deleted row → deleted entry; writing 'disabled' would orphan it forever.
    expect(MockMainCacheServiceUtils.getSharedCacheValue('mcp.status.server-1')).toBeUndefined()
  })

  it('ignores a status write that lands after removal instead of resurrecting the entry', async () => {
    const service = new McpRuntimeService()
    await service.removeServer('server-1')

    // Simulates a connectivity check / restart error path whose setServerStatus
    // call loses the race against removeServer's deleteShared.
    service.setServerStatus('server-1', 'error', new Error('late writer'))

    expect(MockMainCacheServiceUtils.getSharedCacheValue('mcp.status.server-1')).toBeUndefined()
  })
})

describe('McpRuntimeService prompt/resource capability gate', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    mcpSdkMock.clients.length = 0
    mcpSdkMock.state.capabilities = undefined
    mcpSdkMock.state.failStreamable = false
  })

  function stdioServer(id: string): McpServer {
    return { id, name: id, command: 'npx', args: ['-y', 'example-mcp'], isActive: true } as McpServer
  }

  it('never sends prompts/list or resources/list to a server declaring neither capability', async () => {
    mcpSdkMock.state.capabilities = { tools: {} }
    getByIdMock.mockReturnValue(stdioServer('caps-none'))
    const service = new McpRuntimeService()

    expect(await service.listPrompts('caps-none')).toEqual([])
    expect(await service.listResources('caps-none')).toEqual([])

    const client = mcpSdkMock.clients.at(-1)
    expect(client?.listPrompts).not.toHaveBeenCalled()
    expect(client?.listResources).not.toHaveBeenCalled()
  })

  it('lists prompts and resources when the server declares both', async () => {
    mcpSdkMock.state.capabilities = { prompts: {}, resources: {} }
    getByIdMock.mockReturnValue(stdioServer('caps-both'))
    const service = new McpRuntimeService()

    expect(await service.listPrompts('caps-both')).toMatchObject([{ name: 'a-prompt', serverId: 'caps-both' }])
    expect(await service.listResources('caps-both')).toMatchObject([{ uri: 'file:///a', serverId: 'caps-both' }])
  })

  it('reports connected capabilities synchronously, and nothing for a server that never connected', async () => {
    mcpSdkMock.state.capabilities = { resources: {} }
    getByIdMock.mockReturnValue(stdioServer('caps-sync'))
    const service = new McpRuntimeService()

    expect(service.getConnectedServerCapabilities('caps-sync')).toBeUndefined()
    await service.withClient('caps-sync', async () => undefined)
    expect(service.getConnectedServerCapabilities('caps-sync')?.resources).toBeDefined()
  })
})

describe('McpRuntimeService list pagination', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    mcpSdkMock.clients.length = 0
    mcpSdkMock.state.capabilities = { prompts: {}, resources: {} }
    mcpSdkMock.state.failStreamable = false
  })

  function stdioServer(id: string): McpServer {
    return { id, name: id, command: 'npx', args: ['-y', 'example-mcp'], isActive: true } as McpServer
  }

  it('follows the resources cursor so the model sees every page, not just the first', async () => {
    getByIdMock.mockReturnValue(stdioServer('paged-resources'))
    const service = new McpRuntimeService()
    await service.withClient('paged-resources', async () => undefined)
    const client = mcpSdkMock.clients.at(-1)
    client?.listResources
      .mockResolvedValueOnce({ resources: [{ uri: 'file:///1', name: '1' }], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ resources: [{ uri: 'file:///2', name: '2' }] })

    const resources = await service.listResources('paged-resources')

    expect(resources.map((resource) => resource.uri)).toEqual(['file:///1', 'file:///2'])
    expect(client?.listResources).toHaveBeenLastCalledWith({ cursor: 'page-2' })
  })

  it('follows the prompts cursor too', async () => {
    getByIdMock.mockReturnValue(stdioServer('paged-prompts'))
    const service = new McpRuntimeService()
    await service.withClient('paged-prompts', async () => undefined)
    const client = mcpSdkMock.clients.at(-1)
    client?.listPrompts
      .mockResolvedValueOnce({ prompts: [{ name: 'first' }], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ prompts: [{ name: 'second' }] })

    const prompts = await service.listPrompts('paged-prompts')

    expect(prompts.map((prompt) => prompt.name)).toEqual(['first', 'second'])
  })
})
