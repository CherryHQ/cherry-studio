import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appGet: vi.fn(),
  ensure: vi.fn(),
  loadDefaults: vi.fn(),
  preferenceGet: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: mocks.appGet } }))
vi.mock('@data/services/AgentService', () => ({
  agentService: { ensureBuiltinAgent: mocks.ensure }
}))
vi.mock('../builtin/builtinAgentDefinition', () => ({
  loadBuiltinAgentDefaults: mocks.loadDefaults
}))

import { ensureBuiltinAgent } from '../ensureBuiltinAgent'

describe('ensureBuiltinAgent command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appGet.mockReturnValue({ get: mocks.preferenceGet })
    mocks.preferenceGet.mockReturnValue('anthropic::claude-sonnet-4-5')
    mocks.loadDefaults.mockReturnValue({
      name: 'Cherry Support',
      configuration: {
        avatar: '🧰',
        permission_mode: 'default',
        bootstrap_completed: true,
        builtin_role: 'support',
        env_vars: {}
      }
    })
    mocks.ensure.mockReturnValue({ id: 'support-1' })
  })

  it('uses the current package definition and configured default model', () => {
    expect(ensureBuiltinAgent('support')).toEqual({ id: 'support-1' })

    expect(mocks.appGet).toHaveBeenCalledWith('PreferenceService')
    expect(mocks.preferenceGet).toHaveBeenCalledWith('chat.default_model_id')
    expect(mocks.ensure).toHaveBeenCalledWith({
      name: 'Cherry Support',
      builtinRole: 'support',
      preferredModelId: 'anthropic::claude-sonnet-4-5',
      type: 'claude-code',
      configuration: {
        avatar: '🧰',
        permission_mode: 'default',
        bootstrap_completed: true,
        builtin_role: 'support',
        env_vars: {}
      }
    })
    expect(mocks.loadDefaults).toHaveBeenCalledWith('support')
  })

  it('refuses to create a system Agent from an invalid package definition', () => {
    mocks.loadDefaults.mockImplementation(() => {
      throw new Error('Builtin Agent package configuration is invalid for support: permission_mode')
    })

    expect(() => ensureBuiltinAgent('support')).toThrow('Builtin Agent package configuration is invalid')
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it('fails when the package definition is unavailable', () => {
    mocks.loadDefaults.mockImplementation(() => {
      throw new Error('Builtin Agent package definition is unavailable: support')
    })

    expect(() => ensureBuiltinAgent('support')).toThrow('Builtin Agent package definition is unavailable')
    expect(mocks.ensure).not.toHaveBeenCalled()
  })
})
