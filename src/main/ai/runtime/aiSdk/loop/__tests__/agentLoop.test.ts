import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { APICallError, tool } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { markTrustedLocalToolTerminalFailure } from '../localToolTerminalOutcome'
import { createToolCallLimitStopCondition } from '../toolLoopTermination'

const mockCreateAgent = vi.fn()
const TEST_USAGE = {
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
  inputTokenDetails: {},
  outputTokenDetails: {}
}

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args)
}))

describe('Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generate', () => {
    it('routes a trusted terminal tool failure through onError without calling onFinish', async () => {
      const output = markTrustedLocalToolTerminalFailure({
        error: 'terminal failure',
        retryable: false,
        terminal: true,
        userMessage: 'Fix the configuration.',
        i18nKey: 'web_search_provider_unavailable'
      })
      mockCreateAgent.mockResolvedValue({
        generate: vi.fn().mockResolvedValue({
          text: '',
          usage: TEST_USAGE,
          steps: [
            {
              toolResults: [{ type: 'tool-result', toolCallId: 'tool-1', toolName: 'local_lookup', output }]
            }
          ]
        })
      })

      const calls: string[] = []
      const onFinish = vi.fn(() => void calls.push('finish'))
      const onError = vi.fn(() => {
        calls.push('error')
        return 'abort' as const
      })
      const { Agent } = await import('../../Agent')
      const agent = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model',
        hookParts: [{ onFinish, onError }]
      })

      await expect(agent.generate({ prompt: 'hello' })).rejects.toMatchObject({
        name: 'ToolLoopTerminalError',
        message: 'Fix the configuration.',
        i18nKey: 'web_search_provider_unavailable'
      })
      expect(onFinish).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledOnce()
      expect(calls).toEqual(['error'])
    })

    it('routes an actually-triggered cap through onError without calling onFinish', async () => {
      const steps = [
        { toolResults: [] },
        { toolResults: [{ type: 'tool-result', toolCallId: 'tool-2', toolName: 'local_lookup', output: [] }] }
      ]
      const stopWhen = createToolCallLimitStopCondition(2)
      await stopWhen({ steps: steps as never })
      mockCreateAgent.mockResolvedValue({
        generate: vi.fn().mockResolvedValue({ text: '', usage: TEST_USAGE, steps })
      })

      const calls: string[] = []
      const onFinish = vi.fn(() => void calls.push('finish'))
      const onError = vi.fn(() => {
        calls.push('error')
        return 'abort' as const
      })
      const { Agent } = await import('../../Agent')
      const agent = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model',
        options: { stopWhen },
        hookParts: [{ onFinish, onError }]
      })

      await expect(agent.generate({ prompt: 'hello' })).rejects.toMatchObject({
        name: 'ToolLoopTerminalError',
        i18nKey: 'tool_call_limit_reached'
      })
      expect(onFinish).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledOnce()
      expect(calls).toEqual(['error'])
    })

    it('calls only onFinish when generation completes without a terminal outcome', async () => {
      const stopWhen = createToolCallLimitStopCondition(2)
      const steps = [{ toolResults: [] }]
      await expect(stopWhen({ steps: steps as never })).resolves.toBe(false)
      mockCreateAgent.mockResolvedValue({
        generate: vi.fn().mockResolvedValue({ text: 'done', usage: TEST_USAGE, steps })
      })

      const calls: string[] = []
      const onFinish = vi.fn(() => void calls.push('finish'))
      const onError = vi.fn(() => {
        calls.push('error')
        return 'abort' as const
      })
      const { Agent } = await import('../../Agent')
      const agent = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model',
        options: { stopWhen },
        hookParts: [{ onFinish, onError }]
      })

      await expect(agent.generate({ prompt: 'hello' })).resolves.toEqual({ text: 'done', usage: TEST_USAGE })
      expect(onFinish).toHaveBeenCalledOnce()
      expect(onError).not.toHaveBeenCalled()
      expect(calls).toEqual(['finish'])
    })

    it('routes a clean cancellation through onAbort even when generation resolves during the abort', async () => {
      const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' })
      const controller = new AbortController()
      mockCreateAgent.mockResolvedValue({
        generate: vi.fn().mockImplementation(async () => {
          controller.abort(abortError)
          return { text: 'ignored', usage: TEST_USAGE, steps: [] }
        })
      })

      const calls: string[] = []
      const onAbort = vi.fn(() => void calls.push('abort'))
      const onFinish = vi.fn(() => void calls.push('finish'))
      const onError = vi.fn(() => {
        calls.push('error')
        return 'abort' as const
      })
      const { Agent } = await import('../../Agent')
      const agent = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model',
        hookParts: [{ onAbort, onFinish, onError }]
      })

      await expect(agent.generate({ prompt: 'hello' }, controller.signal)).rejects.toBe(abortError)
      expect(onAbort).toHaveBeenCalledOnce()
      expect(onFinish).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(calls).toEqual(['abort'])
    })
  })

  it('pairs a terminal API error with its original after an earlier tool error', async () => {
    const toolError = new Error('Invalid tool input')
    const apiError = new APICallError({
      message: 'Upstream unavailable',
      url: 'https://api.example.com/chat/completions',
      requestBodyValues: {},
      statusCode: 503,
      responseHeaders: {},
      responseBody: '',
      isRetryable: true
    })
    const uiOnError = vi.fn((onError: (error: unknown) => string, error: unknown) => onError(error))
    const cancelUiStream = vi.fn()

    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: (options: { onError: (error: unknown) => string }) => {
          const toolErrorText = uiOnError(options.onError, toolError)
          const apiErrorText = uiOnError(options.onError, apiError)
          return new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: 'tool-input-error',
                toolCallId: 'tool-1',
                toolName: 'search',
                input: {},
                errorText: toolErrorText
              })
              controller.enqueue({ type: 'error', errorText: apiErrorText })
            },
            cancel: cancelUiStream
          })
        }
      })
    })

    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model'
    })
    const reader = agent.stream([], new AbortController().signal).getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'tool-input-error' }, done: false })
    await expect(reader.read()).rejects.toBe(apiError)
    expect(uiOnError).toHaveBeenCalledTimes(2)
    expect(cancelUiStream).toHaveBeenCalledWith(apiError)
  })

  it('preserves an arrived provider error when the signal aborts after the error chunk is queued', async () => {
    const providerError = new APICallError({
      message: 'Upstream unavailable',
      url: 'https://api.example.com/chat/completions',
      requestBodyValues: {},
      statusCode: 503,
      responseHeaders: {},
      responseBody: '',
      isRetryable: true
    })
    const controller = new AbortController()

    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: (options: { onError: (error: unknown) => string }) =>
          new ReadableStream({
            start(streamController) {
              const errorText = options.onError(providerError)
              streamController.enqueue({ type: 'error', errorText })
              controller.abort(new Error('cancelled'))
            }
          })
      })
    })

    const onAbort = vi.fn()
    const onError = vi.fn()
    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      hookParts: [{ onAbort, onError }]
    })

    await expect(agent.stream([], controller.signal).getReader().read()).rejects.toBe(providerError)
    expect(onError).toHaveBeenCalledWith({ error: providerError })
    expect(onAbort).not.toHaveBeenCalled()
  })

  it('turns a terminal tool output into an error instead of forwarding a success finish', async () => {
    const output = markTrustedLocalToolTerminalFailure({
      error: 'Unsafe remote url',
      retryable: false,
      terminal: true,
      userMessage: 'Check the network connection.',
      i18nKey: 'web_lookup_network_error'
    })

    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'tool-output-available', toolCallId: 'tool-1', output })
              controller.enqueue({ type: 'finish', finishReason: 'tool-calls' })
              controller.close()
            }
          }),
        steps: Promise.resolve([
          {
            toolResults: [{ type: 'tool-result', toolCallId: 'tool-1', toolName: 'web_fetch', output }]
          }
        ]),
        finishReason: Promise.resolve('tool-calls')
      })
    })

    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model'
    })
    const reader = agent.stream([], new AbortController().signal).getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'tool-output-available' }, done: false })
    await expect(reader.read()).rejects.toMatchObject({
      name: 'ToolLoopTerminalError',
      message: 'Check the network connection.',
      i18nKey: 'web_lookup_network_error'
    })
  })

  it('turns cap-triggered tool-loop completion into an explicit error', async () => {
    const steps = [
      { toolResults: [] },
      { toolResults: [{ type: 'tool-result', toolCallId: 'tool-2', toolName: 'web_fetch', output: [] }] }
    ]
    const stopWhen = createToolCallLimitStopCondition(2)
    await stopWhen({ steps: steps as never })

    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'finish', finishReason: 'tool-calls' })
              controller.close()
            }
          }),
        steps: Promise.resolve(steps),
        finishReason: Promise.resolve('tool-calls')
      })
    })

    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      options: { stopWhen }
    })

    await expect(agent.stream([], new AbortController().signal).getReader().read()).rejects.toMatchObject({
      name: 'ToolLoopTerminalError',
      i18nKey: 'tool_call_limit_reached'
    })
  })

  it('forwards an approval finish at maxToolCalls=1 when the cap condition was not evaluated', async () => {
    const stopWhen = createToolCallLimitStopCondition(1)
    const steps = [{ toolResults: [] }]

    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'finish', finishReason: 'tool-calls' })
              controller.close()
            }
          }),
        steps: Promise.resolve(steps),
        finishReason: Promise.resolve('tool-calls')
      })
    })

    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      options: { stopWhen }
    })
    const reader = agent.stream([], new AbortController().signal).getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'finish' }, done: false })
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
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
      toolResults: [],
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
      toolResults: [],
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 }
    }
    const fakeStep2 = {
      stepType: 'tool-call',
      content: [],
      toolResults: [],
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
    // contextTokens = last step's totalTokens (anchor for context-build truncation).
    expect(collectedMetadata).toEqual([
      { totalTokens: 8, promptTokens: 3, completionTokens: 5, thoughtsTokens: undefined, contextTokens: 8 },
      { totalTokens: 14, promptTokens: 5, completionTokens: 9, thoughtsTokens: undefined, contextTokens: 6 }
    ])
  })

  it('usage observer sums reasoningTokens (thoughtsTokens) across steps, not just the last', async () => {
    const fakeStep1 = {
      stepType: 'tool-call',
      content: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8, outputTokenDetails: { reasoningTokens: 10 } }
    }
    const fakeStep2 = {
      stepType: 'tool-call',
      content: [],
      toolResults: [],
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
    // contextTokens = last step's totalTokens (anchor for context-build truncation).
    expect(collectedMetadata).toEqual([
      { totalTokens: 8, promptTokens: 3, completionTokens: 5, thoughtsTokens: 10, contextTokens: 8 },
      { totalTokens: 14, promptTokens: 5, completionTokens: 9, thoughtsTokens: 25, contextTokens: 6 }
    ])
  })

  it('uses configured tools when converting replayed tool results', async () => {
    const aiSdkStream = vi.fn().mockResolvedValue({
      toUIMessageStream: () =>
        new ReadableStream({
          start(controller) {
            controller.close()
          }
        })
    })
    mockCreateAgent.mockResolvedValue({ stream: aiSdkStream })

    const imageData = 'A'.repeat(1024)
    const screenshot = tool({
      inputSchema: z.object({}),
      toModelOutput: () => ({ type: 'text', value: '[Image: image/png, delivered to user]' })
    })
    const { Agent } = await import('../../Agent')
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      tools: { screenshot }
    })
    const reader = agent
      .stream(
        [
          {
            id: 'a1',
            role: 'assistant',
            parts: [
              {
                type: 'tool-screenshot',
                toolCallId: 'call-1',
                state: 'output-available',
                input: {},
                output: { content: [{ type: 'image', data: imageData, mimeType: 'image/png' }] }
              }
            ]
          },
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'continue' }] }
        ],
        new AbortController().signal
      )
      .getReader()
    while (!(await reader.read()).done) {
      /* drain to completion */
    }

    const modelMessages = aiSdkStream.mock.calls[0][0].messages
    expect(modelMessages[1].content[0].output).toEqual({
      type: 'text',
      value: '[Image: image/png, delivered to user]'
    })
    expect(JSON.stringify(modelMessages)).not.toContain(imageData)
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

    const onAbort = vi.fn()
    const onError = vi.fn()
    const { Agent } = await import('../../Agent')
    const controller = new AbortController()
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      hookParts: [{ onAbort, onError }]
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
    expect(onAbort).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it('lets abort beat a final finish suspended by downstream backpressure', async () => {
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'finish', finishReason: 'stop' })
              controller.close()
            }
          }),
        steps: Promise.resolve([])
      })
    })

    const controller = new AbortController()
    const onAbort = vi.fn()
    const onError = vi.fn()
    const onFinish = vi.fn()
    const writeSpy = vi.spyOn(WritableStreamDefaultWriter.prototype, 'write')
    try {
      const { Agent } = await import('../../Agent')
      const agent = new Agent({
        providerId: 'openai' as never,
        providerSettings: {} as never,
        modelId: 'test-model',
        hookParts: [{ onAbort, onError, onFinish }]
      })
      const stream = agent.stream([], controller.signal)

      // Do not read yet: the TransformStream's readable high-water mark is
      // zero, so the final finish write remains suspended by backpressure.
      await vi.waitFor(() =>
        expect(writeSpy.mock.calls.some(([chunk]) => (chunk as { type?: string }).type === 'finish')).toBe(true)
      )
      controller.abort(new Error('cancelled'))

      await expect(stream.getReader().read()).resolves.toEqual({ value: undefined, done: true })
      await vi.waitFor(() => expect(onAbort).toHaveBeenCalledOnce())
      expect(onFinish).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    } finally {
      writeSpy.mockRestore()
    }
  })

  it('closes cleanly when abort rejects SDK metadata after the UI stream drains', async () => {
    const abortError = new Error('cancelled')
    let rejectSteps!: (error: unknown) => void
    let metadataAccessed!: () => void
    const didAccessMetadata = new Promise<void>((resolve) => {
      metadataAccessed = resolve
    })
    const steps = new Promise<never>((_resolve, reject) => {
      rejectSteps = reject
    })

    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.close()
            }
          }),
        get steps() {
          metadataAccessed()
          return steps
        }
      })
    })

    const onAbort = vi.fn()
    const onError = vi.fn()
    const { Agent } = await import('../../Agent')
    const controller = new AbortController()
    const agent = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'test-model',
      hookParts: [{ onAbort, onError }]
    })
    const reader = agent.stream([], controller.signal).getReader()
    const read = reader.read()

    await didAccessMetadata
    controller.abort(abortError)
    rejectSteps(abortError)

    await expect(read).resolves.toEqual({ value: undefined, done: true })
    expect(onAbort).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it('preserves a real metadata error when cancellation races with that failure', async () => {
    const providerError = new Error('provider failed')
    let rejectSteps!: (error: unknown) => void
    let metadataAccessed!: () => void
    const didAccessMetadata = new Promise<void>((resolve) => {
      metadataAccessed = resolve
    })
    const steps = new Promise<never>((_resolve, reject) => {
      rejectSteps = reject
    })

    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.close()
            }
          }),
        get steps() {
          metadataAccessed()
          return steps
        }
      })
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
    const read = agent.stream([], controller.signal).getReader().read()

    await didAccessMetadata
    controller.abort(new Error('cancelled'))
    rejectSteps(providerError)

    await expect(read).rejects.toBe(providerError)
    expect(onError).toHaveBeenCalledWith({ error: providerError })
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
  it('aborts rather than closes when the read loop throws undefined', async () => {
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.error(undefined)
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

      await expect(agent.stream([], new AbortController().signal).getReader().read()).rejects.toBeUndefined()
      await new Promise((resolve) => setImmediate(resolve))

      expect(abortSpy).toHaveBeenCalledWith(undefined)
      expect(closeSpy).not.toHaveBeenCalled()
    } finally {
      closeSpy.mockRestore()
      abortSpy.mockRestore()
    }
  })

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
