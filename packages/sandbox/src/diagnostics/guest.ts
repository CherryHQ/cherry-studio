import { readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { request as requestHttps } from 'node:https'
import { setTimeout } from 'node:timers/promises'

import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'

import { createRpcPeer } from '../rpc/peer.js'
import type { JsonValue } from '../types.js'

const peer = createRpcPeer(process.stdin, process.stdout, { authorize: async () => true })
peer.handle('echo', async (params) => params)
peer.handle('read', async ({ path }): Promise<JsonValue> => {
  if (typeof path !== 'string') throw new Error('Expected path')
  try {
    return { text: await readFile(path, 'utf8') }
  } catch (error) {
    return { error: error instanceof Error && 'code' in error ? String(error.code) : String(error) }
  }
})
peer.handle('write', async ({ path, text }): Promise<JsonValue> => {
  if (typeof path !== 'string' || typeof text !== 'string') throw new Error('Expected path and text')
  try {
    await writeFile(path, text)
    return { written: true }
  } catch (error) {
    return { error: error instanceof Error && 'code' in error ? String(error.code) : String(error) }
  }
})
peer.handle('compute', async ({ value }) => {
  const result = await peer.request('host.double', { value })
  if (typeof result !== 'number') throw new Error('Expected number')
  return result + 1
})
peer.handle('forbidden', async () => {
  try {
    return await peer.request('host.secret', {})
  } catch (error) {
    return { error: String(error) }
  }
})
peer.handle('delay', async ({ ms, value }, signal) => {
  if (typeof ms !== 'number' || ms < 0 || ms > 3000) throw new Error('Invalid delay')
  await setTimeout(ms, undefined, { signal })
  return value ?? null
})
peer.handle('cancel', async (_, signal) => {
  await peer.request('host.started', {})
  try {
    await setTimeout(3000, undefined, { signal })
  } catch {
    await peer.request('host.cancelled', {})
    return 'cancelled'
  }
  return 'finished'
})
peer.handle('http', async ({ url, direct, connect }) => {
  if (typeof url !== 'string') throw new Error('Expected URL')
  const target = new URL(url)
  const proxy = new URL(process.env.HTTP_PROXY ?? 'http://127.0.0.1:1')
  return await new Promise((resolve) => {
    const req = request({
      hostname: direct ? target.hostname : proxy.hostname,
      port: direct ? target.port : proxy.port,
      method: connect ? 'CONNECT' : 'GET',
      path: connect ? target.host : direct ? target.pathname : target.href,
      headers: { host: target.host },
      agent: false
    })
    req.setTimeout(2000, () => req.destroy(new Error('timeout')))
    req.on('connect', (response, socket) => {
      socket.destroy()
      resolve({ status: response.statusCode ?? 0 })
    })
    req.on('response', (response) => {
      let body = ''
      response.on('data', (chunk: Buffer) => {
        body += chunk.toString()
        if (body.length > 4096) req.destroy(new Error('too large'))
      })
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, body, location: response.headers.location ?? '' })
      )
    })
    req.on('error', (error: NodeJS.ErrnoException) => resolve({ error: error.code ?? error.message }))
    req.end()
  })
})

peer.handle('fetch', async ({ url }, signal) => {
  if (typeof url !== 'string') throw new Error('Expected URL')
  const target = new URL(url)
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Expected HTTP or HTTPS')
  const proxy = process.env.HTTP_PROXY
  if (!proxy) throw new Error('Missing sandbox proxy')
  const secure = target.protocol === 'https:'
  const agent = secure ? new HttpsProxyAgent(proxy) : new HttpProxyAgent(proxy)
  try {
    return await new Promise<JsonValue>((resolve, reject) => {
      const req = (secure ? requestHttps : request)(
        target,
        {
          agent,
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)])
        },
        (response) => {
          const chunks: Buffer[] = []
          let bytes = 0
          const finish = (truncated: boolean) =>
            resolve({
              status: response.statusCode ?? 0,
              contentType: response.headers['content-type'] ?? '',
              location: response.headers.location ?? '',
              body: Buffer.concat(chunks).toString('utf8'),
              truncated
            })
          response.on('data', (chunk: Buffer) => {
            chunks.push(chunk.subarray(0, Math.max(0, 4096 - bytes)))
            bytes += chunk.length
            if (bytes > 4096) {
              finish(true)
              response.destroy()
            }
          })
          response.on('end', () => finish(false))
          response.on('error', reject)
        }
      )
      req.on('error', reject)
      req.end()
    })
  } finally {
    agent.destroy()
  }
})
