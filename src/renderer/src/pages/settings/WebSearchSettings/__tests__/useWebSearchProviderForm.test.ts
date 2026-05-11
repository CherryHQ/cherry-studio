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

function createActions() {
  return {
    providerOverrides: {},
    updateProvider: vi.fn().mockResolvedValue(undefined),
    setApiKeys: vi.fn().mockResolvedValue(undefined),
    setCapabilityApiHost: vi.fn().mockResolvedValue(undefined),
    setBasicAuth: vi.fn().mockResolvedValue(undefined)
  }
}

describe('useWebSearchProviderForm', () => {
  it('does not expose API host inputs for hostless providers', () => {
    const actions = createActions()
    const fetchProvider: ResolvedWebSearchProvider = {
      id: 'fetch',
      name: 'fetch',
      type: 'api',
      apiKeys: [],
      capabilities: [{ feature: 'fetchUrls' }],
      engines: [],
      basicAuthUsername: '',
      basicAuthPassword: ''
    }

    const { result } = renderHook(() => useWebSearchProviderForm(fetchProvider, actions, 'fetchUrls'))

    expect(result.current.apiHostCapabilities).toEqual([])
  })

  it('shows only the active capability API host for multi-capability providers', () => {
    const actions = createActions()

    const searchForm = renderHook(() => useWebSearchProviderForm(jinaProvider, actions, 'searchKeywords'))
    const fetchForm = renderHook(() => useWebSearchProviderForm(jinaProvider, actions, 'fetchUrls'))

    expect(searchForm.result.current.apiHostCapabilities).toEqual([
      { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' }
    ])
    expect(fetchForm.result.current.apiHostCapabilities).toEqual([
      { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
    ])
  })

  it('persists API host changes for the active capability only', async () => {
    const actions = createActions()
    const { result } = renderHook(() => useWebSearchProviderForm(jinaProvider, actions, 'fetchUrls'))

    act(() => {
      result.current.setApiHostInput('fetchUrls', 'https://reader.example.com/')
    })
    await act(async () => {
      await result.current.commitApiHost(result.current.apiHostCapabilities[0])
    })

    expect(actions.setCapabilityApiHost).toHaveBeenCalledWith('jina', 'fetchUrls', 'https://reader.example.com')
  })

  it('persists trimmed basic auth credentials', async () => {
    const actions = createActions()
    const provider: ResolvedWebSearchProvider = {
      ...jinaProvider,
      id: 'searxng',
      name: 'Searxng',
      basicAuthUsername: '',
      basicAuthPassword: ''
    }
    const { result } = renderHook(() => useWebSearchProviderForm(provider, actions, 'searchKeywords'))

    act(() => {
      result.current.setBasicAuthUsername(' user ')
      result.current.setBasicAuthPassword(' pass ')
    })
    await act(async () => {
      await result.current.commitForm()
    })

    expect(actions.updateProvider).toHaveBeenCalledWith('searxng', {
      basicAuthUsername: 'user',
      basicAuthPassword: 'pass'
    })
  })

  it('persists combined form changes with one provider patch', async () => {
    const actions = createActions()
    const { result } = renderHook(() => useWebSearchProviderForm(jinaProvider, actions, 'fetchUrls'))

    act(() => {
      result.current.setApiKeyInput(' key-a ')
      result.current.setApiHostInput('fetchUrls', ' https://reader.example.com/ ')
    })
    await act(async () => {
      await result.current.commitForm()
    })

    expect(actions.updateProvider).toHaveBeenCalledWith('jina', {
      apiKeys: ['key-a'],
      capabilities: {
        fetchUrls: {
          apiHost: 'https://reader.example.com'
        }
      }
    })
  })

  it('persists only the active capability in combined form changes', async () => {
    const actions = {
      ...createActions(),
      providerOverrides: {
        jina: {
          capabilities: {
            searchKeywords: {
              apiHost: 'https://search.example.com'
            }
          }
        }
      }
    }
    const { result } = renderHook(() => useWebSearchProviderForm(jinaProvider, actions, 'fetchUrls'))

    act(() => {
      result.current.setApiHostInput('fetchUrls', ' https://reader.example.com/ ')
    })
    await act(async () => {
      await result.current.commitForm()
    })

    expect(actions.updateProvider).toHaveBeenCalledWith('jina', {
      capabilities: {
        searchKeywords: {
          apiHost: 'https://search.example.com'
        },
        fetchUrls: {
          apiHost: 'https://reader.example.com'
        }
      }
    })
  })
})
