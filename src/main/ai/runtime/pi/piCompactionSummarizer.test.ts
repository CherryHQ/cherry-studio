import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'

import type { createPiGatewayModelBinding } from './gatewayModelBinding'
import { createPiCompactionSummarizer } from './piCompactionSummarizer'

type Binding = Awaited<ReturnType<typeof createPiGatewayModelBinding>>

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } }

function assistant(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'test',
    model: 'test-model',
    usage,
    stopReason: 'stop',
    timestamp: 0,
    ...overrides
  } as AssistantMessage
}

function summarizerFor() {
  const binding = {
    model: { id: 'test-model', provider: 'test', contextWindow: 10_000, maxTokens: 2_000 },
    modelRuntime: { completeSimple: vi.fn().mockRejectedValue(new Error('bypassed the metered stream')) }
  } as unknown as Binding
  return createPiCompactionSummarizer({
    binding,
    usage: () => ({ headers: {}, release: () => {} })
  })
}

/** The metered stream the runtime supplies; its result resolves like pi's stream output. */
function meteredStream(completeSimple: ReturnType<typeof vi.fn>) {
  return vi.fn().mockImplementation((...args: unknown[]) => ({
    result: () => (completeSimple as (...a: unknown[]) => unknown)(...args)
  }))
}

function request(messages: Message[], stream: ReturnType<typeof meteredStream>) {
  return {
    reason: 'threshold' as const,
    sessionId: 's1',
    model: {} as never,
    messages,
    signal: new AbortController().signal,
    stream: stream as never
  }
}

const filler = (i: number): Message => ({ role: 'user', content: `filler ${i} ${'x'.repeat(5_000)}`, timestamp: i })

describe('createPiCompactionSummarizer', () => {
  it('keeps the initial task and latest message, and discloses omitted middle messages', async () => {
    const completeSimple = vi.fn().mockResolvedValue(assistant({ content: [{ type: 'text', text: 'summary' }] }))
    const messages: Message[] = [
      { role: 'user', content: 'INITIAL TASK', timestamp: 0 },
      ...Array.from({ length: 20 }, (_, i) => filler(i + 1)),
      { role: 'user', content: 'LATEST REQUEST', timestamp: 99 }
    ]

    await summarizerFor()(request(messages, meteredStream(completeSimple)))

    const prompt = completeSimple.mock.calls[0][1].messages.at(-1)!.content as string
    expect(prompt).toContain('INITIAL TASK')
    expect(prompt).toContain('LATEST REQUEST')
    expect(prompt).toMatch(/\d+ earlier messages were omitted/)
  })

  it('retries once with a smaller input when the summarizer itself overflows', async () => {
    const completeSimple = vi
      .fn()
      .mockResolvedValueOnce(
        assistant({
          stopReason: 'error',
          errorMessage: 'request (8315 tokens) exceeds the available context size (8192 tokens)'
        })
      )
      .mockResolvedValueOnce(assistant({ content: [{ type: 'text', text: 'summary' }] }))
    const messages = Array.from({ length: 20 }, (_, i) => filler(i))

    const result = await summarizerFor()(request(messages, meteredStream(completeSimple)))

    expect(result).toMatchObject({ summary: 'summary' })
    const [first, second] = completeSimple.mock.calls.map((call) => (call[1].messages.at(-1)!.content as string).length)
    expect(second).toBeLessThan(first)
  })

  it('routes every summary attempt through the metered stream, never modelRuntime.completeSimple', async () => {
    const completeSimple = vi.fn().mockResolvedValue(assistant({ content: [{ type: 'text', text: 'summary' }] }))
    const stream = meteredStream(completeSimple)

    const result = await summarizerFor()(request([filler(1)], stream))

    expect(result).toMatchObject({ summary: 'summary' })
    expect(stream).toHaveBeenCalledTimes(1)
  })

  it('does not retry a failure that is not a context overflow', async () => {
    const completeSimple = vi.fn().mockResolvedValue(assistant({ stopReason: 'error', errorMessage: 'Unauthorized' }))

    await expect(summarizerFor()(request([filler(1)], meteredStream(completeSimple)))).rejects.toThrow('Unauthorized')
    expect(completeSimple).toHaveBeenCalledTimes(1)
  })
})
