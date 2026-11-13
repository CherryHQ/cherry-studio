import { describe, expect, it } from 'vitest'

import { createWebSearchClient } from '../createWebSearchClient'
import { stepfun } from '../providers/stepfun'
import type { WebSearchCall, WebSearchHttpRequest } from '../types'

function setup(
  body: unknown = { results: [{ title: 'Result', url: 'https://example.com', content: 'Full', snippet: 'Brief' }] },
  status = 200
) {
  const requests: WebSearchHttpRequest[] = []
  const client = createWebSearchClient({
    providers: [{ provider: stepfun, capabilities: ['searchKeywords'] }],
    transport: {
      async request(request) {
        requests.push(request)
        return { status, headers: {}, bodyText: JSON.stringify(body) }
      }
    }
  })
  return { client, requests }
}
function search(maxResults = 4, apiHost?: string): WebSearchCall {
  return {
    providerId: 'stepfun',
    capability: 'searchKeywords',
    input: 'a&b 中文',
    credentials: { apiKey: 'test-key' },
    config: { maxResults, apiHost }
  }
}

describe('StepFun web search', () => {
  it.each([
    [undefined, 'https://api.stepfun.com/v1/search'],
    ['https://proxy.example', 'https://proxy.example/v1/search'],
    ['https://proxy.example/v1/', 'https://proxy.example/v1/search'],
    ['https://proxy.example/prefix/v1', 'https://proxy.example/prefix/v1/search']
  ])('builds the authenticated request for %s', async (host, url) => {
    const { client, requests } = setup()
    const response = await client.execute(search(4, host))
    expect(requests[0]).toMatchObject({ url, method: 'POST' })
    expect(new Headers(requests[0].headers).get('authorization')).toBe('Bearer test-key')
    expect(JSON.parse(requests[0].body!)).toEqual({ query: 'a&b 中文', n: 4 })
    expect(response.results).toEqual([
      { title: 'Result', url: 'https://example.com', content: 'Full', sourceInput: 'a&b 中文' }
    ])
  })
  it.each([1, 20, 50])('caps the remote count for %s', async (count) => {
    const { client, requests } = setup()
    await client.execute(search(count))
    expect(JSON.parse(requests[0].body!).n).toBe(Math.min(count, 20))
  })
  it('uses snippet fallback and trims excess results locally', async () => {
    const { client } = setup({
      results: [
        { title: 'One', url: 'https://one.example', content: '', snippet: 'Brief' },
        { title: 'Two', url: 'https://two.example' }
      ]
    })
    expect((await client.execute(search(1))).results).toEqual([
      { title: 'One', url: 'https://one.example', content: 'Brief', sourceInput: 'a&b 中文' }
    ])
  })
  it('accepts an empty result list', async () => {
    expect((await setup({ results: [] }).client.execute(search())).results).toEqual([])
  })
  it.each([{ results: {} }, { results: [{ title: 'No URL' }] }, { error: { message: 'failure' } }])(
    'rejects malformed successful payloads',
    async (body) => {
      await expect(setup(body).client.execute(search())).rejects.toMatchObject({ kind: 'invalid_response' })
    }
  )
  it('retains HTTP errors', async () => {
    await expect(setup({}, 429).client.execute(search())).rejects.toMatchObject({ kind: 'http', status: 429 })
  })
  it('has no fetch or image capability', async () => {
    expect(stepfun.metadata.capabilities.map((x) => x.capability)).toEqual(['searchKeywords'])
    const { client, requests } = setup()
    await expect(
      client.execute({
        providerId: 'stepfun',
        capability: 'fetchUrls',
        input: 'https://example.com',
        config: {},
        credentials: { apiKey: 'test-key' }
      })
    ).rejects.toMatchObject({ kind: 'configuration' })
    expect(requests).toEqual([])
  })
})
