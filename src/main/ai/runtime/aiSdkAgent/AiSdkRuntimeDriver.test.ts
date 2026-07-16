import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  findByIdOrName: vi.fn(),
  listTools: vi.fn(),
  resolveAndAssert: vi.fn(),
  start: vi.fn()
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
vi.mock('./validateModel', () => ({ resolveAndAssertAiSdkAgentModel: mocks.resolveAndAssert }))
vi.mock('./AiSdkRuntimeConnection', () => ({
  AiSdkRuntimeConnection: class {
    constructor(readonly input: unknown) {}
    start = mocks.start
  }
}))

const { AiSdkRuntimeDriver } = await import('./AiSdkRuntimeDriver')

function makeSession(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'sess-1',
    agentId: 'agent-1',
    workspace: { path: '/work', type: 'user' },
    ...overrides
  } as AgentSessionEntity
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'openai::gpt-4o' })
  mocks.listTools.mockReturnValue([])
})

describe('AiSdkRuntimeDriver.validateSession', () => {
  it('rejects a session without a workspace', async () => {
    await expect(new AiSdkRuntimeDriver().validateSession(makeSession({ workspace: undefined }))).rejects.toThrow(
      /no workspace/
    )
  })

  it('rejects a session without an agent or a model', async () => {
    await expect(new AiSdkRuntimeDriver().validateSession(makeSession({ agentId: null }))).rejects.toThrow(/no agent/)

    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: null })
    await expect(new AiSdkRuntimeDriver().validateSession(makeSession())).rejects.toThrow(/no model/)
  })

  it('delegates provider/model usability to the shared fail-closed validation', async () => {
    mocks.resolveAndAssert.mockImplementation(() => {
      throw new Error('unsupported model')
    })
    await expect(new AiSdkRuntimeDriver().validateSession(makeSession())).rejects.toThrow('unsupported model')
    expect(mocks.resolveAndAssert).toHaveBeenCalledWith('openai::gpt-4o')
  })
})

describe('AiSdkRuntimeDriver.listAvailableTools', () => {
  it('returns the builtin set when no MCP servers are selected', async () => {
    const tools = await new AiSdkRuntimeDriver().listAvailableTools([])

    expect(tools.map((tool) => tool.id)).toEqual(['read', 'ls', 'glob', 'grep', 'write', 'edit', 'bash', 'skill'])
    expect(tools.every((tool) => tool.origin === 'builtin')).toBe(true)
    expect(mocks.findByIdOrName).not.toHaveBeenCalled()
  })

  it('appends selected MCP tools (prompt-gated) after the builtins', async () => {
    mocks.findByIdOrName.mockReturnValue({ id: 'srv-1', name: 'github' } as McpServer)
    mocks.listTools.mockReturnValue([{ name: 'search_issues', description: 'Search issues' } as McpTool])

    const tools = await new AiSdkRuntimeDriver().listAvailableTools(['srv-1'])
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

    const tools = await new AiSdkRuntimeDriver().listAvailableTools(['gone'])

    expect(tools.every((tool) => tool.origin === 'builtin')).toBe(true)
    expect(mocks.listTools).not.toHaveBeenCalled()
  })
})

describe('AiSdkRuntimeDriver.connect', () => {
  it('starts a connection for the session', async () => {
    const started = {}
    mocks.start.mockResolvedValue(started)

    const connection = await new AiSdkRuntimeDriver().connect({
      sessionId: 'sess-1',
      agentId: 'agent-1',
      modelId: 'openai::gpt-4o'
    })

    expect(connection).toBe(started)
    expect(mocks.start).toHaveBeenCalledTimes(1)
  })
})
