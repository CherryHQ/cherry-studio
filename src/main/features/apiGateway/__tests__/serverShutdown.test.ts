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
      new Elysia({ adapter: node() }).use(createMcpRoutes(mcpSessions))
  }
})

import type { McpSessionStore } from '../McpSessionStore'
import { ApiGateway } from '../server'

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

    const port = (
      gateway as unknown as { serverInfo: { raw?: { node?: { server?: { address(): { port: number } } } } } }
    ).serverInfo.raw!.node!.server!.address().port
    const url = `http://127.0.0.1:${port}/mcps/server-1/mcp`
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
