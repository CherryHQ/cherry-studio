import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getById = vi.fn()
const listServers = vi.fn()
const listTools = vi.fn()
const runtimeListResources = vi.fn()
const runtimeListPrompts = vi.fn()
const cacheStore = new Map<string, unknown>()
const cacheService = {
  has: vi.fn((key: string) => cacheStore.has(key)),
  get: vi.fn((key: string) => cacheStore.get(key)),
  set: vi.fn((key: string, value: unknown) => cacheStore.set(key, value)),
  delete: vi.fn((key: string) => cacheStore.delete(key)),
  setShared: vi.fn((key: string, value: unknown) => cacheStore.set(key, value)),
  getShared: vi.fn((key: string) => cacheStore.get(key))
}

const runtimeService = {
  getServerKey: vi.fn((server: { id: string }) => `server:${server.id}`),
  withClient: vi.fn(async (_serverId: string, operation: (client: { listTools: typeof listTools }) => unknown) =>
    operation({ listTools })
  ),
  setServerStatus: vi.fn(),
  onToolListChanged: vi.fn(() => ({ dispose: vi.fn() })),
  listResources: runtimeListResources,
  listPrompts: runtimeListPrompts
}

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    CacheService: cacheService,
    McpRuntimeService: runtimeService
  } as Record<string, unknown>)
})

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { getById, list: listServers }
}))

const { McpCatalogService } = await import('../McpCatalogService')

function server(overrides: Record<string, unknown> = {}) {
  return {
    id: 'server-1',
    name: 'docs',
    isActive: true,
    disabledTools: [],
    disabledAutoApproveTools: [],
    ...overrides
  }
}

function sdkTool(name: string) {
  return {
    name,
    description: `${name} desc`,
    inputSchema: { type: 'object', properties: {} }
  }
}

describe('McpCatalogService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    getById.mockReset()
    listServers.mockReset()
    listTools.mockReset()
    runtimeListResources.mockReset()
    runtimeListPrompts.mockReset()
    cacheStore.clear()
    Object.values(cacheService).forEach((mock) => mock.mockClear())
    runtimeService.getServerKey.mockClear()
    runtimeService.withClient.mockClear()
    runtimeService.setServerStatus.mockClear()
    runtimeService.onToolListChanged.mockClear()
  })

  it('refreshTools fetches live and writes the raw catalog to the shared cache', async () => {
    getById.mockReturnValue(server({ disabledTools: ['blocked'] }))
    listTools.mockResolvedValue({ tools: [sdkTool('search'), sdkTool('blocked')] })

    const service = new McpCatalogService()
    await service.refreshTools('server-1')

    expect(runtimeService.withClient).toHaveBeenCalled()
    expect(cacheService.setShared).toHaveBeenCalledWith(
      'mcp.tools.server-1',
      expect.arrayContaining([
        expect.objectContaining({ name: 'search' }),
        expect.objectContaining({ name: 'blocked' })
      ])
    )
    expect(runtimeService.setServerStatus).toHaveBeenCalledWith('server-1', 'connected')
  })

  it('refreshTools clears the shared tools cache for inactive servers', async () => {
    getById.mockReturnValue(server({ isActive: false }))

    const service = new McpCatalogService()
    await service.refreshTools('server-1')

    expect(runtimeService.withClient).not.toHaveBeenCalled()
    expect(cacheService.setShared).toHaveBeenCalledWith('mcp.tools.server-1', [])
    expect(runtimeService.setServerStatus).toHaveBeenCalledWith('server-1', 'disabled')
  })

  it('refreshTools preserves the shared tools cache and marks status on list failure', async () => {
    getById.mockReturnValue(server())
    const error = new Error('connection failed')
    listTools.mockRejectedValue(error)

    const service = new McpCatalogService()

    await expect(service.refreshTools('server-1')).rejects.toThrow('connection failed')
    // Cold failure writes an empty sentinel (not a populated snapshot) so the cache-only
    // hot path reads `[]` instead of `undefined` and stops re-kicking warms on every request.
    expect(cacheService.setShared).toHaveBeenCalledWith('mcp.tools.server-1', [])
    expect(runtimeService.setServerStatus).toHaveBeenCalledWith('server-1', 'error', error)
  })

  it('listToolsWithStatus reports stale (fresh:false) after a cold refresh failure', async () => {
    getById.mockReturnValue(server())
    listTools.mockRejectedValue(new Error('connection failed'))

    const service = new McpCatalogService()
    await expect(service.refreshTools('server-1')).rejects.toThrow('connection failed')

    const result = service.listToolsWithStatus('server-1')
    expect(result).toEqual({ tools: [], fresh: false })
  })

  it('listToolsWithStatus keeps last-known-good tools but reports stale on a refresh failure', async () => {
    cacheStore.set('mcp.tools.server-1', [{ name: 'search' }])
    getById.mockReturnValue(server())
    listTools.mockRejectedValue(new Error('connection failed'))

    const service = new McpCatalogService()
    await expect(service.refreshTools('server-1')).rejects.toThrow('connection failed')

    const result = service.listToolsWithStatus('server-1')
    expect(result).toEqual({ tools: [{ name: 'search' }], fresh: false })
    expect(cacheStore.get('mcp.tools.server-1')).toEqual([{ name: 'search' }])
  })

  it('listToolsWithStatus reports fresh for a successful empty refresh', async () => {
    getById.mockReturnValue(server())
    listTools.mockResolvedValue({ tools: [] })

    const service = new McpCatalogService()
    await service.refreshTools('server-1')

    const result = service.listToolsWithStatus('server-1')
    expect(result).toEqual({ tools: [], fresh: true })
  })

  it('prewarms active server tools into shared cache', async () => {
    listServers.mockReturnValue({ items: [server()], total: 1, page: 1 })
    listTools.mockResolvedValue({ tools: [sdkTool('search')] })

    const service = new McpCatalogService()
    await (service as unknown as { prewarmActiveServerTools(): Promise<void> }).prewarmActiveServerTools()

    expect(listServers).toHaveBeenCalledWith({ isActive: true })
    expect(runtimeService.withClient).toHaveBeenCalled()
    expect(cacheService.setShared).toHaveBeenCalledWith(
      'mcp.tools.server-1',
      expect.arrayContaining([expect.objectContaining({ name: 'search' })])
    )
  })

  it('listTools reads enabled tools from the shared cache without connecting', async () => {
    cacheStore.set('mcp.tools.server-1', [{ name: 'search' }, { name: 'blocked' }])
    getById.mockReturnValue(server({ disabledTools: ['blocked'] }))

    const service = new McpCatalogService()
    const tools = service.listTools('server-1')

    expect(tools.map((tool) => tool.name)).toEqual(['search'])
    expect(runtimeService.withClient).not.toHaveBeenCalled()
  })

  it('listTools returns disabled tools from cache when includeDisabled is true', async () => {
    cacheStore.set('mcp.tools.server-1', [{ name: 'search' }, { name: 'blocked' }])

    const service = new McpCatalogService()
    const tools = service.listTools('server-1', { includeDisabled: true })

    expect(tools.map((tool) => tool.name)).toEqual(['search', 'blocked'])
    expect(getById).not.toHaveBeenCalled()
    expect(runtimeService.withClient).not.toHaveBeenCalled()
  })

  it('listTools fires a one-shot refresh when the server was never warmed (cache undefined)', async () => {
    const service = new McpCatalogService()
    const refreshSpy = vi.spyOn(service, 'refreshTools').mockResolvedValue(undefined)

    expect(service.listTools('server-1')).toEqual([])
    expect(refreshSpy).toHaveBeenCalledExactlyOnceWith('server-1')
  })

  it('listTools cold kick shares the warm single-flight instead of opening a second connection', async () => {
    getById.mockReturnValue(server())
    listTools.mockResolvedValue({ tools: [sdkTool('search')] })

    const service = new McpCatalogService()
    // A session warm and a cache-only read racing on the same cold server.
    const warm = service.warmToolsCache('server-1')
    expect(service.listTools('server-1')).toEqual([])
    await warm

    expect(runtimeService.withClient).toHaveBeenCalledTimes(1)
  })

  it('listTools does not refresh a warmed-but-empty (dead) server cache', async () => {
    cacheStore.set('mcp.tools.server-1', [])
    const service = new McpCatalogService()
    const refreshSpy = vi.spyOn(service, 'refreshTools').mockResolvedValue(undefined)

    expect(service.listTools('server-1')).toEqual([])
    expect(refreshSpy).not.toHaveBeenCalled()
    expect(runtimeService.withClient).not.toHaveBeenCalled()
  })

  it('warmToolsCache awaits a refresh and fills the cache when it is cold (undefined)', async () => {
    getById.mockReturnValue(server())
    listTools.mockResolvedValue({ tools: [sdkTool('search')] })

    const service = new McpCatalogService()
    await service.warmToolsCache('server-1')

    expect(runtimeService.withClient).toHaveBeenCalledTimes(1)
    expect((cacheStore.get('mcp.tools.server-1') as { name: string }[]).map((tool) => tool.name)).toEqual(['search'])
  })

  it('warmToolsCache re-probes a warmed-but-empty cache (dead-server recovery path)', async () => {
    cacheStore.set('mcp.tools.server-1', [])
    getById.mockReturnValue(server())
    listTools.mockResolvedValue({ tools: [sdkTool('search')] })

    const service = new McpCatalogService()
    await service.warmToolsCache('server-1')

    expect(runtimeService.withClient).toHaveBeenCalledTimes(1)
    expect((cacheStore.get('mcp.tools.server-1') as { name: string }[]).map((tool) => tool.name)).toEqual(['search'])
  })

  it('warmToolsCache resolves immediately without refreshing when the cache is populated', async () => {
    cacheStore.set('mcp.tools.server-1', [{ name: 'search' }])

    const service = new McpCatalogService()
    const refreshSpy = vi.spyOn(service, 'refreshTools')
    await service.warmToolsCache('server-1')

    expect(refreshSpy).not.toHaveBeenCalled()
    expect(runtimeService.withClient).not.toHaveBeenCalled()
  })

  it('warmToolsCache resolves and writes an empty sentinel on cold failure (no per-request retry)', async () => {
    getById.mockReturnValue(server())
    listTools.mockRejectedValue(new Error('connection failed'))

    const service = new McpCatalogService()
    await expect(service.warmToolsCache('server-1')).resolves.toBeUndefined()
    // The empty sentinel is written so the cache-only hot path reads `[]` (not `undefined`)
    // and stops re-kicking warms on every request; the in-flight map still coalesces retries.
    expect(cacheStore.has('mcp.tools.server-1')).toBe(true)
    expect(cacheStore.get('mcp.tools.server-1')).toEqual([])
  })

  it('warmToolsCache single-flights concurrent refreshes for the same server', async () => {
    getById.mockReturnValue(server())
    listTools.mockResolvedValue({ tools: [sdkTool('search')] })

    const service = new McpCatalogService()
    await Promise.all([service.warmToolsCache('server-1'), service.warmToolsCache('server-1')])

    expect(runtimeService.withClient).toHaveBeenCalledTimes(1)
  })

  it('onToolsCacheUpdated fires when a refresh changes the cached tool list', async () => {
    getById.mockReturnValue(server())
    listTools.mockResolvedValue({ tools: [sdkTool('search')] })

    const service = new McpCatalogService()
    const listener = vi.fn()
    service.onToolsCacheUpdated(listener)
    await service.refreshTools('server-1')

    expect(listener).toHaveBeenCalledExactlyOnceWith({ serverId: 'server-1' })
  })

  it('onToolsCacheUpdated does not fire when a refresh rewrites identical content', async () => {
    getById.mockReturnValue(server())
    listTools.mockResolvedValue({ tools: [sdkTool('search')] })

    const service = new McpCatalogService()
    const listener = vi.fn()
    service.onToolsCacheUpdated(listener)
    await service.refreshTools('server-1')
    await service.refreshTools('server-1')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('onToolsCacheUpdated does not fire when a cold cache is first written empty', async () => {
    // undefined and [] read identically through cache-only `listTools`, so a failed first
    // refresh must not notify the bridge — there is nothing new for the SDK to re-list.
    getById.mockReturnValue(server())
    listTools.mockRejectedValue(new Error('connection failed'))

    const service = new McpCatalogService()
    const listener = vi.fn()
    service.onToolsCacheUpdated(listener)
    await expect(service.refreshTools('server-1')).rejects.toThrow('connection failed')

    expect(listener).not.toHaveBeenCalled()
  })

  it('onToolsCacheUpdated does not fire when a populated cache survives a refresh failure', async () => {
    cacheStore.set('mcp.tools.server-1', [{ name: 'search' }])
    getById.mockReturnValue(server())
    listTools.mockRejectedValue(new Error('connection failed'))

    const service = new McpCatalogService()
    const listener = vi.fn()
    service.onToolsCacheUpdated(listener)
    await expect(service.refreshTools('server-1')).rejects.toThrow('connection failed')

    expect(listener).not.toHaveBeenCalled()
    expect(cacheStore.get('mcp.tools.server-1')).toEqual([{ name: 'search' }])
  })

  it('delegates listResources to the runtime service', async () => {
    const resources = [{ uri: 'file://a', name: 'a', serverId: 'server-1', serverName: 'docs' }]
    runtimeListResources.mockResolvedValue(resources)

    const service = new McpCatalogService()
    await expect(service.listResources('server-1')).resolves.toBe(resources)
    expect(runtimeListResources).toHaveBeenCalledWith('server-1')
  })

  it('delegates listPrompts to the runtime service', async () => {
    const prompts = [{ id: 'p1', name: 'greet', serverId: 'server-1', serverName: 'docs' }]
    runtimeListPrompts.mockResolvedValue(prompts)

    const service = new McpCatalogService()
    await expect(service.listPrompts('server-1')).resolves.toBe(prompts)
    expect(runtimeListPrompts).toHaveBeenCalledWith('server-1')
  })
})
