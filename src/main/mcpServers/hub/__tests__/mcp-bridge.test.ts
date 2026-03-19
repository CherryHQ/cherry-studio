import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/MCPService', () => ({
  default: {
    listAllActiveServerTools: vi.fn(async () => []),
    callToolById: vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] })),
    abortTool: vi.fn(async () => true)
  }
}))

import { clearToolMap, resolveHubToolName, resolveHubToolNameAsync, syncToolMapFromTools } from '../mcp-bridge'

describe('resolveHubToolName', () => {
  beforeEach(() => {
    clearToolMap()
  })

  afterEach(() => {
    clearToolMap()
    vi.clearAllMocks()
  })

  it('returns null when mapping is not initialized', () => {
    expect(resolveHubToolName('githubSearchRepos')).toBeNull()
  })

  it('resolves JS name to serverId and toolName', () => {
    syncToolMapFromTools([
      {
        id: 'github__search_repos',
        name: 'search_repos',
        serverId: 'github',
        serverName: 'GitHub',
        description: '',
        inputSchema: { type: 'object' as const },
        type: 'mcp'
      },
      {
        id: 'database__query',
        name: 'query',
        serverId: 'database',
        serverName: 'Database',
        description: '',
        inputSchema: { type: 'object' as const },
        type: 'mcp'
      }
    ])

    const result = resolveHubToolName('githubSearchRepos')
    expect(result).toEqual({ serverId: 'github', toolName: 'search_repos' })
  })

  it('resolves namespaced id to serverId and toolName', () => {
    syncToolMapFromTools([
      {
        id: 'github__search_repos',
        name: 'search_repos',
        serverId: 'github',
        serverName: 'GitHub',
        description: '',
        inputSchema: { type: 'object' as const },
        type: 'mcp'
      }
    ])

    const result = resolveHubToolName('github__search_repos')
    expect(result).toEqual({ serverId: 'github', toolName: 'search_repos' })
  })

  it('returns null for unknown tool name', () => {
    syncToolMapFromTools([
      {
        id: 'github__search_repos',
        name: 'search_repos',
        serverId: 'github',
        serverName: 'GitHub',
        description: '',
        inputSchema: { type: 'object' as const },
        type: 'mcp'
      }
    ])

    expect(resolveHubToolName('unknownTool')).toBeNull()
  })

  it('handles serverId with multiple underscores', () => {
    syncToolMapFromTools([
      {
        id: 'my_server__do_thing',
        name: 'do_thing',
        serverId: 'my_server',
        serverName: 'My Server',
        description: '',
        inputSchema: { type: 'object' as const },
        type: 'mcp'
      }
    ])

    const result = resolveHubToolName('my_server__do_thing')
    expect(result).toEqual({ serverId: 'my_server', toolName: 'do_thing' })
  })
})

describe('resolveHubToolNameAsync', () => {
  beforeEach(() => {
    clearToolMap()
    vi.clearAllMocks()
  })

  afterEach(() => {
    clearToolMap()
  })

  it('lazily refreshes mapping when null', async () => {
    const mcpService = (await import('@main/services/MCPService')).default
    vi.mocked(mcpService.listAllActiveServerTools).mockResolvedValue([
      {
        id: 'github__search_repos',
        name: 'search_repos',
        serverId: 'github',
        serverName: 'GitHub',
        description: '',
        inputSchema: { type: 'object' as const },
        type: 'mcp'
      }
    ])

    // Mapping is null, sync version returns null
    expect(resolveHubToolName('githubSearchRepos')).toBeNull()

    // Async version should refresh and resolve
    const result = await resolveHubToolNameAsync('githubSearchRepos')
    expect(result).toEqual({ serverId: 'github', toolName: 'search_repos' })
    expect(mcpService.listAllActiveServerTools).toHaveBeenCalled()
  })

  it('retries resolution after refresh when tool not found in stale mapping', async () => {
    const mcpService = (await import('@main/services/MCPService')).default

    // Initialize with an empty tool list
    syncToolMapFromTools([])

    // Mock listAllActiveServerTools to return the tool on refresh
    vi.mocked(mcpService.listAllActiveServerTools).mockResolvedValue([
      {
        id: 'tavily__tavily_search',
        name: 'tavily_search',
        serverId: 'tavily',
        serverName: 'Tavily',
        description: '',
        inputSchema: { type: 'object' as const },
        type: 'mcp'
      }
    ])

    const result = await resolveHubToolNameAsync('tavilyTavilySearch')
    expect(result).toEqual({ serverId: 'tavily', toolName: 'tavily_search' })
  })
})
