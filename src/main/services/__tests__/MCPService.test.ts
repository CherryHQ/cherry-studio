import type { MCPServer, MCPTool } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mcpSdkMock = vi.hoisted(() => {
  const clients: Array<InstanceType<typeof Client>> = []
  const state = { failClose: false, failConnect: false }

  class Client {
    close = vi.fn().mockImplementation(async () => {
      if (state.failClose) {
        throw new Error('close failed')
      }
    })
    connect = vi.fn().mockImplementation(async () => {
      if (state.failConnect) {
        throw new Error('connect failed')
      }
    })
    ping = vi.fn().mockResolvedValue(true)
    setNotificationHandler = vi.fn()

    constructor() {
      clients.push(this)
    }
  }

  class SSEClientTransport {}
  class StreamableHTTPClientTransport {}

  return { Client, SSEClientTransport, StreamableHTTPClientTransport, clients, state }
})

vi.mock('@main/apiServer/utils/mcp', () => ({
  getMCPServersFromRedux: vi.fn()
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mcpSdkMock.Client
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: mcpSdkMock.SSEClientTransport
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp', () => ({
  StreamableHTTPClientTransport: mcpSdkMock.StreamableHTTPClientTransport
}))

import { getMCPServersFromRedux } from '@main/apiServer/utils/mcp'
import { CacheService } from '@main/services/CacheService'
import mcpService from '@main/services/MCPService'

const baseInputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] } = {
  type: 'object',
  properties: {},
  required: []
}

const createTool = (overrides: Partial<MCPTool>): MCPTool => ({
  id: `${overrides.serverId}__${overrides.name}`,
  name: overrides.name ?? 'tool',
  description: overrides.description,
  serverId: overrides.serverId ?? 'server',
  serverName: overrides.serverName ?? 'server',
  inputSchema: baseInputSchema,
  type: 'mcp',
  ...overrides
})

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function serverForReplacement(): MCPServer {
  return {
    id: 'replacement-server',
    name: 'replacement-server',
    type: 'streamableHttp',
    baseUrl: 'https://example.com/mcp',
    isActive: true
  }
}

describe('MCPService.listAllActiveServerTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('filters disabled tools per server', async () => {
    const servers: MCPServer[] = [
      {
        id: 'alpha',
        name: 'Alpha',
        isActive: true,
        disabledTools: ['disabled_tool']
      },
      {
        id: 'beta',
        name: 'Beta',
        isActive: true
      }
    ]

    vi.mocked(getMCPServersFromRedux).mockResolvedValue(servers)

    const listToolsSpy = vi.spyOn(mcpService as any, 'listToolsImpl').mockImplementation(async (server: any) => {
      if (server.id === 'alpha') {
        return [
          createTool({ name: 'enabled_tool', serverId: server.id, serverName: server.name }),
          createTool({ name: 'disabled_tool', serverId: server.id, serverName: server.name })
        ]
      }
      return [createTool({ name: 'beta_tool', serverId: server.id, serverName: server.name })]
    })

    const tools = await mcpService.listAllActiveServerTools()

    expect(listToolsSpy).toHaveBeenCalledTimes(2)
    expect(tools.map((tool) => tool.name)).toEqual(['enabled_tool', 'beta_tool'])
  })
})

describe('MCPService client replacement lifecycle (issue #17689)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    CacheService.clear()
    mcpSdkMock.clients.length = 0
    mcpSdkMock.state.failClose = false
    mcpSdkMock.state.failConnect = false
    ;(mcpService as any).clients.clear()
    ;(mcpService as any).pendingClients.clear()
    if ((mcpService as any).clientOperations) {
      ;(mcpService as any).clientOperations.clear()
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('closes a cached client whose ping throws before creating its replacement', async () => {
    const server = serverForReplacement()
    const staleClient = (await mcpService.initClient(server)) as unknown as InstanceType<typeof mcpSdkMock.Client>
    staleClient.ping.mockRejectedValue(new Error('ping timed out'))

    const replacement = await mcpService.initClient(server)

    expect(staleClient.close).toHaveBeenCalledTimes(1)
    expect(replacement).not.toBe(staleClient)
    expect(mcpSdkMock.clients).toHaveLength(2)
  })

  it('coalesces concurrent unhealthy-client checks into one replacement', async () => {
    const server = serverForReplacement()
    const staleClient = (await mcpService.initClient(server)) as unknown as InstanceType<typeof mcpSdkMock.Client>
    const ping = createDeferred<boolean>()
    staleClient.ping.mockImplementation(() => ping.promise)

    const requests = Array.from({ length: 7 }, () => mcpService.initClient(server))
    await new Promise((resolve) => setImmediate(resolve))
    ping.resolve(false)
    const replacements = await Promise.all(requests)

    expect(staleClient.ping).toHaveBeenCalledTimes(1)
    expect(staleClient.close).toHaveBeenCalledTimes(1)
    expect(new Set(replacements).size).toBe(1)
    expect(mcpSdkMock.clients).toHaveLength(2)
  })

  it('does not create a replacement when the stale client cannot be closed', async () => {
    const server = serverForReplacement()
    const staleClient = (await mcpService.initClient(server)) as unknown as InstanceType<typeof mcpSdkMock.Client>
    staleClient.ping.mockResolvedValue(false)
    staleClient.close.mockRejectedValue(new Error('close failed'))

    await expect(mcpService.initClient(server)).rejects.toThrow('close failed')
    expect(mcpSdkMock.clients).toHaveLength(1)
    expect((mcpService as any).clients.get((mcpService as any).getServerKey(server))).toBe(staleClient)
  })

  it('closes a newly created client when activation fails and allows a later retry', async () => {
    const server = serverForReplacement()
    mcpSdkMock.state.failConnect = true

    await expect(mcpService.initClient(server)).rejects.toThrow('connect failed')

    expect(mcpSdkMock.clients).toHaveLength(1)
    expect(mcpSdkMock.clients[0].close).toHaveBeenCalledTimes(1)
    expect((mcpService as any).clientOperations.size).toBe(0)

    mcpSdkMock.state.failConnect = false
    await expect(mcpService.initClient(server)).resolves.toBeInstanceOf(mcpSdkMock.Client)
    expect(mcpSdkMock.clients).toHaveLength(2)
  })

  it('keeps a tracked client when activation cleanup cannot close it', async () => {
    const server = serverForReplacement()
    mcpSdkMock.state.failClose = true
    vi.spyOn(CacheService, 'remove').mockImplementationOnce(() => {
      throw new Error('cache cleanup failed')
    })

    await expect(mcpService.initClient(server)).rejects.toThrow('cache cleanup failed')

    const client = mcpSdkMock.clients[0]
    expect(client.close).toHaveBeenCalledTimes(1)
    expect((mcpService as any).clients.get((mcpService as any).getServerKey(server))).toBe(client)
  })

  it('waits for an in-flight client operation before stopping the server', async () => {
    const server = serverForReplacement()
    const serverKey = (mcpService as any).getServerKey(server)
    const close = vi.fn().mockResolvedValue(undefined)
    const deferred = createDeferred<{ close: typeof close }>()
    const operation = deferred.promise.then((client) => {
      ;(mcpService as any).clients.set(serverKey, client)
      return client
    })
    ;(mcpService as any).clientOperations = new Map([[serverKey, operation]])
    let stopped = false

    const stopPromise = mcpService.stopServer(null as unknown as Electron.IpcMainInvokeEvent, server).then(() => {
      stopped = true
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(stopped).toBe(false)
    deferred.resolve({ close })
    await stopPromise
    expect(close).toHaveBeenCalledTimes(1)
  })
})
