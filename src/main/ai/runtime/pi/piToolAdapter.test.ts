import type { NeutralTool, NeutralToolResult } from '@main/ai/agents/tools/types'
import { describe, expect, it, vi } from 'vitest'

const { toPiToolDefinition } = await import('./piToolAdapter')

function fakeTool(result: NeutralToolResult | Error): NeutralTool<{ id: string }> {
  return {
    name: 'demo',
    description: 'demo description',
    inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
    handler: vi.fn(async () => {
      if (result instanceof Error) throw result
      return result
    })
  }
}

describe('toPiToolDefinition', () => {
  it('maps name, label, description, and passes the JSON Schema through unchanged', () => {
    const tool = fakeTool({ content: [{ type: 'text', text: 'ok' }] })
    const def = toPiToolDefinition(tool, { id: 'ctx1' })
    expect(def.name).toBe('demo')
    expect(def.label).toBe('demo')
    expect(def.description).toBe('demo description')
    // Same object reference — no runtime schema conversion.
    expect(def.parameters).toBe(tool.inputSchema)
  })

  it('threads context and args into the handler and returns pi content with details', async () => {
    const tool = fakeTool({ content: [{ type: 'text', text: 'done' }] })
    const def = toPiToolDefinition(tool, { id: 'ctx1' })
    const out = await def.execute('call-1', { x: '1' }, undefined, undefined, {} as never)
    expect(tool.handler).toHaveBeenCalledWith({ x: '1' }, { id: 'ctx1' })
    expect(out).toEqual({ content: [{ type: 'text', text: 'done' }], details: undefined })
  })

  it('rethrows when the handler throws (hard failure)', async () => {
    const def = toPiToolDefinition(fakeTool(new Error('boom')), { id: 'ctx1' })
    await expect(def.execute('c', {}, undefined, undefined, {} as never)).rejects.toThrow('boom')
  })

  it('throws with the joined text when the handler returns a soft isError result', async () => {
    const def = toPiToolDefinition(fakeTool({ content: [{ type: 'text', text: 'reached no one' }], isError: true }), {
      id: 'ctx1'
    })
    await expect(def.execute('c', {}, undefined, undefined, {} as never)).rejects.toThrow('reached no one')
  })
})
