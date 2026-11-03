import { createServer, request } from 'node:http'

import { expect, it } from 'vitest'

import { createProxy } from '../../src/backends/mxc/proxy.js'
import { validateSpec } from '../../src/host/validateSpec.js'
import { spec } from '../fixtures.js'

function get(proxy: string, url: string, method = 'GET') {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const target = new URL(proxy)
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        method,
        path: method === 'CONNECT' ? new URL(url).host : url,
        agent: false
      },
      (response) => {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode!, body }))
      }
    )
    req.on('connect', (response, socket) => {
      socket.destroy()
      resolve({ status: response.statusCode!, body: '' })
    })
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('timeout')))
    req.end()
  })
}

it('enforces host and port grants for HTTP and CONNECT, isolates proxies and revokes access on close', async () => {
  let hits = 0
  const target = createServer((_, response) => {
    hits++
    response.end('fixture')
  })
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
  const address = target.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  const destination = `http://127.0.0.1:${address.port}/`
  const granted = await createProxy([{ host: '127.0.0.1', port: address.port }], () => {})
  const denied = await createProxy([], () => {})
  const dnsAlias = await createProxy([{ host: 'localhost', port: address.port }], () => {})
  try {
    expect(await get(granted.url, destination)).toEqual({ status: 200, body: 'fixture' })
    expect((await get(granted.url, destination, 'CONNECT')).status).toBe(200)
    for (const method of ['GET', 'CONNECT']) {
      expect((await get(denied.url, destination, method)).status).toBe(403)
      expect((await get(granted.url, `http://localhost:${address.port}/`, method)).status).toBe(403)
      expect((await get(granted.url, 'http://127.0.0.1:1/', method)).status).toBe(403)
    }
    expect((await get(dnsAlias.url, `http://localhost:${address.port}/`)).status).not.toBe(200)
    expect(hits).toBe(1)
    await granted.close()
    await expect(get(granted.url, destination)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    await granted.close()
  } finally {
    await Promise.all([granted.close(), denied.close(), dnsAlias.close()])
    target.closeAllConnections()
    await new Promise<void>((resolve) => target.close(() => resolve()))
  }
})

it.each([
  { host: '*', port: 443 },
  { host: 'https://example.com', port: 443 },
  { host: 'example.com', port: 0 },
  { host: 'example.com', port: 65536 },
  { host: 'example.com', port: 1.5 }
])('rejects malformed proxy grants before launch: %j', (target) => {
  expect(() => validateSpec({ ...spec(), network: { mode: 'proxy', targets: [target] } })).toThrow(
    'Invalid sandbox specification'
  )
})
