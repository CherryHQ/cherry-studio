import type { AssistantMessage, Context, Model } from '@earendil-works/pi-ai'
import { generateSummary, shouldCompact } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import { resolvePiCompactionSettings } from './piCompactionSettings'

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

function response(stopReason: 'error' | 'stop', errorMessage?: string): AssistantMessage {
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

  it('retries a rejected summary with a smaller prompt while keeping the first and latest context', async () => {
    const promptLengths: number[] = []
    const stream = vi.fn(
      async (_model: Model<'openai-completions'>, context: Context, options: { maxTokens?: number }) => {
        const prompt = (context.messages[0].content as { type: 'text'; text: string }[])[0]
        promptLengths.push(prompt.text.length)
        expect(options.maxTokens).toBeLessThanOrEqual(2_048)
        if (prompt.text.length <= 6_000) {
          expect(prompt.text).toContain('FIRST_SYNTHETIC_ANCHOR')
          expect(prompt.text).toContain('LATEST_SYNTHETIC_ANCHOR')
        }
        return {
          result: async () =>
            prompt.text.length > 6_000 ? response('error', 'maximum context length is 49152 tokens') : response('stop')
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
      const stream = vi.fn(async (_model: unknown, context: Context, options: { maxTokens?: number }) => {
        const prompt = (context.messages[0].content as { text: string }[])[0].text
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
    const stream = vi.fn(async (_model: unknown, context: Context) => {
      prompts.push((context.messages[0].content as { text: string }[])[0].text)
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
