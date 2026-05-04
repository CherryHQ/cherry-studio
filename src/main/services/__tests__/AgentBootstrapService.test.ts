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

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: { getModels: vi.fn() }
}))
vi.mock('@main/services/agents/services/SchedulerService', () => ({
  schedulerService: { runTaskNow: vi.fn(), restoreSchedulers: vi.fn(), stopAll: vi.fn() }
}))
vi.mock('@main/services/agents/services/channels', () => ({
  channelManager: { start: vi.fn(), stop: vi.fn() }
}))
vi.mock('@main/services/agents/services/channels/sessionStreamIpc', () => ({
  registerSessionStreamIpc: vi.fn()
}))
vi.mock('@main/services/agents/services/builtin/BuiltinAgentBootstrap', () => ({
  bootstrapBuiltinAgents: vi.fn()
}))
vi.mock('../utils/rtk', () => ({ extractRtkBinaries: vi.fn() }))

import { validateGetModelsFilter, validateRunTaskArgs } from '../AgentBootstrapService'

describe('AgentBootstrapService validators', () => {
  it('accepts valid run-task args', () => {
    expect(validateRunTaskArgs('agent_1', 'task_1')).toEqual({ agentId: 'agent_1', taskId: 'task_1' })
  })

  it('rejects empty run-task args', () => {
    expect(() => validateRunTaskArgs('', 'task_1')).toThrow()
    expect(() => validateRunTaskArgs('agent_1', '')).toThrow()
  })

  it('parses and defaults model filters', () => {
    expect(validateGetModelsFilter(undefined)).toEqual({ offset: 0, limit: 20 })
    expect(validateGetModelsFilter({ providerType: 'anthropic', limit: '5', offset: '1' })).toEqual({
      providerType: 'anthropic',
      limit: 5,
      offset: 1
    })
  })

  it('rejects invalid model filters', () => {
    expect(() => validateGetModelsFilter({ providerType: 'nope' })).toThrow()
    expect(() => validateGetModelsFilter({ limit: 0 })).toThrow()
  })
})
