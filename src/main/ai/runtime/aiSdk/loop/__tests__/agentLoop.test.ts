import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateAgent = vi.fn()

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args)
}))

describe('Agent', () => {
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
      const { Agent } = await import('../../Agent')

      const agent = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model',
        hookParts: [
          {
            onError: () => {
              throw new Error('hook bug — must not escape')
            }
          }
        ]
      })
      const stream = agent.stream([], new AbortController().signal)

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

  it('runs internal observers before the caller-supplied onStepFinish', async () => {
    const order: string[] = []
    const fakeStep = {
      stepType: 'tool-call',
      content: [],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    }

    mockCreateAgent.mockImplementation(
      async ({ agentSettings }: { agentSettings: { onStepFinish?: (s: unknown) => void } }) => ({
        stream: vi.fn().mockImplementation(() => {
          // AI SDK calls onStepFinish from inside its internal step loop —
          // simulate one fire here, before resolving the stream's metadata.
          agentSettings.onStepFinish?.(fakeStep)
          return Promise.resolve({
            toUIMessageStream: () =>
              new ReadableStream({
                start(controller) {
                  controller.close()
                }
              }),
            totalUsage: Promise.resolve({
              inputTokens: 1,
              outputTokens: 2,
              totalTokens: 3,
              inputTokenDetails: {},
              outputTokenDetails: {}
            }),
            steps: Promise.resolve([fakeStep]),
            finishReason: Promise.resolve('stop'),
            response: Promise.resolve({ id: 'r', modelId: 'p::m', timestamp: new Date(), messages: [] }),
            sources: Promise.resolve([])
          })
        })
      })
    )

    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      hookParts: [
        {
          onStepFinish: () => {
            order.push('caller')
          }
        }
      ]
    })

    // Internal observer registered after construction (the usage observer is
    // already attached internally — adding another one here lets us assert
    // that *all* observers run before the caller's hook).
    agent.on('onStepFinish', () => {
      order.push('observer')
    })

    const stream = agent.stream([], new AbortController().signal)
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    expect(order).toEqual(['observer', 'caller'])
  })

  it('usage observer emits a message-metadata chunk for each step.usage', async () => {
    const fakeStep1 = {
      stepType: 'tool-call',
      content: [],
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 }
    }
    const fakeStep2 = {
      stepType: 'tool-call',
      content: [],
      finishReason: 'stop',
      usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 }
    }

    mockCreateAgent.mockImplementation(
      async ({ agentSettings }: { agentSettings: { onStepFinish?: (s: unknown) => void | Promise<void> } }) => ({
        stream: vi.fn().mockImplementation(async () => {
          // AI SDK fires onStepFinish for each step from inside the stream.
          await agentSettings.onStepFinish?.(fakeStep1)
          await agentSettings.onStepFinish?.(fakeStep2)
          return {
            toUIMessageStream: () =>
              new ReadableStream({
                start(controller) {
                  controller.close()
                }
              }),
            totalUsage: Promise.resolve({
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              inputTokenDetails: {},
              outputTokenDetails: {}
            }),
            steps: Promise.resolve([fakeStep1, fakeStep2]),
            finishReason: Promise.resolve('stop'),
            response: Promise.resolve({ id: 'r', modelId: 'p::m', timestamp: new Date(), messages: [] }),
            sources: Promise.resolve([])
          }
        })
      })
    )

    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model'
    })

    const stream = agent.stream([], new AbortController().signal)
    const reader = stream.getReader()
    const collectedMetadata: Array<Record<string, unknown>> = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === 'message-metadata') {
        collectedMetadata.push(value.messageMetadata as Record<string, unknown>)
      }
    }

    // Expect TWO metadata chunks (one per onStepFinish), with running cumulative sums.
    expect(collectedMetadata).toEqual([
      { totalTokens: 8, promptTokens: 3, completionTokens: 5, thoughtsTokens: undefined },
      { totalTokens: 14, promptTokens: 5, completionTokens: 9, thoughtsTokens: undefined }
    ])
  })
})
