import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateAgent = vi.fn()

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args)
}))

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
