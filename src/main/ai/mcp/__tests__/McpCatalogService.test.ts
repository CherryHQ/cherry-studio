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
    getById.mockResolvedValue(server({ disabledTools: ['blocked'] }))
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
    getById.mockResolvedValue(server({ isActive: false }))

    const service = new McpCatalogService()
    await service.refreshTools('server-1')

    expect(runtimeService.withClient).not.toHaveBeenCalled()
    expect(cacheService.setShared).toHaveBeenCalledWith('mcp.tools.server-1', [])
    expect(runtimeService.setServerStatus).toHaveBeenCalledWith('server-1', 'disabled')
  })

  it('refreshTools clears the shared tools cache and marks status on list failure', async () => {
    getById.mockResolvedValue(server())
    const error = new Error('connection failed')
    listTools.mockRejectedValue(error)

    const service = new McpCatalogService()

    await expect(service.refreshTools('server-1')).rejects.toThrow('connection failed')
    expect(cacheService.setShared).toHaveBeenCalledWith('mcp.tools.server-1', [])
    expect(runtimeService.setServerStatus).toHaveBeenCalledWith('server-1', 'error', error)
  })

  it('prewarms active server tools into shared cache', async () => {
    listServers.mockResolvedValue({ items: [server()], total: 1, page: 1 })
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
    getById.mockResolvedValue(server({ disabledTools: ['blocked'] }))

    const service = new McpCatalogService()
    const tools = await service.listTools('server-1')

    expect(tools.map((tool) => tool.name)).toEqual(['search'])
    expect(runtimeService.withClient).not.toHaveBeenCalled()
  })

  it('listTools returns disabled tools from cache when includeDisabled is true', async () => {
    cacheStore.set('mcp.tools.server-1', [{ name: 'search' }, { name: 'blocked' }])

    const service = new McpCatalogService()
    const tools = await service.listTools('server-1', { includeDisabled: true })

    expect(tools.map((tool) => tool.name)).toEqual(['search', 'blocked'])
    expect(getById).not.toHaveBeenCalled()
    expect(runtimeService.withClient).not.toHaveBeenCalled()
  })

  it('listTools fires a one-shot refresh when the server was never warmed (cache undefined)', async () => {
    const service = new McpCatalogService()
    const refreshSpy = vi.spyOn(service, 'refreshTools').mockResolvedValue(undefined)

    await expect(service.listTools('server-1')).resolves.toEqual([])
    expect(refreshSpy).toHaveBeenCalledExactlyOnceWith('server-1')
  })

  it('listTools does not refresh a warmed-but-empty (dead) server cache', async () => {
    cacheStore.set('mcp.tools.server-1', [])
    const service = new McpCatalogService()
    const refreshSpy = vi.spyOn(service, 'refreshTools').mockResolvedValue(undefined)

    await expect(service.listTools('server-1')).resolves.toEqual([])
    expect(refreshSpy).not.toHaveBeenCalled()
    expect(runtimeService.withClient).not.toHaveBeenCalled()
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
