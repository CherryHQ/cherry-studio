import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findByIdOrName: vi.fn(),
  applicationGet: vi.fn(),
  listTools: vi.fn(),
  onToolsCacheUpdated: vi.fn(),
  onToolsCacheUpdatedDispose: vi.fn(),
  listPrompts: vi.fn(),
  listResourceTemplates: vi.fn(),
  getPrompt: vi.fn(),
  callTool: vi.fn(),
  getConnectedServerInstructions: vi.fn()
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

const { createMcpBridgeServer } = await import('../createMcpBridgeServer')

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

/** Connect a 2025-era client (what the Claude CLI speaks) and wait until the server has
 *  processed `initialized`. */
async function connectClient(bridge: ReturnType<typeof createMcpBridgeServer>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { versionNegotiation: { mode: 'legacy' } })
  await bridge.connect(serverTransport)
  await client.connect(clientTransport)
  // client.connect resolves after *sending* `initialized`; give the server a tick to handle it.
  await new Promise((resolve) => setImmediate(resolve))
  return client
}

describe('createMcpBridgeServer', () => {
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
    mocks.listResourceTemplates.mockResolvedValue([])
    mocks.getConnectedServerInstructions.mockReturnValue(undefined)
    mocks.getPrompt.mockResolvedValue({
      description: 'Prompt description',
      messages: [{ role: 'user', content: { type: 'text', text: 'Prompt body' } }]
    })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'McpCatalogService')
        return {
          listTools: mocks.listTools,
          onToolsCacheUpdated: mocks.onToolsCacheUpdated,
          listPrompts: mocks.listPrompts,
          listResourceTemplates: mocks.listResourceTemplates
        }
      if (name === 'McpRuntimeService')
        return {
          getPrompt: mocks.getPrompt,
          callTool: mocks.callTool,
          onCatalogChanged: () => ({ dispose: () => undefined }),
          onResourceUpdated: () => ({ dispose: () => undefined }),
          getConnectedServerInstructions: mocks.getConnectedServerInstructions
        }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('relays upstream tool progress to a client that supplied a progressToken', async () => {
    mocks.listTools.mockReturnValue([{ ...searchTool(), outputSchema: { type: 'array', items: { type: 'integer' } } }])
    // Emit two progress ticks from "upstream" before resolving the call.
    mocks.callTool.mockImplementation(async ({ onProgress }: { onProgress?: (p: unknown) => void }) => {
      onProgress?.({ progress: 1, total: 2 })
      onProgress?.({ progress: 2, total: 2 })
      return { content: [{ type: 'text', text: 'done' }], structuredContent: [1, 2] }
    })

    const client = await connectClient(createMcpBridgeServer('server-1'))
    expect((await client.listTools()).tools[0].outputSchema).toBeUndefined()
    const seen: { progress: number; total?: number }[] = []
    const result = await client.callTool(
      { name: 'search', arguments: {} },
      { onprogress: ({ progress, total }) => seen.push({ progress, total }) }
    )

    expect(result.content).toEqual([
      { type: 'text', text: 'done' },
      { type: 'text', text: '[1,2]' }
    ])
    expect(seen).toEqual([
      { progress: 1, total: 2 },
      { progress: 2, total: 2 }
    ])
  })

  it('exposes upstream instructions to the real Claude-compatible client', async () => {
    mocks.getConnectedServerInstructions.mockReturnValue({ text: 'Use the document URI, not its title.' })
    const client = await connectClient(createMcpBridgeServer('server-1'))
    try {
      expect(client.getInstructions()).toBe('Use the document URI, not its title.')
    } finally {
      await client.close()
    }
  })

  it('omits the progress listener when the client sent no progressToken', async () => {
    mocks.listTools.mockReturnValue([searchTool()])
    mocks.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'done' }] })

    const client = await connectClient(createMcpBridgeServer('server-1'))
    await client.callTool({ name: 'search', arguments: {} })

    // No token means no address to send notifications to, so the runtime must not be
    // handed a listener at all.
    expect(mocks.callTool).toHaveBeenCalledWith(expect.objectContaining({ onProgress: undefined }))
  })

  it('uses a request-captured server snapshot without re-reading the edited database row', () => {
    const capturedServer = { id: 'server-1', name: 'Captured MCP' }

    createMcpBridgeServer('server-1', capturedServer as never)

    expect(mocks.findByIdOrName).not.toHaveBeenCalled()
  })

  it('cancels the upstream call when the client aborts its request', async () => {
    mocks.listTools.mockReturnValue([searchTool()])
    let upstreamSignal: AbortSignal | undefined
    mocks.callTool.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          upstreamSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const client = await connectClient(createMcpBridgeServer('server-1'))
    const controller = new AbortController()
    const call = client.callTool({ name: 'search', arguments: { q: 'x' } }, { signal: controller.signal })
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined())
    controller.abort()
    await expect(call).rejects.toThrow()
    await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true))
    expect(mocks.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'server-1', name: 'search', args: { q: 'x' } })
    )
    await client.close()
  })

  it('proxies prompts/get through McpRuntimeService when prompts are advertised', async () => {
    const client = await connectClient(createMcpBridgeServer('server-1'))
    const result = await client.getPrompt({ name: 'summarize', arguments: { topic: 'release' } })

    expect(mocks.getPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'server-1', name: 'summarize', args: { topic: 'release' } })
    )
    expect(result).toMatchObject({
      description: 'Prompt description',
      messages: [{ role: 'user', content: { type: 'text', text: 'Prompt body' } }]
    })
    await client.close()
  })

  it('lists tools from the cache-only listTools without blocking, stripping bridge-internal fields', async () => {
    mocks.listTools.mockReturnValue([searchTool()])
    const client = await connectClient(createMcpBridgeServer('server-1'))

    expect((await client.listTools()).tools).toEqual([
      { name: 'search', description: 'search desc', inputSchema: { type: 'object', properties: {}, required: [] } }
    ])
    expect(mocks.listTools).toHaveBeenCalledWith('server-1', { includeDisabled: false })
    await client.close()
  })

  it('declares tools.listChanged so the SDK client attaches its re-list handler', async () => {
    const bridge = createMcpBridgeServer('server-1')
    const client = await connectClient(bridge)

    expect(client.getServerCapabilities()?.tools).toEqual({ listChanged: true })

    await client.close()
  })

  it('does not subscribe to cache updates until the session actually initializes', () => {
    createMcpBridgeServer('server-1')
    // A bridge whose query never starts must not leak an emitter subscription.
    expect(mocks.onToolsCacheUpdated).not.toHaveBeenCalled()
  })

  it('relays a cache update as tools/list_changed and serves the refreshed list on re-list', async () => {
    // Proves the bridge's half of the healing loop with a real MCP client over a real
    // transport: initial list empty → cache update → notification received → re-list sees
    // the tools. The other half — the Agent SDK CLI auto-re-listing when it receives the
    // notification — is SDK behavior (verified against 0.3.185) that this test does NOT
    // cover; it stands in with a manual re-list.
    const bridge = createMcpBridgeServer('server-1')
    const client = await connectClient(bridge)

    const notified = new Promise<void>((resolve) => {
      client.setNotificationHandler('notifications/tools/list_changed', async () => resolve())
    })

    // First (per-session) snapshot hits a cold cache: empty.
    expect((await client.listTools()).tools).toEqual([])
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
    const bridge = createMcpBridgeServer('server-1')

    const firstClient = await connectClient(bridge)
    expect(mocks.onToolsCacheUpdated).toHaveBeenCalledTimes(1)
    await firstClient.close()
    await new Promise((resolve) => setImmediate(resolve))
    expect(mocks.onToolsCacheUpdatedDispose).toHaveBeenCalledTimes(1)

    const secondClient = await connectClient(bridge)
    expect(mocks.onToolsCacheUpdated).toHaveBeenCalledTimes(2)

    // The fresh subscription still relays notifications on the new transport.
    const notified = new Promise<void>((resolve) => {
      secondClient.setNotificationHandler('notifications/tools/list_changed', async () => resolve())
    })
    cacheUpdatedListener!({ serverId: 'server-1' })
    await notified

    await secondClient.close()
    await new Promise((resolve) => setImmediate(resolve))
    expect(mocks.onToolsCacheUpdatedDispose).toHaveBeenCalledTimes(2)
  })

  it('ignores cache updates for other servers', async () => {
    const bridge = createMcpBridgeServer('server-1')
    const client = await connectClient(bridge)

    const notificationHandler = vi.fn(async () => {})
    client.setNotificationHandler('notifications/tools/list_changed', notificationHandler)

    cacheUpdatedListener!({ serverId: 'other-server' })
    await new Promise((resolve) => setImmediate(resolve))

    expect(notificationHandler).not.toHaveBeenCalled()

    await client.close()
  })

  it('disposes the cache subscription when the transport closes, and swallows late fires', async () => {
    const bridge = createMcpBridgeServer('server-1')
    const client = await connectClient(bridge)
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

  it('forwards resource templates without leaking Cherry catalog metadata', async () => {
    mocks.listResourceTemplates.mockResolvedValue([
      { name: 'document', uriTemplate: 'docs://documents/{id}', serverId: 'server-1', serverName: 'Docs MCP' }
    ])
    const bridge = createMcpBridgeServer('server-1')
    const client = await connectClient(bridge)
    try {
      expect(await client.listResourceTemplates()).toEqual({
        resourceTemplates: [{ name: 'document', uriTemplate: 'docs://documents/{id}' }]
      })
    } finally {
      await client.close()
    }
  })
})
