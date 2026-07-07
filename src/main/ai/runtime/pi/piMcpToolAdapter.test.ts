import type { McpCallToolResponse } from '@main/ai/mcp/types'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findByIdOrName: vi.fn(),
  refreshTools: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  abortTool: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: mocks.findByIdOrName }
}))
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'McpCatalogService') return { refreshTools: mocks.refreshTools, listTools: mocks.listTools }
      if (name === 'McpRuntimeService') return { callTool: mocks.callTool, abortTool: mocks.abortTool }
      throw new Error(`unexpected service ${name}`)
    }
  }
}))

const { buildMcpToolDefinitions } = await import('./piMcpToolAdapter')

const server = (id: string, name: string): McpServer => ({ id, name }) as McpServer
const tool = (name: string, extra: Partial<McpTool> = {}): McpTool =>
  ({
    id: `srv__${name}`,
    name,
    description: `${name} desc`,
    type: 'mcp',
    serverId: 'srv-1',
    serverName: 'Srv',
    inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
    ...extra
  }) as McpTool

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refreshTools.mockResolvedValue(undefined)
  mocks.listTools.mockReturnValue([])
  mocks.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] } satisfies McpCallToolResponse)
  mocks.abortTool.mockResolvedValue(true)
})

describe('buildMcpToolDefinitions', () => {
  it('returns [] without touching services for an empty id list', async () => {
    const defs = await buildMcpToolDefinitions([])
    expect(defs).toEqual([])
    expect(mocks.findByIdOrName).not.toHaveBeenCalled()
    expect(mocks.refreshTools).not.toHaveBeenCalled()
  })

  it('warms the catalog then mints a pi ToolDefinition per catalogued tool', async () => {
    mocks.findByIdOrName.mockReturnValue(server('srv-1', 'github'))
    mocks.listTools.mockReturnValue([tool('search_issues'), tool('create_issue')])

    const defs = await buildMcpToolDefinitions(['srv-1'])

    expect(mocks.refreshTools).toHaveBeenCalledWith('srv-1')
    expect(mocks.listTools).toHaveBeenCalledWith('srv-1', { includeDisabled: false })
    // Name minted like the claude path; label is the raw tool name; schema passes through by reference.
    expect(defs.map((d) => d.name)).toEqual(['mcp__github__searchIssues', 'mcp__github__createIssue'])
    expect(defs[0].label).toBe('search_issues')
    expect(defs[0].description).toBe('search_issues desc')
    expect(defs[0].parameters).toBe(mocks.listTools.mock.results[0].value[0].inputSchema)
  })

  it('skips unresolvable server ids with a warning', async () => {
    mocks.findByIdOrName.mockImplementation((id: string) => (id === 'good' ? server('good', 'gh') : undefined))
    mocks.listTools.mockReturnValue([tool('t')])

    const defs = await buildMcpToolDefinitions(['missing', 'good'])

    expect(mocks.refreshTools).toHaveBeenCalledTimes(1)
    expect(mocks.refreshTools).toHaveBeenCalledWith('good')
    expect(defs).toHaveLength(1)
  })

  it('dedups a server referenced twice so tool names cannot collide', async () => {
    mocks.findByIdOrName.mockReturnValue(server('srv-1', 'github'))
    mocks.listTools.mockReturnValue([tool('t')])

    const defs = await buildMcpToolDefinitions(['srv-1', 'github'])

    expect(mocks.refreshTools).toHaveBeenCalledTimes(1)
    expect(defs).toHaveLength(1)
  })

  it('does not fail session start when warming a server throws', async () => {
    mocks.findByIdOrName.mockReturnValue(server('srv-1', 'github'))
    mocks.refreshTools.mockRejectedValueOnce(new Error('server dead'))
    mocks.listTools.mockReturnValue([tool('t')])

    await expect(buildMcpToolDefinitions(['srv-1'])).resolves.toHaveLength(1)
  })
})

describe('bridged tool execute()', () => {
  async function buildOne(response: McpCallToolResponse): Promise<ReturnType<typeof buildMcpToolDefinitions>> {
    mocks.findByIdOrName.mockReturnValue(server('srv-1', 'github'))
    mocks.listTools.mockReturnValue([tool('run')])
    mocks.callTool.mockResolvedValue(response)
    return buildMcpToolDefinitions(['srv-1'])
  }

  it('proxies the call to the runtime service and maps text/image content through', async () => {
    const [def] = await buildOne({
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', data: 'BASE64', mimeType: 'image/png' }
      ]
    })
    const out = await def.execute('call-1', { x: '1' }, undefined, undefined, {} as never)

    expect(mocks.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'srv-1', name: 'run', args: { x: '1' } })
    )
    expect(out.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', data: 'BASE64', mimeType: 'image/png' }
    ])
  })

  it('flattens audio and resource blocks to a text summary (no pi channel for them)', async () => {
    const [def] = await buildOne({
      content: [
        { type: 'audio', data: 'A', mimeType: 'audio/mp3' },
        { type: 'resource', resource: { uri: 'file://x', text: 'embedded body' } },
        { type: 'resource', resource: { uri: 'file://y', mimeType: 'application/pdf' } }
      ]
    })
    const out = await def.execute('c', {}, undefined, undefined, {} as never)
    expect(out.content).toEqual([
      { type: 'text', text: '[audio content (audio/mp3)]' },
      { type: 'text', text: 'embedded body' },
      { type: 'text', text: '[resource: file://y (application/pdf)]' }
    ])
  })

  it('surfaces structuredContent as details', async () => {
    const [def] = await buildOne({ content: [{ type: 'text', text: 'ok' }], structuredContent: { total: 3 } })
    const out = await def.execute('c', {}, undefined, undefined, {} as never)
    expect(out.details).toEqual({ total: 3 })
  })

  it('throws the joined text when the result is an isError', async () => {
    const [def] = await buildOne({ content: [{ type: 'text', text: 'boom happened' }], isError: true })
    await expect(def.execute('c', {}, undefined, undefined, {} as never)).rejects.toThrow('boom happened')
  })

  it('aborts the runtime call with the same callId when the pi signal aborts', async () => {
    const controller = new AbortController()
    // Hold the call open so the abort listener fires while it is in-flight.
    let resolveCall!: (value: McpCallToolResponse) => void
    mocks.callTool.mockImplementation(({ callId }: { callId: string }) => {
      expect(typeof callId).toBe('string')
      return new Promise((resolve) => {
        resolveCall = resolve
      }).then(() => ({ content: [{ type: 'text', text: 'late' }] }))
    })

    mocks.findByIdOrName.mockReturnValue(server('srv-1', 'github'))
    mocks.listTools.mockReturnValue([tool('run')])
    const [def] = await buildMcpToolDefinitions(['srv-1'])

    const pending = def.execute('c', {}, controller.signal, undefined, {} as never)
    controller.abort()
    expect(mocks.abortTool).toHaveBeenCalledTimes(1)
    // The callId passed to callTool is the same one used to abort.
    expect(mocks.abortTool).toHaveBeenCalledWith(mocks.callTool.mock.calls[0][0].callId)

    resolveCall({ content: [] })
    await pending
  })
})
