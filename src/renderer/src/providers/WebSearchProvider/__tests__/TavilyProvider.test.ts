import { beforeEach, describe, expect, it, vi } from 'vitest'

import TavilyProvider from '../TavilyProvider'

// Mock TavilyClient
vi.mock('@agentic/tavily', () => ({
  TavilyClient: vi.fn().mockImplementation(() => ({
    search: vi.fn()
  }))
}))

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

function createMockProvider(overrides: Record<string, any> = {}) {
  return {
    id: 'tavily',
    name: 'Tavily',
    apiKey: 'test-key',
    apiHost: 'https://api.tavily.com',
    ...overrides
  } as any
}

function createMockWebsearch(overrides: Record<string, any> = {}) {
  return {
    maxResults: 5,
    searchWithTime: false,
    excludeDomains: [],
    providers: [],
    defaultProvider: 'tavily',
    subscribeSources: [],
    overwrite: false,
    providerConfig: {},
    ...overrides
  } as any
}

describe('TavilyProvider double gate', () => {
  let provider: TavilyProvider
  let mockSearch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createProvider(providerConfig = {}) {
    provider = new TavilyProvider(createMockProvider(providerConfig))
    mockSearch = (provider as any).tvly.search
  }

  it('should NOT request raw content when both gates are default (gate2=false)', async () => {
    createProvider()
    mockSearch.mockResolvedValue({
      query: 'test',
      results: [{ title: 'Test', content: 'snippet', url: 'https://example.com' }]
    })

    const result = await provider.search('test', createMockWebsearch())

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ query: 'test', max_results: 5 }))
    expect(mockSearch).not.toHaveBeenCalledWith(expect.objectContaining({ include_raw_content: true }))
    expect(result.results[0].content).toBe('snippet')
  })

  it('should request raw content when both gates are open', async () => {
    createProvider() // gate1 default = true
    mockSearch.mockResolvedValue({
      query: 'test',
      results: [{ title: 'Test', content: 'snippet', raw_content: 'full page content', url: 'https://example.com' }]
    })

    const result = await provider.search('test', createMockWebsearch({ fullContent: true }))

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ include_raw_content: true }))
    expect(result.results[0].content).toBe('full page content')
  })

  it('should NOT request raw content when gate1 is closed (includeRawContent=false)', async () => {
    createProvider({ includeRawContent: false })
    mockSearch.mockResolvedValue({
      query: 'test',
      results: [{ title: 'Test', content: 'snippet', url: 'https://example.com' }]
    })

    await provider.search('test', createMockWebsearch({ fullContent: true }))

    expect(mockSearch).not.toHaveBeenCalledWith(expect.objectContaining({ include_raw_content: true }))
  })

  it('should NOT request raw content when gate2 is not activated', async () => {
    createProvider()
    mockSearch.mockResolvedValue({
      query: 'test',
      results: [{ title: 'Test', content: 'snippet', url: 'https://example.com' }]
    })

    await provider.search('test', createMockWebsearch({ fullContent: false }))

    expect(mockSearch).not.toHaveBeenCalledWith(expect.objectContaining({ include_raw_content: true }))
  })

  it('should fallback to content when raw_content is empty', async () => {
    createProvider()
    mockSearch.mockResolvedValue({
      query: 'test',
      results: [{ title: 'Test', content: 'snippet', raw_content: '', url: 'https://example.com' }]
    })

    const result = await provider.search('test', createMockWebsearch({ fullContent: true }))

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ include_raw_content: true }))
    expect(result.results[0].content).toBe('snippet')
  })

  it('should fallback to content when raw_content is undefined', async () => {
    createProvider()
    mockSearch.mockResolvedValue({
      query: 'test',
      results: [{ title: 'Test', content: 'snippet', url: 'https://example.com' }]
    })

    const result = await provider.search('test', createMockWebsearch({ fullContent: true }))

    expect(result.results[0].content).toBe('snippet')
  })

  it('should throw on empty query', async () => {
    createProvider()
    await expect(provider.search('  ', createMockWebsearch())).rejects.toThrow('Search query cannot be empty')
  })

  it('should handle search failure', async () => {
    createProvider()
    mockSearch.mockRejectedValue(new Error('API error'))

    await expect(provider.search('test', createMockWebsearch())).rejects.toThrow('Search failed: API error')
  })
})
