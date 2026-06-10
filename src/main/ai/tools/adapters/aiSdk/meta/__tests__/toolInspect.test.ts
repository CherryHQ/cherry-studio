import { jsonSchema, type Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import { ToolRegistry } from '../../registry'
import type { ToolEntry } from '../../types'
import { createToolInspectTool, TOOL_INSPECT_TOOL_NAME } from '../toolInspect'

function makeRegistry(): ToolRegistry {
  const reg = new ToolRegistry()
  const entry: ToolEntry = {
    name: 'mcp__s1__t',
    namespace: 'mcp:s1',
    description: 'inner desc',
    defer: 'auto',
    tool: {
      type: 'function',
      description: 'inner',
      inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] })
    } as Tool
  }
  reg.register(entry)
  return reg
}

async function callInspect(tool: Tool, args: { name: string }) {
  if (typeof tool.execute !== 'function') throw new Error('not executable')
  return tool.execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1', abortSignal: new AbortController().signal }
  } as Parameters<NonNullable<Tool['execute']>>[1])
}

describe('tool_inspect meta-tool', () => {
  it('TOOL_INSPECT_TOOL_NAME is the agreed wire-name', () => {
    expect(TOOL_INSPECT_TOOL_NAME).toBe('tool_inspect')
  })

  it('returns a JSDoc stub for the tool', async () => {
    const reg = makeRegistry()
    const tool = createToolInspectTool(reg, new Set(['mcp__s1__t']), new Set())
    const stub = (await callInspect(tool, { name: 'mcp__s1__t' })) as string
    expect(stub).toContain('function mcp__s1__t(params)')
    expect(stub).toContain('@param {string} params.query')
  })

  it('records the inspected name in the shared ledger', async () => {
    const reg = makeRegistry()
    const ledger = new Set<string>()
    const tool = createToolInspectTool(reg, new Set(['mcp__s1__t']), ledger)
    await callInspect(tool, { name: 'mcp__s1__t' })
    expect(ledger.has('mcp__s1__t')).toBe(true)
  })

  it('refuses a tool outside the per-request allowed set and does not record it', async () => {
    const reg = makeRegistry()
    const ledger = new Set<string>()
    const tool = createToolInspectTool(reg, new Set(['mcp__other']), ledger)
    await expect(callInspect(tool, { name: 'mcp__s1__t' })).rejects.toThrow(/not available in this request/)
    expect(ledger.has('mcp__s1__t')).toBe(false)
  })

  it('throws when the tool is not registered', async () => {
    const reg = makeRegistry()
    const tool = createToolInspectTool(reg, new Set(['unknown']), new Set())
    await expect(callInspect(tool, { name: 'unknown' })).rejects.toThrow(/Tool not found/)
  })

  it('toModelOutput hands the stub to the model as plain text', async () => {
    const reg = makeRegistry()
    const tool = createToolInspectTool(reg, new Set(['mcp__s1__t']), new Set())
    const stub = (await callInspect(tool, { name: 'mcp__s1__t' })) as string
    const out = tool.toModelOutput!({ toolCallId: 'tc-1', input: { name: 'mcp__s1__t' }, output: stub })
    expect(out).toEqual({ type: 'text', value: stub })
  })

  it('advertises a callable inputExample', () => {
    const reg = makeRegistry()
    const tool = createToolInspectTool(reg, new Set(['mcp__s1__t']), new Set())
    expect(tool.inputExamples?.[0]?.input).toMatchObject({ name: expect.any(String) })
  })
})
