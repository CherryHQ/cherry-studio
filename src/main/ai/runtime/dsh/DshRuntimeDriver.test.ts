import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { McpTool } from '@shared/types/mcp'

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
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'McpCatalogService') return { listTools: mocks.listTools }
      throw new Error(`unexpected service ${name}`)
    }
  }
}))
vi.mock('@main/ai/runtime/agentSessionWorkspace', () => ({
  prepareAgentSessionWorkspaceDirectory: mocks.prepareWorkspace
}))
vi.mock('./modelInjection', () => ({ assertDshProviderUsable: mocks.assertProviderUsable }))
vi.mock('./DshRuntimeConnection', () => ({ DshRuntimeConnection: vi.fn() }))

const { DshRuntimeDriver } = await import('./DshRuntimeDriver')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listTools.mockReturnValue([])
  mocks.prepareWorkspace.mockResolvedValue(undefined)
  mocks.assertProviderUsable.mockResolvedValue(undefined)
})

describe('DshRuntimeDriver.validateSession', () => {
  it('prefers the session model override for interactive turns', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      model: 'other::model-x',
      workspace: { path: '/tmp' }
    } as unknown as AgentSessionEntity
    mocks.getAgent.mockReturnValue({ model: 'provider::model' })

    await new DshRuntimeDriver().validateSession(session)

    expect(mocks.assertProviderUsable).toHaveBeenCalledWith('other::model-x')
  })

  it('validates the agent default for headless runs even when an override is set', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      model: 'other::model-x',
      workspace: { path: '/tmp' }
    } as unknown as AgentSessionEntity
    mocks.getAgent.mockReturnValue({ model: 'provider::model' })

    await new DshRuntimeDriver().validateSession(session, { headless: true })

    expect(mocks.assertProviderUsable).toHaveBeenCalledWith('provider::model')
  })

  it('rejects headless runs when the agent default is cleared even when an override is set', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      model: 'other::model-x',
      workspace: { path: '/tmp' }
    } as unknown as AgentSessionEntity
    mocks.getAgent.mockReturnValue({ model: null })

    await expect(new DshRuntimeDriver().validateSession(session, { headless: true })).rejects.toThrow(
      'has no model configured'
    )
    expect(mocks.assertProviderUsable).not.toHaveBeenCalled()
  })
})

describe('DshRuntimeDriver.listAvailableTools', () => {
  it('returns the dsh builtin set when no MCP servers are selected', async () => {
    const tools = await new DshRuntimeDriver().listAvailableTools([])

    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every((tool) => tool.origin === 'builtin')).toBe(true)
    expect(mocks.findByIdOrName).not.toHaveBeenCalled()
  })

  it('uses the host-bridge public name and prompts for third-party MCP tools', async () => {
    mocks.findByIdOrName.mockReturnValue({ id: 'srv-1', name: 'github' })
    mocks.listTools.mockReturnValue([{ name: 'search_issues', description: 'Search issues' } as McpTool])

    const tools = await new DshRuntimeDriver().listAvailableTools(['srv-1'])

    expect(tools.filter((tool) => tool.origin === 'mcp')).toEqual([
      expect.objectContaining({
        id: 'mcp__github__search_issues',
        name: 'search_issues',
        approval: 'prompt',
        sourceId: 'srv-1',
        sourceName: 'github'
      })
    ])
  })

  it('auto-approves safe Cherry tools but keeps sensitive Cherry tools prompt-gated', async () => {
    mocks.findByIdOrName.mockReturnValue({ id: 'cherry-id', name: 'cherry-tools' })
    mocks.listTools.mockReturnValue([
      { name: 'web_search', description: 'Search the web' } as McpTool,
      { name: 'kb_manage', description: 'Manage knowledge' } as McpTool
    ])

    const tools = await new DshRuntimeDriver().listAvailableTools(['cherry-id'])

    expect(tools.find((tool) => tool.id === 'mcp__cherry-tools__web_search')?.approval).toBe('auto')
    expect(tools.find((tool) => tool.id === 'mcp__cherry-tools__kb_manage')?.approval).toBe('prompt')
  })

  it('skips MCP server ids that no longer resolve', async () => {
    mocks.findByIdOrName.mockReturnValue(null)

    const tools = await new DshRuntimeDriver().listAvailableTools(['gone'])

    expect(tools.every((tool) => tool.origin === 'builtin')).toBe(true)
    expect(mocks.listTools).not.toHaveBeenCalled()
  })
})
