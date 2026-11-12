import type { Client } from '@modelcontextprotocol/client'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, deleteMock, updateAgentMock, getAgentMock, findMock, updateMock, emitMock } = vi.hoisted(() => ({
  findMock: vi.fn(),
  updateMock: vi.fn(),
  emitMock: vi.fn(),
  createMock: vi.fn(),
  deleteMock: vi.fn(),
  updateAgentMock: vi.fn(),
  getAgentMock: vi.fn()
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { create: createMock, delete: deleteMock, findByConfig: findMock, update: updateMock }
}))
vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: getAgentMock, updateAgent: updateAgentMock, emitAgentUpdatedForIds: emitMock }
}))

const { createMcpManagerServer } = await import('../mcpManager')

type Result = { isError?: boolean; content: Array<{ type: string; text: string }> }
const clients: Client[] = []

async function createServer(agentId = 'agent-1'): Promise<Client> {
  const client = await connectMcpTestClient(() => createMcpManagerServer(agentId))
  clients.push(client)
  return client
}

async function callTool(client: Client | Promise<Client>, name: string, args: Record<string, unknown>) {
  return (await (await client).callTool({ name, arguments: args })) as Result
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

describe('mcp-manager MCP server', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    updateAgentMock.mockReturnValue({ id: 'agent-1' })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(clients.splice(0).map((client) => client.close()))
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
      expect(updateAgentMock).toHaveBeenCalledWith('agent-1', { mcps: ['server-1'] })
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
    })

    const existing = {
      id: 'existing',
      name: 'my-mcp',
      type: 'stdio',
      command: 'npx',
      isActive: false,
      isTrusted: false,
      installSource: 'manual',
      description: 'original',
      installedAt: 42
    }
    const input = { name: 'my-mcp', command: 'npx' }

    it('reuses an attached server without rewriting the agent MCP set', async () => {
      mockAgent(['existing'])
      findMock.mockReturnValue(existing)
      const result = await callTool(createServer(), 'install_mcp_server', input)
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('already registered')
      expect(result.content[0].text).toContain('ID: existing')
      expect(createMock).not.toHaveBeenCalled()
      expect(deleteMock).not.toHaveBeenCalled()
      expect(updateAgentMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it.each(['throw', 'null'])('keeps an existing shared server when binding fails: %s', async (failure) => {
      mockAgent(['other'])
      findMock.mockReturnValue(existing)
      if (failure === 'throw')
        updateAgentMock.mockImplementation(() => {
          throw new Error('bind failure')
        })
      else updateAgentMock.mockReturnValue(null)
      const result = await callTool(createServer(), 'install_mcp_server', { ...input, activate: true })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Failed to bind existing MCP server existing')
      expect(createMock).not.toHaveBeenCalled()
      expect(deleteMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it.each([false, true])(
      'enables and trusts a reused manual server without replacing its metadata: attached=%s',
      async (attached) => {
        mockAgent(attached ? ['other', 'existing'] : ['other'])
        findMock.mockReturnValue(existing)
        updateMock.mockReturnValue({ ...existing, isActive: true, isTrusted: true, trustedAt: 123 })
        vi.spyOn(Date, 'now').mockReturnValue(123)
        const result = await callTool(createServer(), 'install_mcp_server', { ...input, activate: true })
        expect(result.isError).toBeFalsy()
        expect(result.content[0].text).toContain('ID: existing')
        expect(result.content[0].text).toContain('Active: true\n  Trusted: true')
        expect(result.content[0].text).toContain('shared server definition')
        expect(updateMock).toHaveBeenCalledWith('existing', { isActive: true, isTrusted: true, trustedAt: 123 })
        if (attached) expect(updateAgentMock).not.toHaveBeenCalled()
        else expect(updateAgentMock).toHaveBeenCalledWith('agent-1', { mcps: ['other', 'existing'] })
        expect(emitMock).toHaveBeenCalledWith(['agent-1'], 'mcps')
      }
    )

    it('preserves an existing trust timestamp and only fills a missing or renewed trust timestamp', async () => {
      mockAgent(['existing'])
      vi.spyOn(Date, 'now').mockReturnValue(123)
      const client = await createServer()
      for (const [isTrusted, trustedAt, expected] of [
        [true, 0, 0],
        [true, undefined, 123],
        [false, 5, 123]
      ] as const) {
        findMock.mockReturnValue({ ...existing, isTrusted, trustedAt })
        updateMock.mockReturnValue({ ...existing, isActive: true, isTrusted: true, trustedAt: expected })
        const result = await callTool(client, 'install_mcp_server', { ...input, activate: true })
        expect(result.isError).toBeFalsy()
        expect(updateMock).toHaveBeenLastCalledWith('existing', {
          isActive: true,
          isTrusted: true,
          trustedAt: expected
        })
      }
      updateMock.mockClear()
      emitMock.mockClear()
      findMock.mockReturnValue({ ...existing, isActive: true, isTrusted: true, trustedAt: 0 })
      const result = await callTool(client, 'install_mcp_server', { ...input, activate: true })
      expect(result.content[0].text).toContain('Active: true')
      expect(updateMock).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it.each([undefined, false])(
      'preserves reused activation and trust when activation is not requested: %s',
      async (activate) => {
        mockAgent(['existing'])
        const client = await createServer()
        for (const state of [
          { isActive: true, isTrusted: true },
          { isActive: true, isTrusted: undefined },
          { isActive: false, isTrusted: false }
        ]) {
          findMock.mockReturnValue({ ...existing, ...state })
          const result = await callTool(client, 'install_mcp_server', {
            ...input,
            ...(activate === undefined ? {} : { activate })
          })
          expect(result.content[0].text).toContain(`Active: ${state.isActive}\n  Trusted: ${state.isTrusted ?? false}`)
          expect(result.content[0].text.includes('NOT yet active')).toBe(!state.isActive)
        }
        expect(updateMock).not.toHaveBeenCalled()
        expect(emitMock).not.toHaveBeenCalled()
      }
    )

    it('reports a kept attachment when enabling a reused server fails', async () => {
      mockAgent()
      findMock.mockReturnValue(existing)
      updateMock.mockImplementation(() => {
        throw new Error('update failed')
      })
      const result = await callTool(createServer(), 'install_mcp_server', { ...input, activate: true })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('existing is registered for this agent, but enabling it failed')
      expect(result.content[0].text).toContain('attachment were kept')
      expect(deleteMock).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it('keeps successful activation when the agent refresh fails', async () => {
      mockAgent()
      findMock.mockReturnValue(existing)
      updateMock.mockReturnValue({ ...existing, isActive: true, isTrusted: true, trustedAt: 123 })
      emitMock.mockImplementation(() => {
        throw new Error('refresh failed')
      })
      const result = await callTool(createServer(), 'install_mcp_server', { ...input, activate: true })
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('Active: true\n  Trusted: true')
      expect(result.content[0].text).toContain('Live-session refresh could not be requested')
      expect(deleteMock).not.toHaveBeenCalled()
    })

    it('does not create when matching configuration lookup fails', async () => {
      mockAgent()
      findMock.mockImplementation(() => {
        throw new Error('lookup failed')
      })
      const result = await callTool(createServer(), 'install_mcp_server', input)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('lookup failed')
      expect(createMock).not.toHaveBeenCalled()
      expect(updateAgentMock).not.toHaveBeenCalled()
      expect(deleteMock).not.toHaveBeenCalled()
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

    it.each([
      ['an in-memory transport type', { type: 'inMemory' }],
      ['a field outside the install contract', { isTrusted: true }]
    ])('rejects %s without creating anything', async (_case, extra) => {
      const result = await callTool(createServer(), 'install_mcp_server', { name: 'my-mcp', command: 'npx', ...extra })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Input validation error')
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
      expect(findMock).not.toHaveBeenCalled()
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

    it('rolls back a newly created server when binding returns null', async () => {
      mockAgent()
      mockCreatedServer()
      updateAgentMock.mockReturnValue(null)
      const result = await callTool(createServer(), 'install_mcp_server', { name: 'x', command: 'npx' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Failed to bind MCP server')
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
})
