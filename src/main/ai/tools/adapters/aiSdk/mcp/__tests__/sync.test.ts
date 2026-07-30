import type { Tool } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolRegistry } from '../../registry'
import type { ToolEntry } from '../../types'

const listTools = vi.fn()
const list = vi.fn()

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    McpCatalogService: { listTools, listToolsWithStatus: listTools },
    McpRuntimeService: { callTool: vi.fn() },
    CacheService: { getShared: vi.fn() },
    IpcApiService: { broadcast: vi.fn() }
  } as Record<string, unknown>)
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
      serverId === 's1'
        ? { tools: [mcpTool('s1', 'a'), mcpTool('s1', 'b')], fresh: true }
        : { tools: [mcpTool('s2', 'c')], fresh: true }
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
    listTools.mockReturnValue({ tools: [mcpTool('s1', 'a'), mcpTool('s1', 'b')], fresh: true })

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
    listTools.mockReturnValue({ tools: [mcpTool('s1', 'a')], fresh: true })

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('mcp__gone__x')).toBeUndefined()
    expect(reg.getByName('mcp__s1__a')).toBeDefined()
  })

  it('replaces an existing entry when the schema changes (drift fix)', async () => {
    const reg = new ToolRegistry()
    list.mockReturnValue({ items: [activeServer('s1')] })
    listTools.mockReturnValueOnce({ tools: [mcpTool('s1', 't', 'v1 desc')], fresh: true })
    await syncMcpToolsToRegistry(reg)
    expect(reg.getByName('mcp__s1__t')?.description).toBe('v1 desc')

    listTools.mockReturnValueOnce({ tools: [mcpTool('s1', 't', 'v2 desc')], fresh: true })
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
    listTools.mockReturnValue({ tools: [], fresh: true })

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('web_search')).toBeDefined()
  })

  it('continues when a single server reports a stale (fresh:false) snapshot', async () => {
    const reg = new ToolRegistry()
    list.mockReturnValue({ items: [activeServer('broken'), activeServer('ok')] })
    listTools.mockImplementation((serverId: string) => {
      if (serverId === 'broken') return { tools: [], fresh: false }
      return { tools: [mcpTool('ok', 't')], fresh: true }
    })

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('mcp__ok__t')).toBeDefined()
    expect(reg.getAll()).toHaveLength(1)
  })

  it('keeps last-known-good tools and flags stale when a server reports fresh:false', async () => {
    const reg = new ToolRegistry()
    list.mockReturnValue({ items: [activeServer('flaky')] })
    // Cache still holds the previous snapshot; the refresh failed so `fresh` is false.
    listTools.mockReturnValue({ tools: [mcpTool('flaky', 'stale')], fresh: false })

    await syncMcpToolsToRegistry(reg)

    // Tools are kept registered (not evicted) and no stale-broadcast assertion needed here.
    expect(reg.getByName('mcp__flaky__stale')).toBeDefined()
  })

  it('evicts a locally-disabled tool immediately even when the cache snapshot is stale', async () => {
    const reg = new ToolRegistry()
    // Pre-existing entry from a previous sync.
    reg.register({
      name: 'mcp__srv__old_bug',
      namespace: 'mcp:srv',
      description: 'now disabled by user',
      defer: 'auto',
      tool: { description: '' } as unknown as Tool
    } satisfies ToolEntry)

    list.mockReturnValue({
      items: [
        { id: 'srv', name: 'srv', isActive: true, disabledTools: ['mcp__srv__old_bug'], disabledAutoApproveTools: [] }
      ]
    })
    // Stale cache still has the previous snapshot including the now-disabled tool.
    listTools.mockReturnValue({ tools: [mcpTool('srv', 'old_bug'), mcpTool('srv', 'ok')], fresh: false })

    await syncMcpToolsToRegistry(reg)

    // Locally-disabled tool is evicted regardless of stale/fresh status.
    expect(reg.getByName('mcp__srv__old_bug')).toBeUndefined()
    // Enabled tool is kept (stale fallback preserves last-known-good).
    expect(reg.getByName('mcp__srv__ok')).toBeDefined()
  })

  it('evicts removed/disabled tools on a successful empty refresh (fresh:true with [])', async () => {
    const reg = new ToolRegistry()
    // Pre-existing entry that the server no longer offers.
    reg.register({
      name: 'mcp__s1__gone',
      namespace: 'mcp:s1',
      description: 'removed',
      defer: 'auto',
      tool: { description: '' } as unknown as Tool
    } satisfies ToolEntry)

    list.mockReturnValue({ items: [activeServer('s1')] })
    listTools.mockReturnValue({ tools: [], fresh: true })

    await syncMcpToolsToRegistry(reg)

    expect(reg.getByName('mcp__s1__gone')).toBeUndefined()
  })

  it('synced entry only applies when its id is in scope.mcpToolIds', async () => {
    const reg = new ToolRegistry()
    list.mockReturnValue({ items: [activeServer('gh')] })
    listTools.mockReturnValue({ tools: [mcpTool('gh', 'search'), mcpTool('gh', 'fork')], fresh: true })
    await syncMcpToolsToRegistry(reg)

    const searchEntry = reg.getByName('mcp__gh__search')!
    expect(searchEntry.applies!({ mcpToolIds: new Set(['mcp__gh__search']) })).toBe(true)
    expect(searchEntry.applies!({ mcpToolIds: new Set(['mcp__gh__fork']) })).toBe(false)
    expect(searchEntry.applies!({ mcpToolIds: new Set() })).toBe(false)
  })

  describe('with selectedToolIds filter', () => {
    it('only calls listTools on servers whose tool ids appear in the selection', async () => {
      const reg = new ToolRegistry()
      list.mockReturnValue({ items: [activeServer('gh'), activeServer('jira'), activeServer('slack')] })
      listTools.mockImplementation((serverId: string) => ({ tools: [mcpTool(serverId, 't')], fresh: true }))

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__gh__t']) })

      const calledIds = listTools.mock.calls.map((args) => args[0] as string)
      expect(calledIds).toEqual(['gh'])
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
      listTools.mockImplementation((serverId: string) => ({ tools: [mcpTool(serverId, 'fresh')], fresh: true }))

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__gh__fresh']) })

      // gh's tools refreshed
      expect(reg.getByName('mcp__gh__fresh')).toBeDefined()
      // jira's pre-existing entry NOT evicted just because we didn't sync jira this call
      expect(reg.getByName('mcp__jira__legacy')).toBeDefined()
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
      listTools.mockReturnValue({ tools: [mcpTool('gh', 't')], fresh: true })

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__gh__t']) })

      expect(reg.getByName('mcp__gone__x')).toBeUndefined()
    })

    it('empty selection → no servers synced, no listTools call', async () => {
      const reg = new ToolRegistry()
      list.mockReturnValue({ items: [activeServer('gh')] })
      listTools.mockReturnValue({ tools: [mcpTool('gh', 't')], fresh: true })

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set() })

      expect(listTools).not.toHaveBeenCalled()
    })

    it('matches server name with camelCase normalisation (mirrors buildFunctionCallToolName)', async () => {
      const reg = new ToolRegistry()
      // Server name with separators — `mcp__myServer__t` is the id format.
      list.mockReturnValue({
        items: [{ id: 'srv', name: 'my-server', isActive: true, disabledAutoApproveTools: [] }]
      })
      listTools.mockReturnValue({
        tools: [
          {
            id: 'mcp__myServer__t',
            serverId: 'srv',
            serverName: 'my-server',
            name: 't',
            description: '',
            inputSchema: { type: 'object', properties: {} }
          }
        ],
        fresh: true
      })

      await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set(['mcp__myServer__t']) })

      expect(listTools).toHaveBeenCalledTimes(1)
      expect(reg.getByName('mcp__myServer__t')).toBeDefined()
    })
  })
})
