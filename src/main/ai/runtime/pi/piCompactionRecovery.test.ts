import {
  type AssistantMessage,
  contentText,
  type Model,
  normalizeContext,
  type RetryCallbacks,
  type RetryPolicy,
  type TranscriptContext
} from '@earendil-works/pi-ai'
import type * as PiSdk from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import { resolvePiCompactionSettings } from './piCompactionSettings'

// Exercise the patched SDK module without loading the unrelated CLI and native tools.
const sdkEntry = import.meta.resolve('@earendil-works/pi-coding-agent')
const compactionModule = await import(new URL('./core/compaction/compaction.js', sdkEntry).href)
const { generateBranchSummary }: Pick<typeof PiSdk, 'generateBranchSummary'> = await import(
  new URL('./core/compaction/branch-summarization.js', sdkEntry).href
)
const { compact, generateSummary, shouldCompact }: Pick<typeof PiSdk, 'compact' | 'generateSummary' | 'shouldCompact'> =
  compactionModule
const completeSummarization = compactionModule.completeSummarization as (
  model: Model<'openai-completions'>,
  context: TranscriptContext,
  options: { maxTokens: number; sessionId?: string },
  streamFn: NonNullable<Parameters<typeof generateSummary>[9]>,
  retry?: RetryPolicy,
  callbacks?: RetryCallbacks
) => Promise<AssistantMessage>

const model: Model<'openai-completions'> = {
  id: 'synthetic-qwen',
  name: 'Synthetic Qwen',
  api: 'openai-completions',
  provider: 'synthetic-provider',
  baseUrl: 'https://example.invalid/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 49_152,
  maxTokens: 8_192
}

function response(stopReason: 'error' | 'stop' | 'length', errorMessage?: string): AssistantMessage {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [{ type: 'text', text: 'Synthetic summary' }],
    stopReason,
    errorMessage,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    timestamp: Date.now()
  }
}

function summaryPrompt(context: TranscriptContext): string {
  const message = context.messages.find((entry) => entry.role === 'user')
  if (!message) throw new Error('Missing synthetic summary request')
  return contentText(message.content)
}

describe('Pi compaction across model context sizes', () => {
  it('starts compaction while there is room for the next request and retains a smaller tail', () => {
    const settings = resolvePiCompactionSettings(model)

    expect(shouldCompact(24_000, model.contextWindow, settings)).toBe(false)
    expect(shouldCompact(26_000, model.contextWindow, settings)).toBe(true)
    expect(settings.keepRecentTokens).toBeLessThan(10_000)
  })

  it('keeps the stock tail on large-context models while reserving their declared output', () => {
    expect(resolvePiCompactionSettings({ contextWindow: 200_000, maxTokens: 8_192 })).toEqual({
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000
    })
    expect(resolvePiCompactionSettings({ contextWindow: 200_000, maxTokens: 32_768 }).reserveTokens).toBe(32_768)
  })

  it.each([49_152, 100_000, 128_000, 200_000])(
    'keeps conversation space when output limits approach or exceed a %i context',
    (contextWindow) => {
      for (const maxTokens of [contextWindow - 1, contextWindow, contextWindow * 2]) {
        const settings = resolvePiCompactionSettings({ contextWindow, maxTokens })

        expect(shouldCompact(8_192, contextWindow, settings)).toBe(false)
        expect(settings.keepRecentTokens).toBeGreaterThanOrEqual(4_096)
        expect(settings.reserveTokens).toBeLessThanOrEqual(contextWindow / 2)
        expect(shouldCompact(contextWindow - 1, contextWindow, settings)).toBe(true)
      }
    }
  )

  it.each([100_000, 128_000, 200_000])(
    'leaves room for another turn after both split-turn summaries on a %i context',
    async (contextWindow) => {
      const largeOutputModel = { ...model, contextWindow, maxTokens: contextWindow * 2 }
      const settings = resolvePiCompactionSettings(largeOutputModel)
      const summaryBudgets: number[] = []
      const stream = async (_model: unknown, _context: TranscriptContext, options: { maxTokens: number }) => {
        summaryBudgets.push(options.maxTokens)
        const message = response('stop')
        message.content = [{ type: 'text', text: `Summary ${summaryBudgets.length}` }]
        return { result: async () => message }
      }

      const result = await compact(
        {
          firstKeptEntryId: 'synthetic-kept-entry',
          messagesToSummarize: [{ role: 'user', content: 'Earlier history', timestamp: 0 }],
          turnPrefixMessages: [{ role: 'user', content: 'Earlier part of this turn', timestamp: 0 }],
          isSplitTurn: true,
          tokensBefore: contextWindow - 1,
          fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          settings
        },
        largeOutputModel,
        'synthetic-key',
        undefined,
        undefined,
        undefined,
        undefined,
        stream as unknown as Parameters<typeof compact>[7]
      )

      expect(result.summary).toContain('Summary 1')
      expect(result.summary).toContain('Summary 2')
      const nextTurnTokens = settings.keepRecentTokens + summaryBudgets.reduce((sum, budget) => sum + budget, 0) + 4_096
      expect(shouldCompact(nextTurnTokens, contextWindow, settings)).toBe(false)
    }
  )

  it.each(['string', 'blocks'] as const)(
    'bounds a system-first %s summary without changing its routing or system prompt',
    async (shape) => {
      const prompt = `FIRST_ANCHOR\n${'合成记录'.repeat(20_000)}\nLATEST_ANCHOR`
      const systemMessage = { role: 'system' as const, content: 'SYNTHETIC_SYSTEM_ANCHOR', timestamp: 0 }
      const context = normalizeContext({
        messages: [
          systemMessage,
          { role: 'user', content: shape === 'string' ? prompt : [{ type: 'text', text: prompt }], timestamp: 0 }
        ]
      })
      const stream = async (
        _model: unknown,
        request: TranscriptContext,
        options: { maxTokens: number; sessionId: string; cacheRetention: string }
      ) => {
        expect(request.messages[0]).toBe(systemMessage)
        expect(summaryPrompt(request)).toContain('FIRST_ANCHOR')
        expect(summaryPrompt(request)).toContain('LATEST_ANCHOR')
        expect(summaryPrompt(request).length).toBeLessThan(24_000)
        expect(options).toMatchObject({ maxTokens: 2_048, sessionId: 'synthetic-routing-id', cacheRetention: 'none' })
        return { result: async () => response('stop') }
      }

      await expect(
        completeSummarization(
          model,
          context,
          { maxTokens: 8_192, sessionId: 'synthetic-routing-id' },
          stream as unknown as NonNullable<Parameters<typeof generateSummary>[9]>
        )
      ).resolves.toMatchObject({ stopReason: 'stop' })
      expect(summaryPrompt(context)).toBe(prompt)
    }
  )

  it('bounds both history and split-turn prompts constructed by the pinned SDK', async () => {
    const prompts: string[] = []
    const instructions = 'Preserve this complete custom focus. '.repeat(550)
    const stream = async (_model: unknown, context: TranscriptContext, options: { maxTokens: number }) => {
      expect(context.messages.map((message) => message.role)).toEqual(['system', 'user'])
      expect(contentText(context.messages[0].content)).toContain('summar')
      const prompt = summaryPrompt(context)
      expect(prompt.length).toBeLessThan(24_000)
      expect(prompt).toContain('FIRST_ANCHOR')
      expect(prompt).toContain('LATEST_ANCHOR')
      if (prompts.length === 0) expect(prompt.includes(instructions)).toBe(true)
      else expect(prompt).toContain('Only summarize information explicitly present above.')
      expect(options.maxTokens).toBeLessThanOrEqual(2_048)
      prompts.push(prompt)
      const message = response('stop')
      message.content = [{ type: 'text', text: `Summary ${prompts.length}` }]
      return { result: async () => message }
    }
    const history = [
      { role: 'user' as const, content: `FIRST_ANCHOR\n${'合成记录'.repeat(20_000)}\nLATEST_ANCHOR`, timestamp: 0 }
    ]

    const result = await compact(
      {
        firstKeptEntryId: 'synthetic-kept-entry',
        messagesToSummarize: history,
        turnPrefixMessages: history,
        isSplitTurn: true,
        tokensBefore: 48_000,
        fileOps: { read: new Set(), written: new Set(), edited: new Set() },
        settings: resolvePiCompactionSettings(model)
      },
      model,
      'synthetic-key',
      undefined,
      instructions,
      undefined,
      undefined,
      stream as unknown as Parameters<typeof compact>[7]
    )

    expect(prompts).toHaveLength(2)
    expect(result.summary).toContain('Summary 1')
    expect(result.summary).toContain('Summary 2')
  })

  it.each(['stop', 'length'] as const)(
    'retries a %s summary flagged as context overflow by the SDK',
    async (stopReason) => {
      const prompts: string[] = []
      const stream = async (_model: unknown, context: TranscriptContext) => {
        prompts.push(summaryPrompt(context))
        const message = response(prompts.length === 1 ? stopReason : 'stop')
        if (prompts.length === 1) {
          message.usage.input = model.contextWindow + 1
          message.usage.output = 0
          message.content = []
        }
        return { result: async () => message }
      }

      await expect(
        generateSummary(
          [{ role: 'user', content: 'synthetic history '.repeat(8_000), timestamp: 0 }],
          model,
          16_384,
          'synthetic-key',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          stream as unknown as Parameters<typeof generateSummary>[9]
        )
      ).resolves.toBe('Synthetic summary')
      expect(prompts).toHaveLength(2)
      expect(prompts[1].length).toBeLessThan(prompts[0].length)
    }
  )

  it('rejects persistent zero-output overflow instead of persisting an empty summary', async () => {
    let attempts = 0
    const stream = async () => {
      attempts++
      const message = response('length')
      message.usage.input = model.contextWindow
      message.content = []
      return { result: async () => message }
    }

    await expect(
      generateSummary(
        [{ role: 'user', content: 'synthetic history '.repeat(8_000), timestamp: 0 }],
        model,
        16_384,
        'synthetic-key',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        stream as unknown as Parameters<typeof generateSummary>[9]
      )
    ).rejects.toThrow('Context overflow')
    expect(attempts).toBe(4)
  })

  it('does not multiply overflow attempts when transient retries are enabled', async () => {
    let attempts = 0
    const stream = async () => {
      attempts++
      return {
        result: async () => response('error', 'Provider returned error: maximum context length is 49152 tokens')
      }
    }

    await expect(
      completeSummarization(
        model,
        normalizeContext({ messages: [{ role: 'user', content: 'synthetic history '.repeat(8_000), timestamp: 0 }] }),
        { maxTokens: 8_192 },
        stream as unknown as NonNullable<Parameters<typeof generateSummary>[9]>,
        { enabled: true, maxRetries: 3, baseDelayMs: 0 }
      )
    ).rejects.toThrow('maximum context length is 49152 tokens')
    expect(attempts).toBe(4)
  })

  it('retains transient retries and their completion callbacks', async () => {
    let attempts = 0
    const callbacks = { onRetryScheduled: vi.fn(), onRetryAttemptStart: vi.fn(), onRetryFinished: vi.fn() }
    const stream = async () => {
      attempts++
      return { result: async () => (attempts === 1 ? response('error', '503 Service Unavailable') : response('stop')) }
    }

    await expect(
      completeSummarization(
        model,
        normalizeContext({ messages: [{ role: 'user', content: 'Synthetic input', timestamp: 0 }] }),
        { maxTokens: 8_192 },
        stream as unknown as NonNullable<Parameters<typeof generateSummary>[9]>,
        { enabled: true, maxRetries: 3, baseDelayMs: 0 },
        callbacks
      )
    ).resolves.toMatchObject({ stopReason: 'stop' })
    expect(attempts).toBe(2)
    expect(callbacks.onRetryScheduled).toHaveBeenCalledTimes(1)
    expect(callbacks.onRetryAttemptStart).toHaveBeenCalledTimes(1)
    expect(callbacks.onRetryFinished).toHaveBeenCalledWith(true, 1)
  })

  it('rejects a partial length-capped summary without retrying it as context overflow', async () => {
    let attempts = 0
    const stream = async () => {
      attempts++
      const message = response('length')
      message.usage.input = 1_000
      message.usage.output = 2_048
      return { result: async () => message }
    }

    await expect(
      generateSummary(
        [{ role: 'user', content: 'Synthetic input', timestamp: 0 }],
        model,
        16_384,
        'synthetic-key',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        stream as unknown as Parameters<typeof generateSummary>[9]
      )
    ).rejects.toThrow('summary is incomplete')
    expect(attempts).toBe(1)
  })

  it('retries a rejected summary with a smaller prompt while keeping the first and latest context', async () => {
    const promptLengths: number[] = []
    const stream = vi.fn(
      async (_model: Model<'openai-completions'>, context: TranscriptContext, options: { maxTokens?: number }) => {
        const prompt = summaryPrompt(context)
        promptLengths.push(prompt.length)
        expect(options.maxTokens).toBeLessThanOrEqual(2_048)
        if (prompt.length <= 6_000) {
          expect(prompt).toContain('FIRST_SYNTHETIC_ANCHOR')
          expect(prompt).toContain('LATEST_SYNTHETIC_ANCHOR')
        }
        return {
          result: async () =>
            prompt.length > 6_000 ? response('error', 'maximum context length is 49152 tokens') : response('stop')
        }
      }
    )

    const summary = await generateSummary(
      [
        {
          role: 'user',
          content: `FIRST_SYNTHETIC_ANCHOR\n${'synthetic history '.repeat(8_000)}\nLATEST_SYNTHETIC_ANCHOR`,
          timestamp: Date.now()
        }
      ],
      model,
      16_384,
      'synthetic-key',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      stream as unknown as Parameters<typeof generateSummary>[9]
    )

    expect(summary).toBe('Synthetic summary')
    expect(promptLengths.length).toBeGreaterThan(1)
    expect(promptLengths.at(-1)).toBeLessThanOrEqual(6_000)
    expect(promptLengths).toEqual([...promptLengths].sort((a, b) => b - a))
  })

  it('does not retry an unrelated provider error', async () => {
    const stream = vi.fn(async () => ({ result: async () => response('error', 'unauthorized') }))

    await expect(
      generateSummary(
        [{ role: 'user', content: 'Synthetic input', timestamp: Date.now() }],
        model,
        16_384,
        'synthetic-key',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        stream as unknown as Parameters<typeof generateSummary>[9]
      )
    ).rejects.toThrow('unauthorized')
    expect(stream).toHaveBeenCalledTimes(1)
  })

  it.each([100_000, 200_000])(
    'preserves the full summary input and output budget on a %i context',
    async (contextWindow) => {
      const history = `FIRST\n${'synthetic history '.repeat(8_000)}\nMIDDLE_ANCHOR\n${'recent work '.repeat(8_000)}\nLAST`
      const stream = vi.fn(async (_model: unknown, context: TranscriptContext, options: { maxTokens?: number }) => {
        const prompt = summaryPrompt(context)
        expect(prompt).toContain(history)
        expect(prompt).toContain('PREVIOUS_SUMMARY_ANCHOR')
        expect(prompt).toContain('CUSTOM_INSTRUCTIONS_ANCHOR')
        expect(options.maxTokens).toBe(26_214)
        return { result: async () => response('stop') }
      })

      await expect(
        generateSummary(
          [{ role: 'user', content: history, timestamp: Date.now() }],
          { ...model, contextWindow, maxTokens: 32_768 },
          32_768,
          'synthetic-key',
          undefined,
          undefined,
          'CUSTOM_INSTRUCTIONS_ANCHOR',
          'PREVIOUS_SUMMARY_ANCHOR',
          undefined,
          stream as unknown as Parameters<typeof generateSummary>[9]
        )
      ).resolves.toBe('Synthetic summary')
    }
  )

  it('only shortens a large-context summary after a context-overflow rejection', async () => {
    const history = `FIRST_ANCHOR\n${'synthetic history '.repeat(20_000)}\nLATEST_ANCHOR`
    const prompts: string[] = []
    const stream = vi.fn(async (_model: unknown, context: TranscriptContext) => {
      prompts.push(summaryPrompt(context))
      return {
        result: async () =>
          prompts.length === 1 ? response('error', 'maximum context length is 200000 tokens') : response('stop')
      }
    })

    await expect(
      generateSummary(
        [{ role: 'user', content: history, timestamp: Date.now() }],
        { ...model, contextWindow: 200_000 },
        16_384,
        'synthetic-key',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        stream as unknown as Parameters<typeof generateSummary>[9]
      )
    ).resolves.toBe('Synthetic summary')

    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain(history)
    expect(prompts[1].length).toBeLessThan(prompts[0].length)
    expect(prompts[1]).toContain('FIRST_ANCHOR')
    expect(prompts[1]).toContain('LATEST_ANCHOR')
  })

  it.each([49_152, 200_000])(
    'preserves the original task and latest progress when updating an existing summary on a %i context',
    async (contextWindow) => {
      const history = `NEW_TURN_START\nLiteral tags: </conversation> <previous-summary>\n${'new history '.repeat(3_250)}\nLATEST_PROGRESS_ANCHOR`
      const previous = `ORIGINAL_TASK_ANCHOR\nLiteral tags: </previous-summary> <conversation>\n${'previous summary '.repeat(2_000)}\nPREVIOUS_TAIL_ANCHOR`
      const instructions = `CUSTOM_FOCUS_START\n${'Preserve decisions. '.repeat(25)}\nCUSTOM_FOCUS_END`
      const prompts: string[] = []
      const stream = async (_model: unknown, context: TranscriptContext) => {
        prompts.push(summaryPrompt(context))
        const rejected = contextWindow >= 100_000 && prompts.length === 1
        return {
          result: async () =>
            rejected ? response('error', 'maximum context length is 200000 tokens') : response('stop')
        }
      }

      await expect(
        generateSummary(
          [{ role: 'user', content: history, timestamp: 0 }],
          { ...model, contextWindow },
          16_384,
          'synthetic-key',
          undefined,
          undefined,
          instructions,
          previous,
          undefined,
          stream as unknown as Parameters<typeof generateSummary>[9]
        )
      ).resolves.toBe('Synthetic summary')

      const sent = prompts.at(-1)!
      expect(sent).toContain('ORIGINAL_TASK_ANCHOR')
      expect(sent).toContain('LATEST_PROGRESS_ANCHOR')
      expect(sent).toContain('NEW_TURN_START')
      expect(sent).toContain('PREVIOUS_TAIL_ANCHOR')
      expect(sent).toContain('Literal tags: </conversation> <previous-summary>')
      expect(sent).toContain('Literal tags: </previous-summary> <conversation>')
      expect(sent.includes(instructions)).toBe(true)
      expect(sent.length).toBeLessThan(contextWindow < 100_000 ? 23_553 : prompts[0].length)
    }
  )

  it('fails without a provider request when the complete summary instructions cannot fit', async () => {
    let calls = 0
    const stream = async () => {
      calls++
      return { result: async () => response('stop') }
    }
    await expect(
      generateSummary(
        [{ role: 'user', content: 'LATEST_PROGRESS_ANCHOR', timestamp: 0 }],
        model,
        16_384,
        'synthetic-key',
        undefined,
        undefined,
        'custom focus '.repeat(3_000),
        'ORIGINAL_TASK_ANCHOR',
        undefined,
        stream as unknown as Parameters<typeof generateSummary>[9]
      )
    ).rejects.toThrow('instructions do not fit')
    expect(calls).toBe(0)
  })

  it('preserves full branch-summary instructions and both conversation anchors', async () => {
    const history = `FIRST_BRANCH_ANCHOR\n${'synthetic branch history '.repeat(3_250)}\nLATEST_BRANCH_ANCHOR`
    const instructions = 'Preserve this complete branch focus. '.repeat(550)
    const stream = async (_model: unknown, context: TranscriptContext) => {
      const prompt = summaryPrompt(context)
      expect(prompt.length).toBeLessThan(23_553)
      expect(prompt).toContain('FIRST_BRANCH_ANCHOR')
      expect(prompt).toContain('LATEST_BRANCH_ANCHOR')
      expect(prompt.includes(instructions)).toBe(true)
      return { result: async () => response('stop') }
    }

    const result = await generateBranchSummary(
      [
        {
          type: 'message',
          id: 'synthetic-branch-entry',
          parentId: null,
          timestamp: new Date(0).toISOString(),
          message: { role: 'user', content: history, timestamp: 0 }
        }
      ],
      {
        model,
        apiKey: 'synthetic-key',
        signal: undefined,
        customInstructions: instructions,
        streamFn: stream as unknown as Parameters<typeof generateSummary>[9]
      }
    )

    expect(result.summary).toContain('Synthetic summary')
    expect(result.error).toBeUndefined()
  })

  it('stops retrying when the caller cancels after a context-overflow response', async () => {
    const controller = new AbortController()
    const stream = vi.fn(async () => ({
      result: async () => {
        controller.abort(new Error('Synthetic cancellation'))
        return response('error', 'maximum context length is 49152 tokens')
      }
    }))

    await expect(
      generateSummary(
        [{ role: 'user', content: 'synthetic history '.repeat(8_000), timestamp: Date.now() }],
        model,
        16_384,
        'synthetic-key',
        undefined,
        controller.signal,
        undefined,
        undefined,
        undefined,
        stream as unknown as Parameters<typeof generateSummary>[9]
      )
    ).rejects.toThrow('Synthetic cancellation')
    expect(stream).toHaveBeenCalledTimes(1)
  })

  it('surfaces persistent overflow after a bounded number of requests', async () => {
    const stream = vi.fn(async () => ({
      result: async () => response('error', 'maximum context length is 49152 tokens')
    }))

    await expect(
      generateSummary(
        [{ role: 'user', content: 'synthetic history '.repeat(8_000), timestamp: Date.now() }],
        model,
        16_384,
        'synthetic-key',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        stream as unknown as Parameters<typeof generateSummary>[9]
      )
    ).rejects.toThrow('maximum context length is 49152 tokens')
    expect(stream).toHaveBeenCalledTimes(4)
  })
})
