import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
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

  it('usage observer sums reasoningTokens (thoughtsTokens) across steps, not just the last', async () => {
    const fakeStep1 = {
      stepType: 'tool-call',
      content: [],
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8, outputTokenDetails: { reasoningTokens: 10 } }
    }
    const fakeStep2 = {
      stepType: 'tool-call',
      content: [],
      finishReason: 'stop',
      usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6, outputTokenDetails: { reasoningTokens: 15 } }
    }

    mockCreateAgent.mockImplementation(
      async ({ agentSettings }: { agentSettings: { onStepFinish?: (s: unknown) => void | Promise<void> } }) => ({
        stream: vi.fn().mockImplementation(async () => {
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

    // reasoningTokens (thoughtsTokens) must accumulate alongside the summed completion tokens.
    expect(collectedMetadata).toEqual([
      { totalTokens: 8, promptTokens: 3, completionTokens: 5, thoughtsTokens: 10 },
      { totalTokens: 14, promptTokens: 5, completionTokens: 9, thoughtsTokens: 25 }
    ])
  })

  // ── Abort mid-stream: remaining chunks are dropped and the writer closes cleanly ──
  it('stops forwarding and closes (not errors) when the signal aborts mid-stream', async () => {
    let srcController!: ReadableStreamDefaultController<unknown>
    const source = new ReadableStream({
      start(c) {
        srcController = c
      }
    })
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({ toUIMessageStream: () => source })
    })

    const onError = vi.fn()
    const { Agent } = await import('../../Agent')
    const controller = new AbortController()
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      hookParts: [{ onError }]
    })
    const reader = agent.stream([], controller.signal).getReader()

    // First chunk forwards normally.
    const chunk1 = { type: 'text-delta', id: 't1', delta: 'hello' }
    srcController.enqueue(chunk1)
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(first.value).toEqual(chunk1)

    // Abort, then push another chunk: the loop must drop it and close the stream.
    controller.abort()
    srcController.enqueue({ type: 'text-delta', id: 't1', delta: 'dropped' })

    const next = await reader.read()
    expect(next.done).toBe(true)
    // Abort is not an error: onError must not fire on the abort path.
    expect(onError).not.toHaveBeenCalled()
  })

  // ── writerSettled guard: the terminal signal is emitted exactly once per outcome ──
  it('settles the writer exactly once (close, never abort) on a clean drain', async () => {
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(c) {
              c.close()
            }
          })
      })
    })

    const closeSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'close')
    const abortSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'abort')
    try {
      const { Agent } = await import('../../Agent')
      const agent = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model'
      })
      const reader = agent.stream([], new AbortController().signal).getReader()
      while (!(await reader.read()).done) {
        /* drain to completion */
      }

      expect(closeSpy).toHaveBeenCalledTimes(1)
      expect(abortSpy).not.toHaveBeenCalled()
    } finally {
      closeSpy.mockRestore()
      abortSpy.mockRestore()
    }
  })

  it('settles the writer exactly once (abort, never close) when the read loop errors', async () => {
    const err = new Error('stream blew up')
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(c) {
              c.error(err)
            }
          })
      })
    })

    const onError = vi.fn()
    const closeSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'close')
    const abortSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'abort')
    try {
      const { Agent } = await import('../../Agent')
      const agent = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model',
        hookParts: [{ onError }]
      })
      const reader = agent.stream([], new AbortController().signal).getReader()

      await expect(reader.read()).rejects.toBe(err)
      // Let the IIFE's catch (invokeOnError + settleWriter) run.
      await new Promise((resolve) => setImmediate(resolve))

      expect(onError).toHaveBeenCalledTimes(1)
      expect(abortSpy).toHaveBeenCalledTimes(1)
      expect(closeSpy).not.toHaveBeenCalled()
    } finally {
      closeSpy.mockRestore()
      abortSpy.mockRestore()
    }
  })

  // ── onError returning 'retry' is not implemented: warn (not error) then abort the writer ──
  it('logs a WARN (not error) and aborts when the composed onError returns "retry" (REGRESSION agent-loop-2)', async () => {
    const err = new Error('stream blew up')
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(c) {
              c.error(err)
            }
          })
      })
    })

    const onError = vi.fn().mockReturnValue('retry')
    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      hookParts: [{ onError }]
    })
    const reader = agent.stream([], new AbortController().signal).getReader()

    await expect(reader.read()).rejects.toBe(err)
    // Let the IIFE's catch (invokeOnError → 'retry' branch + settleWriter) run.
    await new Promise((resolve) => setImmediate(resolve))

    expect(onError).toHaveBeenCalledTimes(1)
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'agentLoop onError returned retry; retry not implemented — aborting',
      err
    )
    // The retry branch must not also log an error for the same outcome.
    expect(mockMainLoggerService.error).not.toHaveBeenCalledWith('agentLoop error', err)
  })
})
