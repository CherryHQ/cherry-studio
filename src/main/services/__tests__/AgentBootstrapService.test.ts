import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {}
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    DependsOn: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

vi.mock('@main/services/agents/agentUtils', () => ({
  listMcpTools: vi.fn()
}))
vi.mock('../agents/agentUtils', () => ({
  listMcpTools: vi.fn()
}))
vi.mock('@main/services/agents/services/SchedulerService', () => ({
  schedulerService: { runTaskNow: vi.fn(), restoreSchedulers: vi.fn(), stopAll: vi.fn() }
}))
vi.mock('@main/services/agents/services/channels', () => ({
  channelManager: { start: vi.fn(), stop: vi.fn() }
}))
vi.mock('@main/services/agents/services/builtin/BuiltinAgentBootstrap', () => ({
  bootstrapBuiltinAgents: vi.fn()
}))
vi.mock('../utils/rtk', () => ({ extractRtkBinaries: vi.fn() }))

import { validateListToolsArgs, validateRunTaskArgs } from '../AgentBootstrapService'

describe('AgentBootstrapService validators', () => {
  it('accepts valid run-task args', () => {
    expect(validateRunTaskArgs('agent_1', 'task_1')).toEqual({ agentId: 'agent_1', taskId: 'task_1' })
  })

  it('rejects empty run-task args', () => {
    expect(() => validateRunTaskArgs('', 'task_1')).toThrow()
    expect(() => validateRunTaskArgs('agent_1', '')).toThrow()
  })

  it('parses and defaults list-tools args', () => {
    expect(validateListToolsArgs(undefined)).toEqual({ type: 'claude-code', mcps: [] })
    expect(validateListToolsArgs({ mcps: ['mcp-1'] })).toEqual({ type: 'claude-code', mcps: ['mcp-1'] })
  })
})
