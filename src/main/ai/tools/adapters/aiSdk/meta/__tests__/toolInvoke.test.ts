import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { ToolRegistry } from '../../registry'
import type { ToolEntry } from '../../types'
import { createToolInvokeTool, TOOL_INVOKE_TOOL_NAME } from '../toolInvoke'

const innerExecute = vi.fn()

function makeRegistry(): ToolRegistry {
  const reg = new ToolRegistry()
  const innerTool: Tool = {
    type: 'function',
    description: 'inner',
    inputSchema: { type: 'object' } as unknown as Tool['inputSchema'],
    execute: innerExecute
  } as Tool
  const entry: ToolEntry = {
    name: 'mcp__s1__t',
    namespace: 'mcp:s1',
    description: 'inner desc',
    defer: 'auto',
    tool: innerTool
  }
  reg.register(entry)
  return reg
}

/** Allow-all scope: keeps the pre-scope assertions about not-found / no-execute / approval intact. */
function allowAll(name: string): ReadonlySet<string> {
  return new Set([name])
}

async function callInvoke(tool: Tool, args: { name: string; params?: unknown }) {
  if (typeof tool.execute !== 'function') throw new Error('not executable')
  return tool.execute(args, {
    toolCallId: 'outer-1',
    messages: [],
    experimental_context: { requestId: 'req-1', abortSignal: new AbortController().signal }
  } as Parameters<NonNullable<Tool['execute']>>[1])
}

describe('tool_invoke meta-tool', () => {
  it('TOOL_INVOKE_TOOL_NAME is the agreed wire-name', () => {
    expect(TOOL_INVOKE_TOOL_NAME).toBe('tool_invoke')
  })

  it('forwards params to the inner tool execute', async () => {
    innerExecute.mockReset().mockResolvedValue({ ok: true })
    const reg = makeRegistry()
    const tool = createToolInvokeTool(reg, allowAll('mcp__s1__t'))

    const result = await callInvoke(tool, { name: 'mcp__s1__t', params: { foo: 'bar' } })
    expect(result).toEqual({ ok: true })
    expect(innerExecute).toHaveBeenCalledTimes(1)
    expect(innerExecute.mock.calls[0][0]).toEqual({ foo: 'bar' })
  })

  it('passes empty object when params omitted', async () => {
    innerExecute.mockReset().mockResolvedValue('ok')
    const reg = makeRegistry()
    const tool = createToolInvokeTool(reg, allowAll('mcp__s1__t'))
    await callInvoke(tool, { name: 'mcp__s1__t' })
    expect(innerExecute.mock.calls[0][0]).toEqual({})
  })

  it('nests the toolCallId so telemetry can rebuild the call tree', async () => {
    innerExecute.mockReset().mockResolvedValue('ok')
    const reg = makeRegistry()
    const tool = createToolInvokeTool(reg, allowAll('mcp__s1__t'))
    await callInvoke(tool, { name: 'mcp__s1__t', params: {} })
    const passedOptions = innerExecute.mock.calls[0][1]
    expect(passedOptions.toolCallId).toBe('outer-1::mcp__s1__t')
  })

  it('throws when target tool not registered', async () => {
    const reg = makeRegistry()
    const tool = createToolInvokeTool(reg, allowAll('unknown'))
    await expect(callInvoke(tool, { name: 'unknown' })).rejects.toThrow(/Tool not found/)
  })

  it('throws when target tool has no execute handler', async () => {
    const reg = new ToolRegistry()
    reg.register({
      name: 'inert',
      namespace: 'meta',
      description: '',
      defer: 'auto',
      tool: { type: 'function', description: 'inert', inputSchema: {} } as unknown as Tool
    })
    const tool = createToolInvokeTool(reg, allowAll('inert'))
    await expect(callInvoke(tool, { name: 'inert' })).rejects.toThrow(/no execute handler/)
  })

  it('refuses an approval-gated tool and does not run its execute', async () => {
    innerExecute.mockReset().mockResolvedValue('ok')
    const reg = new ToolRegistry()
    reg.register({
      name: 'mcp__s1__danger',
      namespace: 'mcp:s1',
      description: 'gated',
      defer: 'auto',
      tool: {
        type: 'function',
        description: 'gated',
        inputSchema: { type: 'object' } as unknown as Tool['inputSchema'],
        needsApproval: async () => true,
        execute: innerExecute
      } as Tool
    })
    const tool = createToolInvokeTool(reg, allowAll('mcp__s1__danger'))
    await expect(callInvoke(tool, { name: 'mcp__s1__danger', params: {} })).rejects.toThrow(/requires user approval/)
    expect(innerExecute).not.toHaveBeenCalled()
  })

  it('refuses a tool outside the per-request allowed set without touching the registry', async () => {
    innerExecute.mockReset().mockResolvedValue('ok')
    const reg = makeRegistry()
    // `mcp__s1__t` IS registered process-wide, but this request did not expose it.
    const tool = createToolInvokeTool(reg, new Set(['mcp__other__allowed']))
    await expect(callInvoke(tool, { name: 'mcp__s1__t', params: {} })).rejects.toThrow(/not available in this request/)
    expect(innerExecute).not.toHaveBeenCalled()
  })

  describe('Guard A: unseen-schema guard', () => {
    it('rejects an un-inspected tool with its signature and does not run execute', async () => {
      innerExecute.mockReset().mockResolvedValue('ok')
      const reg = makeRegistry()
      // Fresh ledger per call: the gate auto-records on rejection, so a second call on the same
      // ledger would pass — each assertion must be a first-time invoke.
      await expect(
        callInvoke(createToolInvokeTool(reg, allowAll('mcp__s1__t'), inspected()), {
          name: 'mcp__s1__t',
          params: {}
        })
      ).rejects.toThrow(/hasn't been inspected yet/)
      // The rejection carries the JSDoc signature so the model can retry without a separate inspect.
      await expect(
        callInvoke(createToolInvokeTool(reg, allowAll('mcp__s1__t'), inspected()), {
          name: 'mcp__s1__t',
          params: {}
        })
      ).rejects.toThrow(/function mcp__s1__t/)
      expect(innerExecute).not.toHaveBeenCalled()
    })

    it('records the name on rejection so the corrected retry runs', async () => {
      innerExecute.mockReset().mockResolvedValue('ok')
      const reg = makeRegistry()
      const ledger = inspected()
      const tool = createToolInvokeTool(reg, allowAll('mcp__s1__t'), ledger)

      await expect(callInvoke(tool, { name: 'mcp__s1__t', params: {} })).rejects.toThrow(/hasn't been inspected/)
      expect(ledger.has('mcp__s1__t')).toBe(true)

      const result = await callInvoke(tool, { name: 'mcp__s1__t', params: { foo: 'bar' } })
      expect(result).toBe('ok')
      expect(innerExecute).toHaveBeenCalledTimes(1)
      expect(innerExecute.mock.calls[0][0]).toEqual({ foo: 'bar' })
    })
  })

  describe('Guard B: param validation', () => {
    function zodRegistry(): ToolRegistry {
      const reg = new ToolRegistry()
      reg.register({
        name: 'web_search',
        namespace: 'web',
        description: 'search',
        defer: 'auto',
        tool: {
          type: 'function',
          description: 'search',
          inputSchema: z.object({ query: z.string(), limit: z.number().default(10) }),
          execute: innerExecute
        } as unknown as Tool
      })
      return reg
    }

    it('rejects params that do not match the schema, with the signature, and skips execute', async () => {
      innerExecute.mockReset().mockResolvedValue('ok')
      const reg = zodRegistry()
      const tool = createToolInvokeTool(reg, allowAll('web_search'), inspected('web_search'))
      // `query` is required and must be a string.
      await expect(callInvoke(tool, { name: 'web_search', params: { query: 123 } })).rejects.toThrow(
        /Invalid params for "web_search"/
      )
      await expect(callInvoke(tool, { name: 'web_search', params: {} })).rejects.toThrow(/function web_search/)
      expect(innerExecute).not.toHaveBeenCalled()
    })

    it('passes the parsed value (schema defaults applied) to execute on valid params', async () => {
      innerExecute.mockReset().mockResolvedValue('ok')
      const reg = zodRegistry()
      const tool = createToolInvokeTool(reg, allowAll('web_search'), inspected('web_search'))
      await callInvoke(tool, { name: 'web_search', params: { query: 'mcp' } })
      expect(innerExecute).toHaveBeenCalledTimes(1)
      expect(innerExecute.mock.calls[0][0]).toEqual({ query: 'mcp', limit: 10 })
    })
  })

  describe('toModelOutput + inputExamples', () => {
    it('delegates to the inner tool toModelOutput so the model sees its formatted result', () => {
      innerToModelOutput.mockReset().mockReturnValue({ type: 'text', value: 'SUMMARY' })
      const reg = makeRegistryWithToModelOutput()
      const tool = createToolInvokeTool(reg, allowAll('mcp__s1__t'), inspected('mcp__s1__t'))
      const out = tool.toModelOutput!({
        toolCallId: 'outer-1',
        input: { name: 'mcp__s1__t', params: { a: 1 } },
        output: { ok: true }
      })
      expect(out).toEqual({ type: 'text', value: 'SUMMARY' })
      expect(innerToModelOutput).toHaveBeenCalledTimes(1)
      expect(innerToModelOutput.mock.calls[0][0]).toMatchObject({
        toolCallId: 'outer-1::mcp__s1__t',
        input: { a: 1 },
        output: { ok: true }
      })
    })

    it('falls back to json output when the inner tool has no toModelOutput', () => {
      const reg = makeRegistry()
      const tool = createToolInvokeTool(reg, allowAll('mcp__s1__t'), inspected('mcp__s1__t'))
      const out = tool.toModelOutput!({
        toolCallId: 'outer-1',
        input: { name: 'mcp__s1__t', params: {} },
        output: { ok: true }
      })
      expect(out).toEqual({ type: 'json', value: { ok: true } })
    })

    it('falls back to json for a name outside the allowed set', () => {
      innerToModelOutput.mockReset()
      const reg = makeRegistryWithToModelOutput()
      const tool = createToolInvokeTool(reg, new Set(['mcp__other']), inspected('mcp__s1__t'))
      const out = tool.toModelOutput!({
        toolCallId: 'outer-1',
        input: { name: 'mcp__s1__t', params: {} },
        output: { ok: 1 }
      })
      expect(out).toEqual({ type: 'json', value: { ok: 1 } })
      expect(innerToModelOutput).not.toHaveBeenCalled()
    })

    it('advertises a callable inputExample', () => {
      const reg = makeRegistry()
      const tool = createToolInvokeTool(reg, allowAll('mcp__s1__t'), inspected('mcp__s1__t'))
      expect(tool.inputExamples?.[0]?.input).toMatchObject({ name: expect.any(String), params: expect.any(Object) })
    })
  })
})
