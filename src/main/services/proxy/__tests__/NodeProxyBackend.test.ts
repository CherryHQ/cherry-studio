import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { startTestHttpServer, startTestHttpsServer, unusedPort } from '@test-helpers/http/server'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { fetch as undiciFetch } from 'undici'
import { describe, expect, it, vi } from 'vitest'

import type { ProxyBypassRuleMatcher } from '../bypassRules'
import { NodeProxyBackend } from '../NodeProxyBackend'

function bindWithSharedAgent() {
  const backend = new NodeProxyBackend()
  const sharedProxyAgent = new https.Agent()
  const originalMethod = vi.fn()
  // bindHttpMethod is private; exercise the bound wrapper directly
  const bound = (backend as any).bindHttpMethod(originalMethod, sharedProxyAgent) as (...args: unknown[]) => unknown
  return { bound, originalMethod, sharedProxyAgent }
}

function setBypassRules(backend: NodeProxyBackend, rules: string[]) {
  const matcher = Reflect.get(backend, 'proxyBypassRuleMatcher') as ProxyBypassRuleMatcher
  matcher.updateByPassRules(rules)
}

function readResponse(request: http.ClientRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    request.on('error', reject)
    request.on('response', (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => (body += chunk))
      response.on('error', reject)
      response.on('end', () => resolve(body))
    })
    request.end()
  })
}

describe('NodeProxyBackend request binding', () => {
  it('propagates the caller agent TLS stance per-request without mutating the shared proxy agent', () => {
    const { bound, originalMethod, sharedProxyAgent } = bindWithSharedAgent()

    bound('https://example.test/backup', { agent: new https.Agent({ rejectUnauthorized: false }) })

    const forwardedOptions = originalMethod.mock.calls[0][1]
    expect(forwardedOptions.rejectUnauthorized).toBe(false)
    expect(forwardedOptions.agent).toBe(sharedProxyAgent)
    expect(sharedProxyAgent.options.rejectUnauthorized).not.toBe(false)
  })

  it('keeps a strict caller agent strict on the forwarded request', () => {
    const { bound, originalMethod, sharedProxyAgent } = bindWithSharedAgent()

    bound('https://example.test/backup', { agent: new https.Agent({ rejectUnauthorized: true }) })

    const forwardedOptions = originalMethod.mock.calls[0][1]
    expect(forwardedOptions.rejectUnauthorized).toBe(true)
    expect(sharedProxyAgent.options.rejectUnauthorized).not.toBe(false)
  })

  it('routes agentless requests through the shared proxy agent without injecting TLS options', () => {
    const { bound, originalMethod, sharedProxyAgent } = bindWithSharedAgent()

    bound('https://example.test/api', {})

    const forwardedOptions = originalMethod.mock.calls[0][1]
    expect(forwardedOptions.agent).toBe(sharedProxyAgent)
    expect('rejectUnauthorized' in forwardedOptions).toBe(false)
  })

  it('does not inject TLS options when the caller agent carries no explicit stance (default verifies)', () => {
    const { bound, originalMethod, sharedProxyAgent } = bindWithSharedAgent()

    bound('https://example.test/backup', { agent: new https.Agent() })

    const forwardedOptions = originalMethod.mock.calls[0][1]
    expect(forwardedOptions.agent).toBe(sharedProxyAgent)
    expect('rejectUnauthorized' in forwardedOptions).toBe(false)
  })

  it.each(['get', 'request'] as const)(
    'honors options-only bypass and destination overrides with http.%s',
    async (method) => {
      let directHits = 0
      let proxyHits = 0
      const local = await startTestHttpServer((_request, response) => {
        directHits++
        response.end('direct')
      })
      const proxy = await startTestHttpServer((_request, response) => {
        proxyHits++
        response.end('proxy')
      })
      const backend = new NodeProxyBackend()
      const agent = new HttpProxyAgent(proxy.url)
      setBypassRules(backend, [`127.0.0.1:${local.port}`])
      const bound = Reflect.get(backend, 'bindHttpMethod').call(backend, http[method], agent) as typeof http.request

      try {
        expect(await readResponse(bound({ hostname: local.host, port: local.port }))).toBe('direct')
        expect(await readResponse(bound({ host: local.host, defaultPort: local.port }))).toBe('direct')
        expect(await readResponse(bound(new URL(local.url)))).toBe('direct')
        expect(await readResponse(bound('http://remote.invalid', { hostname: local.host, port: local.port }))).toBe(
          'direct'
        )
        expect(await readResponse(bound(local.url, { hostname: 'remote.invalid' }))).toBe('proxy')
        expect(await readResponse(bound({ hostname: local.host, port: local.port + 1 }))).toBe('proxy')
        expect(directHits).toBe(4)
        expect(proxyHits).toBe(2)
      } finally {
        agent.destroy()
        await Promise.all([local.close(), proxy.close()])
      }
    }
  )

  it('keeps local S3 requests direct through the real AWS HTTP handler', async () => {
    let proxyHits = 0
    const local = await startTestHttpServer()
    const proxy = await startTestHttpServer((_request, response) => {
      proxyHits++
      response.writeHead(502).end()
    })
    const backend = new NodeProxyBackend()
    const client = new S3Client({
      endpoint: local.url,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      maxAttempts: 1
    })

    try {
      await backend.configure(
        proxy.url,
        { kind: 'http', url: proxy.url, displayOrigin: proxy.url },
        ['127.0.0.1'],
        () => {}
      )
      const result = await client.send(new HeadBucketCommand({ Bucket: 'backup' }))
      expect(result.$metadata.httpStatusCode).toBe(200)
      expect(proxyHits).toBe(0)
    } finally {
      await backend.configure(undefined, null, [], () => {})
      client.destroy()
      await Promise.all([local.close(), proxy.close()])
    }
  })

  it('keeps undici IPv6 loopback direct with the Agent NO_PROXY value while proxying other origins', async () => {
    const proxyHits: string[] = []
    const proxyServer = http.createServer((_request, response) => {
      proxyHits.push('request')
      response.writeHead(502).end()
    })
    proxyServer.on('connect', (_request, socket) => {
      proxyHits.push('connect')
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    })
    await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
    const proxyUrl = `http://127.0.0.1:${(proxyServer.address() as AddressInfo).port}`
    const backend = new NodeProxyBackend()
    const previousEnv = {
      HTTP_PROXY: process.env.HTTP_PROXY,
      http_proxy: process.env.http_proxy,
      NO_PROXY: process.env.NO_PROXY,
      no_proxy: process.env.no_proxy
    }

    try {
      process.env.HTTP_PROXY = proxyUrl
      process.env.http_proxy = proxyUrl
      process.env.NO_PROXY = 'localhost,127.0.0.1,::1'
      process.env.no_proxy = 'localhost,127.0.0.1,::1'
      const targetPort = await unusedPort()
      await backend.configure(
        proxyUrl,
        { kind: 'http', url: proxyUrl, displayOrigin: proxyUrl },
        ['localhost', '127.0.0.1', '::1'],
        () => {}
      )

      let connectionError: unknown
      try {
        await undiciFetch(`http://[::1]:${targetPort}/`)
      } catch (error) {
        connectionError = error
      }
      const error = connectionError as Error & { cause?: NodeJS.ErrnoException }
      expect(String(error?.cause?.code ?? error?.message)).toContain('ECONNREFUSED')
      expect(error.cause).toMatchObject({ address: '::1', port: targetPort })
      expect(proxyHits).toEqual([])

      await expect(undiciFetch('http://undici-control.invalid/')).rejects.toThrow()
      expect(proxyHits).toEqual(['connect'])
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await backend.configure(undefined, null, [], () => {})
      proxyServer.closeAllConnections()
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()))
    }
  })

  it('retains the caller TLS agent and callback when an options-only HTTPS request bypasses', async () => {
    const local = await startTestHttpsServer((_request, response) => response.end('secure direct'))
    const backend = new NodeProxyBackend()
    const callerAgent = new https.Agent({ rejectUnauthorized: false })
    const proxyAgent = new HttpsProxyAgent(`http://127.0.0.1:${await unusedPort()}`)
    setBypassRules(backend, [`https://127.0.0.1:${local.port}`])
    const bound = Reflect.get(backend, 'bindHttpMethod').call(
      backend,
      https.get,
      proxyAgent,
      'https:'
    ) as typeof https.get

    try {
      const status = new Promise<number | undefined>((resolve, reject) => {
        const request = bound({ hostname: local.host, port: local.port, agent: callerAgent }, (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        })
        request.on('error', reject)
      })
      expect(await status).toBe(200)
    } finally {
      callerAgent.destroy()
      proxyAgent.destroy()
      await local.close()
    }
  })

  it.each([
    { options: { host: 'minio.internal', port: 9000 }, rule: 'minio.internal:9000', protocol: 'http:' },
    {
      options: { hostname: 'minio.internal', host: 'remote.invalid', port: 9000 },
      rule: 'minio.internal:9000',
      protocol: 'http:'
    },
    { options: { hostname: '192.168.1.5' }, rule: '192.168.0.0/16', protocol: 'http:' },
    { options: { hostname: '::1', port: 9000 }, rule: '[::1]:9000', protocol: 'http:' },
    { options: { hostname: '[::1]', port: 9000 }, rule: '[::1]:9000', protocol: 'http:' },
    { options: {}, rule: 'http://localhost:80', protocol: 'http:' },
    { options: {}, rule: 'https://localhost:443', protocol: 'https:' }
  ])('matches the effective Node destination $rule', ({ options, rule, protocol }) => {
    const backend = new NodeProxyBackend()
    const originalMethod = vi.fn()
    const proxyAgent = new http.Agent()
    setBypassRules(backend, [rule])
    const bound = Reflect.get(backend, 'bindHttpMethod').call(backend, originalMethod, proxyAgent, protocol)

    bound(options)

    expect(originalMethod.mock.calls[0][0]).toEqual(options)
  })
})
