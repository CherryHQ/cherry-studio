import type { MCPServer } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HubServer } from '../index'
import { initHubBridge } from '../mcp-bridge'

const mockMcpServers: MCPServer[] = [
  {
    id: 'github',
    name: 'GitHub',
    command: 'npx',
    args: ['-y', 'github-mcp-server'],
    isActive: true
  } as MCPServer,
  {
    id: 'database',
    name: 'Database',
    command: 'npx',
    args: ['-y', 'db-mcp-server'],
    isActive: true
  } as MCPServer
]

const mockToolDefinitions = {
  github: [
    {
      name: 'search_repos',
      description: 'Search for GitHub repositories',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results' }
        },
        required: ['query']
      }
    },
    {
      name: 'get_user',
      description: 'Get GitHub user profile',
      inputSchema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'GitHub username' }
        },
        required: ['username']
      }
    }
  ],
  database: [
    {
      name: 'query',
      description: 'Execute a database query',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL query to execute' }
        },
        required: ['sql']
      }
    }
  ]
}

const mockMcpService = {
  listTools: vi.fn(async (_: null, server: MCPServer) => {
    return mockToolDefinitions[server.id as keyof typeof mockToolDefinitions] || []
  }),
  callTool: vi.fn(async (_: null, args: { server: MCPServer; name: string; args: unknown }) => {
    if (args.server.id === 'github' && args.name === 'search_repos') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ repos: ['repo1', 'repo2'], query: args.args }) }]
      }
    }
    if (args.server.id === 'github' && args.name === 'get_user') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ username: (args.args as any).username, id: 123 }) }]
      }
    }
    if (args.server.id === 'database' && args.name === 'query') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ rows: [{ id: 1 }, { id: 2 }] }) }]
      }
    }
    return { content: [{ type: 'text', text: '{}' }] }
  })
}

describe('HubServer Integration', () => {
  let hubServer: HubServer

  beforeEach(() => {
    vi.clearAllMocks()
    initHubBridge(mockMcpService as any, () => mockMcpServers)
    hubServer = new HubServer()
  })

  afterEach(() => {
    hubServer.invalidateCache()
  })

  describe('full search → exec flow', () => {
    it('searches for tools and executes them', async () => {
      const searchResult = await (hubServer as any).handleSearch({ query: 'github,repos' })

      expect(searchResult.content).toBeDefined()
      const searchText = JSON.parse(searchResult.content[0].text)
      expect(searchText.total).toBeGreaterThan(0)
      expect(searchText.tools).toContain('searchRepos')

      const execResult = await (hubServer as any).handleExec({
        code: 'return await searchRepos({ query: "test" })'
      })

      expect(execResult.content).toBeDefined()
      const execOutput = JSON.parse(execResult.content[0].text)
      expect(execOutput.result).toEqual({ repos: ['repo1', 'repo2'], query: { query: 'test' } })
    })

    it('handles multiple tool calls in parallel', async () => {
      await (hubServer as any).handleSearch({ query: 'github' })

      const execResult = await (hubServer as any).handleExec({
        code: `
          const results = await parallel(
            searchRepos({ query: "react" }),
            getUser({ username: "octocat" })
          );
          return results
        `
      })

      const execOutput = JSON.parse(execResult.content[0].text)
      expect(execOutput.result).toHaveLength(2)
      expect(execOutput.result[0]).toEqual({ repos: ['repo1', 'repo2'], query: { query: 'react' } })
      expect(execOutput.result[1]).toEqual({ username: 'octocat', id: 123 })
    })

    it('searches across multiple servers', async () => {
      const searchResult = await (hubServer as any).handleSearch({ query: 'query' })

      const searchText = JSON.parse(searchResult.content[0].text)
      expect(searchText.tools).toContain('query')
    })
  })

  describe('cache invalidation', () => {
    it('refreshes tools after invalidation', async () => {
      await (hubServer as any).handleSearch({ query: 'github' })

      const initialCallCount = mockMcpService.listTools.mock.calls.length

      hubServer.invalidateCache()

      await (hubServer as any).handleSearch({ query: 'github' })

      expect(mockMcpService.listTools.mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })

  describe('error handling', () => {
    it('throws error for invalid search query', async () => {
      await expect((hubServer as any).handleSearch({})).rejects.toThrow('query parameter is required')
    })

    it('throws error for invalid exec code', async () => {
      await expect((hubServer as any).handleExec({})).rejects.toThrow('code parameter is required')
    })

    it('handles runtime errors in exec', async () => {
      const execResult = await (hubServer as any).handleExec({
        code: 'throw new Error("test error")'
      })

      const execOutput = JSON.parse(execResult.content[0].text)
      expect(execOutput.error).toBe('test error')
    })
  })

  describe('server instance', () => {
    it('creates a valid MCP server instance', () => {
      expect(hubServer.server).toBeDefined()
      expect(hubServer.server.setRequestHandler).toBeDefined()
    })
  })
})
