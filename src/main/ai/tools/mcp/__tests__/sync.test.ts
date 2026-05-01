import type { Tool } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolRegistry } from '../../registry'
import type { ToolEntry } from '../../types'

const listTools = vi.fn()
const list = vi.fn()

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    // Inject McpService stub
  } as Record<string, unknown>)
})

vi.mock('@main/core/application', async () => {
  return {
    application: {
      get: (name: string) => {
        if (name === 'McpService') return { listTools, callTool: vi.fn() }
        throw new Error(`unexpected service: ${name}`)
      }
    }
  }
})

vi.mock('@main/data/services/McpServerService', () => ({
  mcpServerService: { list }
}))

vi.mock('@main/services/toolApproval/autoApprovePolicy', () => ({
  shouldAutoApprove: () => true
}))

// Import AFTER vi.mock so the mocks bind correctly.
const { syncMcpToolsToRegistry } = await import('../mcpTools')

function mcpTool(serverId: string, name: string, description = '') {
  return {
    id: `mcp__${serverId}__${name}`,
    serverId,
    serverName: serverId,
    name,
    description,
    inputSchema: { type: 'object', properties: {} }
  }
}

function activeServer(id: string, disabledAutoApproveTools: string[] = []) {
  return { id, name: id, isActive: true, disabledAutoApproveTools }
}

describe('syncMcpToolsToRegistry', () => {
  beforeEach(() => {
    listTools.mockReset()
    list.mockReset()
  })

  it('registers tools from every active server', async () => {
    const reg = new ToolRegistry()
    list.mockResolvedValue({ items: [activeServer('s1'), activeServer('s2')] })
    listTools.mockImplementation(async (server: { id: string }) =>
      server.id === 's1' ? [mcpTool('s1', 'a'), mcpTool('s1', 'b')] : [mcpTool('s2', 'c')]
    )

    await syncMcpToolsToRegistry(reg)

    expect(
      reg
        .getAll()
        .map((e) => e.name)
        .sort()
    ).toEqual(['mcp__s1__a', 'mcp__s1__b', 'mcp__s2__c'])
    expect(reg.getByName('mcp__s1__a')?.namespace).toBe('mcp:s1')
    expect(reg.getByName('mcp__s1__a')?.defer).toBe('auto')
  })

  it('deregisters MCP entries no longer present in the snapshot', async () => {
    const reg = new ToolRegistry()
    // Stale entry from an earlier sync — server got removed
    reg.register({
      name: 'mcp__gone__x',
      namespace: 'mcp:gone',
      description: 'stale',
      defer: 'auto',
      tool: { description: '' } as unknown as Tool
    } satisfies ToolEntry)

    list.mockResolvedValue({ items: [activeServer('s1')] })
    listTools.mockResolvedValue([mcpTool('s1', 'a')])

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('mcp__gone__x')).toBeUndefined()
    expect(reg.getByName('mcp__s1__a')).toBeDefined()
  })

  it('replaces an existing entry when the schema changes (drift fix)', async () => {
    const reg = new ToolRegistry()
    list.mockResolvedValue({ items: [activeServer('s1')] })
    listTools.mockResolvedValueOnce([mcpTool('s1', 't', 'v1 desc')])
    await syncMcpToolsToRegistry(reg)
    expect(reg.getByName('mcp__s1__t')?.description).toBe('v1 desc')

    listTools.mockResolvedValueOnce([mcpTool('s1', 't', 'v2 desc')])
    await syncMcpToolsToRegistry(reg)
    expect(reg.getByName('mcp__s1__t')?.description).toBe('v2 desc')
    expect(reg.getAll().filter((e) => e.name === 'mcp__s1__t').length).toBe(1)
  })

  it('does not touch non-MCP entries', async () => {
    const reg = new ToolRegistry()
    reg.register({
      name: 'web__search',
      namespace: 'web',
      description: 'builtin',
      defer: 'never',
      tool: { description: '' } as unknown as Tool
    } satisfies ToolEntry)

    list.mockResolvedValue({ items: [] })
    listTools.mockResolvedValue([])

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('web__search')).toBeDefined()
  })

  it('continues when a single server throws on listTools', async () => {
    const reg = new ToolRegistry()
    list.mockResolvedValue({ items: [activeServer('broken'), activeServer('ok')] })
    listTools.mockImplementation(async (server: { id: string }) => {
      if (server.id === 'broken') throw new Error('connection refused')
      return [mcpTool('ok', 't')]
    })

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('mcp__ok__t')).toBeDefined()
    expect(reg.getAll()).toHaveLength(1)
  })
})
