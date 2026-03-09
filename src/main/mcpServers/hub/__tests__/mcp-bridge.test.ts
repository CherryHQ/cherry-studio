import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/MCPService', () => ({
  default: {
    listAllActiveServerTools: vi.fn(async () => []),
    callToolById: vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] })),
    abortTool: vi.fn(async () => true)
  }
}))

import { clearToolMap, resolveHubToolName, syncToolMapFromTools } from '../mcp-bridge'

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
