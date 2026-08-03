import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appGet: vi.fn(),
  ensure: vi.fn(),
  loadDefinition: vi.fn(),
  preferenceGet: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: mocks.appGet } }))
vi.mock('@data/services/AgentService', () => ({
  agentService: { ensureBuiltinAssistant: mocks.ensure }
}))
vi.mock('@main/ai/agents/builtin/BuiltinAgentProvisioner', () => ({
  loadBuiltinAgentDefinition: mocks.loadDefinition
}))

import { ensureBuiltinAssistant } from '../ensureBuiltinAssistant'

describe('ensureBuiltinAssistant command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appGet.mockReturnValue({ get: mocks.preferenceGet })
    mocks.preferenceGet.mockReturnValue('anthropic::claude-sonnet-4-5')
    mocks.loadDefinition.mockReturnValue({
      name: 'Cherry Assistant',
      configuration: {
        avatar: '🍒',
        permission_mode: 'default',
        max_turns: 100,
        env_vars: {}
      }
    })
    mocks.ensure.mockReturnValue({ id: 'assistant-1' })
  })

  it('uses the current package definition and configured default model', () => {
    expect(ensureBuiltinAssistant()).toEqual({ id: 'assistant-1' })

    expect(mocks.appGet).toHaveBeenCalledWith('PreferenceService')
    expect(mocks.preferenceGet).toHaveBeenCalledWith('chat.default_model_id')
    expect(mocks.ensure).toHaveBeenCalledWith({
      name: 'Cherry Assistant',
      defaultModelId: 'anthropic::claude-sonnet-4-5',
      configuration: {
        avatar: '🍒',
        permission_mode: 'default',
        max_turns: 100,
        env_vars: {}
      }
    })
  })

  it('refuses to create a system Agent from an invalid package definition', () => {
    mocks.loadDefinition.mockReturnValue({
      name: 'Cherry Assistant',
      configuration: { max_turns: 'invalid' }
    })

    expect(() => ensureBuiltinAssistant()).toThrow('Cherry Assistant package configuration is invalid')
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it('fails when the package definition is unavailable', () => {
    mocks.loadDefinition.mockReturnValue(undefined)

    expect(() => ensureBuiltinAssistant()).toThrow('Cherry Assistant package definition is unavailable')
    expect(mocks.ensure).not.toHaveBeenCalled()
  })
})
