import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findByIdOrName: vi.fn(),
  applicationGet: vi.fn(),
  listToolsForSnapshot: vi.fn(),
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

describe('createSdkMcpServerInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findByIdOrName.mockReturnValue({ id: 'server-1', name: 'Docs MCP' })
    mocks.listToolsForSnapshot.mockResolvedValue([])
    mocks.listPrompts.mockResolvedValue([])
    mocks.getPrompt.mockResolvedValue({
      description: 'Prompt description',
      messages: [{ role: 'user', content: { type: 'text', text: 'Prompt body' } }]
    })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'McpCatalogService')
        return { listToolsForSnapshot: mocks.listToolsForSnapshot, listPrompts: mocks.listPrompts }
      if (name === 'McpRuntimeService') return { getPrompt: mocks.getPrompt }
      throw new Error(`Unexpected application.get(${name})`)
    })
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

  it('lists tools via McpCatalogService.listToolsForSnapshot, stripping bridge-internal fields', async () => {
    mocks.listToolsForSnapshot.mockResolvedValue([
      {
        name: 'search',
        description: 'search desc',
        inputSchema: { type: 'object', properties: {}, required: [] },
        id: 'search-id',
        serverId: 'server-1',
        serverName: 'Docs MCP',
        type: 'mcp'
      }
    ])

    const sdkServer = createSdkMcpServerInstance('server-1')
    const handlers = (sdkServer.server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers
    const handler = handlers.get('tools/list')

    expect(handler).toBeDefined()

    const result = await handler!({ method: 'tools/list' }, {})

    expect(mocks.listToolsForSnapshot).toHaveBeenCalledWith('server-1', { includeDisabled: false })
    expect(result).toEqual({
      tools: [
        { name: 'search', description: 'search desc', inputSchema: { type: 'object', properties: {}, required: [] } }
      ]
    })
  })

  it('returns an empty tool list rather than stalling when the snapshot never resolves', async () => {
    // A cold cache + dead/slow server makes listToolsForSnapshot hang on the live connect. The bridge
    // must cap that wait so the SDK's per-session tool snapshot can't stall agent startup.
    mocks.listToolsForSnapshot.mockReturnValue(new Promise<never>(() => {}))

    const sdkServer = createSdkMcpServerInstance('server-1')
    const handlers = (sdkServer.server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers
    const handler = handlers.get('tools/list')!

    vi.useFakeTimers()
    try {
      const result = handler({ method: 'tools/list' }, {})
      // Advance past SNAPSHOT_LIST_TIMEOUT_MS (3_000ms) so the bounded race resolves via timeout.
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(result).resolves.toEqual({ tools: [] })
    } finally {
      vi.useRealTimers()
    }
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
