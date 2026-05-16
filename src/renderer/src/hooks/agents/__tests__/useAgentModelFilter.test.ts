import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import type { Model } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useProvidersMock } = vi.hoisted(() => ({
  useProvidersMock: vi.fn()
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProviders: useProvidersMock
}))

import { useAgentModelFilter } from '../useAgentModelFilter'

function makeModel(providerId: string, modelId: string, overrides: Partial<Model> = {}): Model {
  return {
    id: `${providerId}::${modelId}`,
    providerId,
    name: modelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('useAgentModelFilter', () => {
  beforeEach(() => {
    useProvidersMock.mockReset()
    useProvidersMock.mockReturnValue({ providers: [] })
  })

  it('keeps the generic agent filter for non-Claude-Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter(undefined))

    expect(result.current(makeModel('openai', 'gpt-5'))).toBe(true)
  })

  it('allows Claude models from a provider with an Anthropic Messages endpoint', () => {
    useProvidersMock.mockReturnValue({
      providers: [
        {
          id: 'aihubmix',
          endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://aihubmix.example' } }
        }
      ]
    })
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current(makeModel('aihubmix', 'anthropic/claude-3-5-sonnet'))).toBe(true)
  })

  it('rejects non-Claude models even when the provider has an Anthropic Messages endpoint', () => {
    useProvidersMock.mockReturnValue({
      providers: [
        {
          id: 'aihubmix',
          endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://aihubmix.example' } }
        }
      ]
    })
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current(makeModel('aihubmix', 'gpt-5'))).toBe(false)
  })

  it('rejects Claude models when the provider cannot serve Anthropic Messages', () => {
    useProvidersMock.mockReturnValue({
      providers: [
        {
          id: 'openai',
          endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://openai.example' } }
        }
      ]
    })
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current(makeModel('openai', 'claude-3-5-sonnet'))).toBe(false)
  })
})
