import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression guard for the shutdown deadlock: a session's `GET` stream is an *active
 * HTTP response*, and `@elysia/node` closes the server via Node's `server.close()`
 * without `closeAllConnections`, which waits for exactly those. Closing the sessions
 * after that await therefore never ran — deactivate/restart/quit hung until the client
 * disconnected or the 30-minute sweep fired.
 *
 * Runs against a real node-adapter socket because that is the only place the stall is
 * observable; `app.handle(Request)` never touches `server.close()`.
 */

const mocks = vi.hoisted(() => ({
  findByIdOrName: vi.fn(),
  warmToolsCache: vi.fn(async () => undefined),
  listTools: vi.fn(() => []),
  callTool: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const overrides = {
    PreferenceService: {
      // port 0 => OS picks a free port, so tests never collide.
      get: (key: string) => (key.endsWith('port') ? 0 : '127.0.0.1')
    },
    McpCatalogService: {
      warmToolsCache: mocks.warmToolsCache,
      listTools: mocks.listTools,
      listResources: vi.fn(async () => []),
      listPrompts: vi.fn(async () => []),
      onToolsCacheUpdated: vi.fn(() => ({ dispose: vi.fn() }))
    },
    McpRuntimeService: { callTool: mocks.callTool }
  }
  return mockApplicationFactory(overrides)
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn() }))
  }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: mocks.findByIdOrName, list: vi.fn(() => ({ items: [], total: 0, page: 1 })) }
}))

// Mount only the MCP routes on a real node adapter — the rest of `buildApp` pulls in
// heavy services irrelevant to shutdown ordering.
vi.mock('../app', async () => {
  const { Elysia } = await import('elysia')
  const { node } = await import('@elysia/node')
  const { createMcpRoutes } = await import('../routes/mcp')
  return {
    buildApp: ({ mcpSessions }: { mcpSessions: McpSessionStore }) =>
      new Elysia({ adapter: node() }).use(createMcpRoutes(mcpSessions)).get(
        // Stands in for a proxied completion (`proxyStream`): an active response that never
        // ends on its own, which is what `server.close()` waits for indefinitely.
        '/never-ends',
        () =>
          new Response(
            new ReadableStream({
              start: (controller) => controller.enqueue(new TextEncoder().encode(': open\n\n'))
            }),
            { headers: { 'content-type': 'text/event-stream' } }
          )
      )
  }
})

import type { Server as HttpServer } from 'http'

import type { McpSessionStore } from '../McpSessionStore'
import { ApiGateway } from '../server'

const rawServer = (gateway: ApiGateway): HttpServer =>
  (gateway as unknown as { serverInfo: { raw: { node: { server: HttpServer } } } }).serverInfo.raw.node.server

const portOf = (gateway: ApiGateway): number => (rawServer(gateway).address() as { port: number }).port

/** Open the endless stream and wait for its first chunk, so the response is live server-side. */
const openEndlessStream = async (port: number): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  const response = await fetch(`http://127.0.0.1:${port}/never-ends`)
  expect(response.status).toBe(200)
  const reader = response.body!.getReader()
  await reader.read()
  return reader
}

const SERVER = { id: 'server-1', name: 'filesystem', type: 'stdio', isActive: true }
const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
}

describe('ApiGateway shutdown with a live MCP session', () => {
  let gateway: ApiGateway | null = null

  afterEach(async () => {
    await gateway?.stop().catch(() => {})
    gateway = null
    vi.clearAllMocks()
  })

  it('stops promptly while a session holds an open GET stream', async () => {
    mocks.findByIdOrName.mockReturnValue(SERVER)
    gateway = new ApiGateway()
    await gateway.start()

    const url = `http://127.0.0.1:${portOf(gateway)}/mcps/server-1/mcp`
    const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

    const init = await fetch(url, { method: 'POST', headers: mcpHeaders, body: JSON.stringify(INITIALIZE) })
    const sessionId = init.headers.get('mcp-session-id')
    expect(sessionId).toBeTruthy()
    await init.text()

    // Hold the notification stream open, exactly as a real client does. Deliberately not
    // cancelled before `stop()` — that is the situation that used to deadlock.
    const stream = await fetch(url, {
      headers: { accept: 'text/event-stream', 'mcp-session-id': sessionId! }
    })
    expect(stream.status).toBe(200)
    const reader = stream.body!.getReader()
    void reader.read()

    const started = Date.now()
    await gateway.stop()
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(gateway.isRunning()).toBe(false)

    void reader.cancel().catch(() => {})
    gateway = null
  }, 20_000)
})

describe('ApiGateway shutdown with a stuck plain HTTP response', () => {
  let gateway: ApiGateway | null = null
  /** A server whose sockets outlived `stop()` and must be released before the worker exits. */
  let survivor: HttpServer | null = null

  afterEach(async () => {
    await gateway?.stop().catch(() => {})
    gateway = null
    survivor?.closeAllConnections()
    survivor = null
    vi.clearAllMocks()
  })

  it('stops while a non-MCP response is still streaming', async () => {
    gateway = new ApiGateway()
    await gateway.start()
    const reader = await openEndlessStream(portOf(gateway))

    const started = Date.now()
    await gateway.stop()
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(gateway.isRunning()).toBe(false)
    // The socket was destroyed, so the client is not left waiting on a stream nobody serves.
    await expect(reader.read()).rejects.toThrow()
    gateway = null
  }, 30_000)

  it('settles even when the server cannot force its connections closed', async () => {
    gateway = new ApiGateway()
    await gateway.start()
    const http = rawServer(gateway)
    // `closeAllConnections` is Node 18.2+; a test double or another adapter may not have it.
    Object.defineProperty(http, 'closeAllConnections', { value: undefined, configurable: true })
    const reader = await openEndlessStream(portOf(gateway))

    await expect(gateway.stop()).resolves.toBeUndefined()
    expect(gateway.isRunning()).toBe(false)

    Reflect.deleteProperty(http, 'closeAllConnections')
    survivor = http
    void reader.cancel().catch(() => {})
    gateway = null
  }, 30_000)
})
