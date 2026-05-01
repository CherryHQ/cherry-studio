import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { webSearchSearch, getResolvedConfig } = vi.hoisted(() => ({
  webSearchSearch: vi.fn(),
  getResolvedConfig: vi.fn()
}))

vi.mock('@main/services/webSearch/WebSearchService', () => ({
  webSearchService: { search: webSearchSearch }
}))

vi.mock('@main/services/webSearch/utils/config', () => ({
  getResolvedConfig
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'PreferenceService') return { get: () => null }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

import { createWebSearchToolEntry, WEB_SEARCH_TOOL_NAME } from '../WebSearchTool'

const entry = createWebSearchToolEntry()

const usableProvider = {
  id: 'tavily',
  name: 'Tavily',
  type: 'tavily',
  apiKeys: ['key-1'],
  apiHost: '',
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

const localProvider = {
  id: 'local-google',
  name: 'Local Google',
  type: 'local',
  apiKeys: [],
  apiHost: '',
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

const unusableProvider = {
  id: 'exa',
  name: 'Exa',
  type: 'exa',
  apiKeys: [],
  apiHost: '',
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

function callExecute(args: { query: string }): Promise<unknown> {
  const execute = entry.tool.execute as (args: { query: string }, options: ToolExecutionOptions) => Promise<unknown>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1', abortSignal: new AbortController().signal }
  } as ToolExecutionOptions)
}

describe('web__search', () => {
  beforeEach(() => {
    webSearchSearch.mockReset()
    getResolvedConfig.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(entry.name).toBe(WEB_SEARCH_TOOL_NAME)
    expect(entry.namespace).toBe('web')
    expect(entry.defer).toBe('never')
  })

  it('returns [] when no provider is configured', async () => {
    getResolvedConfig.mockResolvedValue({ providers: [unusableProvider], runtime: {}, providerOverrides: {} })
    const result = await callExecute({ query: 'hello' })
    expect(result).toEqual([])
    expect(webSearchSearch).not.toHaveBeenCalled()
  })

  it('picks the first provider with API keys', async () => {
    webSearchSearch.mockResolvedValue({ query: 'hello', results: [] })
    getResolvedConfig.mockResolvedValue({
      providers: [unusableProvider, usableProvider],
      runtime: {},
      providerOverrides: {}
    })
    await callExecute({ query: 'hello' })
    expect(webSearchSearch).toHaveBeenCalledWith({ providerId: 'tavily', questions: ['hello'], requestId: 'req-1' })
  })

  it('treats local-* providers as usable without API keys', async () => {
    webSearchSearch.mockResolvedValue({ query: 'hello', results: [] })
    getResolvedConfig.mockResolvedValue({
      providers: [localProvider],
      runtime: {},
      providerOverrides: {}
    })
    await callExecute({ query: 'hello' })
    expect(webSearchSearch).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'local-google' }))
  })

  it('maps WebSearchResponse to indexed output items', async () => {
    webSearchSearch.mockResolvedValue({
      query: 'q',
      results: [
        { title: 'A', url: 'https://a.com', content: 'about A' },
        { title: 'B', url: 'https://b.com', content: 'about B' }
      ]
    })
    getResolvedConfig.mockResolvedValue({ providers: [usableProvider], runtime: {}, providerOverrides: {} })

    const result = await callExecute({ query: 'q' })
    expect(result).toEqual([
      { id: 1, title: 'A', url: 'https://a.com', content: 'about A' },
      { id: 2, title: 'B', url: 'https://b.com', content: 'about B' }
    ])
  })

  it('returns [] when webSearchService throws', async () => {
    webSearchSearch.mockRejectedValue(new Error('upstream 503'))
    getResolvedConfig.mockResolvedValue({ providers: [usableProvider], runtime: {}, providerOverrides: {} })
    expect(await callExecute({ query: 'q' })).toEqual([])
  })
})
