import { createServer, type Server } from 'node:http'

import { describe, expect, it } from 'vitest'

import { NodeProxyController } from '../NodeProxyController'
import { CHERRY_NODE_PROXY_BYPASS_RULES_ENV, CHERRY_NODE_PROXY_RULES_ENV } from '../proxyEnv'

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server port')
  return address.port
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

describe('NodeProxyController', () => {
  it('keeps localhost direct while routing remote requests through a configured proxy', async () => {
    const localServer = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ source: 'local' }))
    })
    const proxyRequests: string[] = []
    const proxyServer = createServer((request, response) => {
      proxyRequests.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ source: 'proxy' }))
    })
    proxyServer.on('connect', (request, socket) => {
      proxyRequests.push(request.url ?? '')
      socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
    })
    const [localPort, proxyPort] = await Promise.all([listen(localServer), listen(proxyServer)])
    const controller = new NodeProxyController()
    const proxyEnvKeys = [
      CHERRY_NODE_PROXY_RULES_ENV,
      CHERRY_NODE_PROXY_BYPASS_RULES_ENV,
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'grpc_proxy',
      'http_proxy',
      'https_proxy',
      'NO_PROXY',
      'no_proxy',
      'SOCKS_PROXY',
      'socks_proxy',
      'ALL_PROXY',
      'all_proxy'
    ] as const
    const originalEnv = Object.fromEntries(proxyEnvKeys.map((key) => [key, process.env[key]]))

    try {
      await controller.configure({ proxyRules: `http://127.0.0.1:${proxyPort}` })

      const localResponse = await fetch(`http://localhost:${localPort}/models`, { signal: AbortSignal.timeout(2000) })
      await fetch('http://model-provider.invalid/models', { signal: AbortSignal.timeout(2000) }).catch(() => undefined)

      expect(await localResponse.json()).toEqual({ source: 'local' })
      expect(proxyRequests.some((url) => url.includes('model-provider.invalid'))).toBe(true)
      expect(proxyRequests.every((url) => !url.includes('localhost'))).toBe(true)
      expect(process.env.NO_PROXY?.split(',')).toContain('localhost')
    } finally {
      await controller.configure({})
      for (const key of proxyEnvKeys) {
        const value = originalEnv[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await Promise.all([close(localServer), close(proxyServer)])
    }
  })
})
