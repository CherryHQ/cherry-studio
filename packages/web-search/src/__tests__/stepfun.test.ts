import { describe, expect, it } from 'vitest'

import { createWebSearchClient } from '../createWebSearchClient'
import { stepfun } from '../providers/stepfun'
import type { WebSearchHttpRequest, WebSearchKeywordsCall, WebSearchSearchImagesCall } from '../types'

function setup(
  body: unknown = { results: [{ title: 'Result', url: 'https://example.com', content: 'Full', snippet: 'Brief' }] },
  status = 200,
  capabilities: readonly ('searchKeywords' | 'searchImages')[] = ['searchKeywords']
) {
  const requests: WebSearchHttpRequest[] = []
  const client = createWebSearchClient({
    providers: [{ provider: stepfun, capabilities }],
    transport: {
      async request(request) {
        requests.push(request)
        return { status, headers: {}, bodyText: JSON.stringify(body) }
      }
    }
  })
  return { client, requests }
}
function search(maxResults = 4, apiHost?: string): WebSearchKeywordsCall {
  return {
    providerId: 'stepfun',
    capability: 'searchKeywords',
    input: 'a&b 中文',
    credentials: { apiKey: 'test-key' },
    config: { maxResults, apiHost }
  }
}
function searchImages(maxResults = 4, apiHost?: string): WebSearchSearchImagesCall {
  return {
    providerId: 'stepfun',
    capability: 'searchImages',
    input: 'a&b 中文',
    credentials: { apiKey: 'test-key' },
    config: { maxResults, apiHost }
  }
}

const imageBody = {
  code: 0,
  msg: '',
  data: {
    result: {
      block: false,
      search_results: [
        {
          contentUrl: 'https://img.example/one.png',
          snippet: 'First image',
          width: 800,
          height: 600,
          hostPageUrl: 'https://page.example/one',
          hostname: 'page.example'
        },
        { contentUrl: 'https://img.example/two.png' }
      ]
    }
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
  it('declares keyword and image capabilities but no fetch capability', async () => {
    expect(stepfun.metadata.capabilities.map((x) => x.capability)).toEqual(['searchKeywords', 'searchImages'])
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

describe('StepFun image search', () => {
  it.each([
    [undefined, 'https://api.stepfun.com/step_plan/v1/search-image'],
    ['https://proxy.example', 'https://proxy.example/step_plan/v1/search-image'],
    ['https://proxy.example/v1/', 'https://proxy.example/step_plan/v1/search-image'],
    ['https://proxy.example/prefix', 'https://proxy.example/step_plan/v1/search-image']
  ])('builds the authenticated image request for %s', async (host, url) => {
    const { client, requests } = setup(imageBody, 200, ['searchImages'])
    const response = await client.execute(searchImages(4, host))
    expect(requests[0]).toMatchObject({ url, method: 'POST' })
    expect(new Headers(requests[0].headers).get('authorization')).toBe('Bearer test-key')
    expect(JSON.parse(requests[0].body!)).toEqual({ query: 'a&b 中文', topk: 4 })
    expect(response.capability).toBe('searchImages')
    expect(response.results).toEqual([
      {
        contentUrl: 'https://img.example/one.png',
        snippet: 'First image',
        width: 800,
        height: 600,
        hostPageUrl: 'https://page.example/one',
        hostname: 'page.example',
        sourceInput: 'a&b 中文'
      },
      { contentUrl: 'https://img.example/two.png', snippet: '', sourceInput: 'a&b 中文' }
    ])
  })
  it.each([
    [1, 1],
    [50, 50],
    [500, 50]
  ])('caps topk for maxResults %s', async (count, topk) => {
    const { client, requests } = setup(imageBody, 200, ['searchImages'])
    await client.execute(searchImages(count))
    expect(JSON.parse(requests[0].body!).topk).toBe(topk)
  })
  it('returns an empty list when the response is blocked', async () => {
    const body = { code: 0, msg: '', data: { result: { block: true, search_results: [] } } }
    const { client } = setup(body, 200, ['searchImages'])
    expect((await client.execute(searchImages())).results).toEqual([])
  })
  it('trims excess image results locally', async () => {
    const { client } = setup(imageBody, 200, ['searchImages'])
    expect((await client.execute(searchImages(1))).results).toEqual([
      {
        contentUrl: 'https://img.example/one.png',
        snippet: 'First image',
        width: 800,
        height: 600,
        hostPageUrl: 'https://page.example/one',
        hostname: 'page.example',
        sourceInput: 'a&b 中文'
      }
    ])
  })
  it('raises a provider error carrying msg for a non-zero code', async () => {
    const body = { code: 40001, msg: 'invalid api key', data: { result: { block: false, search_results: [] } } }
    const { client, requests } = setup(body, 200, ['searchImages'])
    await expect(client.execute(searchImages())).rejects.toMatchObject({
      kind: 'provider',
      message: 'invalid api key',
      providerCode: '40001'
    })
    expect(requests).toHaveLength(1)
  })
  it.each([{ code: 0 }, { code: 0, msg: '', data: {} }, { error: { message: 'failure' } }])(
    'rejects malformed successful image payloads',
    async (body) => {
      const { client } = setup(body, 200, ['searchImages'])
      await expect(client.execute(searchImages())).rejects.toMatchObject({ kind: 'invalid_response' })
    }
  )
  it('retains HTTP errors', async () => {
    const { client } = setup({}, 429, ['searchImages'])
    await expect(client.execute(searchImages())).rejects.toMatchObject({ kind: 'http', status: 429 })
  })
})
