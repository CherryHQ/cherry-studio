import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult
} from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { createContextMiddleware } from '../middleware'
import type { ContextMessage } from '../types'

function createMockModel(options?: {
  inputTokens?: number | undefined
  outputText?: string
  omitUsageTotal?: boolean
}): LanguageModelV3 {
  const inputTokens = options?.omitUsageTotal ? undefined : (options?.inputTokens ?? 100)
  const outputText = options?.outputText ?? 'Hello'

  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},

    async doGenerate(): Promise<LanguageModelV3GenerateResult> {
      const content: LanguageModelV3Content[] = [{ type: 'text', text: outputText }]
      const finishReason: LanguageModelV3FinishReason = { unified: 'stop', raw: undefined }
      return {
        content,
        finishReason,
        warnings: [],
        usage: {
          inputTokens: {
            total: inputTokens,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined
          },
          outputTokens: { total: 10, text: undefined, reasoning: undefined }
        },
        response: {
          id: 'test-id',
          timestamp: new Date(),
          modelId: 'test-model'
        }
      }
    },

    async doStream() {
      const parts: LanguageModelV3StreamPart[] = [
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: outputText },
        { type: 'text-end', id: '1' },
        {
          type: 'finish',
          usage: {
            inputTokens: {
              total: inputTokens,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined
            },
            outputTokens: { total: 10, text: undefined, reasoning: undefined }
          },
          finishReason: { unified: 'stop', raw: undefined }
        }
      ]

      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          for (const part of parts) {
            controller.enqueue(part)
          }
          controller.close()
        }
      })

      return { stream }
    }
  }
  return model
}

function makeConversation(messageCount: number): LanguageModelV3Prompt {
  const prompt: LanguageModelV3Prompt = [{ role: 'system', content: 'You are helpful.' }]
  for (let i = 0; i < messageCount; i++) {
    prompt.push({
      role: 'user',
      content: [{ type: 'text', text: `Message ${i}: ${'x'.repeat(100)}` }]
    })
    prompt.push({
      role: 'assistant',
      content: [{ type: 'text', text: `Response ${i}: ${'y'.repeat(100)}` }]
    })
  }
  return prompt
}

/** Assert middleware method exists and return it (avoids `possibly undefined` errors) */
function assertDefined<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is undefined`)
  return value
}

async function readAllChunks(streamResult: LanguageModelV3StreamResult): Promise<LanguageModelV3StreamPart[]> {
  const reader = streamResult.stream.getReader()
  const chunks: LanguageModelV3StreamPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

describe('createContextMiddleware', () => {
  it('passes through when no truncation or compression needed', async () => {
    const middleware = createContextMiddleware({
      contextWindow: 1_000_000
    })

    const prompt: LanguageModelV3Prompt = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]

    const params: LanguageModelV3CallOptions = { prompt }
    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({
      params,
      type: 'generate',
      model: createMockModel()
    })

    expect(result.prompt).toEqual(prompt)
  })

  it('truncates large tool results', async () => {
    const middleware = createContextMiddleware({
      contextWindow: 1_000_000,
      truncate: { threshold: 50, headChars: 10, tailChars: 10 }
    })

    const longOutput = 'x'.repeat(200)
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'Run command' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'run_cmd',
            input: { cmd: 'ls' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'run_cmd',
            output: { type: 'text', value: longOutput }
          }
        ]
      }
    ]

    const params: LanguageModelV3CallOptions = { prompt }
    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({
      params,
      type: 'generate',
      model: createMockModel()
    })

    const toolMsg = result.prompt.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    if (toolMsg?.role === 'tool') {
      const part = toolMsg.content[0]
      if (part.type === 'tool-result' && part.output.type === 'text') {
        expect(part.output.value.length).toBeLessThan(longOutput.length)
        expect(part.output.value).toContain('truncated')
      }
    }
  })

  it('wrapGenerate feeds token usage to janitor', async () => {
    const middleware = createContextMiddleware({
      contextWindow: 500,
      // Budgeting option — without one no Janitor is constructed (budgeting opt-in).
      onBeforeCompress: () => undefined
    })

    const model = createMockModel({ inputTokens: 200 })

    const doGenerate = (): PromiseLike<LanguageModelV3GenerateResult> => model.doGenerate({ prompt: [] })
    const doStream = (): PromiseLike<LanguageModelV3StreamResult> => model.doStream({ prompt: [] })

    const result = await assertDefined(
      middleware.wrapGenerate,
      'wrapGenerate'
    )({
      doGenerate,
      doStream,
      params: { prompt: [] },
      model
    })

    expect(result.usage.inputTokens.total).toBe(200)
  })

  it('wrapStream captures usage from finish chunk', async () => {
    const middleware = createContextMiddleware({
      contextWindow: 500,
      // Budgeting option — without one no Janitor is constructed (budgeting opt-in).
      onBeforeCompress: () => undefined
    })

    const model = createMockModel({ inputTokens: 300 })

    const doGenerate = (): PromiseLike<LanguageModelV3GenerateResult> => model.doGenerate({ prompt: [] })
    const doStream = (): PromiseLike<LanguageModelV3StreamResult> => model.doStream({ prompt: [] })

    const streamResult = await assertDefined(
      middleware.wrapStream,
      'wrapStream'
    )({
      doGenerate,
      doStream,
      params: { prompt: [] },
      model
    })

    const chunks = await readAllChunks(streamResult)
    const finishChunk = chunks.find((c) => c.type === 'finish')
    expect(finishChunk).toBeDefined()
    if (finishChunk?.type === 'finish') {
      expect(finishChunk.usage.inputTokens.total).toBe(300)
    }
  })
})

describe('IR reassembly', () => {
  it('reassembles system messages first, then the conversation', async () => {
    const middleware = createContextMiddleware({})

    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'system', content: 'Late standing instructions.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] }
    ]

    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({ params: { prompt }, type: 'generate', model: createMockModel() })

    expect(result.prompt.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
    expect(result.prompt[0]).toEqual({ role: 'system', content: 'Late standing instructions.' })
    // Conversation content round-trips verbatim through the IR
    expect(result.prompt[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Hi' }] })
    expect(result.prompt[2]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] })
  })

  it('round-trips a tool conversation verbatim through the IR', async () => {
    const middleware = createContextMiddleware({})

    const prompt: LanguageModelV3Prompt = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: [{ type: 'text', text: 'Run it' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'run_cmd', input: { cmd: 'ls' } }]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'run_cmd',
            output: { type: 'text', value: 'file1.txt' }
          }
        ]
      }
    ]

    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({ params: { prompt }, type: 'generate', model: createMockModel() })

    expect(result.prompt).toEqual(prompt)
  })
})

describe('budgeting gate (no budgeting configured)', () => {
  it('allows omitting contextWindow and emits no Janitor warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const middleware = createContextMiddleware({
        truncate: { threshold: 50, tailChars: 10 }
      })

      const prompt: LanguageModelV3Prompt = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]
      const result = await assertDefined(
        middleware.transformParams,
        'transformParams'
      )({
        params: { prompt },
        type: 'generate',
        model: createMockModel()
      })

      expect(result.prompt).toEqual(prompt)
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('wrapGenerate and wrapStream pass through untouched without a Janitor', async () => {
    const middleware = createContextMiddleware({})
    const model = createMockModel({ inputTokens: 42 })

    const doGenerate = (): PromiseLike<LanguageModelV3GenerateResult> => model.doGenerate({ prompt: [] })
    const doStream = (): PromiseLike<LanguageModelV3StreamResult> => model.doStream({ prompt: [] })

    const result = await assertDefined(
      middleware.wrapGenerate,
      'wrapGenerate'
    )({
      doGenerate,
      doStream,
      params: { prompt: [] },
      model
    })
    expect(result.usage.inputTokens.total).toBe(42)

    const streamResult = await assertDefined(
      middleware.wrapStream,
      'wrapStream'
    )({
      doGenerate,
      doStream,
      params: { prompt: [] },
      model
    })
    expect(streamResult.stream).toBeDefined()
  })

  it('throws when onBeforeCompress is configured without contextWindow', () => {
    expect(() => createContextMiddleware({ onBeforeCompress: () => undefined })).toThrow(/contextWindow/)
  })

  it('does not compress an over-budget prompt when onBeforeCompress is not configured', async () => {
    // No budgeting option → no Janitor → transformParams never drops history,
    // even after the model reports usage far beyond contextWindow.
    const middleware = createContextMiddleware({ contextWindow: 100 })
    const model = createMockModel({ inputTokens: 200 })

    await assertDefined(
      middleware.wrapGenerate,
      'wrapGenerate'
    )({
      doGenerate: () => model.doGenerate({ prompt: [] }),
      doStream: () => model.doStream({ prompt: [] }),
      params: { prompt: [] },
      model
    })

    const longPrompt = makeConversation(10)
    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({ params: { prompt: longPrompt }, type: 'generate', model })

    expect(result.prompt).toEqual(longPrompt)
  })
})

describe('onBeforeCompress flow', () => {
  it('calls the hook with token info and drops mechanically when it returns null', async () => {
    const onBeforeCompress = vi.fn().mockReturnValue(null)
    const middleware = createContextMiddleware({
      contextWindow: 100,
      onBeforeCompress
    })

    const model = createMockModel({ inputTokens: 200 })

    // Feed high token usage to trigger the budget check
    await assertDefined(
      middleware.wrapGenerate,
      'wrapGenerate'
    )({
      doGenerate: () => model.doGenerate({ prompt: [] }),
      doStream: () => model.doStream({ prompt: [] }),
      params: { prompt: [] },
      model
    })

    const longPrompt = makeConversation(10)
    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({
      params: { prompt: longPrompt },
      type: 'generate',
      model
    })

    expect(onBeforeCompress).toHaveBeenCalledTimes(1)
    const [history, tokenInfo] = onBeforeCompress.mock.calls[0]
    expect(Array.isArray(history)).toBe(true)
    expect(history.length).toBe(longPrompt.length - 1) // conversation only, system excluded
    expect(tokenInfo).toEqual({ currentTokens: 200, limit: 100 })

    // Mechanical drop keeps the last turn only: [system, last assistant message]
    expect(result.prompt.length).toBeLessThan(longPrompt.length)
    expect(result.prompt.map((m) => m.role)).toEqual(['system', 'assistant'])
    expect(result.prompt[1]).toEqual(longPrompt[longPrompt.length - 1])
  })

  it('replaces the history when the hook returns modified messages', async () => {
    const onBeforeCompress = vi.fn((): ContextMessage[] => [{ role: 'user', content: 'condensed history' }])
    const middleware = createContextMiddleware({
      contextWindow: 100,
      onBeforeCompress
    })

    const model = createMockModel({ inputTokens: 200 })

    await assertDefined(
      middleware.wrapGenerate,
      'wrapGenerate'
    )({
      doGenerate: () => model.doGenerate({ prompt: [] }),
      doStream: () => model.doStream({ prompt: [] }),
      params: { prompt: [] },
      model
    })

    const longPrompt = makeConversation(10)
    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({
      params: { prompt: longPrompt },
      type: 'generate',
      model
    })

    expect(onBeforeCompress).toHaveBeenCalledTimes(1)
    // Hook result is re-evaluated (now under budget) and replaces the history.
    expect(result.prompt).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: [{ type: 'text', text: 'condensed history' }] }
    ])
  })

  it('does not fire the hook when usage stays under budget', async () => {
    const onBeforeCompress = vi.fn().mockReturnValue(null)
    const middleware = createContextMiddleware({
      contextWindow: 1_000_000,
      onBeforeCompress
    })

    const model = createMockModel({ inputTokens: 200 })

    await assertDefined(
      middleware.wrapGenerate,
      'wrapGenerate'
    )({
      doGenerate: () => model.doGenerate({ prompt: [] }),
      doStream: () => model.doStream({ prompt: [] }),
      params: { prompt: [] },
      model
    })

    const longPrompt = makeConversation(10)
    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({
      params: { prompt: longPrompt },
      type: 'generate',
      model
    })

    expect(onBeforeCompress).not.toHaveBeenCalled()
    expect(result.prompt).toEqual(longPrompt)
  })
})

describe('compact', () => {
  it('prunes tool-call and tool-result messages', async () => {
    const middleware = createContextMiddleware({
      contextWindow: 1_000_000,
      compact: { toolCalls: 'all' }
    })

    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'Run command' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'run_cmd',
            input: { cmd: 'ls' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'run_cmd',
            output: { type: 'text', value: 'very long tool output here' }
          }
        ]
      },
      { role: 'user', content: [{ type: 'text', text: 'Thanks' }] }
    ]

    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({
      params: { prompt },
      type: 'generate',
      model: createMockModel()
    })

    // tool message should be removed entirely
    const toolMsg = result.prompt.find((m) => m.role === 'tool')
    expect(toolMsg).toBeUndefined()

    // assistant tool-call message should also be removed (empty after pruning)
    const assistantMsgs = result.prompt.filter((m) => m.role === 'assistant')
    for (const msg of assistantMsgs) {
      if (msg.role === 'assistant') {
        const hasToolCall = msg.content.some((p) => p.type === 'tool-call')
        expect(hasToolCall).toBe(false)
      }
    }
  })

  it('prunes reasoning content', async () => {
    const middleware = createContextMiddleware({
      contextWindow: 1_000_000,
      compact: { reasoning: 'all' }
    })

    const prompt: LanguageModelV3Prompt = [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I need to think about this...' },
          { type: 'text', text: 'Here is my answer.' }
        ]
      }
    ]

    const result = await assertDefined(
      middleware.transformParams,
      'transformParams'
    )({
      params: { prompt },
      type: 'generate',
      model: createMockModel()
    })

    const assistantMsg = result.prompt.find((m) => m.role === 'assistant')
    expect(assistantMsg).toBeDefined()
    if (assistantMsg?.role === 'assistant') {
      const hasReasoning = assistantMsg.content.some((p) => p.type === 'reasoning')
      expect(hasReasoning).toBe(false)
    }
  })
})

describe('usage-missing warning', () => {
  it('wrapGenerate warns once with the [context] prefix when usage.inputTokens.total is missing', async () => {
    const logger = { warn: vi.fn() }
    const middleware = createContextMiddleware({
      contextWindow: 500,
      onBeforeCompress: () => undefined,
      logger
    })

    const model = createMockModel({ omitUsageTotal: true })
    const call = () =>
      assertDefined(
        middleware.wrapGenerate,
        'wrapGenerate'
      )({
        doGenerate: () => model.doGenerate({ prompt: [] }),
        doStream: () => model.doStream({ prompt: [] }),
        params: { prompt: [] },
        model
      })

    await call()
    await call() // warned once only

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const message = logger.warn.mock.calls[0][0] as string
    expect(message).toContain('[context]')
    expect(message).toContain('usage.inputTokens.total')
    expect(message).not.toMatch(/tokenizer/i)
  })

  it('wrapStream warns once with the [context] prefix when the finish chunk lacks usage totals', async () => {
    const logger = { warn: vi.fn() }
    const middleware = createContextMiddleware({
      contextWindow: 500,
      onBeforeCompress: () => undefined,
      logger
    })

    const model = createMockModel({ omitUsageTotal: true })
    const streamResult = await assertDefined(
      middleware.wrapStream,
      'wrapStream'
    )({
      doGenerate: () => model.doGenerate({ prompt: [] }),
      doStream: () => model.doStream({ prompt: [] }),
      params: { prompt: [] },
      model
    })
    await readAllChunks(streamResult)

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const message = logger.warn.mock.calls[0][0] as string
    expect(message).toContain('[context]')
    expect(message).toContain('usage.inputTokens.total')
    expect(message).not.toMatch(/tokenizer/i)
  })

  it('does not warn when usage is present', async () => {
    const logger = { warn: vi.fn() }
    const middleware = createContextMiddleware({
      contextWindow: 500,
      onBeforeCompress: () => undefined,
      logger
    })

    const model = createMockModel({ inputTokens: 200 })
    await assertDefined(
      middleware.wrapGenerate,
      'wrapGenerate'
    )({
      doGenerate: () => model.doGenerate({ prompt: [] }),
      doStream: () => model.doStream({ prompt: [] }),
      params: { prompt: [] },
      model
    })

    expect(logger.warn).not.toHaveBeenCalled()
  })
})
