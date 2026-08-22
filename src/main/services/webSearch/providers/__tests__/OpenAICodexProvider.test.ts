import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig } from '@shared/data/types/webSearch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getValidAccessToken: vi.fn()
}))

vi.mock('electron', () => ({
  net: {
    fetch: mocks.fetch
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    OAuthRuntimeService: {
      getValidAccessToken: mocks.getValidAccessToken
    }
  })
})

import { OpenAICodexProvider } from '../api/OpenAICodexProvider'

const fetchMock = mocks.fetch
const getValidAccessTokenMock = mocks.getValidAccessToken

const runtimeConfig: WebSearchExecutionConfig = {
  maxResults: 4,
  excludeDomains: ['example.com'],
  compression: {
    method: 'none',
    cutoffLimit: 2000
  }
}

function createProvider(): OpenAICodexProvider {
  const provider: WebSearchProvider = {
    id: 'openai-codex',
    name: 'OpenAI Codex',
    type: 'oauth',
    apiKeys: [],
    capabilities: [{ feature: 'searchKeywords', requiresApiHost: false, requiresApiKey: false }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  }
  return new OpenAICodexProvider(provider, { resolve: vi.fn() } as never)
}

const SSE_RESPONSE = [
  'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Answer with [Source](https://src.example/a) cited.","annotations":[{"type":"url_citation","url":"https://src.example/a","title":"Source A","start_index":11,"end_index":40}]}]}}',
  '',
  'data: {"type":"response.done","response":{"output":[]}}',
  'data: [DONE]'
].join('\n')

beforeEach(() => {
  getValidAccessTokenMock.mockResolvedValue({ accessToken: 'codex-token', accountId: 'acct-1' })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OpenAICodexProvider', () => {
  it('searches via the codex responses endpoint with OAuth headers and parses results', async () => {
    fetchMock.mockResolvedValue(
      new Response(SSE_RESPONSE, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    )

    const response = await createProvider().searchKeywords('what is new', runtimeConfig)

    expect(getValidAccessTokenMock).toHaveBeenCalledWith('openai-codex')
    expect(fetchMock).toHaveBeenCalledWith('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      body: expect.stringContaining('"tool_choice":"required"'),
      headers: expect.objectContaining({
        authorization: 'Bearer codex-token',
        'chatgpt-account-id': 'acct-1',
        'openai-beta': 'responses=experimental',
        originator: 'cherry-studio'
      }),
      signal: expect.any(AbortSignal)
    })

    expect(response.providerId).toBe('openai-codex')
    expect(response.capability).toBe('searchKeywords')
    expect(response.inputs).toEqual(['what is new'])
    expect(response.results).toEqual([
      {
        title: 'Source A',
        content: expect.stringContaining('Answer with'),
        url: 'https://src.example/a',
        sourceInput: 'what is new'
      }
    ])
  })

  it('throws a clear error when not signed in to Codex', async () => {
    getValidAccessTokenMock.mockResolvedValue(null)

    await expect(createProvider().searchKeywords('q', runtimeConfig)).rejects.toThrow(/Not signed in to OpenAI Codex/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces HTTP errors from the codex endpoint', async () => {
    fetchMock.mockResolvedValue(new Response('rate limited', { status: 429 }))

    await expect(createProvider().searchKeywords('q', runtimeConfig)).rejects.toThrow(/HTTP 429 rate limited/)
  })

  it('throws when the stream contains no answer or sources', async () => {
    fetchMock.mockResolvedValue(new Response('data: [DONE]', { status: 200 }))

    await expect(createProvider().searchKeywords('q', runtimeConfig)).rejects.toThrow(/returned no answer or sources/)
  })
})
