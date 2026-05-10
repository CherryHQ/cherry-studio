import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useWebSearchDefaultProviderAction } from '../hooks/useWebSearchDefaultProviderAction'

const jinaProvider: ResolvedWebSearchProvider = {
  id: 'jina',
  name: 'Jina',
  type: 'api',
  apiKeys: ['key'],
  capabilities: [
    { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
    { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
  ],
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

describe('useWebSearchDefaultProviderAction', () => {
  it('sets the selected capability default provider', () => {
    const setDefaultProvider = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useWebSearchDefaultProviderAction(jinaProvider, 'fetchUrls', undefined, setDefaultProvider)
    )

    act(() => {
      result.current.onSetAsDefault()
    })

    expect(result.current.isDefault).toBe(false)
    expect(result.current.canSetAsDefault).toBe(true)
    expect(setDefaultProvider).toHaveBeenCalledWith(jinaProvider)
  })

  it('does not set default when provider is already default for the selected capability', () => {
    const setDefaultProvider = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useWebSearchDefaultProviderAction(jinaProvider, 'searchKeywords', jinaProvider, setDefaultProvider)
    )

    act(() => {
      result.current.onSetAsDefault()
    })

    expect(result.current.isDefault).toBe(true)
    expect(result.current.canSetAsDefault).toBe(false)
    expect(setDefaultProvider).not.toHaveBeenCalled()
  })
})
