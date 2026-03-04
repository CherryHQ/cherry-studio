import type { MCPTool } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HubServer } from '../index'

const mockTools: MCPTool[] = [
  {
    id: 'github__search_repos',
    name: 'search_repos',
    description: 'Search for GitHub repositories',
    serverId: 'github',
    serverName: 'GitHub',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' }
      },
      required: ['query']
    },
    type: 'mcp'
  },
  {
    id: 'github__get_user',
    name: 'get_user',
    description: 'Get GitHub user profile',
    serverId: 'github',
    serverName: 'GitHub',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'GitHub username' }
      },
      required: ['username']
    },
    type: 'mcp'
  },
  {
    id: 'database__query',
    name: 'query',
    description: 'Execute a database query',
    serverId: 'database',
    serverName: 'Database',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL query to execute' }
      },
      required: ['sql']
    },
    type: 'mcp'
  }
]

vi.mock('../mcp-bridge', () => ({
  listAllTools: vi.fn(async () => mockTools),
  callMcpTool: vi.fn(async (nameOrId: string, args: unknown) => {
    if (nameOrId === 'githubSearchRepos' || nameOrId === 'github__search_repos') {
      return { repos: ['repo1', 'repo2'], query: args }
    }
    if (nameOrId === 'githubGetUser' || nameOrId === 'github__get_user') {
      return { username: (args as any).username, id: 123 }
    }
    if (nameOrId === 'databaseQuery' || nameOrId === 'database__query') {
      return { rows: [{ id: 1 }, { id: 2 }] }
    }
    return {}
  }),
  abortMcpTool: vi.fn(async () => false),
  syncToolMapFromTools: vi.fn(),
  syncToolMapFromHubTools: vi.fn(),
  clearToolMap: vi.fn(),
  refreshToolMap: vi.fn()
}))

import * as mcpBridge from '../mcp-bridge'

describe('HubServer Integration', () => {
  let hubServer: HubServer

  beforeEach(() => {
    vi.clearAllMocks()
    hubServer = new HubServer()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('full list → exec flow', () => {
    it('lists tools and executes them', async () => {
      const listResult = await (hubServer as any).handleList({ limit: 100, offset: 0 })

      expect(listResult.content).toBeDefined()
      expect(listResult.content[0].text).toContain('githubSearchRepos')

      const execResult = await (hubServer as any).handleExec({
        code: 'return await mcp.callTool("githubSearchRepos", { query: "test" })'
      })

      expect(execResult.content).toBeDefined()
      const execOutput = JSON.parse(execResult.content[0].text)
      expect(execOutput.result).toEqual({ repos: ['repo1', 'repo2'], query: { query: 'test' } })
    })

    it('handles multiple tool calls in parallel', async () => {
      await (hubServer as any).handleList({ limit: 100, offset: 0 })

      const execResult = await (hubServer as any).handleExec({
        code: `
          const results = await parallel(
            mcp.callTool("githubSearchRepos", { query: "react" }),
            mcp.callTool("githubGetUser", { username: "octocat" })
          );
          return results
        `
      })

      const execOutput = JSON.parse(execResult.content[0].text)
      expect(execOutput.result).toHaveLength(2)
      expect(execOutput.result[0]).toEqual({ repos: ['repo1', 'repo2'], query: { query: 'react' } })
      expect(execOutput.result[1]).toEqual({ username: 'octocat', id: 123 })
    })

    it('lists tools across multiple servers', async () => {
      const listResult = await (hubServer as any).handleList({ limit: 100, offset: 0 })
      expect(listResult.content[0].text).toContain('databaseQuery')
    })
  })

  describe('tools caching', () => {
    it('uses cached tools within TTL', async () => {
      await (hubServer as any).handleList({ limit: 100, offset: 0 })
      const firstCallCount = vi.mocked(mcpBridge.listAllTools).mock.calls.length

      await (hubServer as any).handleList({ limit: 100, offset: 0 })
      const secondCallCount = vi.mocked(mcpBridge.listAllTools).mock.calls.length

      expect(secondCallCount).toBe(firstCallCount) // Should use cache
    })

    it('refreshes tools after cache invalidation', async () => {
      await (hubServer as any).handleList({ limit: 100, offset: 0 })
      const firstCallCount = vi.mocked(mcpBridge.listAllTools).mock.calls.length

      hubServer.invalidateCache()

      await (hubServer as any).handleList({ limit: 100, offset: 0 })
      const secondCallCount = vi.mocked(mcpBridge.listAllTools).mock.calls.length

      expect(secondCallCount).toBe(firstCallCount + 1)
    })
  })

  describe('error handling', () => {
    it('throws error for invalid inspect name', async () => {
      await expect((hubServer as any).handleInspect({})).rejects.toThrow('name parameter is required')
    })

    it('throws error for invalid invoke name', async () => {
      await expect((hubServer as any).handleInvoke({})).rejects.toThrow('name parameter is required')
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
      expect(execOutput.isError).toBe(true)
    })
  })

  describe('exec timeouts', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('aborts in-flight tool calls and returns logs on timeout', async () => {
      vi.useFakeTimers()

      let toolCallStarted: (() => void) | null = null
      const toolCallStartedPromise = new Promise<void>((resolve) => {
        toolCallStarted = resolve
      })

      vi.mocked(mcpBridge.callMcpTool).mockImplementationOnce(async () => {
        toolCallStarted?.()
        return await new Promise(() => {})
      })

      const execPromise = (hubServer as any).handleExec({
        code: `
          console.log("starting");
          return await mcp.callTool("githubSearchRepos", { query: "hang" });
        `
      })

      await toolCallStartedPromise
      await vi.advanceTimersByTimeAsync(60000)
      await vi.runAllTimersAsync()

      const execResult = await execPromise
      const execOutput = JSON.parse(execResult.content[0].text)

      expect(execOutput.error).toBe('Execution timed out after 60000ms')
      expect(execOutput.result).toBeUndefined()
      expect(execOutput.isError).toBe(true)
      expect(execOutput.logs).toContain('[log] starting')
      expect(vi.mocked(mcpBridge.abortMcpTool)).toHaveBeenCalled()
    })
  })

  describe('server instance', () => {
    it('creates a valid MCP server instance', () => {
      expect(hubServer.server).toBeDefined()
      expect(hubServer.server.setRequestHandler).toBeDefined()
    })
  })
})
