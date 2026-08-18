import http from 'node:http'
import net from 'node:net'

import type { Api, Context, Model } from '@earendil-works/pi-ai'
import { streamSimple as streamOpenAICompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { streamSimple as streamOpenAIResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { afterEach, describe, expect, it } from 'vitest'

const servers: Array<http.Server | net.Server> = []

async function listen(server: http.Server | net.Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port')
  return address.port
}

function sendExpectedError(socket: net.Socket): void {
  const body = JSON.stringify({ error: { message: 'expected test rejection' } })
  socket.end(
    `HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
  )
}

function createModel<TApi extends Api>(api: TApi, baseUrl: string): Model<TApi> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api,
    provider: 'opencode',
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10_000,
    maxTokens: 1_000
  }
}

const context: Context = {
  messages: [{ role: 'user', content: 'hello', timestamp: 1 }]
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
})

describe('Pi provider request fetch', () => {
  it('routes OpenAI-compatible transports through the request-scoped proxy fetch', async () => {
    let directRequests = 0
    const target = net.createServer((socket) => {
      directRequests += 1
      socket.once('data', () => sendExpectedError(socket))
    })
    const targetPort = await listen(target)

    let proxyRequests = 0
    const proxy = http.createServer()
    proxy.on('connect', (_request, socket) => {
      proxyRequests += 1
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.once('data', () => sendExpectedError(socket as net.Socket))
    })
    const proxyPort = await listen(proxy)
    const dispatcher = new ProxyAgent(`http://127.0.0.1:${proxyPort}`)
    const proxyFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      undiciFetch(input as never, { ...init, dispatcher } as never)) as unknown as typeof globalThis.fetch
    const baseUrl = `http://127.0.0.1:${targetPort}/v1`

    try {
      const completions = await streamOpenAICompletions(createModel('openai-completions', baseUrl), context, {
        apiKey: 'test-key',
        fetch: proxyFetch,
        maxRetries: 0
      }).result()
      const responses = await streamOpenAIResponses(createModel('openai-responses', baseUrl), context, {
        apiKey: 'test-key',
        fetch: proxyFetch,
        maxRetries: 0
      }).result()

      expect(completions.stopReason).toBe('error')
      expect(responses.stopReason).toBe('error')
      expect(proxyRequests).toBe(2)
      expect(directRequests).toBe(0)
    } finally {
      await dispatcher.close()
    }
  })
})
