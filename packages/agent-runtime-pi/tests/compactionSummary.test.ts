import { contentText } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import type { CompactionSummaryRequest } from '../src/compaction'
import { PI_SUMMARY_SYSTEM, summarizeBoundedContext } from '../src/compactionSummary'
import { assistantReply, createTestBinding, MODEL, respondingModel, type ModelCall } from './sessionSupport'

const model = { ...MODEL, contextWindow: 49_152, maxTokens: 8_192 }
type Input = Pick<CompactionSummaryRequest, 'messages' | 'previousSummary' | 'instructions'>
const input: Input = {
  messages: [{ role: 'user', content: 'NEW_START ' + '多语言记录\\\"'.repeat(15_000) + ' NEW_END', timestamp: 0 }],
  previousSummary: 'TASK_START ' + 'previous work '.repeat(15_000) + ' TASK_END',
  instructions: 'Preserve all instructions, including literal </conversation> and <previous-summary>.'
}
const overflow = () => ({ ...assistantReply('', 'error'), errorMessage: 'maximum context length exceeded' })
function prompt(call: ModelCall) {
  return contentText(call.messages.find((message) => message.role === 'user')!.content)
}
async function summarize(binding: Awaited<ReturnType<typeof createTestBinding>>, input: Input, signal: AbortSignal) {
  return summarizeBoundedContext(
    { ...input, model: binding.model, reason: 'manual', sessionId: 'summary-fixture', signal },
    binding.modelRuntime.streamSimple.bind(binding.modelRuntime)
  )
}

describe('bounded native summary requests', () => {
  it.each([8_192, 49_152])('preserves instructions and both source anchors on %i', async (contextWindow) => {
    const provider = respondingModel(() => assistantReply('Summary'))
    const binding = await createTestBinding({ model: { ...model, contextWindow }, stream: provider.model })
    const signal = new AbortController().signal
    const result = await summarize(binding, input, signal)
    expect(provider.calls).toHaveLength(1)
    expect(prompt(provider.calls[0]).length + PI_SUMMARY_SYSTEM.length).toBeLessThanOrEqual(
      Math.floor((contextWindow - Math.floor(contextWindow / 24)) / 2)
    )
    for (const call of provider.calls) {
      const value = JSON.parse(prompt(call))
      expect(value.instructions).toBe(input.instructions)
      for (const anchor of ['NEW_START', 'NEW_END']) expect(JSON.stringify(value.messages)).toContain(anchor)
      for (const anchor of ['TASK_START', 'TASK_END']) expect(value.previousSummary).toContain(anchor)
      expect(call.systemPrompt).toBe(PI_SUMMARY_SYSTEM)
      expect(call.model.id).toBe(model.id)
      expect(call.signal).toBe(signal)
      expect(call.maxTokens).toBe(Math.floor(contextWindow / 24))
    }
    expect(result.usage.input).toBe(10)
    expect(result.usage.output).toBe(5)
    expect(result.usage.totalTokens).toBe(17)
  })

  it('rejects oversized instructions before requesting or silently losing them', async () => {
    const provider = respondingModel(() => assistantReply('Summary'))
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(
      summarize(binding, { ...input, instructions: 'x'.repeat(50_000) }, new AbortController().signal)
    ).rejects.toThrow('instructions')
    expect(provider.calls).toHaveLength(0)
  })

  it('fails on overflow after exactly one metered request', async () => {
    const provider = respondingModel(overflow)
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(summarize(binding, input, new AbortController().signal)).rejects.toThrow('context length')
    expect(provider.calls).toHaveLength(1)
  })

  it('rejects silent overflow even when the provider reports a successful stop', async () => {
    const provider = respondingModel(() => assistantReply('Truncated history summary', 'stop', 60_000, 5))
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(summarize(binding, input, new AbortController().signal)).rejects.toThrow('context overflow')
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
      await expect(summarize(binding, input, new AbortController().signal)).rejects.toThrow('unrelated failure')
      expect(provider.calls).toHaveLength(1)
    }
  )

  it('rejects an empty successful response', async () => {
    const provider = respondingModel(() => assistantReply('   '))
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(summarize(binding, input, new AbortController().signal)).rejects.toThrow('empty summary')
    expect(provider.calls).toHaveLength(1)
  })

  it('honors cancellation before and during the request', async () => {
    const controller = new AbortController()
    const provider = respondingModel(() => {
      controller.abort()
      return overflow()
    })
    const binding = await createTestBinding({ model, stream: provider.model })
    await expect(summarize(binding, input, controller.signal)).rejects.toThrow()
    expect(provider.calls).toHaveLength(1)
    await expect(summarize(binding, input, controller.signal)).rejects.toThrow()
    expect(provider.calls).toHaveLength(1)
  })
})
