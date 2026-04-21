import { APICallError, NoOutputGeneratedError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateAgent = vi.fn()

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args)
}))

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rethrows upstream APICallError instead of NoOutputGeneratedError when no UI output is generated', async () => {
    const apiError = new APICallError({
      message: 'Unauthorized',
      url: 'https://api.example.com/chat/completions',
      requestBodyValues: { model: 'test-model', messages: [] },
      statusCode: 401,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"error":"Invalid signature"}',
      isRetryable: false
    })

    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: ({ onError }: { onError?: (error: unknown) => string }) => {
          onError?.(apiError)
          return new ReadableStream({
            start(controller) {
              controller.error(
                new NoOutputGeneratedError({ message: 'No output generated. Check the stream for errors.' })
              )
            }
          })
        },
        totalUsage: Promise.resolve({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined }
        }),
        steps: Promise.resolve([]),
        finishReason: Promise.resolve('error'),
        response: Promise.resolve({
          id: 'resp-1',
          modelId: 'provider::model',
          timestamp: new Date(),
          messages: []
        }),
        sources: Promise.resolve([])
      })
    })

    const { runAgentLoop } = await import('../agentLoop')

    const stream = runAgentLoop(
      {
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model'
      },
      [],
      new AbortController().signal
    )

    await expect(stream.getReader().read()).rejects.toBe(apiError)
  })

  it('swallows hooks.onError exceptions so they do not become unhandled rejections', async () => {
    const apiError = new APICallError({
      message: 'Insufficient balance',
      url: 'https://api.example.com/chat/completions',
      requestBodyValues: {},
      statusCode: 402,
      responseHeaders: {},
      responseBody: '',
      isRetryable: false
    })

    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.error(apiError)
            }
          }),
        totalUsage: Promise.resolve({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          inputTokenDetails: {},
          outputTokenDetails: {}
        }),
        steps: Promise.resolve([]),
        finishReason: Promise.resolve('error'),
        response: Promise.resolve({ id: 'r', modelId: 'p::m', timestamp: new Date(), messages: [] }),
        sources: Promise.resolve([])
      })
    })

    const unhandledErrors: unknown[] = []
    const onUnhandled = (err: unknown) => unhandledErrors.push(err)
    process.on('unhandledRejection', onUnhandled)

    try {
      const { runAgentLoop } = await import('../agentLoop')

      const stream = runAgentLoop(
        {
          providerId: 'openai' as never,
          providerSettings: {} as never,
          modelId: 'test-model',
          hooks: {
            onError: () => {
              throw new Error('hook bug — must not escape')
            }
          }
        },
        [],
        new AbortController().signal
      )

      // The stream still aborts with the original error; the hook's throw
      // should be swallowed inside `invokeOnError`.
      await expect(stream.getReader().read()).rejects.toBe(apiError)

      // Give the event loop a tick to surface any unhandled rejections.
      await new Promise((resolve) => setImmediate(resolve))

      expect(unhandledErrors).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
