import type { AddressInfo } from 'node:net'

import { WebSocketServer } from 'ws'

import { evaluateCdpExpression } from '../cdp-client'

async function withCdpServer(
  response: (request: { id: number; method: string; params: Record<string, unknown> }) => unknown,
  run: (url: string) => Promise<void>
): Promise<void> {
  const server = new WebSocketServer({ port: 0 })
  await new Promise<void>((resolvePromise) => server.once('listening', resolvePromise))
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const request = JSON.parse(data.toString()) as {
        id: number
        method: string
        params: Record<string, unknown>
      }
      socket.send(JSON.stringify({ id: request.id, result: response(request) }))
    })
  })

  try {
    const { port } = server.address() as AddressInfo
    await run(`ws://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise()))
    )
  }
}

describe('CDP expression evaluation', () => {
  it('evaluates one expression and returns its value', async () => {
    await withCdpServer(
      (request) => {
        expect(request).toMatchObject({
          method: 'Runtime.evaluate',
          params: { awaitPromise: true, expression: '6 * 7', returnByValue: true }
        })
        return { result: { value: 42 } }
      },
      async (url) => {
        await expect(evaluateCdpExpression<number>(url, '6 * 7')).resolves.toBe(42)
      }
    )
  })

  it('rejects a runtime exception returned by CDP', async () => {
    await withCdpServer(
      () => ({ exceptionDetails: { text: '表达式异常' }, result: {} }),
      async (url) => {
        await expect(evaluateCdpExpression(url, 'throw new Error()')).rejects.toThrow('表达式异常')
      }
    )
  })
})
