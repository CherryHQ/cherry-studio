import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { Model } from '@shared/data/types/model'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const baseModel: Model = {
  id: 'openai::gpt-4',
  name: 'GPT-4',
  providerId: 'openai',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

const mocks = vi.hoisted(() => ({
  agent: { id: 'agent-1', configuration: {} } as unknown as AgentEntity,
  model: undefined as Model | undefined,
  updateAgent: vi.fn()
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({ agent: mocks.agent, isLoading: false }),
  useUpdateAgent: () => ({ updateAgent: mocks.updateAgent })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: () => ({ model: mocks.model, isLoading: false })
}))

vi.mock('@renderer/hooks/chat/useAgentTurnFastMode', () => ({
  useAgentTurnFastMode: () => [false, vi.fn()]
}))

import { useAgentModelSettingsPanel } from '../useAgentModelSettingsPanel'

describe('useAgentModelSettingsPanel', () => {
  beforeEach(() => {
    cacheService.delete('chat.agent.reasoning_effort_pending.agent-1')
    cacheService.delete('chat.agent.service_tier_pending.agent-1')
    mocks.agent = { id: 'agent-1', configuration: {} } as unknown as AgentEntity
    mocks.model = baseModel
    mocks.updateAgent.mockReset()
  })

  it('reverts the optimistic reasoning effort when the agent save resolves without a result', async () => {
    mocks.agent = { id: 'agent-1', configuration: { reasoning_effort: 'high' } } as unknown as AgentEntity
    mocks.updateAgent.mockResolvedValue(undefined)

    const { result } = renderHook(() => useAgentModelSettingsPanel('agent-1'))

    expect(result.current.reasoningEffort).toBe('high')

    act(() => result.current.handleReasoningEffortChange('low'))
    expect(result.current.reasoningEffort).toBe('low')

    await act(async () => {})

    expect(result.current.reasoningEffort).toBe('high')
  })

  it('reverts the optimistic service tier when the agent save rejects', async () => {
    mocks.agent = { id: 'agent-1', configuration: { service_tier: 'standard' } } as unknown as AgentEntity
    mocks.updateAgent.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useAgentModelSettingsPanel('agent-1'))

    expect(result.current.serviceTier).toBe('standard')

    act(() => result.current.handleServiceTierChange('flex'))
    expect(result.current.serviceTier).toBe('flex')

    await act(async () => {})

    expect(result.current.serviceTier).toBe('standard')
  })
})
