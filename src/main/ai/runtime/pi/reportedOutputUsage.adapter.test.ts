import { normalizeContext, type Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import { describe, expect, it } from 'vitest'

import { withReportedOutputUsage, type ReportedOutputUsage } from './reportedOutputUsage'

const model = {
  id: 'test',
  name: 'test',
  provider: 'openai',
  api: 'openai-completions',
  baseUrl: 'https://provider.invalid/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 100
} satisfies Model<'openai-completions'>

describe('locked Pi OpenAI adapter count presence', () => {
  it.each([
    [undefined, {}],
    [{ completion_tokens: 12 }, { outputTokens: 12 }],
    [
      { completion_tokens: 0, completion_tokens_details: { reasoning_tokens: 0 } },
      { outputTokens: 0, reasoningTokens: 0 }
    ]
  ])('keeps raw presence despite SDK zero defaults: %j', async (usage, expected) => {
    const counts: ReportedOutputUsage = {}
    const payload =
      [
        { id: 'r', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'length' }] },
        ...(usage ? [{ id: 'r', choices: [], usage }] : [])
      ]
        .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
        .join('') + 'data: [DONE]\n\n'
    const fetcher = (async () =>
      new Response(payload, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
    const message = await streamSimple(model, normalizeContext({ messages: [] }), {
      apiKey: 'test-only',
      fetch: withReportedOutputUsage(fetcher, counts)
    }).result()
    expect(message.stopReason).toBe('length')
    expect(message.usage.output).toBe(usage?.completion_tokens ?? 0)
    expect(counts).toEqual(expected)
  })
})
