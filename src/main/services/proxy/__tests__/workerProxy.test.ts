import http from 'node:http'
import net from 'node:net'
import { Worker } from 'node:worker_threads'

import { embeddingWorkerSource } from '@main/ai/localModel/capabilities/embedding/worker'
import { buildInferenceWorkerSource } from '@main/ai/localModel/runtime/worker/buildWorkerSource'
import { onnxRuntimeWorkerSource } from '@main/ai/localModel/runtime/worker/onnxRuntime'
import { afterEach, describe, expect, it } from 'vitest'

import { createProxyBypassMatcher } from '../bypassRules'
import { createProxyRoutingSnapshot, normalizeProxyEndpoint, type ProxyRoutingSnapshot } from '../proxyRouting'
import { configureWorkerProxy } from '../workerProxy'

const servers: Array<http.Server | net.Server> = []
const workers: Worker[] = []
const inferenceWorkerSource = buildInferenceWorkerSource(onnxRuntimeWorkerSource, embeddingWorkerSource)

async function listen(server: http.Server | net.Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port')
  return address.port
}

/** Minimal SOCKS5 endpoint whose canned response proves the request used the proxy. */
function createSocks5Server(onConnect: () => void) {
  return net.createServer((socket) => {
    let greeted = false
    let connected = false
    socket.on('data', () => {
      if (!greeted) {
        greeted = true
        socket.write(Buffer.from([0x05, 0x00]))
      } else if (!connected) {
        connected = true
        onConnect()
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      } else {
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied')
      }
    })
  })
}

async function fetchFromWorker(
  targetUrls: string[],
  proxyRouting: ProxyRoutingSnapshot,
  env: NodeJS.Dict<string> = process.env
): Promise<unknown> {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads')
    const createProxyBypassMatcher = ${createProxyBypassMatcher.toString()}
    const configureWorkerProxy = ${configureWorkerProxy.toString()}
    configureWorkerProxy(workerData.appPath, workerData.proxyRouting, createProxyBypassMatcher)
    Promise.all(workerData.targetUrls.map((url) => fetch(url).then((response) => response.text()))).then(
      (bodies) => parentPort.postMessage({ ok: true, bodies }),
      (error) => parentPort.postMessage({ ok: false, message: error.message })
    )
  `
  const worker = new Worker(source, {
    eval: true,
    env,
    workerData: { appPath: process.cwd(), targetUrls, proxyRouting }
  })
  workers.push(worker)

  return await new Promise((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
  })
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()))
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
})

describe('configureWorkerProxy', () => {
  it('is embedded and invoked by the production inference worker', () => {
    expect(inferenceWorkerSource).toContain(configureWorkerProxy.toString())
    // The matcher must travel with it: the worker evaluates bypass rules itself, and a free
    // reference to another module's symbol would not survive `.toString()`.
    expect(inferenceWorkerSource).toContain(createProxyBypassMatcher.toString())
    expect(inferenceWorkerSource).toContain('configureWorkerProxy(appPath, msg.proxyRouting, createProxyBypassMatcher)')
  })

  it('uses a direct snapshot even when the worker environment contains proxy variables', async () => {
    let directRequests = 0
    const target = http.createServer((_request, response) => {
      directRequests += 1
      response.end('direct')
    })
    const targetPort = await listen(target)

    const result = await fetchFromWorker(
      [`http://127.0.0.1:${targetPort}/model`],
      { version: 1, mode: 'direct' },
      {
        ...process.env,
        HTTP_PROXY: 'http://127.0.0.1:1',
        HTTPS_PROXY: 'http://127.0.0.1:1',
        http_proxy: 'http://127.0.0.1:1',
        https_proxy: 'http://127.0.0.1:1',
        SOCKS_PROXY: 'socks5://127.0.0.1:1',
        socks_proxy: 'socks5://127.0.0.1:1',
        ALL_PROXY: 'socks5://127.0.0.1:1',
        all_proxy: 'socks5://127.0.0.1:1',
        CHERRY_STUDIO_NODE_PROXY_RULES: 'socks5://127.0.0.1:1',
        CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: ''
      }
    )

    expect(result).toEqual({ ok: true, bodies: ['direct'] })
    expect(directRequests).toBe(1)
  })

  it('routes an inference worker fetch through the normalized HTTP proxy endpoint', async () => {
    const targetPort = await listen(net.createServer((socket) => socket.destroy()))
    let proxyRequests = 0
    const proxy = http.createServer()
    proxy.on('connect', (_request, socket) => {
      proxyRequests += 1
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.once('data', () => {
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied')
      })
    })
    const proxyPort = await listen(proxy)
    const targetUrl = `http://127.0.0.1:${targetPort}/model`
    const routing = createProxyRoutingSnapshot(1, normalizeProxyEndpoint(`http://127.0.0.1:${proxyPort}`), [])

    const result = await fetchFromWorker([targetUrl], routing)

    expect(result).toEqual({ ok: true, bodies: ['proxied'] })
    expect(proxyRequests).toBe(1)
  })

  it('applies main-owned bypass decisions to direct and SOCKS-routed origins', async () => {
    let directRequests = 0
    const directTarget = http.createServer((_request, response) => {
      directRequests += 1
      response.end('direct')
    })
    const directPort = await listen(directTarget)
    const proxiedPort = await listen(net.createServer((socket) => socket.destroy()))
    let proxyConnects = 0
    const proxyPort = await listen(createSocks5Server(() => (proxyConnects += 1)))
    const directUrl = `http://127.0.0.1:${directPort}/model`
    const proxiedUrl = `http://127.0.0.1:${proxiedPort}/model`
    const endpoint = normalizeProxyEndpoint(`socks5://127.0.0.1:${proxyPort}`)!
    const routing = createProxyRoutingSnapshot(2, endpoint, [`127.0.0.1:${directPort}`])

    const result = await fetchFromWorker([directUrl, proxiedUrl], routing)

    expect(result).toEqual({ ok: true, bodies: ['direct', 'proxied'] })
    expect(directRequests).toBe(1)
    expect(proxyConnects).toBe(1)
  })

  // The regression this guards: a model download's first hop is `huggingface.co` but its
  // weights come from `us.aws.cdn.hf.co` — a different registrable domain, reached only via
  // redirect. Judging origins up front can only cover the first hop, so a bypass rule the
  // user wrote for the CDN would be ignored and the download forced through the proxy.
  it('re-judges the origin of every redirect hop, not just the one the request started on', async () => {
    let cdnRequests = 0
    const cdn = http.createServer((_request, response) => {
      cdnRequests += 1
      response.end('weights')
    })
    const cdnPort = await listen(cdn)
    const entry = http.createServer((_request, response) => {
      response.writeHead(302, { Location: `http://127.0.0.1:${cdnPort}/weights` })
      response.end()
    })
    const entryPort = await listen(entry)
    const proxiedPort = await listen(net.createServer((socket) => socket.destroy()))
    let proxyConnects = 0
    const proxyPort = await listen(createSocks5Server(() => (proxyConnects += 1)))
    const endpoint = normalizeProxyEndpoint(`socks5://127.0.0.1:${proxyPort}`)!
    const routing = createProxyRoutingSnapshot(3, endpoint, [`127.0.0.1:${entryPort}`, `127.0.0.1:${cdnPort}`])

    const result = await fetchFromWorker(
      [`http://127.0.0.1:${entryPort}/model`, `http://127.0.0.1:${proxiedPort}/other`],
      routing
    )

    // The redirect target connects directly; the unexempted origin still goes to the proxy,
    // so a dispatcher that simply bypassed everything would not pass this.
    expect(result).toEqual({ ok: true, bodies: ['weights', 'proxied'] })
    expect(cdnRequests).toBe(1)
    expect(proxyConnects).toBe(1)
  })
})
