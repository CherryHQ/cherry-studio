import type { McpCallToolResponse } from '@main/ai/mcp/types'
import { createToolInvokeTool } from '@main/ai/tools/adapters/aiSdk/meta/toolInvoke'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolRegistry } from '../../registry'

const listTools = vi.fn()
const list = vi.fn()
const getById = vi.fn()
const callTool = vi.fn<(req: unknown) => Promise<McpCallToolResponse>>()

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    McpCatalogService: { listTools },
    McpRuntimeService: { callTool }
  } as Record<string, unknown>)
})

vi.mock('@application', async () => {
  return {
    application: {
      get: (name: string) => {
        if (name === 'McpCatalogService') return { listTools }
        if (name === 'McpRuntimeService') return { callTool }
        throw new Error(`unexpected service: ${name}`)
      }
    }
  }
})

vi.mock('@main/data/services/McpServerService', () => ({
  mcpServerService: { list, getById }
}))

// Import AFTER vi.mock so the mocks bind correctly.
const { syncMcpToolsToRegistry } = await import('../mcpTools')

function mcpTool(serverId: string, name: string, description = '') {
  return {
    id: `mcp__${serverId}__${name}`,
    serverId,
    serverName: serverId,
    name,
    description,
    inputSchema: { type: 'object', properties: {} }
  }
}

function activeServer(id: string, disabledAutoApproveTools: string[] = []) {
  return { id, name: id, isActive: true, disabledAutoApproveTools }
}

/** Register a single tool via the production sync path and return its SDK execute fn. */
async function registerToolExecute(reg: ToolRegistry) {
  list.mockReturnValue({ items: [activeServer('s1')] })
  listTools.mockReturnValue([mcpTool('s1', 't')])
  await syncMcpToolsToRegistry(reg)
  const entry = reg.getByName('mcp__s1__t')
  if (!entry) throw new Error('expected mcp__s1__t to be registered')
  const execute = entry.tool.execute
  if (!execute) throw new Error('expected the registered tool to have an execute fn')
  return execute
}

describe('mcpTools execute wrapper', () => {
  beforeEach(() => {
    listTools.mockReset()
    list.mockReset()
    getById.mockReset()
    callTool.mockReset()
  })

  it('rejects when the server is no longer active or registered', async () => {
    const reg = new ToolRegistry()
    const execute = await registerToolExecute(reg)

    // resolveActiveServerById → mcpServerService.getById resolves an inactive server,
    // so resolveActiveServerById returns undefined and execute throws.
    getById.mockReturnValue({ id: 's1', name: 's1', isActive: false })

    await expect(execute({}, { toolCallId: 'call-1' } as any)).rejects.toThrow(
      'MCP server s1 is not active or no longer registered'
    )
    // Never reaches the runtime when the server is inactive.
    expect(callTool).not.toHaveBeenCalled()
  })

  it('rejects with the result summary when callTool returns isError', async () => {
    const reg = new ToolRegistry()
    const execute = await registerToolExecute(reg)

    getById.mockReturnValue(activeServer('s1'))
    callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'boom from server' }]
    } as McpCallToolResponse)

    await expect(execute({ q: 'x' }, { toolCallId: 'call-2' } as any)).rejects.toThrow('boom from server')
  })

  it('returns the runtime result plus mcp metadata on success', async () => {
    const reg = new ToolRegistry()
    const execute = await registerToolExecute(reg)

    getById.mockReturnValue(activeServer('s1'))
    const runtimeResult: McpCallToolResponse = {
      isError: false,
      content: [{ type: 'text', text: 'ok' }]
    } as McpCallToolResponse
    callTool.mockResolvedValue(runtimeResult)
    const abortSignal = new AbortController().signal

    const out = (await execute({ q: 'x' }, { toolCallId: 'call-3', abortSignal } as any)) as McpCallToolResponse & {
      metadata: { description: string; name: string; serverId: string; serverName: string; type: string }
    }

    expect(callTool).toHaveBeenCalledWith({
      serverId: 's1',
      name: 't',
      args: { q: 'x' },
      callId: 'call-3',
      signal: abortSignal
    })
    expect(out.content).toEqual([{ type: 'text', text: 'ok' }])
    expect(out.metadata).toEqual({ description: '', name: 't', serverName: 's1', serverId: 's1', type: 'mcp' })
  })

  it('rejects Draft 2020-12-invalid deferred arguments before calling the MCP runtime', async () => {
    const reg = new ToolRegistry()
    const tool = {
      ...mcpTool('s1', 't'),
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        unevaluatedProperties: false
      }
    }
    list.mockReturnValue({ items: [activeServer('s1')] })
    listTools.mockReturnValue([tool])
    getById.mockReturnValue(activeServer('s1'))
    callTool.mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'should not run' }]
    } as McpCallToolResponse)
    await syncMcpToolsToRegistry(reg)

    const invoke = createToolInvokeTool(reg, new Set([tool.id]), new Set([tool.id]))
    const execute = invoke.execute
    if (!execute) throw new Error('expected tool_invoke to have an execute fn')

    await expect(
      execute({ name: tool.id, params: { query: 'hello', unexpected: true } }, {
        toolCallId: 'outer-1',
        messages: []
      } as never)
    ).rejects.toThrow(/Invalid params/)
    expect(callTool).not.toHaveBeenCalled()
  })

  it('executes the explicitly selected server when display names normalize alike', async () => {
    const reg = new ToolRegistry()
    const reimbursement = {
      ...mcpTool('server-a', 'executeSql'),
      id: 'mcp__mysql__executeSql_a',
      serverName: 'mysql_报销'
    }
    const elevator = {
      ...mcpTool('server-b', 'executeSql'),
      id: 'mcp__mysql__executeSql_b',
      serverName: 'mysql_电梯'
    }
    list.mockReturnValue({
      items: [
        { ...activeServer('server-b'), name: 'mysql_电梯', sortOrder: 2 },
        { ...activeServer('server-a'), name: 'mysql_报销', sortOrder: 1 }
      ]
    })
    listTools.mockImplementation((serverId: string) => (serverId === 'server-a' ? [reimbursement] : [elevator]))
    getById.mockReturnValue({ id: 'server-a', name: 'mysql_报销', isActive: true })
    callTool.mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'ok' }]
    } as McpCallToolResponse)

    await syncMcpToolsToRegistry(reg, { selectedToolIds: new Set([reimbursement.id]) })
    const execute = reg.getByName(reimbursement.id)?.tool.execute
    if (!execute) throw new Error('expected selected reimbursement tool')
    await execute({ sql: 'select 1' }, { toolCallId: 'call-reimbursement' } as any)

    expect(callTool).toHaveBeenCalledExactlyOnceWith({
      serverId: 'server-a',
      name: 'executeSql',
      args: { sql: 'select 1' },
      callId: 'call-reimbursement'
    })
  })
})
