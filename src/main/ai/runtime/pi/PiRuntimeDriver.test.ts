import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { McpTool } from '@shared/types/mcp'

import { ApiGatewayNotRunningError } from '../agentApiGateway'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  findByIdOrName: vi.fn(),
  listTools: vi.fn(),
  prepareWorkspace: vi.fn(),
  assertProviderUsable: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.getAgent } }))
vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: mocks.findByIdOrName }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ McpCatalogService: { listTools: mocks.listTools } } as never)
})
vi.mock('@main/ai/runtime/agentSessionWorkspace', () => ({
  prepareAgentSessionWorkspaceDirectory: mocks.prepareWorkspace
}))
vi.mock('./modelInjection', () => ({ assertPiProviderUsable: mocks.assertProviderUsable }))
vi.mock('./PiRuntimeConnection', () => ({ PiRuntimeConnection: vi.fn() }))

const { PiRuntimeDriver } = await import('./PiRuntimeDriver')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listTools.mockReturnValue([])
  mocks.prepareWorkspace.mockResolvedValue(undefined)
  mocks.assertProviderUsable.mockResolvedValue(undefined)
})

describe('PiRuntimeDriver.validateSession', () => {
  it('rejects a gateway-only session and offers to enable the gateway', async () => {
    mocks.getAgent.mockReturnValue({ model: 'provider::model' })
    mocks.assertProviderUsable.mockRejectedValueOnce(new ApiGatewayNotRunningError())
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { path: '/workspace', type: 'user' }
    } as AgentSessionEntity
    await expect(new PiRuntimeDriver().validateSession(session)).rejects.toMatchObject({
      name: 'ApiGatewayNotRunningError',
      i18nKey: 'api_gateway_required'
    })
    expect(application.get('IpcApiService').broadcast).toHaveBeenCalledWith('api_gateway.required', {
      sessionId: 'session-1'
    })
  })
})

describe('PiRuntimeDriver.listAvailableTools', () => {
  it('returns the pi builtin set when no MCP servers are selected', async () => {
    const tools = await new PiRuntimeDriver().listAvailableTools([])

    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every((tool) => tool.origin === 'builtin')).toBe(true)
    expect(mocks.findByIdOrName).not.toHaveBeenCalled()
  })

  it('appends bridged MCP tools (prompt-gated) after the builtins', async () => {
    mocks.findByIdOrName.mockReturnValue({ id: 'srv-1', name: 'github' })
    mocks.listTools.mockReturnValue([{ name: 'search_issues', description: 'Search issues' } as McpTool])

    const tools = await new PiRuntimeDriver().listAvailableTools(['srv-1'])
    const mcpTools = tools.filter((tool) => tool.origin === 'mcp')

    expect(mocks.listTools).toHaveBeenCalledWith('srv-1', { includeDisabled: false })
    expect(mcpTools).toEqual([
      expect.objectContaining({
        id: 'mcp__srv_1__search_issues',
        name: 'search_issues',
        approval: 'prompt',
        sourceId: 'srv-1',
        sourceName: 'github'
      })
    ])
  })

  it('skips MCP server ids that no longer resolve', async () => {
    mocks.findByIdOrName.mockReturnValue(null)

    const tools = await new PiRuntimeDriver().listAvailableTools(['gone'])

    expect(tools.every((tool) => tool.origin === 'builtin')).toBe(true)
    expect(mocks.listTools).not.toHaveBeenCalled()
  })
})
