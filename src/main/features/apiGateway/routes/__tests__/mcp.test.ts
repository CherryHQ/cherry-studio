import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/v1/mcps*` integration tests — drive the real Elysia app via `app.handle(Request)`
 * so the auth guard, route wiring and the stateless Streamable HTTP transport are all
 * exercised end-to-end. Only the leaves are stubbed: the SQLite-backed
 * `mcpServerService` and the MCP runtime/catalog services.
 */

const { mockPreferenceGet, mockList, mockFindByIdOrName, mockListTools, mockWarmToolsCache, mockCallTool } = vi.hoisted(
  () => ({
    mockPreferenceGet: vi.fn<(key: string) => unknown>(() => 'test-key'),
    mockList: vi.fn(),
    mockFindByIdOrName: vi.fn(),
    mockListTools: vi.fn(),
    mockWarmToolsCache: vi.fn(async () => undefined),
    mockCallTool: vi.fn()
  })
)

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const overrides = {
    PreferenceService: { get: mockPreferenceGet },
    McpCatalogService: {
      listTools: mockListTools,
      warmToolsCache: mockWarmToolsCache,
      listResources: vi.fn(async () => []),
      listPrompts: vi.fn(async () => []),
      onToolsCacheUpdated: vi.fn(() => ({ dispose: vi.fn() }))
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

function rpc(app: ReturnType<typeof buildApp>, path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, { method: 'POST', headers: MCP_HEADERS, body: JSON.stringify(body) })
  )
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
}

describe('/v1/mcps', () => {
  let app: ReturnType<typeof buildApp>

  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferenceGet.mockReturnValue('test-key')
    mockList.mockReturnValue({ items: [ACTIVE_SERVER], total: 1, page: 1 })
    mockFindByIdOrName.mockImplementation((id: string) => (id === 'server-1' ? ACTIVE_SERVER : undefined))
    mockListTools.mockReturnValue([TOOL])
    mockWarmToolsCache.mockResolvedValue(undefined)
    app = buildApp()
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

  it('proxies tools/list over stateless Streamable HTTP without a session header', async () => {
    const init = await rpc(app, '/v1/mcps/server-1/mcp', INITIALIZE)
    expect(init.status).toBe(200)
    // Stateless mode issues no session id, so the client has nothing to echo back.
    expect(init.headers.get('mcp-session-id')).toBeNull()
    expect((await init.json()).result.serverInfo.name).toBe('filesystem')

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
      args: { path: '/tmp/a.txt' }
    })
  })

  it('POST /v1/mcps/:id/mcp → 404 for an unknown server', async () => {
    const res = await rpc(app, '/v1/mcps/nope/mcp', INITIALIZE)
    expect(res.status).toBe(404)
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
    expect(res.headers.get('allow')).toBe('POST')
    expect((await res.json()).error).toMatchObject({ code: -32000, message: 'Method not allowed.' })
  })

  it('documents the endpoints in the OpenAPI spec', async () => {
    const spec = await (await get(app, '/openapi/json', {})).json()
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/v1/mcps/', '/v1/mcps/{server_id}']))
    expect(spec.paths['/v1/mcps/'].get.description).toBe('apiGateway.docs.operations.list_mcp_servers::en-US')
    expect(spec.paths['/v1/mcps/{server_id}/mcp'].post.description).toBe('apiGateway.docs.operations.mcp_proxy::en-US')
    // GET/DELETE on the proxy path are transport plumbing, not part of the documented API.
    expect(spec.paths['/v1/mcps/{server_id}/mcp'].get).toBeUndefined()
  })
})
