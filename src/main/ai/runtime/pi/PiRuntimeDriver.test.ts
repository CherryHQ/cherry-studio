import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  findByIdOrName: vi.fn(),
  listTools: vi.fn()
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
vi.mock('./modelInjection', () => ({ assertPiProviderUsable: vi.fn() }))
vi.mock('./PiRuntimeConnection', () => ({ PiRuntimeConnection: vi.fn() }))

const { PiRuntimeDriver } = await import('./PiRuntimeDriver')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listTools.mockReturnValue([])
})

describe('PiRuntimeDriver.listAvailableTools', () => {
  it('returns the pi builtin set when no MCP servers are selected', async () => {
    const tools = await new PiRuntimeDriver().listAvailableTools([])

    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every((tool) => tool.origin === 'builtin')).toBe(true)
    expect(mocks.findByIdOrName).not.toHaveBeenCalled()
  })

  it('appends bridged MCP tools (prompt-gated) after the builtins', async () => {
    mocks.findByIdOrName.mockReturnValue({ id: 'srv-1', name: 'github' } as McpServer)
    mocks.listTools.mockReturnValue([{ name: 'search_issues', description: 'Search issues' } as McpTool])

    const tools = await new PiRuntimeDriver().listAvailableTools(['srv-1'])
    const mcpTools = tools.filter((tool) => tool.origin === 'mcp')

    expect(mocks.listTools).toHaveBeenCalledWith('srv-1', { includeDisabled: false })
    expect(mcpTools).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^mcp__/),
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
