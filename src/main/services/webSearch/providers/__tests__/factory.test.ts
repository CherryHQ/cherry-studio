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
import { QueritProvider } from '../api/QueritProvider'
import { SearxngProvider } from '../api/SearxngProvider'
import { TavilyProvider } from '../api/TavilyProvider'
import { ZhipuProvider } from '../api/ZhipuProvider'
import { createWebSearchProvider } from '../factory'
import { ExaMcpProvider } from '../mcp/ExaMcpProvider'

function createProvider(overrides: Partial<ResolvedWebSearchProvider>): ResolvedWebSearchProvider {
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
  }
}

describe('createWebSearchProvider', () => {
  it('maps each provider id to the correct implementation class', () => {
    expect(createWebSearchProvider(createProvider({ id: 'zhipu' }))).toBeInstanceOf(ZhipuProvider)
    expect(createWebSearchProvider(createProvider({ id: 'tavily' }))).toBeInstanceOf(TavilyProvider)
    expect(createWebSearchProvider(createProvider({ id: 'searxng' }))).toBeInstanceOf(SearxngProvider)
    expect(createWebSearchProvider(createProvider({ id: 'exa' }))).toBeInstanceOf(ExaProvider)
    expect(createWebSearchProvider(createProvider({ id: 'exa-mcp', type: 'mcp' }))).toBeInstanceOf(ExaMcpProvider)
    expect(createWebSearchProvider(createProvider({ id: 'bocha' }))).toBeInstanceOf(BochaProvider)
    expect(createWebSearchProvider(createProvider({ id: 'querit' }))).toBeInstanceOf(QueritProvider)
  })

  it('throws for unsupported provider ids', () => {
    expect(() =>
      createWebSearchProvider(
        createProvider({
          id: 'unsupported-provider' as ResolvedWebSearchProvider['id']
        })
      )
    ).toThrow('Unsupported web search provider: unsupported-provider')
  })
})
