import { describe, expect, it, vi } from 'vitest'

import { Runtime } from '../runtime'
import type { GeneratedTool } from '../types'

vi.mock('../mcp-bridge', () => ({
  callMcpTool: vi.fn(async (toolId: string, params: unknown) => {
    if (toolId === 'server__failing_tool') {
      throw new Error('Tool failed')
    }
    return { toolId, params, success: true }
  })
}))

const createMockTool = (partial: Partial<GeneratedTool>): GeneratedTool => ({
  serverId: 'server1',
  serverName: 'server1',
  toolName: 'tool',
  functionName: 'server1_mockTool',
  jsCode: 'async function server1_mockTool() {}',
  fn: async (params) => ({ result: params }),
  signature: '{}',
  returns: 'unknown',
  ...partial
})

describe('Runtime', () => {
  describe('execute', () => {
    it('executes simple code and returns result', async () => {
      const runtime = new Runtime()
      const tools: GeneratedTool[] = []

      const result = await runtime.execute('return 1 + 1', tools)

      expect(result.result).toBe(2)
      expect(result.error).toBeUndefined()
    })

    it('executes async code', async () => {
      const runtime = new Runtime()
      const tools: GeneratedTool[] = []

      const result = await runtime.execute('return await Promise.resolve(42)', tools)

      expect(result.result).toBe(42)
    })

    it('calls tool functions', async () => {
      const runtime = new Runtime()
      const tools = [
        createMockTool({
          functionName: 'searchRepos',
          fn: async (params) => ({ repos: ['repo1', 'repo2'], query: params })
        })
      ]

      const result = await runtime.execute('return await searchRepos({ query: "test" })', tools)

      expect(result.result).toEqual({ toolId: 'searchRepos', params: { query: 'test' }, success: true })
    })

    it('captures console logs', async () => {
      const runtime = new Runtime()
      const tools: GeneratedTool[] = []

      const result = await runtime.execute(
        `
        console.log("hello");
        console.warn("warning");
        return "done"
        `,
        tools
      )

      expect(result.result).toBe('done')
      expect(result.logs).toContain('[log] hello')
      expect(result.logs).toContain('[warn] warning')
    })

    it('handles errors gracefully', async () => {
      const runtime = new Runtime()
      const tools: GeneratedTool[] = []

      const result = await runtime.execute('throw new Error("test error")', tools)

      expect(result.result).toBeUndefined()
      expect(result.error).toBe('test error')
      expect(result.isError).toBe(true)
    })

    it('supports parallel helper', async () => {
      const runtime = new Runtime()
      const tools: GeneratedTool[] = []

      const result = await runtime.execute(
        `
        const results = await parallel(
          Promise.resolve(1),
          Promise.resolve(2),
          Promise.resolve(3)
        );
        return results
        `,
        tools
      )

      expect(result.result).toEqual([1, 2, 3])
    })

    it('supports settle helper', async () => {
      const runtime = new Runtime()
      const tools: GeneratedTool[] = []

      const result = await runtime.execute(
        `
        const results = await settle(
          Promise.resolve(1),
          Promise.reject(new Error("fail"))
        );
        return results.map(r => r.status)
        `,
        tools
      )

      expect(result.result).toEqual(['fulfilled', 'rejected'])
    })

    it('returns last expression when no explicit return', async () => {
      const runtime = new Runtime()
      const tools: GeneratedTool[] = []

      const result = await runtime.execute(
        `
        const x = 10;
        const y = 20;
        return x + y
        `,
        tools
      )

      expect(result.result).toBe(30)
    })

    it('stops execution when a tool throws', async () => {
      const runtime = new Runtime()
      const tools = [
        createMockTool({
          functionName: 'server__failing_tool'
        })
      ]

      const result = await runtime.execute('return await server__failing_tool({})', tools)

      expect(result.result).toBeUndefined()
      expect(result.error).toBe('Tool failed')
      expect(result.isError).toBe(true)
    })
  })
})
