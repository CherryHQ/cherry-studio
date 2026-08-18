import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServer as McpServerEntity } from '@shared/data/types/mcpServer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findByIdOrName: vi.fn(),
  refreshTools: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: mocks.findByIdOrName }
}))
vi.mock('@application', () => ({
  application: { get: () => ({ refreshTools: mocks.refreshTools }) }
}))

const { buildMcpToolDefinitions, buildPiMcpToolName, warmMcpToolCatalogs } = await import('./piMcpToolAdapter')

function createServer(
  tools: Tool[],
  call: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>
): McpServer {
  const server = new McpServer({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    call(request.params.name, request.params.arguments ?? {}, extra.signal)
  )
  return server
}

const tool = (name: string): Tool => ({
  name,
  description: `${name} desc`,
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refreshTools.mockResolvedValue(undefined)
})

describe('warmMcpToolCatalogs', () => {
  it('resolves, deduplicates, and warms user-configured MCP servers', async () => {
    mocks.findByIdOrName.mockImplementation((id: string) =>
      id === 'missing' ? undefined : ({ id: 'server-1', name: 'server' } as McpServerEntity)
    )

    await warmMcpToolCatalogs(['server-1', 'server', 'missing'])

    expect(mocks.refreshTools).toHaveBeenCalledTimes(1)
    expect(mocks.refreshTools).toHaveBeenCalledWith('server-1')
  })

  it('does not fail session startup when a catalog refresh rejects', async () => {
    mocks.findByIdOrName.mockReturnValue({ id: 'server-1', name: 'server' } as McpServerEntity)
    mocks.refreshTools.mockRejectedValue(new Error('offline'))

    await expect(warmMcpToolCatalogs(['server-1'])).resolves.toBeUndefined()
  })
})

describe('buildMcpToolDefinitions', () => {
  it('keeps long same-prefix tool identities distinct within the provider limit', () => {
    const prefix = 'tool_with_a_shared_prefix_'.repeat(4)
    const first = buildPiMcpToolName('server', `${prefix}first`)
    const second = buildPiMcpToolName('server', `${prefix}second`)

    expect(first).not.toBe(second)
    expect(first.length).toBeLessThanOrEqual(63)
    expect(second.length).toBeLessThanOrEqual(63)
  })

  it('fails materialization closed when a tool snapshot contains duplicate wire identities', async () => {
    const duplicate = createServer([tool('same'), tool('same')], async () => ({ content: [] }))

    await expect(buildMcpToolDefinitions({ duplicate: { name: 'duplicate', instance: duplicate } })).rejects.toThrow(
      'Duplicate Pi MCP tool name: mcp__duplicate__same'
    )
  })

  it('closes earlier clients before failing on a cross-server tool identity collision', async () => {
    const first = createServer([tool('same')], async () => ({ content: [] }))
    const second = createServer([tool('same')], async () => ({ content: [] }))
    const firstClosed = vi.fn()
    first.server.onclose = firstClosed

    await expect(
      buildMcpToolDefinitions({
        first: { name: 'duplicate', instance: first },
        second: { name: 'duplicate', instance: second }
      })
    ).rejects.toThrow('Duplicate Pi MCP tool name: mcp__duplicate__same')
    expect(firstClosed).toHaveBeenCalledOnce()
  })

  it('adapts every supplied MCP server instead of filtering by server origin', async () => {
    const external = createServer([tool('search_issues')], async () => ({
      content: [{ type: 'text', text: 'external' }]
    }))
    const builtin = createServer([tool('kb_search')], async () => ({ content: [{ type: 'text', text: 'builtin' }] }))

    const bridge = await buildMcpToolDefinitions({
      github: { name: 'github', instance: external },
      'cherry-tools': { name: 'cherry-tools', instance: builtin }
    })

    expect(bridge.tools.map((definition) => definition.name)).toEqual([
      'mcp__github__search_issues',
      'mcp__cherry-tools__kb_search'
    ])
    await bridge.close()
  })

  it('proxies calls, structured details, and MCP content through the in-memory transport', async () => {
    const call = vi.fn(async () => ({
      content: [
        { type: 'text' as const, text: 'ok' },
        { type: 'image' as const, data: 'BASE64', mimeType: 'image/png' },
        { type: 'resource' as const, resource: { uri: 'file:///doc', text: 'body' } }
      ],
      structuredContent: { total: 3 }
    }))
    const server = createServer(
      [
        {
          ...tool('run'),
          outputSchema: { type: 'object', properties: { total: { type: 'integer' } }, required: ['total'] }
        }
      ],
      call
    )
    const bridge = await buildMcpToolDefinitions({ server: { name: 'server', instance: server } })

    const output = await bridge.tools[0].execute('call-1', { value: 'x' }, undefined, undefined, {} as never)

    expect(call).toHaveBeenCalledWith('run', { value: 'x' }, expect.any(AbortSignal))
    expect(output).toEqual({
      content: [
        { type: 'text', text: 'ok' },
        { type: 'image', data: 'BASE64', mimeType: 'image/png' },
        { type: 'text', text: 'body' }
      ],
      details: { total: 3 }
    })
    expect(bridge.tools[0].outputSchema).toEqual({
      type: 'object',
      properties: { total: { type: 'integer' } },
      required: ['total']
    })
    await bridge.close()
  })

  it('throws MCP soft errors and forwards Pi cancellation', async () => {
    const aborted = vi.fn()
    const server = createServer([tool('run')], async (_name, _args, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted()
            resolve()
          },
          { once: true }
        )
      })
      return { content: [{ type: 'text', text: 'cancelled' }], isError: true }
    })
    const bridge = await buildMcpToolDefinitions({ server: { name: 'server', instance: server } })
    const controller = new AbortController()

    const pending = bridge.tools[0].execute('call-1', {}, controller.signal, undefined, {} as never)
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()

    await expect(pending).rejects.toThrow()
    expect(aborted).toHaveBeenCalledOnce()
    await bridge.close()
  })

  it('closes every connected MCP server', async () => {
    const first = createServer([], async () => ({ content: [] }))
    const second = createServer([], async () => ({ content: [] }))
    const firstClosed = vi.fn()
    const secondClosed = vi.fn()
    first.server.onclose = firstClosed
    second.server.onclose = secondClosed
    const bridge = await buildMcpToolDefinitions({
      first: { name: 'first', instance: first },
      second: { name: 'second', instance: second }
    })

    await bridge.close()

    expect(firstClosed).toHaveBeenCalledOnce()
    expect(secondClosed).toHaveBeenCalledOnce()
  })
})
