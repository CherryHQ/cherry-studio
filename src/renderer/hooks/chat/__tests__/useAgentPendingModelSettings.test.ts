import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { useAgentPendingReasoningEffort } from '../useAgentPendingModelSettings'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

describe('useAgentPendingReasoningEffort', () => {
  it('keeps a newer pending value when an older mutation runs canonical-divergence cleanup', () => {
    const agentId = 'agent-1'
    const pendingKey = `chat.agent.reasoning_effort_pending.${agentId}` as const
    cacheService.delete(pendingKey)

    const composer = renderHook(
      ({ canonical }: { canonical: ReasoningEffortOption }) => useAgentPendingReasoningEffort(agentId, canonical),
      { initialProps: { canonical: 'default' as ReasoningEffortOption } }
    )
    const panel = renderHook(
      ({ canonical }: { canonical: ReasoningEffortOption }) => useAgentPendingReasoningEffort(agentId, canonical),
      { initialProps: { canonical: 'default' as ReasoningEffortOption } }
    )

    let composerVersion = 0
    let panelVersion = 0
    act(() => {
      composerVersion = composer.result.current.startPending('high')
      panelVersion = panel.result.current.startPending('medium')
    })

    expect(composerVersion).toBeLessThan(panelVersion)

    act(() => {
      composer.result.current.clearPending(composerVersion)
    })

    expect(composer.result.current.effective).toBe('medium')
    expect(panel.result.current.effective).toBe('medium')

    act(() => {
      panel.result.current.clearPending(panelVersion)
    })

    expect(composer.result.current.effective).toBe('default')
    expect(panel.result.current.effective).toBe('default')
  })

  it('reverts the optimistic value when persistence fails', () => {
    const agentId = 'agent-2'
    const pendingKey = `chat.agent.reasoning_effort_pending.${agentId}` as const
    cacheService.delete(pendingKey)

    const { result } = renderHook(() => useAgentPendingReasoningEffort(agentId, 'default'))

    let version = 0
    act(() => {
      version = result.current.startPending('high')
    })
    expect(result.current.effective).toBe('high')

    act(() => {
      result.current.finishPending(version, true)
    })

    expect(result.current.effective).toBe('default')
  })
})
