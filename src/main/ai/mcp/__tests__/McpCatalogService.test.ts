import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerDebug } = vi.hoisted(() => ({ loggerDebug: vi.fn() }))
const getById = vi.fn()
const listServers = vi.fn()
const listTools = vi.fn()
const getServerCapabilities = vi.fn<() => Record<string, unknown> | undefined>()
const runtimeListResources = vi.fn()
const runtimeListPrompts = vi.fn()
const cacheStore = new Map<string, unknown>()
const cacheExpirations = new Map<string, number>()
const readCache = (key: string) => {
  const expiresAt = cacheExpirations.get(key)
  if (expiresAt !== undefined && expiresAt <= Date.now()) {
    cacheStore.delete(key)
    cacheExpirations.delete(key)
  }
  return cacheStore.get(key)
}
const cacheService = {
  has: vi.fn((key: string) => readCache(key) !== undefined),
  get: vi.fn((key: string) => readCache(key)),
  set: vi.fn((key: string, value: unknown, ttl?: number) => {
    cacheStore.set(key, value)
    if (ttl !== undefined) cacheExpirations.set(key, Date.now() + ttl)
  }),
  delete: vi.fn((key: string) => {
    cacheExpirations.delete(key)
    return cacheStore.delete(key)
  }),
  setShared: vi.fn((key: string, value: unknown) => cacheStore.set(key, value)),
  getShared: vi.fn((key: string) => cacheStore.get(key))
}

const runtimeService = {
  getServerKey: vi.fn((server: { id: string }) => `server:${server.id}`),
  withClient: vi.fn(
    async (
      _serverId: string,
      operation: (client: {
        listTools: typeof listTools
        getServerCapabilities: typeof getServerCapabilities
      }) => unknown
    ) => operation({ listTools, getServerCapabilities })
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

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: loggerDebug,
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
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
    getServerCapabilities.mockReset()
    getServerCapabilities.mockReturnValue({ tools: {} })
    loggerDebug.mockReset()
    runtimeListResources.mockReset()
    runtimeListPrompts.mockReset()
    cacheStore.clear()
    cacheExpirations.clear()
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

  it('mints distinct ids for non-ASCII server names with the same readable slug', async () => {
    getById.mockImplementation((id: string) =>
      id === 'server-a' ? server({ id, name: 'mysql_报销' }) : server({ id, name: 'mysql_电梯' })
    )
    listTools.mockResolvedValue({ tools: [sdkTool('executeSql')] })

    const service = new McpCatalogService()
    await service.refreshTools('server-a')
    await service.refreshTools('server-b')

    const first = service.listTools('server-a', { includeDisabled: true })[0]
    const second = service.listTools('server-b', { includeDisabled: true })[0]
    expect(first.id).not.toBe(second.id)
    expect(first.serverId).toBe('server-a')
    expect(second.serverId).toBe('server-b')
  })

  it('mints distinct ids for non-ASCII tool names from one server', async () => {
    getById.mockReturnValue(server({ id: 'ocr-server', name: 'ocr' }))
    listTools.mockResolvedValue({ tools: [sdkTool('识别身份证'), sdkTool('识别发票')] })

    const service = new McpCatalogService()
    await service.refreshTools('ocr-server')

    const tools = service.listTools('ocr-server', { includeDisabled: true })
    expect(tools[0].id).not.toBe(tools[1].id)
  })

  it('starts a prompts/resources-only server instead of failing on tools/list', async () => {
    // A server declaring no `tools` answers tools/list with -32601; sending it anyway surfaced as
    // "start failed" and left the server impossible to enable, resources and prompts included.
    getById.mockReturnValue(server())
    getServerCapabilities.mockReturnValue({ prompts: {}, resources: {} })

    const service = new McpCatalogService()
    await expect(service.refreshTools('server-1')).resolves.toBeUndefined()

    expect(listTools).not.toHaveBeenCalled()
    expect(cacheService.setShared).toHaveBeenCalledWith('mcp.tools.server-1', [])
  })

  it('refreshTools clears the shared tools cache for inactive servers', async () => {
    getById.mockReturnValue(server({ isActive: false }))

    const service = new McpCatalogService()
    await service.refreshTools('server-1')

    expect(runtimeService.withClient).not.toHaveBeenCalled()
    expect(cacheService.setShared).toHaveBeenCalledWith('mcp.tools.server-1', [])
    expect(runtimeService.setServerStatus).toHaveBeenCalledWith('server-1', 'disabled')
  })

  it('refreshTools clears the shared tools cache and marks status on list failure', async () => {
    getById.mockReturnValue(server())
    const error = new Error('connection failed')
    listTools.mockRejectedValue(error)

    const service = new McpCatalogService()

    await expect(service.refreshTools('server-1')).rejects.toThrow('connection failed')
    expect(cacheService.setShared).toHaveBeenCalledWith('mcp.tools.server-1', [])
    expect(runtimeService.setServerStatus).toHaveBeenCalledWith('server-1', 'error', error)
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

  it('does not re-probe a confirmed empty server on every warm', async () => {
    getById.mockReturnValue(server())
    listTools.mockResolvedValue({ tools: [] })
    const service = new McpCatalogService()

    await service.warmToolsCache('server-1')
    await service.warmToolsCache('server-1')

    expect(runtimeService.withClient).toHaveBeenCalledTimes(1)
    expect(loggerDebug).toHaveBeenCalledWith('Skipping MCP tools warm during retry backoff', { serverId: 'server-1' })
  })

  it('clears the retry deadline when the shared tools cache is explicitly cleared', async () => {
    getById.mockReturnValue(server())
    listTools.mockResolvedValueOnce({ tools: [] }).mockResolvedValueOnce({ tools: [sdkTool('search')] })
    const service = new McpCatalogService()

    await service.warmToolsCache('server-1')
    service.clearSharedToolsCache('server-1')
    await service.warmToolsCache('server-1')

    expect(runtimeService.withClient).toHaveBeenCalledTimes(2)
  })

  it('re-probes a confirmed empty server after the retry window', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      getById.mockReturnValue(server())
      listTools.mockResolvedValue({ tools: [] })
      const service = new McpCatalogService()

      await service.warmToolsCache('server-1')
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      await service.warmToolsCache('server-1')

      expect(runtimeService.withClient).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('warmToolsCache resolves immediately without refreshing when the cache is populated', async () => {
    cacheStore.set('mcp.tools.server-1', [{ name: 'search' }])

    const service = new McpCatalogService()
    const refreshSpy = vi.spyOn(service, 'refreshTools')
    await service.warmToolsCache('server-1')

    expect(refreshSpy).not.toHaveBeenCalled()
    expect(runtimeService.withClient).not.toHaveBeenCalled()
  })

  it('warmToolsCache resolves and leaves a warmed-but-empty cache when the refresh fails', async () => {
    getById.mockReturnValue(server())
    listTools.mockRejectedValue(new Error('connection failed'))

    const service = new McpCatalogService()
    await expect(service.warmToolsCache('server-1')).resolves.toBeUndefined()
    expect(cacheStore.get('mcp.tools.server-1')).toEqual([])
  })

  it('backs off a failed warm before retrying', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      getById.mockReturnValue(server())
      listTools.mockRejectedValue(new Error('connection failed'))
      const service = new McpCatalogService()

      await service.warmToolsCache('server-1')
      await service.warmToolsCache('server-1')
      expect(runtimeService.withClient).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(30 * 1000)
      await service.warmToolsCache('server-1')
      expect(runtimeService.withClient).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
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

  it('onToolsCacheUpdated fires when a populated cache degrades to empty', async () => {
    cacheStore.set('mcp.tools.server-1', [{ name: 'search' }])
    getById.mockReturnValue(server())
    listTools.mockRejectedValue(new Error('connection failed'))

    const service = new McpCatalogService()
    const listener = vi.fn()
    service.onToolsCacheUpdated(listener)
    await expect(service.refreshTools('server-1')).rejects.toThrow('connection failed')

    expect(listener).toHaveBeenCalledExactlyOnceWith({ serverId: 'server-1' })
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
