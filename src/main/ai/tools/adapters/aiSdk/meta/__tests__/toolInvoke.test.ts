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
})
