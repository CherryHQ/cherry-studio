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
import { JinaReaderProvider } from '../api/JinaReaderProvider'
import { QueritProvider } from '../api/QueritProvider'
import { SearxngProvider } from '../api/SearxngProvider'
import { TavilyProvider } from '../api/TavilyProvider'
import { ZhipuProvider } from '../api/ZhipuProvider'
import { createKeywordSearchProvider, createUrlSearchProvider } from '../factory'
import { ExaMcpProvider } from '../mcp/ExaMcpProvider'

function createProvider<TProviderId extends ResolvedWebSearchProvider['id']>(
  overrides: Partial<ResolvedWebSearchProvider> & { id: TProviderId }
): ResolvedWebSearchProvider & { id: TProviderId } {
  return {
    id: 'tavily',
    name: 'Provider',
    type: 'api',
    apiKeys: ['test-key'],
    apiHost: 'https://api.example.com',
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: '',
    ...overrides
  } as ResolvedWebSearchProvider & { id: TProviderId }
}

describe('createKeywordSearchProvider', () => {
  it('maps each keyword provider id to the correct implementation class', () => {
    expect(createKeywordSearchProvider(createProvider({ id: 'zhipu' }))).toBeInstanceOf(ZhipuProvider)
    expect(createKeywordSearchProvider(createProvider({ id: 'tavily' }))).toBeInstanceOf(TavilyProvider)
    expect(createKeywordSearchProvider(createProvider({ id: 'searxng' }))).toBeInstanceOf(SearxngProvider)
    expect(createKeywordSearchProvider(createProvider({ id: 'exa' }))).toBeInstanceOf(ExaProvider)
    expect(createKeywordSearchProvider(createProvider({ id: 'exa-mcp', type: 'mcp' }))).toBeInstanceOf(ExaMcpProvider)
    expect(createKeywordSearchProvider(createProvider({ id: 'bocha' }))).toBeInstanceOf(BochaProvider)
    expect(createKeywordSearchProvider(createProvider({ id: 'querit' }))).toBeInstanceOf(QueritProvider)
  })

  it('throws for URL provider ids', () => {
    expect(() =>
      createKeywordSearchProvider(
        createProvider({
          id: 'fetch'
        }) as Parameters<typeof createKeywordSearchProvider>[0]
      )
    ).toThrow('Unsupported keyword search provider: fetch')
  })
})

describe('createUrlSearchProvider', () => {
  it('maps each URL provider id to the correct implementation class', () => {
    expect(createUrlSearchProvider(createProvider({ id: 'fetch' }))).toBeInstanceOf(FetchProvider)
    expect(createUrlSearchProvider(createProvider({ id: 'jina-reader' }))).toBeInstanceOf(JinaReaderProvider)
  })

  it('throws for keyword provider ids', () => {
    expect(() =>
      createUrlSearchProvider(
        createProvider({
          id: 'tavily'
        }) as Parameters<typeof createUrlSearchProvider>[0]
      )
    ).toThrow('Unsupported URL search provider: tavily')
  })
})
