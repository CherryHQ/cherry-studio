import type { Tool } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolRegistry } from '../../registry'
import type { ToolEntry } from '../../types'

const listTools = vi.fn()
const list = vi.fn()

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    McpCatalogService: { listTools },
    McpRuntimeService: { callTool: vi.fn() }
  } as Record<string, unknown>)
})

vi.mock('@application', async () => {
  return {
    application: {
      get: (name: string) => {
        if (name === 'McpCatalogService') return { listTools }
        if (name === 'McpRuntimeService') return { callTool: vi.fn() }
        throw new Error(`unexpected service: ${name}`)
      }
    }
  }
})

vi.mock('@main/data/services/McpServerService', () => ({
  mcpServerService: { list }
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
    list.mockReturnValue({ items: [activeServer('s1'), activeServer('s2')] })
    listTools.mockImplementation((serverId: string) =>
      serverId === 's1' ? [mcpTool('s1', 'a'), mcpTool('s1', 'b')] : [mcpTool('s2', 'c')]
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

  it('marks a force-prompt (approval-gated) tool defer:never so it stays inline for the SDK gate', async () => {
    const reg = new ToolRegistry()
    // Server disables auto-approve for tool 'a' (force-prompt); 'b' stays auto-approve.
    list.mockReturnValue({ items: [activeServer('s1', ['a'])] })
    listTools.mockReturnValue([mcpTool('s1', 'a'), mcpTool('s1', 'b')])

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('mcp__s1__a')?.defer).toBe('never')
    expect(reg.getByName('mcp__s1__b')?.defer).toBe('auto')
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

    list.mockReturnValue({ items: [activeServer('s1')] })
    listTools.mockReturnValue([mcpTool('s1', 'a')])

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('mcp__gone__x')).toBeUndefined()
    expect(reg.getByName('mcp__s1__a')).toBeDefined()
  })

  it('replaces an existing entry when the schema changes (drift fix)', async () => {
    const reg = new ToolRegistry()
    list.mockReturnValue({ items: [activeServer('s1')] })
    listTools.mockReturnValueOnce([mcpTool('s1', 't', 'v1 desc')])
    await syncMcpToolsToRegistry(reg)
    expect(reg.getByName('mcp__s1__t')?.description).toBe('v1 desc')

    listTools.mockReturnValueOnce([mcpTool('s1', 't', 'v2 desc')])
    await syncMcpToolsToRegistry(reg)
    expect(reg.getByName('mcp__s1__t')?.description).toBe('v2 desc')
    expect(reg.getAll().filter((e) => e.name === 'mcp__s1__t').length).toBe(1)
  })

  it('does not touch non-MCP entries', async () => {
    const reg = new ToolRegistry()
    reg.register({
      name: 'web_search',
      namespace: 'web',
      description: 'builtin',
      defer: 'never',
      tool: { description: '' } as unknown as Tool
    } satisfies ToolEntry)

    list.mockReturnValue({ items: [] })
    listTools.mockReturnValue([])

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('web_search')).toBeDefined()
  })

  it('continues when a single server throws on listTools', async () => {
    const reg = new ToolRegistry()
    list.mockReturnValue({ items: [activeServer('broken'), activeServer('ok')] })
    listTools.mockImplementation((serverId: string) => {
      if (serverId === 'broken') throw new Error('connection refused')
      return [mcpTool('ok', 't')]
    })

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('mcp__ok__t')).toBeDefined()
    expect(reg.getAll()).toHaveLength(1)
  })

  it('synced entry only applies when its id is in scope.mcpToolIds', async () => {
    const reg = new ToolRegistry()
    list.mockReturnValue({ items: [activeServer('gh')] })
    listTools.mockReturnValue([mcpTool('gh', 'search'), mcpTool('gh', 'fork')])
    await syncMcpToolsToRegistry(reg)

    const searchEntry = reg.getByName('mcp__gh__search')!
    expect(searchEntry.applies!({ mcpToolIds: new Set(['mcp__gh__search']) })).toBe(true)
    expect(searchEntry.applies!({ mcpToolIds: new Set(['mcp__gh__fork']) })).toBe(false)
    expect(searchEntry.applies!({ mcpToolIds: new Set() })).toBe(false)
  })

  it('excludes distinct identities sharing one wire id while keeping unrelated tools', async () => {
    const reg = new ToolRegistry()
    const collisionId = 'mcp__collision'
    list.mockReturnValue({ items: [activeServer('server-a'), activeServer('server-b')] })
    listTools.mockImplementation((serverId: string) =>
      serverId === 'server-a'
        ? [{ ...mcpTool('server-a', 'first'), id: collisionId }, mcpTool('server-a', 'safe')]
        : [{ ...mcpTool('server-b', 'second'), id: collisionId }]
    )

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName(collisionId)).toBeUndefined()
    expect(reg.getByName('mcp__server-a__safe')).toBeDefined()
  })

  it('deduplicates repeated descriptors for the same identity', async () => {
    const reg = new ToolRegistry()
    const duplicate = mcpTool('server-a', 'query')
    list.mockReturnValue({ items: [activeServer('server-a')] })
    listTools.mockReturnValue([duplicate, duplicate])

    await syncMcpToolsToRegistry(reg)

    expect(reg.getAll().filter((entry) => entry.name === duplicate.id)).toHaveLength(1)
  })

  describe('with selectedToolIds filter', () => {
    it('scans every active server cache and registers only the selected id', async () => {
      const reg = new ToolRegistry()
      list.mockReturnValue({ items: [activeServer('gh'), activeServer('jira'), activeServer('slack')] })
      listTools.mockImplementation((serverId: string) => [mcpTool(serverId, 't')])

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__gh__t']) })

      const calledIds = listTools.mock.calls.map((args) => args[0] as string)
      expect(calledIds).toEqual(['gh', 'jira', 'slack'])
      expect(reg.getAll().map((entry) => entry.name)).toEqual(['mcp__gh__t'])
    })

    it('matches selected ids against catalog entries instead of normalized server names', async () => {
      const reg = new ToolRegistry()
      const reimbursement = { ...mcpTool('server-a', 'executeSql'), id: 'mcp__mysql__executeSql_a' }
      const elevator = { ...mcpTool('server-b', 'executeSql'), id: 'mcp__mysql__executeSql_b' }
      list.mockReturnValue({
        items: [
          { ...activeServer('server-a'), name: 'mysql_报销' },
          { ...activeServer('server-b'), name: 'mysql_电梯' }
        ]
      })
      listTools.mockImplementation((serverId: string) => (serverId === 'server-a' ? [reimbursement] : [elevator]))

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set([reimbursement.id]) })

      expect(listTools.mock.calls.map(([serverId]) => serverId)).toEqual(['server-a', 'server-b'])
      expect(reg.getByName(reimbursement.id)?.namespace).toBe('mcp:server-a')
      expect(reg.getByName(elevator.id)).toBeUndefined()
    })

    it('keeps entries from active-but-unselected servers untouched (no eviction within other namespaces)', async () => {
      const reg = new ToolRegistry()
      // Pre-existing entry from an earlier broad sync of 'jira'.
      reg.register({
        name: 'mcp__jira__legacy',
        namespace: 'mcp:jira',
        description: 'pre-existing jira tool',
        defer: 'auto',
        tool: { description: '' } as unknown as Tool
      } satisfies ToolEntry)

      list.mockReturnValue({ items: [activeServer('gh'), activeServer('jira')] })
      listTools.mockImplementation((serverId: string) => [mcpTool(serverId, 'fresh')])

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__gh__fresh']) })

      // gh's tools refreshed
      expect(reg.getByName('mcp__gh__fresh')).toBeDefined()
      // jira's pre-existing entry NOT evicted just because we didn't sync jira this call
      expect(reg.getByName('mcp__jira__legacy')).toBeDefined()
    })

    it('keeps tools selected by overlapping requests for the same server', async () => {
      const reg = new ToolRegistry()
      list.mockReturnValue({ items: [activeServer('gh')] })
      listTools.mockReturnValue([mcpTool('gh', 'search'), mcpTool('gh', 'fork')])

      await Promise.all([
        syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__gh__search']) }),
        syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__gh__fork']) })
      ])

      expect(reg.getByName('mcp__gh__search')).toBeDefined()
      expect(reg.getByName('mcp__gh__fork')).toBeDefined()
    })

    it('still evicts entries from servers that are no longer active (stale-server cleanup runs globally)', async () => {
      const reg = new ToolRegistry()
      reg.register({
        name: 'mcp__gone__x',
        namespace: 'mcp:gone',
        description: 'stale',
        defer: 'auto',
        tool: { description: '' } as unknown as Tool
      } satisfies ToolEntry)

      list.mockReturnValue({ items: [activeServer('gh')] })
      listTools.mockReturnValue([mcpTool('gh', 't')])

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__gh__t']) })

      expect(reg.getByName('mcp__gone__x')).toBeUndefined()
    })

    it('empty selection → no servers synced, no listTools call', async () => {
      const reg = new ToolRegistry()
      list.mockReturnValue({ items: [activeServer('gh')] })
      listTools.mockReturnValue([mcpTool('gh', 't')])

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set() })

      expect(listTools).not.toHaveBeenCalled()
    })

    it('registers an exact selected id containing readable camelCase slugs', async () => {
      const reg = new ToolRegistry()
      list.mockReturnValue({
        items: [{ id: 'srv', name: 'my-server', isActive: true, disabledAutoApproveTools: [] }]
      })
      listTools.mockReturnValue([
        {
          id: 'mcp__myServer__t',
          serverId: 'srv',
          serverName: 'my-server',
          name: 't',
          description: '',
          inputSchema: { type: 'object', properties: {} }
        }
      ])

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__myServer__t']) })

      expect(listTools).toHaveBeenCalledTimes(1)
      expect(reg.getByName('mcp__myServer__t')).toBeDefined()
    })
  })
})
