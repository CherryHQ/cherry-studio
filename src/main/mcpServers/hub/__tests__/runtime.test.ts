import { describe, expect, it, vi } from 'vitest'

import { Runtime } from '../runtime'

vi.mock('../mcp-bridge', () => ({
  callMcpTool: vi.fn(async (name: string, params: unknown) => {
    if (name === 'server__failing_tool') {
      throw new Error('Tool failed')
    }
    return { name, params, success: true }
  })
}))

describe('Runtime', () => {
  describe('execute', () => {
    it('executes simple code and returns result', async () => {
      const runtime = new Runtime()

      const result = await runtime.execute('return 1 + 1')

      expect(result.result).toBe(2)
      expect(result.error).toBeUndefined()
    })

    it('executes async code', async () => {
      const runtime = new Runtime()

      const result = await runtime.execute('return await Promise.resolve(42)')

      expect(result.result).toBe(42)
    })

    it('calls tools via mcp.callTool', async () => {
      const runtime = new Runtime()

      const result = await runtime.execute('return await mcp.callTool("searchRepos", { query: "test" })')

      expect(result.result).toEqual({ name: 'searchRepos', params: { query: 'test' }, success: true })
    })

    it('captures console logs', async () => {
      const runtime = new Runtime()

      const result = await runtime.execute(
        `
        console.log("hello")
        console.warn("warning")
        return "done"
        `
      )

      expect(result.result).toBe('done')
      expect(result.logs).toContain('[log] hello')
      expect(result.logs).toContain('[warn] warning')
    })

    it('captures mcp.log', async () => {
      const runtime = new Runtime()

      const result = await runtime.execute(
        `
        mcp.log('info', 'starting', { step: 1 })
        return { ok: true }
        `
      )

      expect(result.result).toEqual({ ok: true })
      expect(result.logs?.some((l) => l.includes('starting'))).toBe(true)
    })

    it('handles errors gracefully', async () => {
      const runtime = new Runtime()

      const result = await runtime.execute('throw new Error("test error")')

      expect(result.result).toBeUndefined()
      expect(result.error).toBe('test error')
      expect(result.isError).toBe(true)
    })

    it('supports parallel helper', async () => {
      const runtime = new Runtime()

      const result = await runtime.execute(
        `
        const results = await parallel(
          Promise.resolve(1),
          Promise.resolve(2),
          Promise.resolve(3)
        )
        return results
        `
      )

      expect(result.result).toEqual([1, 2, 3])
    })

    it('supports settle helper', async () => {
      const runtime = new Runtime()

      const result = await runtime.execute(
        `
        const results = await settle(
          Promise.resolve(1),
          Promise.reject(new Error("fail"))
        )
        return results.map(r => r.status)
        `
      )

      expect(result.result).toEqual(['fulfilled', 'rejected'])
    })

    it('stops execution when a tool throws', async () => {
      const runtime = new Runtime()

      const result = await runtime.execute('return await mcp.callTool("server__failing_tool", {})')

      expect(result.result).toBeUndefined()
      expect(result.error).toBe('Tool failed')
      expect(result.isError).toBe(true)
    })
  })
})
