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
})
