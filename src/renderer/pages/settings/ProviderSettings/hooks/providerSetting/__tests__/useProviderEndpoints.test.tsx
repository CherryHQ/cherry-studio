import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { useProviderEndpoints } from '../useProviderEndpoints'

describe('useProviderEndpoints', () => {
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

  it('does not overwrite an unsaved draft when the same provider receives a new server host', () => {
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

    act(() => {
      result.current.setApiHost('https://draft.example.com')
    })

    rerender({
      value: {
        ...provider,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.updated.example.com' }
        }
      }
    })

    expect(result.current.apiHost).toBe('https://draft.example.com')
    expect(result.current.providerApiHost).toBe('https://api.updated.example.com')
  })
})
