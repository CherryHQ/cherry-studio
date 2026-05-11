import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderEndpoints } from '../useProviderEndpoints'

describe('useProviderEndpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the openai endpoint as primary and still exposes the anthropic host input', () => {
    const provider = {
      id: 'custom',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://anthropic.example.com' }
      }
    } as any

    const { result } = renderHook(() => useProviderEndpoints(provider))

    expect(result.current.primaryEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(result.current.providerApiHost).toBe('https://api.example.com')
    expect(result.current.providerAnthropicHost).toBe('https://anthropic.example.com')
  })

  it('uses the anthropic endpoint as primary when the provider default endpoint is anthropic', () => {
    const provider = {
      id: 'anthropic',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com' }
      }
    } as any

    const { result } = renderHook(() => useProviderEndpoints(provider))

    expect(result.current.primaryEndpoint).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    expect(result.current.providerAnthropicHost).toBe('https://api.anthropic.com')
  })

  it('falls back to the first supported runtime chat endpoint when defaultChatEndpoint is missing', () => {
    const provider = {
      id: 'ollama',
      endpointConfigs: {
        [ENDPOINT_TYPE.OLLAMA_CHAT]: { baseUrl: 'http://localhost:11434' }
      }
    } as any

    const { result } = renderHook(() => useProviderEndpoints(provider))

    expect(result.current.primaryEndpoint).toBe(ENDPOINT_TYPE.OLLAMA_CHAT)
    expect(result.current.providerApiHost).toBe('http://localhost:11434')
  })

  it('keeps the anthropic host input even for cherryin', () => {
    const provider = {
      id: 'cherryin',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://anthropic.example.com' }
      }
    } as any

    const { result } = renderHook(() => useProviderEndpoints(provider))

    expect(result.current.providerAnthropicHost).toBe('https://anthropic.example.com')
  })

  it('owns endpoint drafts locally per hook instance', () => {
    const provider = {
      id: 'openai',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' }
      },
      settings: {}
    } as any

    const first = renderHook(() => useProviderEndpoints(provider))
    const second = renderHook(() => useProviderEndpoints(provider))

    act(() => {
      first.result.current.setApiHost('https://input.example.com')
    })

    expect(first.result.current.apiHost).toBe('https://input.example.com')
    expect(second.result.current.apiHost).toBe('https://api.example.com')
  })

  it('updates the draft when the same provider receives a new server host', () => {
    const provider = {
      id: 'openai',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' }
      },
      settings: {}
    } as any

    const { result, rerender } = renderHook(({ value }) => useProviderEndpoints(value), {
      initialProps: { value: provider }
    })

    expect(result.current.apiHost).toBe('https://api.example.com')

    rerender({
      value: {
        ...provider,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.updated.example.com' }
        }
      }
    })

    expect(result.current.apiHost).toBe('https://api.updated.example.com')
  })
})
