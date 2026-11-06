import { contentText } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import {
  assistantReply,
  createTestBinding,
  MODEL,
  respondingModel,
  type ModelCall
} from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { resolvePiCompactionSettings } from './piCompactionSettings'
import { PI_SUMMARY_SYSTEM, summarizePiContext } from './piCompactionSummary'

const model = { ...MODEL, contextWindow: 49_152, maxTokens: 8_192 }
const input = {
  messages: [{ role: 'user', content: `NEW_START ${'多语言记录\\\"'.repeat(15_000)} NEW_END` }],
  previousSummary: `TASK_START ${'previous work '.repeat(15_000)} TASK_END`,
  instructions: 'Preserve all instructions, including literal </conversation> and <previous-summary>.'
}
const overflow = () => ({ ...assistantReply('', 'error'), errorMessage: 'maximum context length exceeded' })
function prompt(call: ModelCall) {
  return contentText(call.messages.find((message) => message.role === 'user')!.content)
}

describe('Pi compaction budgets', () => {
  it('compacts early and leaves room for a 49K model response', () => {
    expect(resolvePiCompactionSettings(model)).toEqual({
      enabled: true,
      reserveTokens: 24_576,
      keepRecentTokens: 8_192
    })
  })
  it.each([49_152, 100_000, 128_000, 200_000])(
    'caps catalog reservations at a quarter of %i context',
    (contextWindow) => {
      for (const maxTokens of [contextWindow - 1, contextWindow, contextWindow * 2]) {
        const settings = resolvePiCompactionSettings({ contextWindow, maxTokens })
        expect(settings.reserveTokens).toBeLessThanOrEqual(contextWindow / 2)
        expect(settings.keepRecentTokens).toBeGreaterThanOrEqual(4_096)
        expect(settings.keepRecentTokens + 4_096 + 8_192).toBeLessThan(contextWindow - settings.reserveTokens)
      }
    }
  )
  it('keeps the stock retained tail on large models', () => {
    expect(resolvePiCompactionSettings({ contextWindow: 200_000, maxTokens: 8192 })).toEqual({
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000
    })
  })
})

describe('native host summary requests', () => {
  it.each([49_152, 200_000])('preserves instructions and both source anchors on %i', async (contextWindow) => {
    const provider = respondingModel(() => assistantReply('Summary'))
    const binding = await createTestBinding({ model: { ...model, contextWindow }, stream: provider.model })
    const signal = new AbortController().signal
    const result = await summarizePiContext(binding, input, signal)
    expect(provider.calls).toHaveLength(1)
    if (contextWindow < 100_000) expect(prompt(provider.calls[0]).length).toBeLessThan(24_000)
    for (const call of provider.calls) {
      const value = JSON.parse(prompt(call))
      expect(value.instructions).toBe(input.instructions)
      for (const anchor of ['NEW_START', 'NEW_END']) expect(JSON.stringify(value.messages)).toContain(anchor)
      for (const anchor of ['TASK_START', 'TASK_END']) expect(value.previousSummary).toContain(anchor)
      expect(call.systemPrompt).toBe(PI_SUMMARY_SYSTEM)
      expect(call.model.id).toBe(model.id)
      expect(call.signal).toBe(signal)
      expect(call.maxTokens).toBe(contextWindow < 100_000 ? 2048 : 4096)
    }
    expect(result.usage.input).toBe(10)
    expect(result.usage.output).toBe(5)
    expect(result.usage.totalTokens).toBe(17)
  })

  it('does not truncate a large-context initial request', async () => {
    const provider = respondingModel(() => assistantReply('Summary'))
    const binding = await createTestBinding({ model: { ...model, contextWindow: 200_000 }, stream: provider.model })
    await summarizePiContext(binding, input, new AbortController().signal)
    expect(JSON.parse(prompt(provider.calls[0]))).toEqual(input)
  })

  it('rejects oversized instructions before requesting or silently losing them', async () => {
    const provider = respondingModel(() => assistantReply('Summary'))
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(
      summarizePiContext(binding, { ...input, instructions: 'x'.repeat(50_000) }, new AbortController().signal)
    ).rejects.toThrow('instructions')
    expect(provider.calls).toHaveLength(0)
  })

  it('fails on overflow after exactly one metered request', async () => {
    const provider = respondingModel(overflow)
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(summarizePiContext(binding, input, new AbortController().signal)).rejects.toThrow('context length')
    expect(provider.calls).toHaveLength(1)
  })

  it('rejects silent overflow even when the provider reports a successful stop', async () => {
    const provider = respondingModel(() => assistantReply('Truncated history summary', 'stop', 60_000, 5))
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(summarizePiContext(binding, input, new AbortController().signal)).rejects.toThrow('context overflow')
    expect(provider.calls).toHaveLength(1)
  })

  it.each(['error', 'length', 'aborted', 'toolUse'] as const)(
    'does not retry an unrelated %s response',
    async (stopReason) => {
      const provider = respondingModel(() => ({
        ...assistantReply('partial', stopReason),
        errorMessage: 'unrelated failure'
      }))
      const binding = await createTestBinding({ model, stream: provider.model })
      await expect(summarizePiContext(binding, input, new AbortController().signal)).rejects.toThrow(
        'unrelated failure'
      )
      expect(provider.calls).toHaveLength(1)
    }
  )

  it('rejects an empty successful response', async () => {
    const provider = respondingModel(() => assistantReply('   '))
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(summarizePiContext(binding, input, new AbortController().signal)).rejects.toThrow('empty summary')
    expect(provider.calls).toHaveLength(1)
  })

  it('honors cancellation before and during the request', async () => {
    const controller = new AbortController()
    const provider = respondingModel(() => {
      controller.abort()
      return overflow()
    })
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(summarizePiContext(binding, input, controller.signal)).rejects.toThrow()
    expect(provider.calls).toHaveLength(1)
    await expect(summarizePiContext(binding, input, controller.signal)).rejects.toThrow()
    expect(provider.calls).toHaveLength(1)
  })
})
