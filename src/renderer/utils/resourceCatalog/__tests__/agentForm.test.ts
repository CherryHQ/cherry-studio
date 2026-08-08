import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { describe, expect, it } from 'vitest'

import { agentEnvVarsFromText, buildInitialAgentFormState } from '../agentForm'

function createAgent(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: 'a-1',
    type: 'claude-code',
    name: 'Agent',
    description: '',
    model: 'anthropic::claude-sonnet-4-5',
    modelName: null,
    instructions: '',
    mcps: [],
    configuration: {},
    orderKey: 'k',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    ...overrides
  }
}

describe('buildInitialAgentFormState', () => {
  it('copies AgentBase fields to form state', () => {
    const agent = createAgent({
      name: 'Demo',
      description: 'd',
      model: 'p-1::m-1',
      planModel: 'p-1::p-1',
      smallModel: 'p-1::s-1',
      instructions: 'hi',
      mcps: ['mcp-1']
    })
    const state = buildInitialAgentFormState(agent)
    expect(state).toMatchObject({
      name: 'Demo',
      description: 'd',
      model: 'p-1::m-1',
      planModel: 'p-1::p-1',
      smallModel: 'p-1::s-1',
      instructions: 'hi',
      mcps: ['mcp-1']
    })
  })

  it('uses the provided enabled skill ids as form state', () => {
    const state = buildInitialAgentFormState(createAgent(), ['skill-1', 'skill-2'])

    expect(state.skillIds).toEqual(['skill-1', 'skill-2'])
  })

  it('lifts configuration sub-keys onto the flat form object', () => {
    const agent = createAgent({
      configuration: {
        avatar: '🚀',
        permission_mode: 'bypassPermissions',
        heartbeat_enabled: true,
        heartbeat_interval: 15,
        env_vars: {
          DEBUG: '1',
          NODE_ENV: 'production'
        }
      }
    })
    const state = buildInitialAgentFormState(agent)
    expect(state.avatar).toBe('🚀')
    expect(state.permissionMode).toBe('bypassPermissions')
    expect(state.heartbeatEnabled).toBe(true)
    expect(state.heartbeatInterval).toBe(15)
    expect(state.envVarsText).toBe('DEBUG=1\nNODE_ENV=production')
  })

  it('uses the legacy heartbeat defaults when configuration omits heartbeat keys', () => {
    const state = buildInitialAgentFormState(createAgent({ configuration: {} }))

    expect(state.heartbeatEnabled).toBe(true)
    expect(state.heartbeatInterval).toBe(30)
  })
})

describe('agentEnvVarsFromText', () => {
  it('parses KEY=VALUE lines, dropping blanks and keeping `=` inside values', () => {
    expect(agentEnvVarsFromText('DEBUG=1\n\nURL=https://x?a=b\n')).toEqual({
      DEBUG: '1',
      URL: 'https://x?a=b'
    })
  })

  it('treats a line without `=` as an empty value', () => {
    expect(agentEnvVarsFromText(' DEBUG ')).toEqual({ DEBUG: '' })
  })
})
