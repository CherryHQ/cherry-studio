import type { AgentDetail } from '@shared/data/types/agent'
import { describe, expect, it } from 'vitest'

import {
  buildInitialAgentFormState,
  diffAgentUpdate,
  isCreatePayloadValid,
  validateAgentCreateForm
} from '../descriptor'

function createAgent(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: 'a-1',
    type: 'claude-code',
    name: 'Agent',
    description: '',
    model: 'claude-sonnet-4-5',
    accessiblePaths: [],
    instructions: '',
    mcps: [],
    allowedTools: [],
    configuration: {},
    tags: [],
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
      model: 'm-1',
      planModel: 'p-1',
      smallModel: 's-1',
      instructions: 'hi',
      accessiblePaths: ['/a', '/b'],
      mcps: ['mcp-1'],
      allowedTools: ['Read']
    })
    const state = buildInitialAgentFormState(agent)
    expect(state).toMatchObject({
      name: 'Demo',
      description: 'd',
      model: 'm-1',
      planModel: 'p-1',
      smallModel: 's-1',
      instructions: 'hi',
      accessiblePaths: ['/a', '/b'],
      mcps: ['mcp-1'],
      allowedTools: ['Read']
    })
  })

  it('lifts configuration sub-keys onto the flat form object', () => {
    const agent = createAgent({
      configuration: {
        avatar: '🚀',
        permission_mode: 'bypassPermissions',
        max_turns: 10,
        soul_enabled: true,
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
    expect(state.maxTurns).toBe(10)
    expect(state.soulEnabled).toBe(true)
    expect(state.heartbeatEnabled).toBe(true)
    expect(state.heartbeatInterval).toBe(15)
    expect(state.envVarsText).toBe('DEBUG=1\nNODE_ENV=production')
  })

  it('maps the default max_turns value to the form sentinel 0', () => {
    const agent = createAgent({
      configuration: {
        max_turns: 100
      }
    })

    const state = buildInitialAgentFormState(agent)
    expect(state.maxTurns).toBe(0)
  })
})

describe('agent create flow helpers', () => {
  it('requires both name and model before create save is enabled', () => {
    const draft = buildInitialAgentFormState()

    expect(isCreatePayloadValid(draft)).toBe(false)
    expect(isCreatePayloadValid({ ...draft, name: 'Planner' })).toBe(false)
    expect(isCreatePayloadValid({ ...draft, model: 'claude-sonnet-4-5' })).toBe(false)
    expect(isCreatePayloadValid({ ...draft, name: 'Planner', model: 'claude-sonnet-4-5' })).toBe(true)
  })

  it('reports missing required fields individually for page-level validation', () => {
    const draft = buildInitialAgentFormState()

    expect(validateAgentCreateForm(draft)).toEqual({
      nameMissing: true,
      modelMissing: true,
      isValid: false
    })
    expect(validateAgentCreateForm({ ...draft, name: 'Planner' })).toEqual({
      nameMissing: false,
      modelMissing: true,
      isValid: false
    })
  })
})

describe('diffAgentUpdate', () => {
  it('returns null when nothing changed', () => {
    const agent = createAgent()
    const baseline = buildInitialAgentFormState(agent)
    expect(diffAgentUpdate(baseline, baseline, agent)).toBeNull()
  })

  it('includes only changed top-level keys in the PATCH payload', () => {
    const agent = createAgent()
    const baseline = buildInitialAgentFormState(agent)
    const next = { ...baseline, name: 'Renamed', instructions: 'new prompt' }

    const result = diffAgentUpdate(baseline, next, agent)
    expect(result?.dto).toEqual({
      name: 'Renamed',
      instructions: 'new prompt'
    })
    expect(result?.tagsChanged).toBe(false)
  })

  it('merges configuration-subkey patches on top of the existing configuration', () => {
    const agent = createAgent({
      configuration: { avatar: '🤖', plugin_state: 'keep-me' }
    })
    const baseline = buildInitialAgentFormState(agent)
    const next = { ...baseline, avatar: '🚀', maxTurns: 5 }

    const result = diffAgentUpdate(baseline, next, agent)
    // plugin_state must be preserved — the library form does not edit it, so
    // it MUST NOT be stripped from the PATCH payload.
    expect(result?.dto.configuration).toEqual({
      avatar: '🚀',
      plugin_state: 'keep-me',
      max_turns: 5
    })
  })

  it('round-trips env_vars through the textarea format', () => {
    const agent = createAgent({ configuration: { env_vars: { A: '1' } } })
    const baseline = buildInitialAgentFormState(agent)
    // User appends a line via the textarea control.
    const next = { ...baseline, envVarsText: 'A=1\nB=2' }

    const result = diffAgentUpdate(baseline, next, agent)
    expect(result?.dto.configuration).toMatchObject({
      env_vars: {
        A: '1',
        B: '2'
      }
    })
  })

  it('emits the accessiblePaths array when list contents change', () => {
    const agent = createAgent({ accessiblePaths: ['/a'] })
    const baseline = buildInitialAgentFormState(agent)
    const next = { ...baseline, accessiblePaths: ['/a', '/b'] }

    const result = diffAgentUpdate(baseline, next, agent)
    expect(result?.dto.accessiblePaths).toEqual(['/a', '/b'])
  })

  it('persists the explicit default permission mode when switching back from another mode', () => {
    const agent = createAgent({ configuration: { permission_mode: 'plan' } })
    const baseline = buildInitialAgentFormState(agent)
    const next = { ...baseline, permissionMode: 'default' }

    const result = diffAgentUpdate(baseline, next, agent)
    expect(result?.dto.configuration).toMatchObject({
      permission_mode: 'default'
    })
  })

  it('restores max_turns to the schema default when the form uses the 0 sentinel', () => {
    const agent = createAgent({ configuration: { max_turns: 5 } })
    const baseline = buildInitialAgentFormState(agent)
    const next = { ...baseline, maxTurns: 0 }

    const result = diffAgentUpdate(baseline, next, agent)
    expect(result?.dto.configuration).toMatchObject({
      max_turns: 100
    })
  })

  it('flags tag-only changes as save-worthy', () => {
    const agent = createAgent()
    const baseline = buildInitialAgentFormState(agent)
    const next = { ...baseline, tags: ['work'] }

    const result = diffAgentUpdate(baseline, next, agent)
    expect(result).not.toBeNull()
    expect(result?.tagsChanged).toBe(true)
    expect(result?.tagNames).toEqual(['work'])
    // The dto itself stays empty — tagIds resolution lives at the page level.
    expect(result?.dto).toEqual({})
  })
})
