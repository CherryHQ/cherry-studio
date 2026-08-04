import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appGet: vi.fn(),
  ensure: vi.fn(),
  loadDefaults: vi.fn(),
  preferenceGet: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: mocks.appGet } }))
vi.mock('@data/services/AgentService', () => ({
  agentService: { ensureBuiltinAssistant: mocks.ensure }
}))
vi.mock('@data/builtinAgentDefinition', () => ({
  loadBuiltinAssistantDefaults: mocks.loadDefaults
}))

import { ensureBuiltinAssistant } from '../ensureBuiltinAssistant'

describe('ensureBuiltinAssistant command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appGet.mockReturnValue({ get: mocks.preferenceGet })
    mocks.preferenceGet.mockReturnValue('anthropic::claude-sonnet-4-5')
    mocks.loadDefaults.mockReturnValue({
      name: 'Cherry Assistant',
      configuration: {
        avatar: '🍒',
        permission_mode: 'default',
        max_turns: 100,
        bootstrap_completed: true,
        builtin_role: 'assistant',
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
        bootstrap_completed: true,
        builtin_role: 'assistant',
        env_vars: {}
      }
    })
    expect(mocks.loadDefaults).toHaveBeenCalledOnce()
  })

  it('refuses to create a system Agent from an invalid package definition', () => {
    mocks.loadDefaults.mockImplementation(() => {
      throw new Error('Cherry Assistant package configuration is invalid: max_turns')
    })

    expect(() => ensureBuiltinAssistant()).toThrow('Cherry Assistant package configuration is invalid')
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it('fails when the package definition is unavailable', () => {
    mocks.loadDefaults.mockImplementation(() => {
      throw new Error('Cherry Assistant package definition is unavailable')
    })

    expect(() => ensureBuiltinAssistant()).toThrow('Cherry Assistant package definition is unavailable')
    expect(mocks.ensure).not.toHaveBeenCalled()
  })
})
