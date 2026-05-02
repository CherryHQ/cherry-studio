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

  it('drains pendingMessages mid-flight via prepareStep (steering observer)', async () => {
    const { PendingMessageQueue } = await import('../PendingMessageQueue')
    const queue = new PendingMessageQueue()
    const seenByPrepareStep: Array<{ count: number }> = []

    mockCreateAgent.mockImplementation(
      async ({
        agentSettings
      }: {
        agentSettings: {
          prepareStep?: (opts: { messages: unknown[] }) => Promise<{ messages?: unknown[] } | undefined>
        }
      }) => ({
        stream: vi.fn().mockImplementation(async () => {
          // Inject something just before AI SDK calls prepareStep.
          queue.push({ id: 'inj1', role: 'user', data: { parts: [{ type: 'text', text: 'wait' }] } } as never)
          // Simulate AI SDK calling prepareStep. The steering observer
          // should drain `inj1` and append it to the messages array.
          const result = await agentSettings.prepareStep?.({ messages: [{ role: 'user', content: 'hi' }] })
          seenByPrepareStep.push({ count: result?.messages?.length ?? 0 })

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
            steps: Promise.resolve([]),
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
      modelId: 'test-model',
      pendingMessages: queue
    })

    const stream = agent.stream([], new AbortController().signal)
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    // prepareStep observer drained `inj1` and appended it: 1 original + 1 injected = 2.
    expect(seenByPrepareStep).toEqual([{ count: 2 }])
  })

  it('tail-rechecks pendingMessages — restarts agent.stream when injection lands after final prepareStep', async () => {
    const { PendingMessageQueue } = await import('../PendingMessageQueue')
    const queue = new PendingMessageQueue()
    let streamCalls = 0

    mockCreateAgent.mockImplementation(async () => ({
      stream: vi.fn().mockImplementation(async () => {
        streamCalls++
        // First call: inject AFTER the (mocked) inner step, simulating the
        // race where the user's message lands after AI SDK's last
        // prepareStep but before the stream resolves.
        if (streamCalls === 1) {
          queue.push({ id: 'tail1', role: 'user', data: { parts: [{ type: 'text', text: 'p.s.' }] } } as never)
        }

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
          steps: Promise.resolve([]),
          finishReason: Promise.resolve('stop'),
          response: Promise.resolve({ id: `r${streamCalls}`, modelId: 'p::m', timestamp: new Date(), messages: [] }),
          sources: Promise.resolve([])
        }
      })
    }))

    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      pendingMessages: queue
    })

    const stream = agent.stream([], new AbortController().signal)
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    // Two streams: initial + tail recheck after `tail1` was drained.
    expect(streamCalls).toBe(2)
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

  describe('toTool', () => {
    /**
     * Builds a mock AI SDK agent whose `stream()` emits a sequence of
     * text-delta UIMessageChunks (`text-start` → deltas → `text-end` →
     * `finish`). Returned via `mockCreateAgent.mockResolvedValue` so
     * the child Agent's `stream()` works during a test.
     */
    function mockChildStream(textDeltas: string[]) {
      const chunks: Array<Record<string, unknown>> = [
        { type: 'start' },
        { type: 'start-step' },
        { type: 'text-start', id: 't1' },
        ...textDeltas.map((delta) => ({ type: 'text-delta', id: 't1', delta })),
        { type: 'text-end', id: 't1' },
        { type: 'finish-step' },
        { type: 'finish' }
      ]
      mockCreateAgent.mockResolvedValue({
        stream: vi.fn().mockResolvedValue({
          toUIMessageStream: () =>
            new ReadableStream({
              start(controller) {
                for (const c of chunks) controller.enqueue(c)
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
          steps: Promise.resolve([]),
          finishReason: Promise.resolve('stop'),
          response: Promise.resolve({ id: 'r', modelId: 'p::m', timestamp: new Date(), messages: [] }),
          sources: Promise.resolve([])
        })
      })
    }

    it('streams child text deltas as preliminary tool results, final yield is the full text', async () => {
      mockChildStream(['Hel', 'lo, ', 'world!'])

      const { Agent } = await import('../../Agent')
      const child = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model'
      })

      const childTool = child.toTool<{ topic: string }>({
        description: 'Research a topic',
        inputSchema: { type: 'object', properties: { topic: { type: 'string' } } } as never,
        toPrompt: ({ topic }) => `Research: ${topic}`
      })

      const execute = (childTool as { execute: (input: unknown, opts: unknown) => AsyncGenerator<string> }).execute
      const iter = execute(
        { topic: 'cats' },
        { abortSignal: new AbortController().signal, toolCallId: 'tc-1', messages: [] }
      )

      const yields: string[] = []
      let returnValue: string | undefined
      while (true) {
        const { value, done } = await iter.next()
        if (done) {
          returnValue = value as string | undefined
          break
        }
        yields.push(value)
      }

      // Cumulative deltas — each yield is the assembled text up to that point.
      expect(yields).toEqual(['Hel', 'Hello, ', 'Hello, world!'])
      expect(returnValue).toBe('Hello, world!')
    })

    it('falls back to JSON.stringify when toPrompt is not provided', async () => {
      mockChildStream(['ok'])

      const { Agent } = await import('../../Agent')
      const child = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model'
      })

      const childTool = child.toTool({
        description: 'X',
        inputSchema: { type: 'object' } as never
      })

      const execute = (childTool as { execute: (input: unknown, opts: unknown) => AsyncGenerator<string> }).execute
      const iter = execute({ a: 1 }, { abortSignal: new AbortController().signal, toolCallId: 'tc-1', messages: [] })
      while (true) {
        const { done } = await iter.next()
        if (done) break
      }

      // Verify the prompt landed via `userMessage.parts[0].text`.
      const aiAgent = await mockCreateAgent.mock.results[0].value
      const streamCall = aiAgent.stream.mock.calls[0][0]
      const userTextPart = (streamCall.messages[0].content as Array<{ type: string; text: string }>).find(
        (p) => p.type === 'text'
      )
      expect(userTextPart?.text).toBe('{"a":1}')
    })
  })
})
