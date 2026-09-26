import { createServer, type Server } from 'node:http'
import net from 'node:net'

import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici'
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
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'keeps %s direct while routing remote requests through a configured proxy',
    async (hostname) => {
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

        const localResponse = await fetch(`http://${hostname}:${localPort}/models`, {
          signal: AbortSignal.timeout(2000)
        })
        await fetch('http://model-provider.invalid/models', { signal: AbortSignal.timeout(2000) }).catch(
          () => undefined
        )

        expect(await localResponse.json()).toEqual({ source: 'local' })
        expect(proxyRequests.some((url) => url.includes('model-provider.invalid'))).toBe(true)
        expect(proxyRequests.every((url) => !url.includes(hostname))).toBe(true)
        expect(process.env.NO_PROXY?.split(',')).toContain(hostname)

        const dispatcher = new EnvHttpProxyAgent()
        try {
          const response = await undiciFetch(`http://${hostname}:${localPort}/models`, {
            dispatcher,
            signal: AbortSignal.timeout(2000)
          })
          expect(await response.json()).toEqual({ source: 'local' })
          expect(proxyRequests.every((url) => !url.includes(hostname))).toBe(true)
        } finally {
          await dispatcher.close()
        }
      } finally {
        await controller.configure({})
        for (const key of proxyEnvKeys) {
          const value = originalEnv[key]
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        await Promise.all([close(localServer), close(proxyServer)])
      }
    }
  )

  it('keeps localhost direct under `<-loopback>,localhost`, with the rest of the scope proxied', async () => {
    const localServer = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ source: 'local' }))
    })
    const proxyRequests: string[] = []
    const tunnels: string[] = []
    const proxyServer = createServer((request, response) => {
      proxyRequests.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ source: 'proxy' }))
    })
    // undici's proxy path tunnels even plain http:// requests; pipe the tunnel to the target so
    // the request completes and the tunnel record is the proof of proxying.
    proxyServer.on('connect', (request, clientSocket, head) => {
      tunnels.push(request.url ?? '')
      const [host, port] = (request.url ?? '').split(':')
      const target = net.connect(Number(port), host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head?.length) target.write(head)
        target.pipe(clientSocket)
        clientSocket.pipe(target)
      })
      target.on('error', () => clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'))
    })
    const [localPort, proxyPort] = await Promise.all([listen(localServer), listen(proxyServer)])
    const controller = new NodeProxyController()
    try {
      // Later rules override earlier ones — the arrangement verified against a real Chromium
      // session, where `<-loopback>,localhost` keeps localhost direct while the negation
      // proxies the rest of the loopback scope.
      await controller.configure({
        proxyRules: `http://127.0.0.1:${proxyPort}`,
        proxyBypassRules: '<-loopback>,localhost'
      })
      const response = await fetch(`http://localhost:${localPort}/models`, { signal: AbortSignal.timeout(5000) })
      expect(await response.json()).toEqual({ source: 'local' })
      const proxied = await fetch(`http://127.0.0.1:${localPort}/models`, { signal: AbortSignal.timeout(5000) })
      expect(await proxied.json()).toEqual({ source: 'local' })
      expect(tunnels).toContain(`127.0.0.1:${localPort}`)
      expect(tunnels.every((url) => !url.startsWith('localhost'))).toBe(true)
      expect(proxyRequests.every((url) => !url.includes('localhost'))).toBe(true)
    } finally {
      await controller.configure({})
      await Promise.all([close(localServer), close(proxyServer)])
    }
  })

  it('lets <-loopback> send local traffic through the configured proxy', async () => {
    const localServer = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ source: 'local' }))
    })
    const tunnels: string[] = []
    const proxyServer = createServer((_request, response) => {
      response.writeHead(404).end()
    })
    // With `<-loopback>` even loopback requests arrive as CONNECT tunnels; pipe them to the
    // target so the request completes and the tunnel itself is the proof of proxying.
    proxyServer.on('connect', (request, clientSocket, head) => {
      tunnels.push(request.url ?? '')
      const [host, port] = (request.url ?? '').split(':')
      const target = net.connect(Number(port), host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head?.length) target.write(head)
        target.pipe(clientSocket)
        clientSocket.pipe(target)
      })
      target.on('error', () => clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'))
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
      await controller.configure({
        proxyRules: `http://127.0.0.1:${proxyPort}`,
        proxyBypassRules: '<-loopback>'
      })
      const response = await fetch(`http://127.0.0.1:${localPort}/models`, { signal: AbortSignal.timeout(5000) })
      expect(await response.json()).toEqual({ source: 'local' })
      expect(tunnels).toContain(`127.0.0.1:${localPort}`)
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

  it('keeps IPv4-mapped loopback direct when the scope rides along the configured proxy', async () => {
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
      // withLoopbackBypass's merged output; pinned through the real matcher by the composition
      // test in ProxyService.test.ts — this run is about the request stack itself.
      await controller.configure({
        proxyRules: `http://127.0.0.1:${proxyPort}`,
        proxyBypassRules: [
          'localhost',
          '*.localhost',
          'localhost6',
          'localhost6.localdomain6',
          'loopback',
          '127.0.0.0/8',
          '0.0.0.0',
          '[::1]',
          '[::ffff:127.0.0.0]/104',
          '169.254.0.0/16',
          'fe80::/10'
        ].join(',')
      })

      const response = await fetch(`http://[::ffff:127.0.0.1]:${localPort}/models`, {
        signal: AbortSignal.timeout(5000)
      })
      expect(await response.json()).toEqual({ source: 'local' })
      await fetch('http://model-provider.invalid/models', { signal: AbortSignal.timeout(5000) }).catch(() => undefined)
      expect(proxyRequests.some((url) => url.includes('model-provider.invalid'))).toBe(true)
      expect(proxyRequests.every((url) => !url.includes('ffff'))).toBe(true)
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
