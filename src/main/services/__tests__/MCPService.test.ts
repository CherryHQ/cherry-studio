import type { MCPServer, MCPTool } from '@types'
import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/apiServer/utils/mcp', () => ({
  getMCPServersFromRedux: vi.fn()
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

vi.mock('@main/services/ProxyManager', () => {
  const emitter = new EventEmitter()
  return { proxyManager: emitter }
})

import { getMCPServersFromRedux } from '@main/apiServer/utils/mcp'
import mcpService from '@main/services/MCPService'
import { proxyManager } from '@main/services/ProxyManager'

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

describe('MCPService proxy invalidation (regression for #14454)', () => {
  beforeEach(() => {
    ;(mcpService as any).clients.clear()
    ;(mcpService as any).clientServerTypes.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const seedClient = (key: string, type: string) => {
    const close = vi.fn().mockResolvedValue(undefined)
    ;(mcpService as any).clients.set(key, { close })
    ;(mcpService as any).clientServerTypes.set(key, type)
    return close
  }

  it('closes only network-backed clients on proxy change', async () => {
    const closeStreamable = seedClient('http-1', 'streamableHttp')
    const closeSse = seedClient('http-2', 'sse')
    const closeHttp = seedClient('http-3', 'http')
    const closeStdio = seedClient('stdio-1', 'stdio')
    const closeInMemory = seedClient('inmem-1', 'inmemory')

    await (mcpService as any).invalidateNetworkClients()

    expect(closeStreamable).toHaveBeenCalledOnce()
    expect(closeSse).toHaveBeenCalledOnce()
    expect(closeHttp).toHaveBeenCalledOnce()
    expect(closeStdio).not.toHaveBeenCalled()
    expect(closeInMemory).not.toHaveBeenCalled()

    // closeClient() removes entries from both maps; verify cleanup.
    expect((mcpService as any).clients.has('http-1')).toBe(false)
    expect((mcpService as any).clients.has('http-2')).toBe(false)
    expect((mcpService as any).clients.has('http-3')).toBe(false)
    expect((mcpService as any).clients.has('stdio-1')).toBe(true)
    expect((mcpService as any).clients.has('inmem-1')).toBe(true)
    expect((mcpService as any).clientServerTypes.has('http-1')).toBe(false)
    expect((mcpService as any).clientServerTypes.has('stdio-1')).toBe(true)
  })

  it('reacts to a proxyManager change event', async () => {
    const closeStreamable = seedClient('streamable-evt', 'streamableHttp')
    const closeStdio = seedClient('stdio-evt', 'stdio')

    ;(proxyManager as unknown as EventEmitter).emit('change', { mode: 'direct' })
    // The handler is async; flush the microtask queue.
    await new Promise((resolve) => setImmediate(resolve))

    expect(closeStreamable).toHaveBeenCalledOnce()
    expect(closeStdio).not.toHaveBeenCalled()
  })

  it('is a no-op when there are no clients to invalidate', async () => {
    await expect((mcpService as any).invalidateNetworkClients()).resolves.toBeUndefined()
  })
})
