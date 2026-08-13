import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/v1/mcps*` integration tests — drive the real Elysia app via `app.handle(Request)`
 * so the auth guard, route wiring and the stateless Streamable HTTP transport are all
 * exercised end-to-end. Only the leaves are stubbed: the SQLite-backed
 * `mcpServerService` and the MCP runtime/catalog services.
 */

const {
  mockPreferenceGet,
  mockList,
  mockFindByIdOrName,
  mockListTools,
  mockWarmToolsCache,
  mockCallTool,
  toolsCacheListeners
} = vi.hoisted(() => ({
  mockPreferenceGet: vi.fn<(key: string) => unknown>(() => 'test-key'),
  mockList: vi.fn(),
  mockFindByIdOrName: vi.fn(),
  mockListTools: vi.fn(),
  mockWarmToolsCache: vi.fn(async () => undefined),
  mockCallTool: vi.fn(),
  // Real listener set so a test can actually fire the event the bridge relays as
  // `tools/list_changed` — the whole point of sessions.
  toolsCacheListeners: new Set<(event: { serverId: string }) => void>()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const overrides = {
    PreferenceService: { get: mockPreferenceGet },
    McpCatalogService: {
      listTools: mockListTools,
      warmToolsCache: mockWarmToolsCache,
      listResources: vi.fn(async () => []),
      listPrompts: vi.fn(async () => []),
      onToolsCacheUpdated: vi.fn((listener: (event: { serverId: string }) => void) => {
        toolsCacheListeners.add(listener)
        return { dispose: () => toolsCacheListeners.delete(listener) }
      })
    },
    McpRuntimeService: { callTool: mockCallTool }
  }
  return mockApplicationFactory(overrides)
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn() }))
  }
}))

vi.mock('@main/i18n', () => ({
  t: (key: string, _params?: unknown, lang?: string) => (lang ? `${key}::${lang}` : key),
  getAppLanguage: () => 'en-US',
  SUPPORTED_LANGUAGES: ['en-US', 'zh-CN']
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { list: mockList, findByIdOrName: mockFindByIdOrName }
}))

// Sibling routes pulled in by buildApp — stubbed so this suite stays hermetic.
vi.mock('../../proxyStream', () => ({
  processMessage: vi.fn(),
  default: { processMessage: vi.fn() }
}))
vi.mock('../../utils/models', () => ({ getModels: vi.fn(async () => ({ object: 'list', data: [] })) }))
vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: { list: vi.fn(() => ({ items: [], total: 0 })), getById: vi.fn() }
}))

import { buildApp } from '../../app'
import { McpSessionStore } from '../../McpSessionStore'

const ACTIVE_SERVER = { id: 'server-1', name: 'filesystem', type: 'stdio', description: 'Local files', isActive: true }
const TOOL = {
  id: 'filesystem__read_file',
  name: 'read_file',
  description: 'Read a file',
  type: 'mcp',
  serverId: 'server-1',
  serverName: 'filesystem',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
}

/** MCP clients MUST accept both content types on POST; the transport enforces it. */
const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'x-api-key': 'test-key'
}

function get(
  app: ReturnType<typeof buildApp>,
  path: string,
  headers: Record<string, string> = { 'x-api-key': 'test-key' }
) {
  return app.handle(new Request(`http://localhost${path}`, { method: 'GET', headers }))
}

function rpc(app: ReturnType<typeof buildApp>, path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, ...extraHeaders },
      body: JSON.stringify(body)
    })
  )
}

/** Drive the full handshake and return the id the transport assigned. */
async function openSession(app: ReturnType<typeof buildApp>, path = '/v1/mcps/server-1/mcp'): Promise<string> {
  const res = await rpc(app, path, INITIALIZE)
  const sessionId = res.headers.get('mcp-session-id')
  if (!sessionId) throw new Error(`no session id issued (status ${res.status})`)
  // The SDK client always follows initialize with this; it is what arms the bridge's relay.
  await rpc(app, path, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': sessionId })
  return sessionId
}

/**
 * Drain a session POST response. Session transports answer in SSE (not JSON) so that
 * request-related notifications such as `notifications/progress` are actually written —
 * the SDK drops those under `enableJsonResponse`. Returns every JSON-RPC message in order.
 */
async function readSseMessages(res: Response): Promise<any[]> {
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
}

/** The final result message of a session POST (notifications may precede it). */
async function sseResult(res: Response): Promise<any> {
  const messages = await readSseMessages(res)
  return messages.find((message) => 'result' in message || 'error' in message)
}

/** Read SSE frames off a stream until `predicate` matches or the budget runs out. */
async function readFrames(res: Response, predicate: (text: string) => boolean, budget = 40): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (let i = 0; i < budget; i++) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: false }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: false }), 25)
      )
    ])
    if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true })
    if (predicate(buffer)) break
  }
  void reader.cancel()
  return buffer
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
}

describe('/v1/mcps', () => {
  let app: ReturnType<typeof buildApp>
  let sessions: McpSessionStore

  beforeEach(() => {
    vi.clearAllMocks()
    toolsCacheListeners.clear()
    mockPreferenceGet.mockReturnValue('test-key')
    mockList.mockReturnValue({ items: [ACTIVE_SERVER], total: 1, page: 1 })
    mockFindByIdOrName.mockImplementation((id: string) => (id === 'server-1' ? ACTIVE_SERVER : undefined))
    mockListTools.mockReturnValue([TOOL])
    mockWarmToolsCache.mockResolvedValue(undefined)
    sessions = new McpSessionStore()
    app = buildApp({ mcpSessions: sessions })
  })

  afterEach(async () => {
    await sessions.closeAll()
  })

  it('GET /v1/mcps lists active servers with an absolute proxy url', async () => {
    const res = await get(app, '/v1/mcps')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      servers: [
        {
          id: 'server-1',
          name: 'filesystem',
          type: 'streamableHttp',
          description: 'Local files',
          url: 'http://localhost/v1/mcps/server-1/mcp'
        }
      ]
    })
    expect(mockList).toHaveBeenCalledWith({ isActive: true })
  })

  it('GET /v1/mcps requires credentials', async () => {
    const res = await get(app, '/v1/mcps', {})
    expect(res.status).toBe(401)
  })

  it('GET /v1/mcps/:id returns the server with its warmed tool list', async () => {
    const res = await get(app, '/v1/mcps/server-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: 'server-1',
      name: 'filesystem',
      type: 'stdio',
      description: 'Local files',
      tools: [TOOL]
    })
    // Warmed before reading: `listTools` is cache-only and would otherwise return [].
    expect(mockWarmToolsCache).toHaveBeenCalledWith('server-1')
  })

  it('GET /v1/mcps/:id → 404 for an unknown server', async () => {
    const res = await get(app, '/v1/mcps/nope')
    expect(res.status).toBe(404)
  })

  it('proxies tools/list with full tool metadata', async () => {
    const list = await rpc(app, '/v1/mcps/server-1/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(list.status).toBe(200)
    const body = await list.json()
    expect(body.result.tools).toHaveLength(1)
    expect(body.result.tools[0]).toMatchObject({ name: 'read_file', description: 'Read a file' })
  })

  it('proxies tools/call through to the MCP runtime', async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'file contents' }] })

    const res = await rpc(app, '/v1/mcps/server-1/mcp', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '/tmp/a.txt' } }
    })

    expect(res.status).toBe(200)
    expect((await res.json()).result.content).toEqual([{ type: 'text', text: 'file contents' }])
    expect(mockCallTool).toHaveBeenCalledWith({
      serverId: 'server-1',
      name: 'read_file',
      args: { path: '/tmp/a.txt' },
      // Forwarded so a dropped connection stops the upstream call instead of letting it
      // run to completion against the runtime's own controller.
      signal: expect.any(AbortSignal)
    })
  })

  // The peer is an MCP transport: a failure raised before the route runs must still be
  // JSON-RPC, or the client sees a REST envelope where the protocol promises an error object.
  it('POST /v1/mcps/:id/mcp → 404 for an unknown server, as JSON-RPC', async () => {
    const res = await rpc(app, '/v1/mcps/nope/mcp', INITIALIZE)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32000 } })
  })

  it('POST /v1/mcps/:id/mcp → -32700 for a body Elysia cannot parse', async () => {
    const res = await app.handle(
      new Request('http://localhost/v1/mcps/server-1/mcp', { method: 'POST', headers: MCP_HEADERS, body: '{oops' })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  })

  // `warmToolsCache` can block on an upstream connect whose timeout floor is 180s. Gating
  // every message on it would put that in front of the handshake itself.
  it('only waits on the tools cache for tools/list', async () => {
    await rpc(app, '/v1/mcps/server-1/mcp', INITIALIZE)
    expect(mockWarmToolsCache).not.toHaveBeenCalled()

    await rpc(app, '/v1/mcps/server-1/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(mockWarmToolsCache).not.toHaveBeenCalled()

    await rpc(app, '/v1/mcps/server-1/mcp', { jsonrpc: '2.0', id: 9, method: 'tools/list' })
    expect(mockWarmToolsCache).toHaveBeenCalledWith('server-1')
  })

  // The capability must track what the transport can actually deliver. A session holds a
  // stream, so it advertises listChanged; the one-shot path builds its bridge with
  // `listChanged: false` (it has no stream), and never reaches a client because only an
  // `initialize` — which opens a session — is answered with capabilities at all.
  it('advertises tools.listChanged to a session client, which can receive it', async () => {
    const res = await rpc(app, '/v1/mcps/server-1/mcp', INITIALIZE)
    expect((await sseResult(res)).result.capabilities.tools).toEqual({ listChanged: true })
  })

  // The MCP transport spec requires Origin validation to block DNS rebinding; native
  // clients send no Origin and must stay unaffected.
  describe('Origin validation', () => {
    it.each(['POST', 'GET', 'DELETE'])('rejects a non-local Origin on %s', async (method) => {
      const res = await app.handle(
        new Request('http://localhost/v1/mcps/server-1/mcp', {
          method,
          headers: { ...MCP_HEADERS, origin: 'https://evil.example' },
          ...(method === 'POST' ? { body: JSON.stringify(INITIALIZE) } : {})
        })
      )
      expect(res.status).toBe(403)
    })

    it('allows a loopback Origin', async () => {
      const res = await app.handle(
        new Request('http://localhost/v1/mcps/server-1/mcp', {
          method: 'POST',
          headers: { ...MCP_HEADERS, origin: 'http://localhost:5173' },
          body: JSON.stringify(INITIALIZE)
        })
      )
      expect(res.status).toBe(200)
    })

    it('allows a native client that sends no Origin', async () => {
      const res = await rpc(app, '/v1/mcps/server-1/mcp', INITIALIZE)
      expect(res.status).toBe(200)
    })
  })

  // Stateless offers no SSE stream and no session to terminate. Must not reach the
  // transport: its GET branch opens a stream regardless, which the per-request teardown
  // then closes, so the client would get a dead stream rather than a refusal.
  it.each(['GET', 'DELETE'])('%s /v1/mcps/:id/mcp → 405', async (method) => {
    const res = await app.handle(
      new Request(`http://localhost/v1/mcps/server-1/mcp`, {
        method,
        headers: { 'x-api-key': 'test-key', accept: 'text/event-stream' }
      })
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST, GET, DELETE')
    expect((await res.json()).error).toMatchObject({ code: -32000, message: 'Method not allowed.' })
  })

  describe('sessions (opt-in via initialize)', () => {
    it('issues an Mcp-Session-Id on initialize and reuses it for follow-up calls', async () => {
      const res = await rpc(app, '/v1/mcps/server-1/mcp', INITIALIZE)
      const sessionId = res.headers.get('mcp-session-id')
      expect(res.status).toBe(200)
      expect(sessionId).toBeTruthy()
      expect(sessions.size).toBe(1)

      const list = await rpc(
        app,
        '/v1/mcps/server-1/mcp',
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { 'mcp-session-id': sessionId! }
      )
      expect(list.status).toBe(200)
      expect((await sseResult(list)).result.tools).toHaveLength(1)
    })

    // Regression for the silent-drop this PR fixes: with `enableJsonResponse: true` the SDK
    // resolves the call but never writes request-related notifications, so an HTTP client
    // saw the result and lost every progress update. An in-memory transport cannot show this.
    it('delivers notifications/progress to a session client over the HTTP transport', async () => {
      mockCallTool.mockImplementation(async ({ onProgress }: { onProgress?: (p: unknown) => void }) => {
        onProgress?.({ progress: 1, total: 2 })
        onProgress?.({ progress: 2, total: 2 })
        return { content: [{ type: 'text', text: 'done' }] }
      })

      const sessionId = await openSession(app)
      const res = await rpc(
        app,
        '/v1/mcps/server-1/mcp',
        {
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'read_file', arguments: { path: '/tmp/a.txt' }, _meta: { progressToken: 'tok-1' } }
        },
        { 'mcp-session-id': sessionId }
      )

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const messages = await readSseMessages(res)
      const progress = messages.filter((m) => m.method === 'notifications/progress')
      expect(progress.map((m) => m.params.progress)).toEqual([1, 2])
      expect(progress.every((m) => m.params.progressToken === 'tok-1')).toBe(true)
      expect(messages.find((m) => 'result' in m).result.content).toEqual([{ type: 'text', text: 'done' }])
    })

    // The hybrid contract: clients that never handshake keep the behaviour shipped in #18080.
    it('still serves a sessionless tools/list with no handshake', async () => {
      const res = await rpc(app, '/v1/mcps/server-1/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/list' })
      expect(res.status).toBe(200)
      expect((await res.json()).result.tools).toHaveLength(1)
      expect(sessions.size).toBe(0)
    })

    it('rejects an unknown session id with 404', async () => {
      const res = await rpc(
        app,
        '/v1/mcps/server-1/mcp',
        { jsonrpc: '2.0', id: 4, method: 'tools/list' },
        { 'mcp-session-id': 'nope' }
      )
      expect(res.status).toBe(404)
    })

    it('GET opens an SSE stream for a session and still 405s without one', async () => {
      expect((await get(app, '/v1/mcps/server-1/mcp', { 'x-api-key': 'test-key' })).status).toBe(405)

      const sessionId = await openSession(app)
      const stream = await get(app, '/v1/mcps/server-1/mcp', {
        'x-api-key': 'test-key',
        accept: 'text/event-stream',
        'mcp-session-id': sessionId
      })
      expect(stream.status).toBe(200)
      expect(stream.headers.get('content-type')).toContain('text/event-stream')
      void stream.body?.cancel()
    })

    // The feature itself: without this, sessions buy nothing over #18080's stateless proxy.
    it('pushes tools/list_changed onto a session stream when the tools cache changes', async () => {
      const sessionId = await openSession(app)
      const stream = await get(app, '/v1/mcps/server-1/mcp', {
        'x-api-key': 'test-key',
        accept: 'text/event-stream',
        'mcp-session-id': sessionId
      })
      expect(toolsCacheListeners.size).toBeGreaterThan(0)

      for (const listener of toolsCacheListeners) listener({ serverId: 'server-1' })

      const frames = await readFrames(stream, (text) => text.includes('tools/list_changed'))
      expect(frames).toContain('notifications/tools/list_changed')
    })

    it('DELETE terminates a session; the id is unusable afterwards', async () => {
      const sessionId = await openSession(app)
      const del = await app.handle(
        new Request('http://localhost/v1/mcps/server-1/mcp', {
          method: 'DELETE',
          headers: { 'x-api-key': 'test-key', 'mcp-session-id': sessionId }
        })
      )
      expect(del.status).toBe(200)
      expect(sessions.size).toBe(0)

      const after = await rpc(
        app,
        '/v1/mcps/server-1/mcp',
        { jsonrpc: '2.0', id: 5, method: 'tools/list' },
        { 'mcp-session-id': sessionId }
      )
      expect(after.status).toBe(404)
    })

    // The cap used to be checked against `sessions.size` alone, which is only updated after
    // `bridge.connect()` resolves — so a concurrent burst all passed the check at once.
    it('holds the session cap under a concurrent initialize burst', async () => {
      const burst = 80
      const responses = await Promise.all(
        Array.from({ length: burst }, () => rpc(app, '/v1/mcps/server-1/mcp', INITIALIZE))
      )

      const opened = responses.filter((res) => res.headers.get('mcp-session-id')).length
      const refused = responses.filter((res) => res.status === 503).length
      expect(sessions.size).toBeLessThanOrEqual(64)
      expect(opened).toBeLessThanOrEqual(64)
      expect(opened + refused).toBe(burst)
    })

    // Browsers cannot read a response header that is not in access-control-expose-headers,
    // so without this the official client reads a null id and orphans the session.
    it('exposes mcp-session-id to browser clients', async () => {
      const res = await app.handle(
        new Request('http://localhost/v1/mcps/server-1/mcp', {
          method: 'POST',
          // Loopback: a non-local Origin is rejected outright by the transport-boundary check.
          headers: { ...MCP_HEADERS, origin: 'http://localhost:5173' },
          body: JSON.stringify(INITIALIZE)
        })
      )
      expect(res.headers.get('mcp-session-id')).toBeTruthy()
      expect(res.headers.get('access-control-expose-headers')?.toLowerCase()).toContain('mcp-session-id')
    })

    // The SDK unregisters its standalone stream from that stream's `cancel` callback, so a
    // cancellation that never reaches the source strands the mapping and every later GET on
    // the session answers 409 — for the rest of its life, since nothing else clears it.
    it('lets a client reopen the stream after cancelling the previous one', async () => {
      const sessionId = await openSession(app)
      const streamHeaders = {
        'x-api-key': 'test-key',
        accept: 'text/event-stream',
        'mcp-session-id': sessionId
      }

      const first = await get(app, '/v1/mcps/server-1/mcp', streamHeaders)
      expect(first.status).toBe(200)
      await first.body!.cancel()

      const second = await get(app, '/v1/mcps/server-1/mcp', streamHeaders)
      expect(second.status).toBe(200)
      void second.body?.cancel()
    })

    it('refuses new sessions once closed, so a shutdown race cannot strand one', async () => {
      await sessions.closeAll()
      const res = await rpc(app, '/v1/mcps/server-1/mcp', INITIALIZE)
      expect(res.status).toBe(503)
      expect(sessions.size).toBe(0)
    })

    it('closeAll drops every session, so gateway shutdown cannot leak bridges', async () => {
      const sessionId = await openSession(app)
      await sessions.closeAll()
      expect(sessions.size).toBe(0)

      const after = await rpc(
        app,
        '/v1/mcps/server-1/mcp',
        { jsonrpc: '2.0', id: 6, method: 'tools/list' },
        { 'mcp-session-id': sessionId }
      )
      expect(after.status).toBe(404)
    })
  })

  it('documents the endpoints in the OpenAPI spec', async () => {
    const spec = await (await get(app, '/openapi/json', {})).json()
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/v1/mcps/', '/v1/mcps/{server_id}']))
    expect(spec.paths['/v1/mcps/'].get.description).toBe('apiGateway.docs.operations.list_mcp_servers::en-US')
    expect(spec.paths['/v1/mcps/{server_id}/mcp'].post.description).toBe('apiGateway.docs.operations.mcp_proxy::en-US')
    // GET/DELETE on the proxy path are transport plumbing, not part of the documented API.
    expect(spec.paths['/v1/mcps/{server_id}/mcp'].get).toBeUndefined()
  })

  // The proxy answers JSON on the one-shot path and SSE on a session, so a client generated
  // from this spec must be told about both — declaring only JSON makes it pick a JSON parser
  // and never see a session response.
  it('advertises both response media types for the proxy', async () => {
    const spec = await (await get(app, '/openapi/json', {})).json()
    const content = spec.paths['/v1/mcps/{server_id}/mcp'].post.responses['200'].content
    expect(Object.keys(content).sort()).toEqual(['application/json', 'text/event-stream'])
  })
})
