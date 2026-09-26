import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpTool } from '@shared/types/mcp'

const mocks = vi.hoisted(() => ({
  findByIdOrName: vi.fn(),
  listTools: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({ agentService: {} }))
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
  prepareAgentSessionWorkspaceDirectory: vi.fn()
}))
vi.mock('./modelInjection', () => ({ assertDshProviderUsable: vi.fn() }))
vi.mock('./DshRuntimeConnection', () => ({ DshRuntimeConnection: vi.fn() }))

const { DshRuntimeDriver } = await import('./DshRuntimeDriver')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listTools.mockReturnValue([])
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
