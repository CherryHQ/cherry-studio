import http from 'node:http'
import net from 'node:net'

import type { Api, Context, Model } from '@earendil-works/pi-ai'
import { streamSimple as streamOpenAICompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { streamSimple as streamOpenAIResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { NodeProxyController } from '@main/services/proxy/NodeProxyController'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { afterEach, describe, expect, it } from 'vitest'

const servers: Array<http.Server | net.Server> = []
let nodeProxyController: NodeProxyController | undefined

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

const context: Context = {
  messages: [{ role: 'user', content: 'hello', timestamp: 1 }]
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

  it('preserves HTTP proxy authentication through the production Node transport', async () => {
    const targetPort = await listen(net.createServer((socket) => socket.destroy()))
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
      createModel('openai-completions', `http://127.0.0.1:${targetPort}/v1`),
      context,
      { apiKey: 'test-key', maxRetries: 0 }
    ).result()

    expect(result.stopReason).toBe('error')
    expect(authorizedRequests).toBe(1)
  })

  it('preserves SOCKS5 username and password through the production Node transport', async () => {
    const targetPort = await listen(net.createServer((socket) => socket.destroy()))
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
      createModel('openai-responses', `http://127.0.0.1:${targetPort}/v1`),
      context,
      { apiKey: 'test-key', maxRetries: 0 }
    ).result()

    expect(result.stopReason).toBe('error')
    expect(authorizedRequests).toBe(1)
  })
})
