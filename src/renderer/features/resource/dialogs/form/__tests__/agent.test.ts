import type { AgentDetail } from '@renderer/pages/library/types'
import { describe, expect, it } from 'vitest'

import {
  type AgentFormState,
  applyAgentFormPatch,
  buildInitialAgentFormState,
  diffAgentSaveIntent,
  diffAgentUpdate
} from '../agent'

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

  it('lifts configuration sub-keys onto the flat form object', () => {
    const agent = createAgent({
      configuration: {
        avatar: '🚀',
        permission_mode: 'bypassPermissions',
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
    expect(state.soulEnabled).toBe(true)
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

describe('applyAgentFormPatch', () => {
  it('switching permission mode does not enable soul mode', () => {
    const draft = buildInitialAgentFormState()
    const next = applyAgentFormPatch(draft, { permissionMode: 'acceptEdits' })

    expect(next.permissionMode).toBe('acceptEdits')
    expect(next.soulEnabled).toBe(false)
  })

  it('switching to bypass permissions does not enable soul mode', () => {
    const draft = buildInitialAgentFormState()
    const next = applyAgentFormPatch(draft, { permissionMode: 'bypassPermissions' })

    expect(next.permissionMode).toBe('bypassPermissions')
    expect(next.soulEnabled).toBe(false)
  })

  it('enabling soul mode switches to bypass permissions', () => {
    const draft = buildInitialAgentFormState()
    const next = applyAgentFormPatch(draft, { soulEnabled: true })

    expect(next.soulEnabled).toBe(true)
    expect(next.permissionMode).toBe('bypassPermissions')
  })

  it('leaving bypass permissions disables soul mode to match the legacy settings popup', () => {
    const draft = buildInitialAgentFormState(
      createAgent({
        configuration: { soul_enabled: true, permission_mode: 'bypassPermissions' }
      })
    )
    const next = applyAgentFormPatch(draft, { permissionMode: 'default' })

    expect(next.permissionMode).toBe('default')
    expect(next.soulEnabled).toBe(false)
  })
})

describe('diffAgentSaveIntent', () => {
  it('wraps update diffs for the edit dialog save handler', () => {
    const agent = createAgent()
    const baseline = buildInitialAgentFormState(agent)
    const next = { ...baseline, name: 'Renamed' }

    expect(diffAgentSaveIntent(next, baseline, agent)).toEqual({
      kind: 'update',
      payload: { name: 'Renamed' }
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
  })

  it('preserves UniqueModelIds in the PATCH payload without legacy conversion', () => {
    const agent = createAgent({
      model: 'anthropic::claude-sonnet-4-5',
      planModel: 'anthropic::claude-haiku-4-5',
      smallModel: 'anthropic::claude-opus-4-5'
    })
    const baseline = buildInitialAgentFormState(agent)
    const next: AgentFormState = {
      ...baseline,
      model: 'anthropic::claude-sonnet-4-6',
      planModel: 'anthropic::claude-haiku-4-6',
      smallModel: ''
    }

    const result = diffAgentUpdate(baseline, next, agent)

    expect(result?.dto).toMatchObject({
      model: 'anthropic::claude-sonnet-4-6',
      planModel: 'anthropic::claude-haiku-4-6',
      smallModel: undefined
    })
  })

  it('merges configuration-subkey patches on top of the existing configuration without sending max_turns', () => {
    const agent = createAgent({
      configuration: { avatar: '🤖', plugin_state: 'keep-me', max_turns: 10 }
    })
    const baseline = buildInitialAgentFormState(agent)
    const next = { ...baseline, avatar: '🚀' }

    const result = diffAgentUpdate(baseline, next, agent)
    // plugin_state must be preserved — the library form does not edit it, so
    // it MUST NOT be stripped from the PATCH payload.
    expect(result?.dto.configuration).toEqual({
      avatar: '🚀',
      plugin_state: 'keep-me'
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

  it('preserves env var value whitespace after the first equals sign', () => {
    const agent = createAgent({ configuration: { env_vars: {} } })
    const baseline = buildInitialAgentFormState(agent)
    const next = { ...baseline, envVarsText: 'TOKEN= abc \nEMPTY=  \nSPACED_KEY =value=with=equals' }

    const result = diffAgentUpdate(baseline, next, agent)
    expect(result?.dto.configuration).toMatchObject({
      env_vars: {
        TOKEN: ' abc ',
        EMPTY: '  ',
        SPACED_KEY: 'value=with=equals'
      }
    })
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
})
