import { experimental_runCodeMode } from '@ai-sdk/code-mode'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpCallToolResponse } from '@main/ai/mcp/types'

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

  it.each([{ disabledTools: ['t'] }, { disabledAutoApproveTools: ['t'] }])(
    'rejects a revoked tool before dispatch even after discovery',
    async (policy) => {
      const reg = new ToolRegistry()
      const execute = await registerToolExecute(reg)
      getById.mockReturnValue({ ...activeServer('s1'), ...policy })
      await expect(execute({}, { toolCallId: 'stale-call' } as any)).rejects.toThrow(/disabled|requires approval/)
      expect(callTool).not.toHaveBeenCalled()
    }
  )

  it('rejects with the result summary when callTool returns isError', async () => {
    const reg = new ToolRegistry()
    const execute = await registerToolExecute(reg)

    getById.mockReturnValue(activeServer('s1'))
    callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'boom from server' }]
    })

    await expect(execute({ q: 'x' }, { toolCallId: 'call-2' } as any)).rejects.toThrow('boom from server')
  })

  it('returns the runtime result plus mcp metadata on success', async () => {
    const reg = new ToolRegistry()
    const execute = await registerToolExecute(reg)

    getById.mockReturnValue(activeServer('s1'))
    const runtimeResult: McpCallToolResponse = {
      isError: false,
      content: [{ type: 'text', text: 'ok' }]
    }
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
    })
    await syncMcpToolsToRegistry(reg)

    await expect(
      experimental_runCodeMode({
        js: `return await tools.${tool.id}({ query: "hello", unexpected: true })`,
        tools: { [tool.id]: reg.getByName(tool.id)!.tool },
        options: { toolsContext: { [tool.id]: { requestId: 'request-1' } } },
        toolExecutionOptions: { toolCallId: 'outer-1', messages: [] }
      })
    ).rejects.toThrow(/Invalid input/)
    expect(callTool).not.toHaveBeenCalled()
  })

  it('executes through a real MCP transport and retains image/resource results and child scope', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = new McpServer({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } })
    const received: unknown[] = []
    server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      received.push(request.params.arguments)
      return {
        content: [
          { type: 'image', mimeType: 'image/png', data: 'cGljdHVyZQ==' },
          { type: 'resource', resource: { uri: 'file:///artifact.pdf', mimeType: 'application/pdf', blob: 'ZmlsZQ==' } }
        ]
      }
    })
    const client = new Client({ name: 'cherry', version: '1' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const reg = new ToolRegistry()
      await registerToolExecute(reg)
      getById.mockReturnValue(activeServer('s1'))
      const scopes: unknown[] = []
      callTool.mockImplementation(async (request) => {
        const req = request as { name: string; args: Record<string, unknown>; scope: string }
        scopes.push(req.scope)
        return (await client.callTool({ name: req.name, arguments: req.args })) as McpCallToolResponse
      })
      const result = await experimental_runCodeMode({
        js: 'return await tools.mcp__s1__t({})',
        tools: { mcp__s1__t: reg.getByName('mcp__s1__t')!.tool },
        options: { toolsContext: { mcp__s1__t: { requestId: 'request-1', topicId: 'topic-1' } } },
        toolExecutionOptions: { toolCallId: 'outer-1', messages: [] }
      })
      expect(received).toEqual([{}])
      expect(scopes).toEqual(['topic-1'])
      expect(result).toMatchObject({
        content: [
          { type: 'image', data: 'cGljdHVyZQ==' },
          { type: 'resource', resource: { uri: 'file:///artifact.pdf', blob: 'ZmlsZQ==' } }
        ],
        metadata: { serverId: 's1', name: 't', type: 'mcp' }
      })
    } finally {
      await client.close()
      await server.close()
    }
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
    })

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
