import { createServer } from 'node:http'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { APICallError, generateText, streamText, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { chatErrorContext } from '@main/ai/utils/chatErrorContext'
import { createExactPathDiagnosticsMiddleware } from '@main/ai/utils/exactPathDiagnostics'
import { createExactPathFetch } from '@main/ai/utils/exactPathFetch'
import { serializeError } from '@main/ai/utils/serializeError'

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] }]

// Regressions: SDK HTTP/parser errors are created after fetch resolves, and stream failures can arrive later.
describe('complete path diagnostics at the model boundary', () => {
  it.each([
    ['generate', 404, JSON.stringify({ error: { message: 'No route', type: 'not_found' } })],
    ['stream', 404, JSON.stringify({ error: { message: 'No route', type: 'not_found' } })],
    ['generate', 200, 'invalid-json']
  ] as const)('reports the real gateway URL for %s status %i', async (mode, status, body) => {
    const paths: string[] = []
    const server = createServer((request, response) => {
      paths.push(request.url!)
      request.resume()
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const exactUrl = `${origin}/literal/answer/?api_key=private-key&version=2`
    try {
      const provider = createOpenAICompatible({
        name: 'fixture',
        baseURL: origin,
        apiKey: 'private-bearer',
        fetch: createExactPathFetch(exactUrl, globalThis.fetch)
      })
      const model = wrapLanguageModel({
        model: provider.chatModel('fixture-model'),
        middleware: createExactPathDiagnosticsMiddleware(exactUrl)
      })
      let failure: unknown
      if (mode === 'generate') {
        failure = await generateText({ model, prompt: 'hello', maxRetries: 0 }).catch((error: unknown) => error)
      } else {
        const result = streamText({ model, prompt: 'hello', maxRetries: 0, onError: () => {} })
        for await (const chunk of result.fullStream) if (chunk.type === 'error') failure = chunk.error
      }
      expect(APICallError.isInstance(failure)).toBe(true)
      const error = failure as APICallError
      expect(error.url).toBe(`${origin}/literal/answer/?api_key=%3Credacted%3E&version=2`)
      expect(error.statusCode).toBe(status)
      expect(error.isRetryable).toBe(false)
      expect(paths).toEqual(['/literal/answer/?api_key=private-key&version=2'])
      const diagnostics = JSON.stringify({ log: chatErrorContext(error), ipc: serializeError(error) })
      expect(diagnostics).toContain('/literal/answer/')
      expect(diagnostics).not.toMatch(/private-key|private-bearer|chat\/completions/)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it.each(['chunk', 'read'] as const)(
    'annotates a late stream %s error without changing its identity or retry metadata',
    async (kind) => {
      const error = new APICallError({
        message: 'rate limit',
        url: 'https://adapter.example.com/chat/completions',
        requestBodyValues: {},
        statusCode: 429,
        isRetryable: true
      })
      const model = wrapLanguageModel({
        model: {
          specificationVersion: 'v3',
          provider: 'fixture',
          modelId: 'fixture',
          supportedUrls: {},
          doGenerate: async () => {
            throw error
          },
          doStream: async () => ({
            stream: new ReadableStream<LanguageModelV3StreamPart>({
              start(controller) {
                if (kind === 'read') controller.error(error)
                else {
                  controller.enqueue({ type: 'error', error })
                  controller.close()
                }
              }
            })
          })
        } as LanguageModelV3,
        middleware: createExactPathDiagnosticsMiddleware(
          'https://gateway.example.com/literal?token=secret#private-fragment'
        )
      })
      const { stream } = await model.doStream({ prompt })
      const reader = stream.getReader()
      const failure =
        kind === 'read' ? await reader.read().catch((value: unknown) => value) : (await reader.read()).value
      expect(kind === 'read' ? failure : (failure as { error: unknown }).error).toBe(error)
      expect(error.url).toBe('https://gateway.example.com/literal?token=%3Credacted%3E')
      expect(error.statusCode).toBe(429)
      expect(error.isRetryable).toBe(true)
    }
  )

  it('preserves abort identity, nested diagnostics and cycles while redacting userinfo', async () => {
    const abort = Object.assign(new DOMException('cancelled', 'AbortError'), { cause: new Error('socket') })
    const nested = abort.cause as Error & { cause?: unknown; url?: string }
    nested.cause = abort
    const middleware = createExactPathDiagnosticsMiddleware(
      'https://user:password@gateway.example.com/literal?token=secret'
    )
    const failure = await Promise.resolve(
      middleware.wrapGenerate!({
        doGenerate: async () => {
          throw abort
        }
      } as never)
    ).catch((value: unknown) => value)
    expect(failure).toBe(abort)
    expect(abort.name).toBe('AbortError')
    expect(nested.url).toContain('/literal?token=%3Credacted%3E')
    expect(nested.url).not.toMatch(/user|password|secret/)
  })

  it('keeps frozen failures intact and forwards successful stream chunks unchanged', async () => {
    const frozen = Object.freeze(new Error('frozen transport failure'))
    const middleware = createExactPathDiagnosticsMiddleware('https://gateway.example.com/literal')
    await expect(
      Promise.resolve(
        middleware.wrapGenerate!({
          doGenerate: async () => {
            throw frozen
          }
        } as never)
      )
    ).rejects.toBe(frozen)
    const chunk: LanguageModelV3StreamPart = { type: 'text-delta', id: 'text-1', delta: 'hello' }
    const result = await middleware.wrapStream!({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(chunk)
            controller.close()
          }
        }),
        response: { headers: { 'x-request-id': 'request-1' } }
      })
    } as never)
    const reader = result.stream.getReader()
    expect((await reader.read()).value).toBe(chunk)
    expect((await reader.read()).done).toBe(true)
    expect(result.response?.headers?.['x-request-id']).toBe('request-1')
  })

  it('does not replace failures whose nested-error accessor throws', async () => {
    const original = Object.defineProperty(new Error('original'), 'cause', {
      get() {
        throw new Error('accessor')
      }
    })
    const middleware = createExactPathDiagnosticsMiddleware('https://gateway.example.com/literal')
    await expect(
      Promise.resolve(
        middleware.wrapGenerate!({
          doGenerate: async () => {
            throw original
          }
        } as never)
      )
    ).rejects.toBe(original)
  })

  it('forwards cancellation to the upstream stream', async () => {
    let reason: unknown
    const middleware = createExactPathDiagnosticsMiddleware('https://gateway.example.com/literal')
    const result = await middleware.wrapStream!({
      doStream: async () => ({
        stream: new ReadableStream({
          cancel(value) {
            reason = value
          }
        })
      })
    } as never)
    await result.stream.cancel('caller cancelled')
    expect(reason).toBe('caller cancelled')
  })
})
