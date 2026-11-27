import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect, createServer as createTcpServer, type Server, type Socket } from 'node:net'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'

import type { Dispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPinnedDispatcher } from '../pinnedDispatcher'
import { buildNodeProxyEnvironment } from '../proxyEnv'

const servers: Server[] = []
const sockets = new Set<Socket>()
const dispatchers: Dispatcher[] = []
const defaultCertificates = getCACertificates('default')

async function listen(server: Server): Promise<number> {
  servers.push(server)
  server.on('connection', (socket) => sockets.add(socket))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
  return address.port
}

function configureProxy(proxyRules: string, proxyBypassRules = '') {
  for (const [key, value] of Object.entries(buildNodeProxyEnvironment({ proxyRules, proxyBypassRules }))) {
    vi.stubEnv(key, value)
  }
}

async function transfer(port: number, protocol = 'http:') {
  const url = `${protocol}//mineru.invalid:${port}/upload`
  const dispatcher = createPinnedDispatcher({ url, address: { address: '127.0.0.1', family: 4 } })
  dispatchers.push(dispatcher)
  const response = await fetch(url, {
    method: 'PUT',
    body: 'document bytes',
    signal: AbortSignal.timeout(3000),
    ...{ dispatcher }
  })
  return response.json()
}

async function startTarget() {
  const requests: string[] = []
  const port = await listen(
    createServer(async (request, response) => {
      requests.push(request.url ?? '')
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ host: request.headers.host, body: Buffer.concat(chunks).toString() }))
    })
  )
  return { port, requests }
}

beforeEach(() => {
  vi.stubEnv('CHERRY_STUDIO_NODE_PROXY_RULES', undefined)
  vi.stubEnv('CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES', undefined)
})

afterEach(async () => {
  await Promise.all(dispatchers.splice(0).map((dispatcher) => dispatcher.destroy()))
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  vi.unstubAllEnvs()
  setDefaultCACertificates(defaultCertificates)
})

describe('pinned transfers using the application proxy policy', () => {
  it('connects directly to the validated address while preserving the original HTTP host', async () => {
    const { port } = await startTarget()
    expect(await transfer(port)).toEqual({ host: `mineru.invalid:${port}`, body: 'document bytes' })
  })

  it.each(['http', 'https'])('uses an authenticated %s proxy with the pinned IP', async (protocol) => {
    const { port } = await startTarget()
    const tunnels: IncomingMessage[] = []
    const certificate = readFileSync(new URL('../../__tests__/fixtures/self-signed-cert.pem', import.meta.url), 'utf8')
    setDefaultCACertificates([...getCACertificates('default'), certificate])
    const proxy =
      protocol === 'http'
        ? createServer()
        : createHttpsServer({
            cert: certificate,
            key: readFileSync(new URL('../../__tests__/fixtures/self-signed-key.pem', import.meta.url))
          })
    proxy.on('connect', (request, client, head) => {
      tunnels.push(request)
      const destination = new URL(`http://${request.url}`)
      const upstream = connect(Number(destination.port), destination.hostname, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstream.write(head)
        client.pipe(upstream).pipe(client)
      })
      sockets.add(upstream)
      upstream.on('error', () => client.destroy())
    })
    const proxyPort = await listen(proxy)
    configureProxy(`${protocol}://user:password@127.0.0.1:${proxyPort}`)
    expect(await transfer(port)).toEqual({ host: `mineru.invalid:${port}`, body: 'document bytes' })
    expect(
      tunnels.map((request) => ({
        url: request.url,
        host: request.headers.host,
        auth: request.headers['proxy-authorization']
      }))
    ).toEqual([
      {
        url: `127.0.0.1:${port}`,
        host: `127.0.0.1:${port}`,
        auth: `Basic ${Buffer.from('user:password').toString('base64')}`
      }
    ])
  })

  it('verifies the original TLS hostname through the HTTP tunnel, not the pinned IP', async () => {
    const certificate = readFileSync(new URL('../../__tests__/fixtures/self-signed-cert.pem', import.meta.url), 'utf8')
    const originalCertificates = getCACertificates('default')
    setDefaultCACertificates([...originalCertificates, certificate])
    try {
      const target = createHttpsServer({
        cert: certificate,
        key: readFileSync(new URL('../../__tests__/fixtures/self-signed-key.pem', import.meta.url))
      })
      const port = await listen(target)
      const proxy = createServer()
      proxy.on('connect', (_request, client) => {
        const upstream = connect(port, '127.0.0.1', () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          client.pipe(upstream).pipe(client)
        })
        sockets.add(upstream)
        upstream.on('error', () => client.destroy())
      })
      configureProxy(`http://127.0.0.1:${await listen(proxy)}`)
      await expect(transfer(port, 'https:')).rejects.toMatchObject({
        cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID', host: 'mineru.invalid' }
      })
    } finally {
      setDefaultCACertificates(originalCertificates)
    }
  })

  it('matches bypass rules against the original hostname before pinning', async () => {
    const { port } = await startTarget()
    const tunnels: string[] = []
    const proxy = createServer()
    proxy.on('connect', (request, socket) => {
      tunnels.push(request.url ?? '')
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    })
    configureProxy(`http://127.0.0.1:${await listen(proxy)}`, '*.invalid')
    expect(await transfer(port)).toEqual({ host: `mineru.invalid:${port}`, body: 'document bytes' })
    expect(tunnels).toEqual([])
  })

  it('does not silently fall back to direct access when the configured proxy rejects the tunnel', async () => {
    const { port, requests } = await startTarget()
    const proxy = createServer()
    proxy.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'))
    configureProxy(`http://127.0.0.1:${await listen(proxy)}`)
    await expect(transfer(port)).rejects.toThrow()
    expect(requests).toEqual([])
  })

  it.each([4, 5])('sends a pinned address through a SOCKS %s proxy while retaining HTTP host', async (version) => {
    const { port } = await startTarget()
    const destinations: { address: string; port: number }[] = []
    const proxy = createTcpServer((client) => {
      const tunnel = (request: Buffer) => {
        const address = [...request.subarray(4, 8)].join('.')
        const destinationPort = version === 4 ? request.readUInt16BE(2) : request.readUInt16BE(8)
        destinations.push({ address, port: destinationPort })
        const upstream = connect(destinationPort, address, () => {
          client.write(
            version === 4 ? Buffer.from([0, 90, 0, 0, 0, 0, 0, 0]) : Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])
          )
          client.pipe(upstream).pipe(client)
        })
        sockets.add(upstream)
        upstream.on('error', () => client.destroy())
      }
      if (version === 4) client.once('data', tunnel)
      else
        client.once('data', () => {
          client.write(Buffer.from([5, 0]))
          client.once('data', tunnel)
        })
    })
    configureProxy(`socks${version}://127.0.0.1:${await listen(proxy)}`)
    expect(await transfer(port)).toEqual({ host: `mineru.invalid:${port}`, body: 'document bytes' })
    expect(destinations).toEqual([{ address: '127.0.0.1', port }])
  })
})
