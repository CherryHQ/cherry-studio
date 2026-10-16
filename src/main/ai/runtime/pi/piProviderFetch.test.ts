import http from 'node:http'
import net from 'node:net'

import { normalizeContext } from '@earendil-works/pi-ai'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  stream as streamGoogle,
  streamSimple as streamGoogleSimple
} from '@earendil-works/pi-ai/api/google-generative-ai'
import { streamSimple as streamOpenAICompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { streamSimple as streamOpenAIResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { Agent, fetch as undiciFetch, getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NodeProxyController } from '@main/services/proxy/NodeProxyController'

const servers: Array<http.Server | net.Server> = []
let nodeProxyController: NodeProxyController | undefined

async function listen(server: http.Server | net.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  servers.push(server)
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

function createAuthenticatedHttpProxy(username: string, password: string, onAuthorized: () => void): http.Server {
  const expectedAuthorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const proxy = http.createServer()
  proxy.on('connect', (request, socket) => {
    if (request.headers['proxy-authorization'] !== expectedAuthorization) {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
      )
      return
    }

    onAuthorized()
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    socket.once('data', () => sendExpectedError(socket as net.Socket))
  })
  return proxy
}

function createAuthenticatedSocks5Proxy(username: string, password: string, onAuthorized: () => void): net.Server {
  return net.createServer((socket) => {
    let stage: 'greeting' | 'authentication' | 'connect' | 'request' = 'greeting'

    socket.on('data', (chunk) => {
      if (stage === 'greeting') {
        stage = 'authentication'
        socket.write(Buffer.from([0x05, 0x02]))
        return
      }

      if (stage === 'authentication') {
        const usernameLength = chunk[1]
        const receivedUsername = chunk.subarray(2, 2 + usernameLength).toString()
        const passwordLength = chunk[2 + usernameLength]
        const receivedPassword = chunk.subarray(3 + usernameLength, 3 + usernameLength + passwordLength).toString()
        if (receivedUsername !== username || receivedPassword !== password) {
          socket.end(Buffer.from([0x01, 0x01]))
          return
        }

        stage = 'connect'
        onAuthorized()
        socket.write(Buffer.from([0x01, 0x00]))
        return
      }

      if (stage === 'connect') {
        stage = 'request'
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        return
      }

      sendExpectedError(socket)
    })
  })
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

const context = normalizeContext({
  messages: [{ role: 'user', content: 'hello', timestamp: 1 }]
})

function geminiSse(text: string): string {
  return `data: ${JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 }
  })}\n\n`
}

afterEach(async () => {
  if (nodeProxyController) {
    await nodeProxyController.configure({})
    nodeProxyController = undefined
  }
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
  it('rejects listener errors without registering an unbound server for cleanup', async () => {
    const server = http.createServer()
    const error = Object.assign(new Error('Address unavailable'), { code: 'EADDRNOTAVAIL' })
    const start = vi.spyOn(server, 'listen').mockImplementation(() => {
      queueMicrotask(() => server.emit('error', error))
      return server
    })
    try {
      await expect(listen(server)).rejects.toBe(error)
      expect(servers).not.toContain(server)
    } finally {
      start.mockRestore()
    }
  })

  it.each([
    ['stream', streamGoogle],
    ['streamSimple', streamGoogleSimple]
  ] as const)(
    'completes Gemini %s through the supplied fetch with custom endpoint and headers',
    async (_name, stream) => {
      const requests: Array<{ url?: string; headers: http.IncomingHttpHeaders; body: string }> = []
      const targetPort = await listen(
        http.createServer(async (request, response) => {
          let body = ''
          for await (const chunk of request) body += chunk
          requests.push({ url: request.url, headers: request.headers, body })
          response.writeHead(200, { 'content-type': 'text/event-stream' }).end(geminiSse('Gemini response'))
        })
      )
      const model = createModel('google-generative-ai', `http://127.0.0.1:${targetPort}/custom/v1beta`)
      model.headers = { 'x-provider-header': 'provider-value' }
      const result = await stream(model, context, {
        apiKey: 'test-key',
        headers: { 'x-request-header': 'request-value' },
        fetch: (input, init) => globalThis.fetch(input, init),
        maxRetries: 0
      }).result()

      expect(result.stopReason).toBe('stop')
      expect(result.content).toEqual([expect.objectContaining({ type: 'text', text: 'Gemini response' })])
      expect(result.usage).toMatchObject({ input: 3, output: 2, totalTokens: 5 })
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe('/custom/v1beta/models/test-model:streamGenerateContent?alt=sse')
      expect(requests[0].headers).toMatchObject({
        'x-goog-api-key': 'test-key',
        'x-provider-header': 'provider-value',
        'x-request-header': 'request-value'
      })
      expect(JSON.parse(requests[0].body).contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }])
    }
  )

  it('keeps concurrent Gemini fetch implementations isolated', async () => {
    const model = createModel('google-generative-ai', 'http://model-provider.invalid/v1beta')
    const results = await Promise.all(
      ['first', 'second'].map((text) =>
        streamGoogleSimple(model, context, {
          apiKey: 'test-key',
          fetch: async () => new Response(geminiSse(text), { headers: { 'content-type': 'text/event-stream' } })
        }).result()
      )
    )
    expect(results.map((result) => result.stopReason)).toEqual(['stop', 'stop'])
    expect(results.map((result) => result.content)).toEqual([
      [expect.objectContaining({ type: 'text', text: 'first' })],
      [expect.objectContaining({ type: 'text', text: 'second' })]
    ])
  })

  it('aborts an in-flight Gemini request through the supplied fetch', async () => {
    const controller = new AbortController()
    let requests = 0
    const targetPort = await listen(
      http.createServer((_request, response) => {
        requests++
        response.writeHead(200, { 'content-type': 'text/event-stream' }).flushHeaders()
        controller.abort()
      })
    )
    const result = await streamGoogleSimple(
      createModel('google-generative-ai', `http://127.0.0.1:${targetPort}/v1beta`),
      context,
      { apiKey: 'test-key', fetch: (input, init) => globalThis.fetch(input, init), signal: controller.signal }
    ).result()
    expect(result.stopReason).toBe('aborted')
    expect(requests).toBe(1)
  })

  it('keeps the default Gemini fetch and honors Node proxy bypass rules', async () => {
    let directRequests = 0
    let proxyRequests = 0
    const targetPort = await listen(
      http.createServer((_request, response) => {
        directRequests++
        response.writeHead(200, { 'content-type': 'text/event-stream' }).end(geminiSse('direct response'))
      })
    )
    const proxyPort = await listen(createAuthenticatedHttpProxy('proxy-user', 'proxy-pass', () => proxyRequests++))
    const originalDispatcher = getGlobalDispatcher()
    const directDispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, callback) =>
          callback(null, options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4)
      }
    })
    setGlobalDispatcher(directDispatcher)
    nodeProxyController = new NodeProxyController()
    const proxyRules = `http://proxy-user:proxy-pass@127.0.0.1:${proxyPort}`
    const model = createModel('google-generative-ai', `http://gemini.test:${targetPort}/v1beta`)
    try {
      await nodeProxyController.configure({ proxyRules })
      const proxied = await streamGoogleSimple(model, context, {
        apiKey: 'test-key',
        maxRetries: 0
      }).result()
      expect(proxied.errorMessage).toContain('expected test rejection')
      expect(proxyRequests).toBe(1)
      expect(directRequests).toBe(0)

      await nodeProxyController.configure({ proxyRules, proxyBypassRules: ['gemini.test'] })
      for (const fetch of [undefined, undiciFetch as unknown as typeof globalThis.fetch]) {
        const result = await streamGoogleSimple(model, context, { apiKey: 'test-key', fetch, maxRetries: 0 }).result()
        expect(result.stopReason).toBe('stop')
        expect(result.content).toEqual([expect.objectContaining({ type: 'text', text: 'direct response' })])
      }
      expect(directRequests).toBe(2)
      expect(proxyRequests).toBe(1)
    } finally {
      await nodeProxyController.configure({})
      nodeProxyController = undefined
      setGlobalDispatcher(originalDispatcher)
      await directDispatcher.close()
    }
  })

  it('routes OpenAI and Gemini transports through the request-scoped proxy fetch', async () => {
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
      const gemini = await streamGoogleSimple(createModel('google-generative-ai', baseUrl), context, {
        apiKey: 'test-key',
        fetch: proxyFetch,
        maxRetries: 0
      }).result()

      expect(completions.stopReason).toBe('error')
      expect(responses.stopReason).toBe('error')
      expect(gemini.stopReason).toBe('error')
      expect(gemini.errorMessage).toContain('expected test rejection')
      expect(proxyRequests).toBe(3)
      expect(directRequests).toBe(0)
    } finally {
      await dispatcher.close()
    }
  })

  it('preserves HTTP proxy authentication through the production Node transport', async () => {
    let authorizedRequests = 0
    const proxyPort = await listen(
      createAuthenticatedHttpProxy('proxy-user', 'proxy-pass', () => {
        authorizedRequests += 1
      })
    )
    nodeProxyController = new NodeProxyController()
    await nodeProxyController.configure({
      proxyRules: `http://proxy-user:proxy-pass@127.0.0.1:${proxyPort}`
    })

    const result = await streamOpenAICompletions(
      createModel('openai-completions', 'http://model-provider.invalid/v1'),
      context,
      { apiKey: 'test-key', maxRetries: 0, fetch: undiciFetch as unknown as typeof globalThis.fetch }
    ).result()

    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('expected test rejection')
    expect(authorizedRequests).toBe(1)

    const gemini = await streamGoogleSimple(
      createModel('google-generative-ai', 'http://model-provider.invalid/v1beta'),
      context,
      { apiKey: 'test-key', maxRetries: 0, fetch: undiciFetch as unknown as typeof globalThis.fetch }
    ).result()
    expect(gemini.stopReason).toBe('error')
    expect(gemini.errorMessage).toContain('expected test rejection')
    expect(authorizedRequests).toBe(2)
  })

  it('preserves SOCKS5 username and password through the production Node transport', async () => {
    let authorizedRequests = 0
    const proxyPort = await listen(
      createAuthenticatedSocks5Proxy('proxy-user', 'proxy-pass', () => {
        authorizedRequests += 1
      })
    )
    nodeProxyController = new NodeProxyController()
    await nodeProxyController.configure({
      proxyRules: `socks5://proxy-user:proxy-pass@127.0.0.1:${proxyPort}`
    })

    const result = await streamOpenAIResponses(
      createModel('openai-responses', 'http://model-provider.invalid/v1'),
      context,
      { apiKey: 'test-key', maxRetries: 0, fetch: undiciFetch as unknown as typeof globalThis.fetch }
    ).result()

    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('expected test rejection')
    expect(authorizedRequests).toBe(1)

    const gemini = await streamGoogleSimple(
      createModel('google-generative-ai', 'http://model-provider.invalid/v1beta'),
      context,
      { apiKey: 'test-key', maxRetries: 0, fetch: undiciFetch as unknown as typeof globalThis.fetch }
    ).result()
    expect(gemini.stopReason).toBe('error')
    expect(gemini.errorMessage).toContain('expected test rejection')
    expect(authorizedRequests).toBe(2)
  })
})
