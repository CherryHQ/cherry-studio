import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createWebSearchClient } from '../createWebSearchClient'
import { yuanbao } from '../providers/yuanbao'
import type { WebSearchCall, WebSearchHttpRequest, WebSearchHttpResponse, WebSearchTransport } from '../types'
import { type WebSearchError, WebSearchTransportError } from '../WebSearchError'

const fixture = readFileSync(new URL('./fixtures/yuanbao-search-response.json', import.meta.url), 'utf8')
const call: WebSearchCall = {
  providerId: 'yuanbao',
  capability: 'searchKeywords',
  input: 'hello',
  config: { maxResults: 4 },
  credentials: { apiKey: 'test-key' }
}

function setup(body: unknown = JSON.parse(fixture), status = 200) {
  const requests: WebSearchHttpRequest[] = []
  const transport: WebSearchTransport = {
    async request(request) {
      requests.push(request)
      return { status, headers: {}, bodyText: typeof body === 'string' ? body : JSON.stringify(body) }
    }
  }
  return { requests, client: clientFor(transport) }
}

function clientFor(transport: WebSearchTransport) {
  return createWebSearchClient({ transport, providers: [{ provider: yuanbao, capabilities: ['searchKeywords'] }] })
}

function pages(...values: unknown[]) {
  return { Response: { Pages: values.map((value) => JSON.stringify(value)) } }
}

describe('Yuanbao SearchPro contract', () => {
  it.each([1, 4, 100])('does not leak result limits or unsupported filters into SearchPro (%i)', async (maxResults) => {
    const { client, requests } = setup()
    await client.execute({ ...call, config: { maxResults } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      url: 'https://api.wsa.cloud.tencent.com/SearchPro',
      method: 'POST',
      body: '{"Query":"hello"}',
      headers: {
        Authorization: 'Bearer test-key',
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
      }
    })
  })

  it('preserves the host path and the complete untrimmed Unicode query', async () => {
    const { client, requests } = setup()
    const input = `  你好，世界!? ${'x'.repeat(150)}  `
    await client.execute({ ...call, input, config: { maxResults: 4, apiHost: 'https://service.example/proxy' } })
    expect(requests[0].url).toBe('https://service.example/proxy/SearchPro')
    expect(JSON.parse(requests[0].body!)).toEqual({ Query: input })
  })

  it('maps digests and caller provenance without treating result capping as content truncation', async () => {
    const { client } = setup()
    const response = await client.execute(call)
    expect(response.results).toEqual([
      {
        title: 'Tencent Cloud Search',
        url: 'https://cloud.tencent.com/product/wsa',
        content: 'Search summaries from Tencent Cloud.',
        sourceInput: 'hello'
      },
      {
        title: 'WSA documentation',
        url: 'https://cloud.tencent.com/document/product/1772',
        content: 'Service key authentication and SearchPro.',
        sourceInput: 'hello'
      },
      { title: 'Empty summary', url: 'https://example.com/empty', content: '', sourceInput: 'hello' },
      { title: 'Source metadata', url: 'https://example.com/source', content: '', sourceInput: 'hello' }
    ])
    expect((await client.execute({ ...call, config: { maxResults: 2 } })).results).toEqual(response.results.slice(0, 2))
  })

  it('rejects malformed pages beyond the result cap instead of hiding a corrupt response', async () => {
    const { client } = setup(pages({ title: 'valid', url: 'https://example.com' }, { title: 'missing URL' }))
    await expect(client.execute({ ...call, config: { maxResults: 1 } })).rejects.toMatchObject({
      kind: 'invalid_response',
      code: 'yuanbao_page_schema_mismatch'
    })
  })

  it.each([
    'InternalError',
    'InvalidParameter',
    'RequestLimitExceeded',
    'ResourceNotFound',
    'ResourceUnavailable',
    'UnauthorizedOperation',
    'FutureCode'
  ])('surfaces %s business errors even when Pages is empty', async (Code) => {
    const { client } = setup({ Response: { Error: { Code, Message: 'Yuanbao failure' }, Pages: [] } })
    await expect(client.execute(call)).rejects.toMatchObject({
      kind: 'provider',
      code: 'provider_error',
      providerCode: Code,
      message: 'Yuanbao failure'
    })
  })

  it.each([401, 429, 500])('preserves Tencent Code, Message and HTTP %i', async (status) => {
    const { client } = setup(
      { Response: { Error: { Code: 'UnauthorizedOperation', Message: 'Yuanbao denied access' } } },
      status
    )
    await expect(client.execute(call)).rejects.toMatchObject({
      kind: 'provider',
      code: 'provider_error',
      providerCode: 'UnauthorizedOperation',
      message: 'Yuanbao denied access',
      status
    })
  })

  it.each([
    ['unavailable', 503],
    [{ Response: { Pages: [] } }, 500]
  ])('keeps non-Tencent HTTP failures as HTTP errors (%j)', async (body, status) => {
    const { client } = setup(body, status)
    await expect(client.execute(call)).rejects.toMatchObject({ kind: 'http', code: 'http_error', status })
  })

  it.each([
    ['{', 'invalid_json'],
    [{}, 'schema_mismatch'],
    [null, 'schema_mismatch'],
    [[], 'schema_mismatch'],
    [{ Response: null }, 'schema_mismatch'],
    [{ Response: [] }, 'schema_mismatch'],
    [{ Response: {} }, 'schema_mismatch'],
    [{ Response: { Pages: {} } }, 'schema_mismatch'],
    [{ Response: { Pages: [1] } }, 'schema_mismatch'],
    [{ Response: { Pages: ['broken'] } }, 'yuanbao_page_invalid_json'],
    ...[
      null,
      [],
      1,
      'text',
      {},
      { title: 'title' },
      { url: 'url' },
      { title: 1, url: 'url' },
      { title: 'title', url: 'url', content: null },
      { title: 'title', url: 'url', passage: 1 }
    ].map((value) => [pages(value), 'yuanbao_page_schema_mismatch'] as const)
  ] as const)('rejects malformed success shapes without returning partial results (%j)', async (body, code) => {
    const { client } = setup(body)
    await expect(client.execute(call)).rejects.toMatchObject({ kind: 'invalid_response', code })
  })

  it.each([null, [], {}, { Code: '', Message: 'bad' }, { Code: 'Code' }, { Code: 'Code', Message: 1 }])(
    'rejects malformed Error objects on 200 and non-2xx (%j)',
    async (Error) => {
      for (const status of [200, 401]) {
        const { client } = setup({ Response: { Error, Pages: [] } }, status)
        await expect(client.execute(call)).rejects.toMatchObject({
          kind: 'invalid_response',
          code: 'yuanbao_invalid_error'
        })
      }
    }
  )

  it.each([undefined, '', 'hit black query'])('does not mistake informational Msg for failure (%s)', async (Msg) => {
    const { client } = setup({ Response: { Pages: [], Msg } })
    await expect(client.execute(call)).resolves.toMatchObject({ results: [] })
  })

  it('uses a safe fallback for empty provider messages', async () => {
    const { client } = setup({ Response: { Error: { Code: 'FutureCode', Message: '' } } })
    await expect(client.execute(call)).rejects.toMatchObject({ message: 'Yuanbao reported FutureCode' })
  })

  it('redacts credentials from provider errors and their serialization', async () => {
    for (const status of [200, 401]) {
      const { client } = setup(
        { Response: { Error: { Code: 'UnauthorizedOperation', Message: 'Rejected test-key' } } },
        status
      )
      const error = await client.execute(call).catch((error: WebSearchError) => error)
      expect(error).toMatchObject({ kind: 'provider', message: 'Rejected [redacted]' })
      expect(JSON.stringify(error)).not.toContain('test-key')
    }
  })

  it('cancels before execution without making an outbound request', async () => {
    const { client, requests } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(client.execute({ ...call, signal: controller.signal })).rejects.toMatchObject({
      kind: 'cancelled',
      name: 'AbortError'
    })
    expect(requests).toEqual([])
  })

  it('preserves caller signal and timeout and prioritizes in-flight cancellation over business errors', async () => {
    const controller = new AbortController()
    const requests: WebSearchHttpRequest[] = []
    let resolve!: (response: WebSearchHttpResponse) => void
    const client = clientFor({
      request(request) {
        requests.push(request)
        return new Promise((done) => {
          resolve = done
        })
      }
    })
    const pending = client.execute({ ...call, signal: controller.signal, timeoutMs: 1234 })
    expect(requests).toHaveLength(1)
    expect(requests[0].signal).toBe(controller.signal)
    expect(requests[0].timeoutMs).toBe(1234)
    controller.abort()
    resolve({
      status: 429,
      headers: {},
      bodyText: JSON.stringify({ Response: { Error: { Code: 'RequestLimitExceeded', Message: 'Limited' } } })
    })
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled', name: 'AbortError' })
  })

  it('does not swallow transport exceptions in the adapter JSON catch', async () => {
    const error = new WebSearchTransportError('network', 'Disconnected')
    const transport: WebSearchTransport = {
      async request() {
        throw error
      }
    }
    await expect(yuanbao.execute({ call, apiHost: 'https://service.example', transport })).rejects.toBe(error)
    await expect(clientFor(transport).execute(call)).rejects.toMatchObject({
      kind: 'network',
      code: 'network_error',
      cause: error
    })
  })
})
