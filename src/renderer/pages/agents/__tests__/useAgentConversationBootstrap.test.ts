import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

const mocks = vi.hoisted(() => ({
  agent: undefined as any,
  agentLoading: false,
  agentLookupId: undefined as string | null | undefined,
  modelLookupId: undefined as string | null | undefined
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: (agentId: string | null) => {
    mocks.agentLookupId = agentId
    return { agent: mocks.agent, isLoading: mocks.agentLoading }
  }
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: (modelId: string | null | undefined) => {
    mocks.modelLookupId = modelId
    return {
      model: modelId ? { id: modelId, providerId: modelId.split('::')[0] } : undefined,
      isLoading: Boolean(modelId)
    }
  }
}))

import { useAgentConversationBootstrap } from '../useAgentConversationBootstrap'

const session = { id: 'session-1', agentId: 'agent-1' } as AgentSessionEntity

describe('useAgentConversationBootstrap', () => {
  beforeEach(() => {
    mocks.agent = undefined
    mocks.agentLoading = false
    mocks.agentLookupId = undefined
    mocks.modelLookupId = undefined
  })

  it('uses the list agent as a key hint while the canonical agent is loading', () => {
    mocks.agentLoading = true

    const { result } = renderHook(() =>
      useAgentConversationBootstrap({
        session,
        sessionLoading: false,
        sessionSource: 'query',
        agentHint: { id: 'agent-1', model: 'provider-hint::model-hint' }
      })
    )

    expect(mocks.agentLookupId).toBe('agent-1')
    expect(mocks.modelLookupId).toBe('provider-hint::model-hint')
    expect(result.current.resources.model?.id).toBe('provider-hint::model-hint')
  })

  it('switches the model key to the canonical agent result', () => {
    mocks.agentLoading = true
    const { rerender, result } = renderHook(() =>
      useAgentConversationBootstrap({
        session,
        sessionLoading: false,
        sessionSource: 'query',
        agentHint: { id: 'agent-1', model: 'provider-hint::model-hint' }
      })
    )

    expect(mocks.modelLookupId).toBe('provider-hint::model-hint')
    mocks.agent = { id: 'agent-1', model: 'provider-canonical::model-canonical' }
    rerender()

    expect(mocks.modelLookupId).toBe('provider-canonical::model-canonical')
    expect(result.current.resources.agent).toBe(mocks.agent)
  })

  it('does not use a hint from a different agent', () => {
    renderHook(() =>
      useAgentConversationBootstrap({
        session,
        sessionLoading: false,
        sessionSource: 'query',
        agentHint: { id: 'agent-2', model: 'provider-stale::model-stale' }
      })
    )

    expect(mocks.modelLookupId).toBeUndefined()
  })

  it('prefers a per-session model override over the agent default', () => {
    mocks.agent = { id: 'agent-1', model: 'provider-canonical::model-canonical' }

    const { result } = renderHook(() =>
      useAgentConversationBootstrap({
        session: { ...session, model: 'provider-session::model-session' },
        sessionLoading: false,
        sessionSource: 'query',
        agentHint: { id: 'agent-1', model: 'provider-hint::model-hint' }
      })
    )

    expect(mocks.modelLookupId).toBe('provider-session::model-session')
    expect(result.current.resources.model?.id).toBe('provider-session::model-session')
  })

  it('keeps sibling sessions of the same agent on independent models', () => {
    mocks.agent = { id: 'agent-1', model: 'provider-canonical::model-canonical' }
    const base = {
      sessionLoading: false as const,
      sessionSource: 'query' as const,
      agentHint: { id: 'agent-1', model: 'provider-hint::model-hint' as const }
    }

    const first = renderHook(() =>
      useAgentConversationBootstrap({
        ...base,
        sessionSource: 'query',
        session: { ...session, id: 'session-a', model: 'provider-a::model-a' }
      })
    )
    const second = renderHook(() =>
      useAgentConversationBootstrap({
        ...base,
        sessionSource: 'query',
        session: { ...session, id: 'session-b', model: 'provider-b::model-b' }
      })
    )

    expect(first.result.current.resources.model?.id).toBe('provider-a::model-a')
    expect(second.result.current.resources.model?.id).toBe('provider-b::model-b')
  })

  it('does not revive the hint once the agent resolves without a model', () => {
    mocks.agent = { id: 'agent-1', model: null }

    const { result } = renderHook(() =>
      useAgentConversationBootstrap({
        session,
        sessionLoading: false,
        sessionSource: 'query',
        agentHint: { id: 'agent-1', model: 'provider-hint::model-hint' }
      })
    )

    expect(mocks.modelLookupId).toBeNull()
    expect(result.current.resources.model).toBeUndefined()
  })
})
