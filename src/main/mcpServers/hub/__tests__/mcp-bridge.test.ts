import type { MCPCallToolResponse, MCPTool } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockMcpService = {
  listAllActiveServerTools: vi.fn(async (): Promise<MCPTool[]> => []),
  callToolById: vi.fn(async (): Promise<MCPCallToolResponse> => ({ content: [{ type: 'text', text: '{}' }] })),
  abortTool: vi.fn(async () => true)
}

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'McpService') {
        return mockMcpService
      }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    })
  }
}))

import {
  callMcpTool,
  clearToolMap,
  resolveHubToolName,
  resolveHubToolNameAsync,
  syncToolMapFromTools
} from '../mcp-bridge'

const githubSearchRepos: MCPTool = {
  id: 'github__search_repos',
  name: 'search_repos',
  serverId: 'github',
  serverName: 'GitHub',
  description: '',
  inputSchema: { type: 'object' as const },
  type: 'mcp'
}

async function callWithMockedResponse(response: MCPCallToolResponse): Promise<unknown> {
  mockMcpService.callToolById.mockResolvedValueOnce(response)
  syncToolMapFromTools([githubSearchRepos])
  return callMcpTool('githubSearchRepos', {})
}

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
    mockMcpService.listAllActiveServerTools.mockResolvedValue([
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
    expect(mockMcpService.listAllActiveServerTools).toHaveBeenCalled()
  })

  it('retries resolution after refresh when tool not found in stale mapping', async () => {
    // Initialize with an empty tool list
    syncToolMapFromTools([])

    // Mock listAllActiveServerTools to return the tool on refresh
    mockMcpService.listAllActiveServerTools.mockResolvedValue([
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

describe('callMcpTool result extraction', () => {
  beforeEach(() => {
    clearToolMap()
    vi.clearAllMocks()
  })

  afterEach(() => {
    clearToolMap()
  })

  it('parses a single text block as JSON when possible', async () => {
    const result = await callWithMockedResponse({
      content: [{ type: 'text', text: '{"id":"abc","name":"Repo"}' }]
    })

    expect(result).toEqual({ id: 'abc', name: 'Repo' })
  })

  it('returns the raw string when a single text block is not valid JSON', async () => {
    const result = await callWithMockedResponse({
      content: [{ type: 'text', text: 'plain text response' }]
    })

    expect(result).toBe('plain text response')
  })

  it('returns every text block as an array when the response has multiple blocks', async () => {
    const result = await callWithMockedResponse({
      content: [
        { type: 'text', text: '{"id":"a","name":"first"}' },
        { type: 'text', text: '{"id":"b","name":"second"}' },
        { type: 'text', text: '{"id":"c","name":"third"}' }
      ]
    })

    expect(result).toEqual([
      { id: 'a', name: 'first' },
      { id: 'b', name: 'second' },
      { id: 'c', name: 'third' }
    ])
  })

  it('preserves unparseable blocks as strings inside the array', async () => {
    const result = await callWithMockedResponse({
      content: [
        { type: 'text', text: '{"valid":true}' },
        { type: 'text', text: 'not json at all' }
      ]
    })

    expect(result).toEqual([{ valid: true }, 'not json at all'])
  })

  it('returns structuredContent when the content array is empty', async () => {
    const result = await callWithMockedResponse({
      content: [],
      structuredContent: { result: [{ id: 'x' }, { id: 'y' }] }
    })

    expect(result).toEqual({ result: [{ id: 'x' }, { id: 'y' }] })
  })

  it('prefers structuredContent over the content array when both are present', async () => {
    const result = await callWithMockedResponse({
      content: [{ type: 'text', text: '{"fromContent":true}' }],
      structuredContent: { fromStructured: true }
    })

    expect(result).toEqual({ fromStructured: true })
  })

  it('returns null when both content and structuredContent are empty', async () => {
    const result = await callWithMockedResponse({ content: [] })

    expect(result).toBeNull()
  })

  it('returns the raw content array when only non-text blocks are present', async () => {
    const imageContent = {
      content: [{ type: 'image' as const, data: 'base64data', mimeType: 'image/png' }]
    }
    const result = await callWithMockedResponse(imageContent)

    expect(result).toEqual(imageContent.content)
  })

  it('parses the first text block when content mixes text and non-text blocks', async () => {
    const result = await callWithMockedResponse({
      content: [
        { type: 'text', text: '{"valid":true}' },
        { type: 'image', data: 'base64data', mimeType: 'image/png' }
      ]
    })

    expect(result).toEqual({ valid: true })
  })

  it('throws with the single error message when isError has one text block', async () => {
    await expect(
      callWithMockedResponse({
        isError: true,
        content: [{ type: 'text', text: 'tool failed: invalid input' }]
      })
    ).rejects.toThrow('tool failed: invalid input')
  })

  it('throws with every error block joined when isError has multiple text blocks', async () => {
    await expect(
      callWithMockedResponse({
        isError: true,
        content: [
          { type: 'text', text: 'first error line' },
          { type: 'text', text: 'second error line' }
        ]
      })
    ).rejects.toThrow('first error line\nsecond error line')
  })

  it('throws the default message when isError has no text blocks', async () => {
    await expect(
      callWithMockedResponse({
        isError: true,
        content: []
      })
    ).rejects.toThrow('Tool execution failed')
  })
})
