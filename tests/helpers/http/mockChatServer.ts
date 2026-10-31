import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'

import * as z from 'zod'

const chatRequestSchema = z.looseObject({
  model: z.string().min(1),
  messages: z.array(z.unknown()),
  stream: z.boolean().default(false)
})

export interface MockChatRequest {
  readonly body: z.infer<typeof chatRequestSchema>
  /** Resolves when the response closes, including client cancellation. */
  readonly closed: Promise<void>
  /** Sends one text delta. Only valid for streaming requests. */
  sendText(text: string): void
  /** Sends optional final text and completes the JSON or SSE response normally. */
  complete(text?: string): void
  /** Sends an SSE provider error, or HTTP 500 for a non-streaming request. */
  fail(message: string): void
  /** Destroys the socket without a finish chunk or [DONE]. */
  disconnect(): void
}

export interface MockChatServer {
  readonly baseUrl: string
  readonly modelId: string
  /** Receives requests in arrival order. Timeout and server shutdown reject the wait. */
  nextRequest(timeoutMs?: number): Promise<MockChatRequest>
  /** Closes all connections, including unfinished streams, and rejects pending waits. */
  close(): Promise<void>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function createChatRequest(body: MockChatRequest['body'], res: ServerResponse, id: string): MockChatRequest {
  const metadata = { id, model: body.model, created: Math.floor(Date.now() / 1000) }
  const closed = new Promise<void>((resolve) => res.once('close', resolve))

  const assertOpen = () => {
    if (res.destroyed || res.writableEnded) throw new Error('Mock chat response is already closed')
  }
  const sendEvent = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`)
  const sendChunk = (delta: object, finishReason: 'stop' | null = null) =>
    sendEvent({
      ...metadata,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    })

  if (body.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.flushHeaders()
    sendChunk({ role: 'assistant', content: '' })
  }

  return {
    body,
    closed,
    sendText(text) {
      assertOpen()
      if (!body.stream) throw new Error('sendText requires a streaming request')
      sendChunk({ content: text })
    },
    complete(text = '') {
      assertOpen()
      if (body.stream) {
        if (text) sendChunk({ content: text })
        sendChunk({}, 'stop')
        res.end('data: [DONE]\n\n')
      } else {
        sendJson(res, 200, {
          ...metadata,
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }]
        })
      }
    },
    fail(message) {
      assertOpen()
      const error = { error: { message, type: 'server_error', code: 'mock_error' } }
      if (body.stream) {
        sendEvent(error)
        res.end('data: [DONE]\n\n')
      } else {
        sendJson(res, 500, error)
      }
    },
    disconnect() {
      res.destroy()
    }
  }
}

/** Real loopback OpenAI-compatible HTTP server shared by Node tests and Electron E2E. */
export async function startMockChatServer(): Promise<MockChatServer> {
  const modelId = 'mock-chat'
  const requests: MockChatRequest[] = []
  const waiters = new Set<{ resolve(request: MockChatRequest): void; reject(error: Error): void }>()
  let requestId = 0
  let closing = false
  let closePromise: Promise<void> | undefined

  const server = createServer((req, res) => {
    const route = req.url?.split('?')[0]
    if (req.method === 'GET' && route === '/v1/models') {
      sendJson(res, 200, { object: 'list', data: [{ id: modelId, object: 'model', created: 0, owned_by: 'mock' }] })
      return
    }
    if (req.method !== 'POST' || route !== '/v1/chat/completions') {
      sendJson(res, 404, { error: { message: 'Unknown mock endpoint', type: 'invalid_request_error' } })
      return
    }

    const receive = async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const body = chatRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (closing || res.destroyed) return
      const request = createChatRequest(body, res, `chatcmpl-mock-${++requestId}`)
      const waiter = waiters.values().next().value
      if (waiter) {
        waiter.resolve(request)
      } else {
        requests.push(request)
        void request.closed.then(() => {
          const index = requests.indexOf(request)
          if (index !== -1) requests.splice(index, 1)
        })
      }
    }
    void receive().catch(() => {
      if (!res.destroyed) {
        sendJson(res, 400, { error: { message: 'Invalid chat completion request', type: 'invalid_request_error' } })
      }
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock server did not bind a TCP port')

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    modelId,
    nextRequest(timeoutMs = 10_000) {
      if (closing) return Promise.reject(new Error('Mock chat server is closed'))
      const request = requests.shift()
      if (request) return Promise.resolve(request)
      return new Promise<MockChatRequest>((resolve, reject) => {
        const waiter = {
          resolve(request: MockChatRequest) {
            clearTimeout(timer)
            waiters.delete(waiter)
            resolve(request)
          },
          reject(error: Error) {
            clearTimeout(timer)
            waiters.delete(waiter)
            reject(error)
          }
        }
        const timer = setTimeout(() => waiter.reject(new Error('Timed out waiting for a mock chat request')), timeoutMs)
        waiters.add(waiter)
      })
    },
    close() {
      if (!closePromise) {
        closing = true
        for (const waiter of waiters) waiter.reject(new Error('Mock chat server is closed'))
        requests.length = 0
        closePromise = new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
          server.closeAllConnections()
        })
      }
      return closePromise
    }
  }
}
