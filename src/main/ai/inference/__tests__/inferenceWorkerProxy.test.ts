import http from 'node:http'
import net from 'node:net'
import { Worker } from 'node:worker_threads'

import { afterEach, describe, expect, it } from 'vitest'

import { configureInferenceWorkerProxy } from '../inferenceWorkerProxy'
import { inferenceWorkerSource } from '../inferenceWorkerSource'

const servers: Array<http.Server | net.Server> = []
const workers: Worker[] = []

async function listen(server: http.Server | net.Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port')
  return address.port
}

async function fetchFromWorker(targetUrl: string, proxyUrl: string): Promise<unknown> {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads')
    const configureInferenceWorkerProxy = ${configureInferenceWorkerProxy.toString()}
    configureInferenceWorkerProxy(workerData.appPath)
    fetch(workerData.targetUrl).then(
      (response) => response.text().then((body) => parentPort.postMessage({ ok: true, body })),
      (error) => parentPort.postMessage({ ok: false, message: error.message })
    )
  `
  const worker = new Worker(source, {
    eval: true,
    env: {
      ...process.env,
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      NO_PROXY: '',
      no_proxy: ''
    },
    workerData: { appPath: process.cwd(), targetUrl }
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

describe('configureInferenceWorkerProxy', () => {
  it('is embedded and invoked by the production inference worker', () => {
    expect(inferenceWorkerSource).toContain(configureInferenceWorkerProxy.toString())
    expect(inferenceWorkerSource).toContain('configureInferenceWorkerProxy(appPath)')
  })

  it('routes an inference worker fetch through the configured HTTP proxy', async () => {
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

    const result = await fetchFromWorker(`http://127.0.0.1:${targetPort}/model`, `http://127.0.0.1:${proxyPort}`)

    expect(result).toEqual({ ok: true, body: 'proxied' })
    expect(proxyRequests).toBe(1)
  })
})
