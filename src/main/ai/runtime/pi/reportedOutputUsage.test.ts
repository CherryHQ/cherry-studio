import { describe, expect, it } from 'vitest'

import { collectReportedOutputUsage, withReportedOutputUsage, type ReportedOutputUsage } from './reportedOutputUsage'

describe('raw output usage before SDK normalization', () => {
  it.each([
    [{}, {}],
    [{ usage: { completion_tokens: 0 } }, { outputTokens: 0 }],
    [{ usage: { completion_tokens: 12 } }, { outputTokens: 12 }],
    [
      { usage: { completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 } } },
      { outputTokens: 12, reasoningTokens: 0 }
    ],
    [
      { response: { usage: { output_tokens: 8, output_tokens_details: { reasoning_tokens: 3 } } } },
      { outputTokens: 8, reasoningTokens: 3 }
    ],
    [{ usageMetadata: { candidatesTokenCount: 3, thoughtsTokenCount: 2 } }, { outputTokens: 5, reasoningTokens: 2 }]
  ])('retains field presence in %j', (wire, expected) => {
    const counts: ReportedOutputUsage = {}
    collectReportedOutputUsage(wire, counts)
    expect(counts).toEqual(expected)
  })
  it('observes fragmented SSE without changing the consumer bytes', async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\ndata: {"usage":{"completion_tokens":0,"completion_tokens_details":{"reasoning_tokens":0}}}\n\ndata: [DONE]\n\n'
    const encoder = new TextEncoder()
    const counts: ReportedOutputUsage = {}
    const fetcher = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const character of payload) controller.enqueue(encoder.encode(character))
            controller.close()
          }
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )) as typeof fetch
    const response = await withReportedOutputUsage(fetcher, counts)('https://provider.invalid')
    expect(await response.text()).toBe(payload)
    expect(counts).toEqual({ outputTokens: 0, reasoningTokens: 0 })
  })
  it('does not invent counts for missing usage or inspect non-SSE responses', async () => {
    const counts: ReportedOutputUsage = {}
    const fetcher = (async () => new Response('{"usage":{"completion_tokens":7}}')) as typeof fetch
    expect(await (await withReportedOutputUsage(fetcher, counts)('https://provider.invalid')).text()).toContain('7')
    expect(counts).toEqual({})
  })
})
