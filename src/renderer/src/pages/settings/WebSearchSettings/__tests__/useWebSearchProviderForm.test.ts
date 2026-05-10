import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useWebSearchProviderForm } from '../hooks/useWebSearchProviderForm'

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

describe('useWebSearchProviderForm', () => {
  it('shows only the active capability API host for multi-capability providers', () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)

    const searchForm = renderHook(() => useWebSearchProviderForm(jinaProvider, updateProvider, 'searchKeywords'))
    const fetchForm = renderHook(() => useWebSearchProviderForm(jinaProvider, updateProvider, 'fetchUrls'))

    expect(searchForm.result.current.apiHostCapabilities).toEqual([
      { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' }
    ])
    expect(fetchForm.result.current.apiHostCapabilities).toEqual([
      { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
    ])
  })

  it('persists API host changes for the active capability only', () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useWebSearchProviderForm(jinaProvider, updateProvider, 'fetchUrls'))

    act(() => {
      result.current.setApiHostInput('fetchUrls', 'https://reader.example.com/')
    })
    act(() => {
      result.current.commitApiHost(result.current.apiHostCapabilities[0])
    })

    expect(updateProvider).toHaveBeenCalledWith('jina', {
      capabilities: [
        { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
        { feature: 'fetchUrls', apiHost: 'https://reader.example.com' }
      ]
    })
  })
})
