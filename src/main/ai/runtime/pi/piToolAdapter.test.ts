import type { NeutralTool, NeutralToolResult } from '@main/ai/agents/tools/types'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ autonomyCall: vi.fn(), memoryHandler: vi.fn() }))

vi.mock('@main/ai/mcp/servers/cherryAutonomyTools', () => ({
  CherryAutonomyTools: class {
    tools() {
      return [
        { name: 'cron', description: 'cron desc', inputSchema: { type: 'object' } },
        { name: 'notify', description: 'notify desc', inputSchema: { type: 'object' } },
        { name: 'config', description: 'config desc', inputSchema: { type: 'object' } }
      ]
    }
    call = mocks.autonomyCall
  }
}))

vi.mock('@main/ai/agents/tools/memoryTools', () => ({
  memoryTool: {
    name: 'memory',
    description: 'memory desc',
    inputSchema: { type: 'object' },
    handler: mocks.memoryHandler
  }
}))

const { AUTONOMY_TOOL_NAMES, buildAutonomyToolDefinitions, toPiToolDefinition } = await import('./piToolAdapter')

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
  it('maps metadata and passes JSON Schema through unchanged', () => {
    const tool = fakeTool({ content: [{ type: 'text', text: 'ok' }] })
    const def = toPiToolDefinition(tool, { id: 'ctx1' })
    expect(def).toMatchObject({ name: 'demo', label: 'demo', description: 'demo description' })
    expect(def.parameters).toBe(tool.inputSchema)
  })

  it('threads context and args into the handler', async () => {
    const tool = fakeTool({ content: [{ type: 'text', text: 'done' }] })
    const def = toPiToolDefinition(tool, { id: 'ctx1' })
    const out = await def.execute('call-1', { x: '1' }, undefined, undefined, {} as never)
    expect(tool.handler).toHaveBeenCalledWith({ x: '1' }, { id: 'ctx1' })
    expect(out).toEqual({ content: [{ type: 'text', text: 'done' }], details: undefined })
  })

  it('propagates hard and soft failures', async () => {
    const hard = toPiToolDefinition(fakeTool(new Error('boom')), { id: 'ctx1' })
    await expect(hard.execute('c', {}, undefined, undefined, {} as never)).rejects.toThrow('boom')

    const soft = toPiToolDefinition(
      fakeTool({ content: [{ type: 'text', text: 'reached no one' }], isError: true }),
      { id: 'ctx1' }
    )
    await expect(soft.execute('c', {}, undefined, undefined, {} as never)).rejects.toThrow('reached no one')
  })
})

describe('buildAutonomyToolDefinitions', () => {
  it('uses the same MCP names as the Claude runtime and keeps approval names in sync', () => {
    const defs = buildAutonomyToolDefinitions(
      { agentId: 'a', workspaceSource: { type: 'system' }, workspacePath: '/w' },
      { agentId: 'a', workspacePath: '/w' }
    )
    expect(defs.map((definition) => definition.name)).toEqual([
      'mcp__cherry-tools__cron',
      'mcp__cherry-tools__notify',
      'mcp__cherry-tools__config',
      'mcp__agent-memory__memory'
    ])
    expect(new Set(defs.map((definition) => definition.name))).toEqual(AUTONOMY_TOOL_NAMES)
  })

  it('routes autonomy and memory calls through their owning implementations', async () => {
    mocks.autonomyCall.mockResolvedValue({ content: [{ type: 'text', text: 'cron result' }] })
    mocks.memoryHandler.mockResolvedValue({ content: [{ type: 'text', text: 'memory result' }] })
    const defs = buildAutonomyToolDefinitions(
      { agentId: 'a', workspaceSource: { type: 'system' }, workspacePath: '/w' },
      { agentId: 'a', workspacePath: '/w' }
    )

    await defs[0].execute('c1', { action: 'list' }, undefined, undefined, {} as never)
    expect(mocks.autonomyCall).toHaveBeenCalledWith('cron', { action: 'list' })
    await defs[3].execute('c2', { action: 'search' }, undefined, undefined, {} as never)
    expect(mocks.memoryHandler).toHaveBeenCalledWith(
      { action: 'search' },
      { agentId: 'a', workspacePath: '/w' }
    )
  })
})
