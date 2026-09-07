import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, deleteMock, updateAgentMock, getAgentMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteMock: vi.fn(),
  updateAgentMock: vi.fn(),
  getAgentMock: vi.fn()
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { create: createMock, delete: deleteMock }
}))
vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: getAgentMock, updateAgent: updateAgentMock }
}))

const { default: McpManagerServer } = await import('../mcpManager')
type McpManagerServerInstance = InstanceType<typeof McpManagerServer>

function createServer(agentId = 'agent-1') {
  return new McpManagerServer(agentId)
}

function handlers(server: McpManagerServerInstance) {
  return (server.mcpServer.server as any)._requestHandlers
}

async function listTools(server: McpManagerServerInstance): Promise<any> {
  return handlers(server).get('tools/list')({ method: 'tools/list', params: {} }, {})
}

async function callTool(server: McpManagerServerInstance, name: string, args: Record<string, unknown>): Promise<any> {
  return handlers(server).get('tools/call')({ method: 'tools/call', params: { name, arguments: args } }, {})
}

function mockAgent(mcps: string[] = []) {
  getAgentMock.mockReturnValue({ id: 'agent-1', mcps })
  updateAgentMock.mockReturnValue({ id: 'agent-1', mcps: [...mcps, 'server-1'] })
}

function mockCreatedServer(overrides: Record<string, unknown> = {}) {
  createMock.mockReturnValue({
    id: 'server-1',
    name: 'my-mcp',
    type: 'stdio',
    command: 'npx',
    baseUrl: undefined,
    ...overrides
  })
}

describe('McpManagerServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes exactly install_mcp_server', async () => {
    const result = await listTools(createServer())
    expect(result.tools.map((t: any) => t.name)).toEqual(['install_mcp_server'])
  })

  describe('install_mcp_server', () => {
    it('registers a stdio server and binds it to the current agent, inactive by default', async () => {
      mockAgent()
      mockCreatedServer()
      const server = createServer('agent-1')

      const result = await callTool(server, 'install_mcp_server', {
        name: 'my-mcp',
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'some-mcp-server'],
        env: { API_KEY: 'abc' }
      })

      expect(result.isError).toBeFalsy()
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-mcp',
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'some-mcp-server'],
          env: { API_KEY: 'abc' },
          isActive: false,
          isTrusted: false,
          installSource: 'ai_assisted'
        })
      )
      // The activate gate is stripped before the shared strict schema, so it never
      // leaks into the persisted record.
      expect(createMock.mock.calls[0][0]).not.toHaveProperty('activate')
      expect(getAgentMock).toHaveBeenCalledWith('agent-1')
      expect(updateAgentMock).toHaveBeenCalledWith('agent-1', { mcps: ['server-1'] })
      expect(result.content[0].text).toContain('registered for this agent')
      expect(result.content[0].text).toContain('NOT yet active')
    })

    it('activates and trusts the server when activate: true is passed', async () => {
      mockAgent()
      mockCreatedServer()
      const server = createServer('agent-1')

      const result = await callTool(server, 'install_mcp_server', {
        name: 'my-mcp',
        type: 'stdio',
        command: 'npx',
        activate: true
      })

      expect(result.isError).toBeFalsy()
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-mcp',
          isActive: true,
          isTrusted: true
        })
      )
      expect(result.content[0].text).toContain('installed and enabled for this agent')
      expect(result.content[0].text).toContain('active now')
    })

    it('appends to the existing mcps set when the agent already has servers', async () => {
      mockAgent(['existing-1'])
      mockCreatedServer()
      const server = createServer('agent-1')

      await callTool(server, 'install_mcp_server', { name: 'my-mcp', command: 'npx' })

      expect(updateAgentMock).toHaveBeenCalledWith('agent-1', { mcps: ['existing-1', 'server-1'] })
    })

    it('defaults type to stdio and requires command for stdio', async () => {
      mockAgent()
      mockCreatedServer()
      const server = createServer('agent-1')

      const ok = await callTool(server, 'install_mcp_server', { name: 'my-mcp', command: 'npx' })
      expect(ok.isError).toBeFalsy()
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'stdio' }))

      const missing = await callTool(server, 'install_mcp_server', { name: 'my-mcp' })
      expect(missing.isError).toBe(true)
      expect(missing.content[0].text).toContain('command')
      expect(createMock).toHaveBeenCalledTimes(1)
    })

    it('requires baseUrl for remote (sse/streamableHttp) servers', async () => {
      const server = createServer('agent-1')

      const missing = await callTool(server, 'install_mcp_server', { name: 'remote-mcp', type: 'streamableHttp' })
      expect(missing.isError).toBe(true)
      expect(missing.content[0].text).toContain('baseUrl')
      expect(createMock).not.toHaveBeenCalled()

      mockAgent()
      mockCreatedServer({ type: 'streamableHttp', baseUrl: 'https://example.com/mcp', command: undefined })
      const ok = await callTool(server, 'install_mcp_server', {
        name: 'remote-mcp',
        type: 'streamableHttp',
        baseUrl: 'https://example.com/mcp'
      })
      expect(ok.isError).toBeFalsy()
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://example.com/mcp' }))
    })

    it('requires a name', async () => {
      const result = await callTool(createServer(), 'install_mcp_server', { command: 'npx' })
      expect(result.isError).toBe(true)
      expect(createMock).not.toHaveBeenCalled()
    })

    it('rejects invalid field types via the shared schema (zod parse failure)', async () => {
      const result = await callTool(createServer(), 'install_mcp_server', {
        name: 'my-mcp',
        command: 'npx',
        env: { API_KEY: 123 }
      })
      expect(result.isError).toBe(true)
      expect(createMock).not.toHaveBeenCalled()
      expect(updateAgentMock).not.toHaveBeenCalled()
    })

    it('surfaces an install failure as an error result, not a throw', async () => {
      mockAgent()
      // create() is synchronous — it throws, not rejects.
      createMock.mockImplementation(() => {
        throw new Error('db write failed')
      })
      const result = await callTool(createServer(), 'install_mcp_server', { name: 'x', command: 'npx' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('db write failed')
    })

    it('does not create when the agent is missing', async () => {
      getAgentMock.mockReturnValue(null)
      const result = await callTool(createServer('ghost'), 'install_mcp_server', { name: 'x', command: 'npx' })
      expect(result.isError).toBe(true)
      expect(createMock).not.toHaveBeenCalled()
      expect(updateAgentMock).not.toHaveBeenCalled()
    })

    it('rolls back the created server when the bind fails', async () => {
      mockAgent()
      mockCreatedServer()
      updateAgentMock.mockImplementation(() => {
        throw new Error('bind write failed')
      })
      const result = await callTool(createServer(), 'install_mcp_server', { name: 'x', command: 'npx' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('bind write failed')
      expect(deleteMock).toHaveBeenCalledWith('server-1')
    })

    it('still surfaces the bind error when the rollback delete also fails', async () => {
      mockAgent()
      mockCreatedServer()
      updateAgentMock.mockImplementation(() => {
        throw new Error('bind write failed')
      })
      deleteMock.mockImplementation(() => {
        throw new Error('delete failed')
      })
      const result = await callTool(createServer(), 'install_mcp_server', { name: 'x', command: 'npx' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('bind write failed')
    })
  })

  it('rejects an unknown tool', async () => {
    const result = await callTool(createServer(), 'nope', {})
    expect(result.isError).toBe(true)
  })
})
