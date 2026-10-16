import { expect, it } from 'vitest'

import { createWebSearchClient } from '../client'
import { WebSearchError, WebSearchTransportError } from '../errors'
import { tavily } from '../providers/tavily'
import { clientFor, loopbackServer } from './helpers/loopbackServer'

it.each(['network', 'timeout', 'cancelled', 'unknown'] as const)(
  'classifies transport %s without native details',
  async (kind) => {
    const active = createWebSearchClient({
      providers: [{ provider: tavily, capabilities: ['searchKeywords'] }],
      transport: {
        async request() {
          throw new WebSearchTransportError(kind)
        }
      }
    })
    const error = await active
      .execute({
        providerId: 'tavily',
        capability: 'searchKeywords',
        input: 'secret-body',
        config: { maxResults: 1 },
        credentials: { apiKey: 'secret-credential' }
      })
      .catch((error) => error)
    expect(error).toBeInstanceOf(WebSearchError)
    expect(error).toMatchObject({
      kind,
      code: kind === 'network' ? 'network_error' : kind === 'unknown' ? 'unknown_error' : kind,
      providerId: 'tavily',
      capability: 'searchKeywords'
    })
    expect(JSON.stringify(error.toJSON())).not.toMatch(/secret|stack|cause/)
  }
)
it('allowlists error serialization and bounds upstream metadata', () => {
  const error = new WebSearchError('Safe message', {
    kind: 'provider',
    code: 'provider_error',
    providerCode: '\n' + 'x'.repeat(200),
    retryAfter: '\r3',
    requestId: 'id\u0000',
    ...{ credential: 'secret-credential', body: 'secret-body' }
  })
  expect(error).toBeInstanceOf(Error)
  expect(error.toJSON()).toEqual({
    message: 'Safe message',
    kind: 'provider',
    code: 'provider_error',
    providerCode: 'x'.repeat(128),
    retryAfter: '3',
    requestId: 'id',
    providerId: undefined,
    capability: undefined,
    httpStatus: undefined
  })
  expect(JSON.stringify(error)).not.toMatch(/secret|stack|cause/)
})
it('preserves the caller abort reason before networking', async () => {
  const server = await loopbackServer('{}')
  try {
    const controller = new AbortController()
    const reason = new Error('caller owns this reason')
    controller.abort(reason)
    await expect(
      clientFor(tavily).execute({
        providerId: 'tavily',
        capability: 'searchKeywords',
        input: 'query',
        config: { apiHost: server.host, maxResults: 1 },
        signal: controller.signal
      })
    ).rejects.toBe(reason)
    expect(server.requests).toEqual([])
  } finally {
    await server.close()
  }
})

it.each([
  ['bad-json', 200, 'invalid_response', 'invalid_json'],
  ['{}', 200, 'invalid_response', 'invalid_response'],
  ['{"error":{"code":"denied","message":"secret-body"}}', 200, 'provider', 'provider_error'],
  ['secret-body', 503, 'http', 'http_error']
])('classifies protocol failures without exposing body or credentials (%#)', async (body, status, kind, code) => {
  const server = await loopbackServer(String(body), Number(status))
  try {
    const error = await clientFor(tavily)
      .execute({
        providerId: 'tavily',
        capability: 'searchKeywords',
        input: 'secret-body',
        config: { apiHost: server.host, maxResults: 1 },
        credentials: { apiKey: 'secret-credential' }
      })
      .catch((error) => error)
    expect(error).toBeInstanceOf(WebSearchError)
    expect(error).toMatchObject({ kind, code, providerId: 'tavily', capability: 'searchKeywords' })
    if (kind === 'provider') expect(error.providerCode).toBe('denied')
    expect(error.message + JSON.stringify(error.toJSON())).not.toMatch(/secret|127\.0\.0\.1|stack|cause/)
  } finally {
    await server.close()
  }
})
it('classifies configuration failures as portable errors', async () => {
  const error = await clientFor(tavily)
    .execute({
      providerId: 'tavily',
      capability: 'searchKeywords',
      input: 'hello',
      config: { apiHost: '', maxResults: 1 }
    })
    .catch((error) => error)
  expect(error).toBeInstanceOf(WebSearchError)
  expect(error.toJSON()).toMatchObject({ kind: 'configuration', code: 'api_host_missing' })
})
