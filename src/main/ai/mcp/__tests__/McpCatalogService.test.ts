import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getById = vi.fn()
const listServers = vi.fn()
const listTools = vi.fn()
const cacheStore = new Map<string, unknown>()
const cacheService = {
  has: vi.fn((key: string) => cacheStore.has(key)),
  get: vi.fn((key: string) => cacheStore.get(key)),
  set: vi.fn((key: string, value: unknown) => cacheStore.set(key, value)),
  delete: vi.fn((key: string) => cacheStore.delete(key)),
  setShared: vi.fn((key: string, value: unknown) => cacheStore.set(key, value))
}

const runtimeService = {
  getServerKey: vi.fn((server: { id: string }) => `server:${server.id}`),
  withClient: vi.fn(async (_serverId: string, operation: (client: { listTools: typeof listTools }) => unknown) =>
    operation({ listTools })
  ),
  setServerStatus: vi.fn(),
  onToolListChanged: vi.fn(() => ({ dispose: vi.fn() }))
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
    cacheStore.clear()
    Object.values(cacheService).forEach((mock) => mock.mockClear())
    runtimeService.getServerKey.mockClear()
    runtimeService.withClient.mockClear()
    runtimeService.setServerStatus.mockClear()
    runtimeService.onToolListChanged.mockClear()
  })

  it('writes raw catalog to shared cache and returns enabled tools by default', async () => {
    getById.mockResolvedValue(server({ disabledTools: ['blocked'] }))
    listTools.mockResolvedValue({ tools: [sdkTool('search'), sdkTool('blocked')] })

    const service = new McpCatalogService()
    const tools = await service.listTools('server-1')

    expect(tools.map((tool) => tool.name)).toEqual(['search'])
    expect(cacheService.setShared).toHaveBeenCalledWith(
      'mcp.tools.server-1',
      expect.arrayContaining([
        expect.objectContaining({ name: 'search' }),
        expect.objectContaining({ name: 'blocked' })
      ])
    )
    expect(runtimeService.setServerStatus).toHaveBeenCalledWith('server-1', 'connected')
  })

  it('returns disabled tools when includeDisabled is true', async () => {
    getById.mockResolvedValue(server({ disabledTools: ['blocked'] }))
    listTools.mockResolvedValue({ tools: [sdkTool('search'), sdkTool('blocked')] })

    const service = new McpCatalogService()
    const tools = await service.listTools('server-1', { includeDisabled: true })

    expect(tools.map((tool) => tool.name)).toEqual(['search', 'blocked'])
  })

  it('clears shared tools cache for inactive servers', async () => {
    getById.mockResolvedValue(server({ isActive: false }))

    const service = new McpCatalogService()
    const tools = await service.listTools('server-1')

    expect(tools).toEqual([])
    expect(runtimeService.withClient).not.toHaveBeenCalled()
    expect(cacheService.setShared).toHaveBeenCalledWith('mcp.tools.server-1', [])
    expect(runtimeService.setServerStatus).toHaveBeenCalledWith('server-1', 'disabled')
  })

  it('clears shared tools cache and marks status on list failure', async () => {
    getById.mockResolvedValue(server())
    const error = new Error('connection failed')
    listTools.mockRejectedValue(error)

    const service = new McpCatalogService()

    await expect(service.listTools('server-1')).rejects.toThrow('connection failed')
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
})
