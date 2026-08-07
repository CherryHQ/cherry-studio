import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findByIdOrName: vi.fn(),
  applicationGet: vi.fn(),
  listTools: vi.fn(),
  onToolsCacheUpdated: vi.fn(),
  onToolsCacheUpdatedDispose: vi.fn(),
  listPrompts: vi.fn(),
  getPrompt: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: {
    findByIdOrName: mocks.findByIdOrName
  }
}))

vi.mock('@application', () => ({
  application: {
    get: mocks.applicationGet
  }
}))

const { createSdkMcpServerInstance } = await import('../createSdkMcpServerInstance')

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>

/** Latest listener passed to the mocked `onToolsCacheUpdated` — the test's stand-in for
 *  `McpCatalogService._onToolsCacheUpdated.fire`. */
let cacheUpdatedListener: ((event: { serverId: string }) => void) | undefined

function searchTool() {
  return {
    name: 'search',
    description: 'search desc',
    inputSchema: { type: 'object', properties: {}, required: [] },
    id: 'search-id',
    serverId: 'server-1',
    serverName: 'Docs MCP',
    type: 'mcp'
  }
}

/** Connect a real MCP client to the bridge over an in-memory transport pair and make sure
 *  the `initialized` notification has been processed server-side before returning. */
async function connectClient(sdkServer: ReturnType<typeof createSdkMcpServerInstance>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} })
  await sdkServer.server.connect(serverTransport)
  await client.connect(clientTransport)
  // client.connect resolves after *sending* `initialized`; give the server a tick to handle it.
  await new Promise((resolve) => setImmediate(resolve))
  return client
}

describe('createSdkMcpServerInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheUpdatedListener = undefined
    mocks.findByIdOrName.mockReturnValue({ id: 'server-1', name: 'Docs MCP' })
    mocks.listTools.mockReturnValue([])
    mocks.onToolsCacheUpdated.mockImplementation((listener: (event: { serverId: string }) => void) => {
      cacheUpdatedListener = listener
      return { dispose: mocks.onToolsCacheUpdatedDispose }
    })
    mocks.listPrompts.mockResolvedValue([])
    mocks.getPrompt.mockResolvedValue({
      description: 'Prompt description',
      messages: [{ role: 'user', content: { type: 'text', text: 'Prompt body' } }]
    })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'McpCatalogService')
        return {
          listTools: mocks.listTools,
          onToolsCacheUpdated: mocks.onToolsCacheUpdated,
          listPrompts: mocks.listPrompts
        }
      if (name === 'McpRuntimeService') return { getPrompt: mocks.getPrompt }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('uses a request-captured server snapshot without re-reading the edited database row', () => {
    const capturedServer = { id: 'server-1', name: 'Captured MCP' }

    createSdkMcpServerInstance('server-1', capturedServer as never)

    expect(mocks.findByIdOrName).not.toHaveBeenCalled()
  })

  it('proxies prompts/get through McpRuntimeService when prompts are advertised', async () => {
    const sdkServer = createSdkMcpServerInstance('server-1')
    const handlers = (sdkServer.server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers
    const handler = handlers.get('prompts/get')

    expect(handler).toBeDefined()

    const result = await handler!(
      { method: 'prompts/get', params: { name: 'summarize', arguments: { topic: 'release' } } },
      {}
    )

    expect(mocks.getPrompt).toHaveBeenCalledWith({
      serverId: 'server-1',
      name: 'summarize',
      args: { topic: 'release' }
    })
    expect(result).toEqual({
      description: 'Prompt description',
      messages: [{ role: 'user', content: { type: 'text', text: 'Prompt body' } }]
    })
  })

  it('lists tools from the cache-only listTools without blocking, stripping bridge-internal fields', async () => {
    mocks.listTools.mockReturnValue([searchTool()])

    const sdkServer = createSdkMcpServerInstance('server-1')
    const handlers = (sdkServer.server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers
    const handler = handlers.get('tools/list')

    expect(handler).toBeDefined()

    const result = await handler!({ method: 'tools/list' }, {})

    expect(mocks.listTools).toHaveBeenCalledWith('server-1', { includeDisabled: false })
    expect(result).toEqual({
      tools: [
        { name: 'search', description: 'search desc', inputSchema: { type: 'object', properties: {}, required: [] } }
      ]
    })
  })

  it('declares tools.listChanged so the SDK client attaches its re-list handler', async () => {
    const sdkServer = createSdkMcpServerInstance('server-1')
    const client = await connectClient(sdkServer)

    expect(client.getServerCapabilities()?.tools).toEqual({ listChanged: true })

    await client.close()
  })

  it('does not subscribe to cache updates until the session actually initializes', () => {
    createSdkMcpServerInstance('server-1')
    // A bridge whose query never starts must not leak an emitter subscription.
    expect(mocks.onToolsCacheUpdated).not.toHaveBeenCalled()
  })

  it('relays a cache update as tools/list_changed and serves the refreshed list on re-list', async () => {
    // Proves the bridge's half of the healing loop with a real MCP client over a real
    // transport: initial list empty → cache update → notification received → re-list sees
    // the tools. The other half — the Agent SDK CLI auto-re-listing when it receives the
    // notification — is SDK behavior (verified against 0.3.185) that this test does NOT
    // cover; it stands in with a manual re-list.
    const sdkServer = createSdkMcpServerInstance('server-1')
    const client = await connectClient(sdkServer)

    const notified = new Promise<void>((resolve) => {
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => resolve())
    })

    // First (per-session) snapshot hits a cold cache: empty.
    await expect(client.listTools()).resolves.toEqual({ tools: [] })
    expect(cacheUpdatedListener).toBeDefined()

    // The background refresh lands: cache now has tools, catalog fires the update event.
    mocks.listTools.mockReturnValue([searchTool()])
    cacheUpdatedListener!({ serverId: 'server-1' })

    await notified
    const relisted = await client.listTools()
    expect(relisted.tools.map((tool) => tool.name)).toEqual(['search'])

    await client.close()
  })

  it('re-subscribes on reconnect and disposes again on the second close', async () => {
    // The subscription lifecycle is self-managed via oninitialized/onclose, so a
    // connect → close → reconnect sequence on one instance must not end up with zero
    // or two live subscriptions. Locks the ??=-plus-reset pairing.
    const sdkServer = createSdkMcpServerInstance('server-1')

    const firstClient = await connectClient(sdkServer)
    expect(mocks.onToolsCacheUpdated).toHaveBeenCalledTimes(1)
    await firstClient.close()
    await new Promise((resolve) => setImmediate(resolve))
    expect(mocks.onToolsCacheUpdatedDispose).toHaveBeenCalledTimes(1)

    const secondClient = await connectClient(sdkServer)
    expect(mocks.onToolsCacheUpdated).toHaveBeenCalledTimes(2)

    // The fresh subscription still relays notifications on the new transport.
    const notified = new Promise<void>((resolve) => {
      secondClient.setNotificationHandler(ToolListChangedNotificationSchema, async () => resolve())
    })
    cacheUpdatedListener!({ serverId: 'server-1' })
    await notified

    await secondClient.close()
    await new Promise((resolve) => setImmediate(resolve))
    expect(mocks.onToolsCacheUpdatedDispose).toHaveBeenCalledTimes(2)
  })

  it('ignores cache updates for other servers', async () => {
    const sdkServer = createSdkMcpServerInstance('server-1')
    const client = await connectClient(sdkServer)

    const notificationHandler = vi.fn(async () => {})
    client.setNotificationHandler(ToolListChangedNotificationSchema, notificationHandler)

    cacheUpdatedListener!({ serverId: 'other-server' })
    await new Promise((resolve) => setImmediate(resolve))

    expect(notificationHandler).not.toHaveBeenCalled()

    await client.close()
  })

  it('disposes the cache subscription when the transport closes, and swallows late fires', async () => {
    const sdkServer = createSdkMcpServerInstance('server-1')
    const client = await connectClient(sdkServer)
    expect(mocks.onToolsCacheUpdated).toHaveBeenCalledTimes(1)

    await client.close()
    // onclose is delivered through the transport pair asynchronously.
    await new Promise((resolve) => setImmediate(resolve))
    expect(mocks.onToolsCacheUpdatedDispose).toHaveBeenCalledTimes(1)

    // A fire that races the teardown (emitter dispatched before dispose) must be swallowed,
    // not become an unhandled rejection from sendToolListChanged on a closed transport.
    expect(() => cacheUpdatedListener!({ serverId: 'server-1' })).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('responds to resource template discovery when resources are advertised', async () => {
    const sdkServer = createSdkMcpServerInstance('server-1')
    const handlers = (sdkServer.server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers
    const handler = handlers.get('resources/templates/list')

    expect(handler).toBeDefined()
    await expect(handler!({ method: 'resources/templates/list' }, {})).resolves.toEqual({
      resourceTemplates: []
    })
  })
})
