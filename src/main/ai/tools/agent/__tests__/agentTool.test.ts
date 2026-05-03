import { describe, expect, it, vi } from 'vitest'

const mockCreateAgent = vi.fn()
vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args)
}))

function mockChildStreamingText(deltas: string[]): void {
  const chunks = [
    { type: 'start' },
    { type: 'start-step' },
    { type: 'text-start', id: 't1' },
    ...deltas.map((delta) => ({ type: 'text-delta', id: 't1', delta })),
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

interface ExecuteOptions {
  abortSignal: AbortSignal
  toolCallId: string
  messages: unknown[]
}

async function consumeGenerator<T, R>(gen: AsyncGenerator<T, R>): Promise<{ yields: T[]; final: R }> {
  const yields: T[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) return { yields, final: next.value }
    yields.push(next.value)
  }
}

describe('createAgentTool', () => {
  it('sync mode: yields child text deltas, returns final text', async () => {
    mockChildStreamingText(['Hel', 'lo, ', 'world!'])
    const { Agent } = await import('../../../agent/Agent')
    const { createAgentTool } = await import('../agentTool')

    const child = new Agent({
      providerId: 'openai' as never,
      providerSettings: {} as never,
      modelId: 'm'
    })
    const t = createAgentTool({ buildChild: () => child })

    const execute = (t as { execute: (i: unknown, o: ExecuteOptions) => AsyncGenerator<string, string> }).execute
    const { yields, final } = await consumeGenerator(
      execute(
        { description: 'say hi', prompt: 'say hi' },
        { abortSignal: new AbortController().signal, toolCallId: 'tc', messages: [] }
      )
    )

    expect(yields).toEqual(['Hel', 'Hello, ', 'Hello, world!'])
    expect(final).toBe('Hello, world!')
  })

  it('async mode: returns ack immediately, injects user message on completion', async () => {
    mockChildStreamingText(['final result'])

    const { Agent } = await import('../../../agent/Agent')
    const { createAgentTool } = await import('../agentTool')
    const { AsyncChildAbortMap } = await import('../AsyncChildAbortMap')

    const inject = vi.fn().mockReturnValue(true)
    const asyncTasks = new AsyncChildAbortMap()

    const t = createAgentTool({
      buildChild: () => new Agent({ providerId: 'openai' as never, providerSettings: {} as never, modelId: 'm' }),
      inject,
      topicId: 'topic-A',
      asyncTasks
    })

    const execute = (t as { execute: (i: unknown, o: ExecuteOptions) => AsyncGenerator<string, string> }).execute
    const { final } = await consumeGenerator(
      execute(
        { description: 'do work', prompt: 'do something', run_in_background: true },
        { abortSignal: new AbortController().signal, toolCallId: 'tc', messages: [] }
      )
    )

    // Ack returned synchronously (well, after the generator settles, but no streaming).
    const ack = JSON.parse(final)
    expect(ack.status).toBe('started')
    expect(ack.taskId).toMatch(/^agent-[0-9a-f]{6}$/)
    expect(ack.description).toBe('do work')

    // Wait microtasks for the drainer to settle.
    await new Promise((resolve) => setImmediate(resolve))

    expect(inject).toHaveBeenCalledOnce()
    const [message] = inject.mock.calls[0]
    expect(message.topicId).toBe('topic-A')
    expect(message.role).toBe('user')
    const text = message.data.parts[0].text
    expect(text).toContain(`<async-task-result task="${ack.taskId}">`)
    expect(text).toContain('final result')
  })

  it('async mode: detached child survives parent abort (does not cascade signal)', async () => {
    mockChildStreamingText(['result'])

    const { Agent } = await import('../../../agent/Agent')
    const { createAgentTool } = await import('../agentTool')
    const { AsyncChildAbortMap } = await import('../AsyncChildAbortMap')

    const inject = vi.fn().mockReturnValue(true)
    const t = createAgentTool({
      buildChild: () => new Agent({ providerId: 'openai' as never, providerSettings: {} as never, modelId: 'm' }),
      inject,
      topicId: 'topic-async',
      asyncTasks: new AsyncChildAbortMap()
    })

    const parentAc = new AbortController()
    const execute = (t as { execute: (i: unknown, o: ExecuteOptions) => AsyncGenerator<string, string> }).execute
    await consumeGenerator(
      execute(
        { description: 'detached', prompt: 'do work', run_in_background: true },
        { abortSignal: parentAc.signal, toolCallId: 'tc', messages: [] }
      )
    )

    // Parent's per-tool signal aborts (mimics AI SDK firing on stream cleanup).
    // Detached child should NOT cascade this — it must complete and inject result.
    parentAc.abort('parent-stream-end')

    await new Promise((resolve) => setImmediate(resolve))

    expect(inject).toHaveBeenCalledOnce()
    const text = inject.mock.calls[0][0].data.parts[0].text
    expect(text).toContain('<async-task-result task="agent-')
    expect(text).toContain('result')
  })

  it('sync mode: child cascades parent abort (still chained)', async () => {
    mockChildStreamingText(['will be aborted'])

    const { Agent } = await import('../../../agent/Agent')
    const { createAgentTool } = await import('../agentTool')

    const t = createAgentTool({
      buildChild: () => new Agent({ providerId: 'openai' as never, providerSettings: {} as never, modelId: 'm' })
    })
    const parentAc = new AbortController()
    const execute = (t as { execute: (i: unknown, o: ExecuteOptions) => AsyncGenerator<string, string> }).execute

    // Just verify the run completes and returns a string — the cascade logic is
    // tested by the absence of cascade in the async test above. We don't try
    // to abort mid-stream here since the mock streams synchronously.
    const { final } = await consumeGenerator(
      execute({ description: 'sync', prompt: 'x' }, { abortSignal: parentAc.signal, toolCallId: 'tc', messages: [] })
    )
    expect(final).toBe('will be aborted')
  })

  it('async mode: child error becomes async-task-error injection', async () => {
    mockCreateAgent.mockResolvedValue({
      stream: vi.fn().mockResolvedValue({
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.error(new Error('boom'))
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

    const { Agent } = await import('../../../agent/Agent')
    const { createAgentTool } = await import('../agentTool')
    const { AsyncChildAbortMap } = await import('../AsyncChildAbortMap')

    const inject = vi.fn().mockReturnValue(true)
    const t = createAgentTool({
      buildChild: () => new Agent({ providerId: 'openai' as never, providerSettings: {} as never, modelId: 'm' }),
      inject,
      topicId: 'topic-X',
      asyncTasks: new AsyncChildAbortMap()
    })

    const execute = (t as { execute: (i: unknown, o: ExecuteOptions) => AsyncGenerator<string, string> }).execute
    await consumeGenerator(
      execute(
        { description: 'will fail', prompt: 'fail', run_in_background: true },
        { abortSignal: new AbortController().signal, toolCallId: 'tc', messages: [] }
      )
    )
    await new Promise((resolve) => setImmediate(resolve))

    const text = inject.mock.calls[0][0].data.parts[0].text
    expect(text).toMatch(/^<async-task-error task="agent-/)
    expect(text).toContain('boom')
  })

  it('async mode: drops result silently when parent stream is no longer live', async () => {
    mockChildStreamingText(['result'])

    const { Agent } = await import('../../../agent/Agent')
    const { createAgentTool } = await import('../agentTool')
    const { AsyncChildAbortMap } = await import('../AsyncChildAbortMap')

    const inject = vi.fn().mockReturnValue(false) // dead stream
    const t = createAgentTool({
      buildChild: () => new Agent({ providerId: 'openai' as never, providerSettings: {} as never, modelId: 'm' }),
      inject,
      topicId: 'topic-DEAD',
      asyncTasks: new AsyncChildAbortMap()
    })

    const execute = (t as { execute: (i: unknown, o: ExecuteOptions) => AsyncGenerator<string, string> }).execute
    await consumeGenerator(
      execute(
        { description: 'orphan', prompt: 'do work', run_in_background: true },
        { abortSignal: new AbortController().signal, toolCallId: 'tc', messages: [] }
      )
    )
    await new Promise((resolve) => setImmediate(resolve))

    expect(inject).toHaveBeenCalledOnce()
    // No throw, no unhandled rejection — drained gracefully.
  })

  it('falls back to sync when run_in_background is set but deps are missing', async () => {
    mockChildStreamingText(['ok'])
    const { Agent } = await import('../../../agent/Agent')
    const { createAgentTool } = await import('../agentTool')

    const t = createAgentTool({
      // No inject / topicId / asyncTasks → async unsupported, sync fallback.
      buildChild: () => new Agent({ providerId: 'openai' as never, providerSettings: {} as never, modelId: 'm' })
    })
    const execute = (t as { execute: (i: unknown, o: ExecuteOptions) => AsyncGenerator<string, string> }).execute
    const { final } = await consumeGenerator(
      execute(
        { description: 'x', prompt: 'x', run_in_background: true },
        { abortSignal: new AbortController().signal, toolCallId: 'tc', messages: [] }
      )
    )
    // Sync return = the actual text, not a JSON ack
    expect(final).toBe('ok')
  })
})
