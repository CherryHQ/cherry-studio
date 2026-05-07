import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn()
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    webContents: {
      userAgent: '',
      setWindowOpenHandler: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      executeJavaScript: vi.fn()
    },
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    loadURL: vi.fn()
  }))
}))

import { BochaProvider } from '../api/BochaProvider'
import { ExaProvider } from '../api/ExaProvider'
import { FetchProvider } from '../api/FetchProvider'
import { JinaProvider } from '../api/JinaProvider'
import { QueritProvider } from '../api/QueritProvider'
import { SearxngProvider } from '../api/SearxngProvider'
import { TavilyProvider } from '../api/TavilyProvider'
import { ZhipuProvider } from '../api/ZhipuProvider'
import { createWebSearchProvider } from '../factory'
import { ExaMcpProvider } from '../mcp/ExaMcpProvider'
import { WEB_SEARCH_PROVIDER_REGISTRY } from '../registry'

function createProvider<TProviderId extends ResolvedWebSearchProvider['id']>(
  overrides: Partial<ResolvedWebSearchProvider> & { id: TProviderId }
): ResolvedWebSearchProvider & { id: TProviderId } {
  const { id, ...restOverrides } = overrides

  return {
    id,
    name: 'Provider',
    type: 'api',
    apiKeys: ['test-key'],
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.example.com' }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: '',
    ...restOverrides
  } as ResolvedWebSearchProvider & { id: TProviderId }
}

describe('createWebSearchProvider', () => {
  it('registers every supported provider id', () => {
    expect(Object.keys(WEB_SEARCH_PROVIDER_REGISTRY).sort()).toEqual([
      'bocha',
      'exa',
      'exa-mcp',
      'fetch',
      'jina',
      'querit',
      'searxng',
      'tavily',
      'zhipu'
    ])
  })

  it('maps each provider id to the correct implementation class', () => {
    expect(createWebSearchProvider(createProvider({ id: 'zhipu' }))).toBeInstanceOf(ZhipuProvider)
    expect(createWebSearchProvider(createProvider({ id: 'tavily' }))).toBeInstanceOf(TavilyProvider)
    expect(createWebSearchProvider(createProvider({ id: 'searxng' }))).toBeInstanceOf(SearxngProvider)
    expect(createWebSearchProvider(createProvider({ id: 'exa' }))).toBeInstanceOf(ExaProvider)
    expect(createWebSearchProvider(createProvider({ id: 'exa-mcp', type: 'mcp' }))).toBeInstanceOf(ExaMcpProvider)
    expect(createWebSearchProvider(createProvider({ id: 'bocha' }))).toBeInstanceOf(BochaProvider)
    expect(createWebSearchProvider(createProvider({ id: 'querit' }))).toBeInstanceOf(QueritProvider)
    expect(
      createWebSearchProvider(createProvider({ id: 'fetch', capabilities: [{ feature: 'fetchUrls', apiHost: '' }] }))
    ).toBeInstanceOf(FetchProvider)
    expect(
      createWebSearchProvider(
        createProvider({
          id: 'jina',
          capabilities: [
            { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
            { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
          ]
        })
      )
    ).toBeInstanceOf(JinaProvider)
  })
})
