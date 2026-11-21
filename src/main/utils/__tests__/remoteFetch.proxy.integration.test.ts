import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect, createServer as createTcpServer, type Socket } from 'node:net'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lookup = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup }))

import { BaseService } from '@main/core/lifecycle'
import { NodeProxyBackend } from '@main/services/proxy/NodeProxyBackend'
import { normalizeProxyEndpoint } from '@main/services/proxy/proxyRouting'
import { BlacklistSubscriptionService } from '@main/services/webSearch/BlacklistSubscriptionService'
import type { WebSearchBlacklistSubscription } from '@shared/data/preference/preferenceTypes'

import { fetchRemoteText } from '../remoteFetch'

// Only DNS and app-policy boundaries are substituted. Requests, CONNECT/SOCKS
// handshakes, response limits, TLS verification and global proxy wrapper are real.
describe('bounded app-proxy fetch integration', () => {
  const servers: Array<Server | ReturnType<typeof createTcpServer>> = []
  const sockets = new Set<Socket>()
  let originPort: number, proxyUrl: string | undefined
  let body: string, status: number, location: string | undefined
  let backend: NodeProxyBackend
  let destinations: string[], hosts: string[]
  let proxyAuth: Array<string | undefined>, originProxyAuth: Array<string | undefined>

  async function listen(server: Server | ReturnType<typeof createTcpServer>): Promise<number> {
    servers.push(server)
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return (server.address() as { port: number }).port
  }

  function tunnel(socket: Duplex, head = Buffer.alloc(0)) {
    const upstream = connect(originPort, '127.0.0.1')
    sockets.add(upstream)
    upstream.on('close', () => sockets.delete(upstream))
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.on('connect', () => {
      if (head.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
  }

  async function startProxy(kind: 'http' | 'socks5', stall = false) {
    if (kind === 'http') {
      const server = createServer((_request, response) => response.writeHead(500).end())
      server.on('connect', (request, socket, head) => {
        destinations.push(request.url!)
        proxyAuth.push(request.headers['proxy-authorization'])
        if (stall) return
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        tunnel(socket, head)
      })
      proxyUrl = `http://127.0.0.1:${await listen(server)}`
    } else {
      const server = createTcpServer((socket) => {
        socket.once('data', () => {
          socket.write(Buffer.from([5, 0]))
          socket.once('data', (request) => {
            // IPv4 ATYP proves the validated IP, not a hostname, goes to SOCKS.
            expect(request[3]).toBe(1)
            destinations.push(`${[...request.subarray(4, 8)].join('.')}:${request.readUInt16BE(8)}`)
            socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
            tunnel(socket)
          })
        })
      })
      proxyUrl = `socks5://127.0.0.1:${await listen(server)}`
    }
  }

  beforeEach(async () => {
    body = '*://*.spam.example/*\n'
    status = 200
    location = undefined
    destinations = []
    hosts = []
    proxyAuth = []
    originProxyAuth = []
    lookup
      .mockReset()
      .mockImplementation(async (hostname: string) => [
        { address: hostname === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }
      ])
    MockApplicationUtils.setService('PreferenceService', { get: () => false })
    MockApplicationUtils.setService('ProxyService', { getRemoteFetchProxy: async () => proxyUrl })
    originPort = await listen(
      createServer((request, response) => {
        hosts.push(request.headers.host!)
        originProxyAuth.push(request.headers['proxy-authorization'])
        response.writeHead(
          request.url === '/final' ? 200 : status,
          request.url !== '/final' && location ? { Location: location } : {}
        )
        response.end(body)
      })
    )
    backend = new NodeProxyBackend()
  })

  afterEach(async () => {
    await backend.configure(undefined, null, [], () => {})
    for (const socket of sockets) socket.destroy()
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
    proxyUrl = undefined
  })

  it.each(['http', 'socks5'] as const)(
    'uses the %s app proxy with a pinned IP and original Host, even under the global wrapper',
    async (kind) => {
      await startProxy(kind)
      await backend.configure(proxyUrl, normalizeProxyEndpoint(proxyUrl), [], () => {})
      await expect(fetchRemoteText('http://lists.example/list', { respectAppProxy: true })).resolves.toBe(body)
      expect(destinations).toEqual(['93.184.216.34:80'])
      expect(hosts).toEqual(['lists.example'])
      expect(lookup).toHaveBeenCalledTimes(1)
    }
  )

  it('sends proxy credentials only on CONNECT, not to the origin', async () => {
    await startProxy('http')
    const authenticated = new URL(proxyUrl!)
    authenticated.username = 'fixture-user'
    authenticated.password = 'fixture-only-password'
    proxyUrl = authenticated.toString()
    await expect(fetchRemoteText('http://lists.example/list', { respectAppProxy: true })).resolves.toBe(body)
    expect(proxyAuth).toEqual([`Basic ${Buffer.from('fixture-user:fixture-only-password').toString('base64')}`])
    expect(originProxyAuth).toEqual([undefined])
  })

  it('adds and refreshes through the actual subscription service, retaining cached rules on proxy failure', async () => {
    await startProxy('http')
    BaseService.resetInstances()
    let subscriptions: WebSearchBlacklistSubscription[] = []
    MockApplicationUtils.setService('PreferenceService', {
      get: (key: string) => (key === 'app.fetch.allow_private_network' ? false : subscriptions),
      set: async (_key: string, value: WebSearchBlacklistSubscription[]) => {
        subscriptions = value
      }
    })
    const service = new BlacklistSubscriptionService()
    const added = await service.add('http://lists.example/list')
    expect(added.rules).toEqual(['*://*.spam.example/*'])
    status = 503
    const failed = await service.refresh(added.id)
    expect(failed.rules).toEqual(added.rules)
    expect(failed.lastError).toContain('503')
    expect(subscriptions).toEqual([failed])
    expect(destinations).toEqual(['93.184.216.34:80', '93.184.216.34:80'])
    MockApplicationUtils.setService('ProxyService', {
      getRemoteFetchProxy: async () => {
        throw new Error('proxy unavailable')
      }
    })
    const noRoute = await service.refresh(added.id)
    expect(noRoute.rules).toEqual(added.rules)
    expect(noRoute.lastError).toBe('proxy unavailable')
    expect(destinations).toHaveLength(2)
  })

  it('honors an app-selected direct bypass even while the global proxy wrapper is active', async () => {
    await startProxy('http')
    await backend.configure(proxyUrl, normalizeProxyEndpoint(proxyUrl), [], () => {})
    proxyUrl = undefined
    await expect(
      fetchRemoteText(`http://127.0.0.1:${originPort}/list`, {
        respectAppProxy: true,
        allowPrivateNetwork: true
      })
    ).resolves.toBe(body)
    expect(destinations).toEqual([])
    expect(hosts).toEqual([`127.0.0.1:${originPort}`])
  })

  it('revalidates DNS and app routing at each public redirect', async () => {
    await startProxy('http')
    status = 302
    location = 'http://other.example/final'
    const route = vi.fn(async () => proxyUrl)
    MockApplicationUtils.setService('ProxyService', { getRemoteFetchProxy: route })
    await expect(
      fetchRemoteText('http://lists.example/list', { respectAppProxy: true, maxRedirects: 1 })
    ).resolves.toBe(body)
    expect(route.mock.calls).toHaveLength(2)
    expect(lookup.mock.calls.map(([hostname]) => hostname)).toEqual(['lists.example', 'other.example'])
    expect(hosts).toEqual(['lists.example', 'other.example'])
  })

  it('rejects a private redirect before opening another proxy tunnel', async () => {
    await startProxy('http')
    status = 302
    location = 'http://private.example/secrets'
    await expect(
      fetchRemoteText('http://lists.example/list', { respectAppProxy: true, maxRedirects: 2 })
    ).rejects.toThrow(/private/)
    expect(destinations).toEqual(['93.184.216.34:80'])
  })

  it('rejects oversized chunked responses and stalled proxy handshakes', async () => {
    await startProxy('http')
    body = 'x'.repeat(2048)
    await expect(fetchRemoteText('http://lists.example/list', { respectAppProxy: true, maxBytes: 16 })).rejects.toThrow(
      /too large/
    )
    await startProxy('http', true)
    await expect(
      fetchRemoteText('http://lists.example/list', { respectAppProxy: true, timeoutMs: 40 })
    ).rejects.toThrow()
  })

  it('keeps certificate verification enabled across a CONNECT tunnel', async () => {
    const fixture = join(import.meta.dirname, '../../services/__tests__/fixtures')
    originPort = await listen(
      createHttpsServer(
        {
          key: readFileSync(join(fixture, 'self-signed-key.pem')),
          cert: readFileSync(join(fixture, 'self-signed-cert.pem'))
        },
        (_request, response) => response.end('secure test response')
      )
    )
    await startProxy('http')
    await expect(fetchRemoteText('https://lists.example/list', { respectAppProxy: true })).rejects.toThrow(
      /certificate|self.signed/i
    )
    expect(destinations).toEqual(['93.184.216.34:443'])
    expect(hosts).toEqual([])
    const originalRoots = getCACertificates('default')
    try {
      setDefaultCACertificates([...originalRoots, readFileSync(join(fixture, 'self-signed-cert.pem'), 'utf8')])
      // Trusting the test issuer still must not trust its 127.0.0.1 certificate
      // for lists.example. Certificate identity stays with the original URL.
      await expect(fetchRemoteText('https://lists.example/list', { respectAppProxy: true })).rejects.toThrow(
        /hostname|altnames/i
      )
      await expect(
        fetchRemoteText('https://127.0.0.1/list', {
          respectAppProxy: true,
          allowPrivateNetwork: true
        })
      ).resolves.toBe('secure test response')
    } finally {
      setDefaultCACertificates(originalRoots)
    }
  })
})
