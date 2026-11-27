import http from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDashScopeTransport } from '../dashscope/dashscopeTransport'

/**
 * Exercises the global-fetch fallback over a real socket: the `dispatcher`
 * option is undici-specific, so a real request proves it is accepted (and the
 * response still parses) rather than rejected as "fetch failed".
 */
describe('DashScope request over a real socket', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a response whose headers arrive after a delayed real HTTP server', async () => {
    const server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://img/a.png' }] } }))
      }, 400)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      const transport = createDashScopeTransport({ apiKey: 'token', imageBaseURL: `http://127.0.0.1:${port}` })
      const result = await transport.submit({
        modelId: 'qwen-image',
        prompt: 'a fox',
        n: 1,
        size: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        providerParams: {},
        modelDescriptor: {
          id: 'qwen-image',
          endpoint: '/api/v1/services/aigc/text2image/image-synthesis',
          isSync: true
        },
        requestTimeoutMs: 5_000
      })

      expect(result).toEqual({ imageUrls: ['https://img/a.png'] })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
