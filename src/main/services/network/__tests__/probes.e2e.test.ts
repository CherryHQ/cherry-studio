import { startTestHttpServer, startTestHttpsServer, unusedPort } from '@test-helpers/http/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { httpReach, resolveHost, tlsHandshake } from '../probes'

/**
 * End-to-end over real loopback sockets; only Electron's `net.fetch` is swapped for Node's fetch.
 * A bare 407 cannot be simulated here (undici rejects it before it becomes a Response), so proxy
 * auth stays a unit test on the status classifier.
 */
const fetchImpl = globalThis.fetch
const signal = () => new AbortController().signal

describe('httpReach against a real server', () => {
  let server: Awaited<ReturnType<typeof startTestHttpServer>>
  beforeAll(async () => {
    server = await startTestHttpServer((req, res) => {
      const status = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('status') ?? 200)
      res.writeHead(status).end()
    })
  })
  afterAll(() => server.close())

  it('reports ok with the status for 2xx and 4xx (the server was reached)', async () => {
    await expect(httpReach(`${server.url}/?status=200`, { signal: signal(), fetchImpl })).resolves.toMatchObject({
      status: 'ok',
      data: { status: 200 }
    })
    await expect(httpReach(`${server.url}/?status=404`, { signal: signal(), fetchImpl })).resolves.toMatchObject({
      status: 'ok',
      data: { status: 404 }
    })
  })

  it('classifies 5xx as a server failure', async () => {
    await expect(httpReach(`${server.url}/?status=503`, { signal: signal(), fetchImpl })).resolves.toMatchObject({
      status: 'failed',
      kind: 'http_server',
      code: 'HTTP 503'
    })
  })

  it('classifies a closed port as refused', async () => {
    const port = await unusedPort()
    await expect(httpReach(`http://127.0.0.1:${port}/`, { signal: signal(), fetchImpl })).resolves.toMatchObject({
      status: 'failed',
      kind: 'refused'
    })
  })

  it('classifies an elapsed timeout signal as timeout', async () => {
    const slow = await startTestHttpServer(() => {})
    try {
      const result = await httpReach(slow.url, { signal: AbortSignal.timeout(50), fetchImpl })
      expect(result).toMatchObject({ status: 'failed', kind: 'timeout' })
    } finally {
      await slow.close()
    }
  })
})

describe('tlsHandshake against a real TLS server', () => {
  it('rejects the self-signed test certificate as tls_cert and still names its issuer', async () => {
    const server = await startTestHttpsServer()
    try {
      const result = await tlsHandshake(server.host, server.port, signal())
      expect(result).toMatchObject({ status: 'failed', kind: 'tls_cert', data: { issuer: '127.0.0.1' } })
      if (result.status === 'failed') expect(result.code).toMatch(/SELF_SIGNED|DEPTH_ZERO/)
    } finally {
      await server.close()
    }
  })

  it('reports an elapsed timeout signal as timeout, not as a certificate problem', async () => {
    const server = await startTestHttpsServer()
    try {
      const result = await tlsHandshake(server.host, server.port, AbortSignal.timeout(0))
      expect(result).toMatchObject({ status: 'failed', kind: 'timeout' })
    } finally {
      await server.close()
    }
  })

  it('classifies a closed port as refused', async () => {
    await expect(tlsHandshake('127.0.0.1', await unusedPort(), signal())).resolves.toMatchObject({
      status: 'failed',
      kind: 'refused'
    })
  })
})

describe('resolveHost', () => {
  it('resolves localhost and fails an .invalid name as dns', async () => {
    await expect(resolveHost('localhost', signal())).resolves.toMatchObject({ status: 'ok' })
    await expect(resolveHost('cherry-doctor-test.invalid', signal())).resolves.toMatchObject({
      status: 'failed',
      kind: 'dns'
    })
  })
})
