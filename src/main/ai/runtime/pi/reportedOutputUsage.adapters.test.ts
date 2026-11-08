import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createPerplexity } from '@ai-sdk/perplexity'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { createXai } from '@ai-sdk/xai'
import { describe, expect, it } from 'vitest'

import { collectReportedOutputUsage, type ReportedOutputUsage } from '@main/ai/runtime/pi/reportedOutputUsage'
import { AiSdkToGeminiSse } from '@main/features/apiGateway/adapters/stream/AiSdkToGeminiSse'
import { providerReportedOutputUsage } from '@shared/ai/reportedOutputUsage'

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'answer' }] }]

function geminiProjection(output: number | undefined, reasoning: number | undefined, raw: unknown) {
  const provenance = providerReportedOutputUsage({
    outputTokens: output,
    outputTokenDetails: { reasoningTokens: reasoning },
    raw
  })
  const adapter = new AiSdkToGeminiSse({ model: 'fixture' })
  adapter.transformChunk({
    type: 'message-metadata',
    messageMetadata: {
      stats: { outputTokens: output ?? 0, outputTokenDetails: { reasoningTokens: reasoning ?? 0 } },
      reportedOutputUsage: provenance
    }
  })
  adapter.transformChunk({ type: 'finish', finishReason: 'length' })
  const frame = adapter.finalizeEvents().at(-1)!
  // The Google client strips unknown extensions; read standard Gemini usage only.
  const counts: ReportedOutputUsage = {}
  collectReportedOutputUsage({ usageMetadata: frame.usageMetadata }, counts)
  return { provenance, counts }
}

describe('pinned provider count provenance', () => {
  it.each([0, 25])('retains actual Bedrock adapter camelCase output usage: %s', async (outputTokens) => {
    const provider = createAmazonBedrock({
      region: 'us-east-1',
      apiKey: 'fixture',
      fetch: async () =>
        Response.json({
          output: { message: { role: 'assistant', content: [{ text: 'partial' }] } },
          stopReason: 'max_tokens',
          usage: { inputTokens: 100, outputTokens, totalTokens: 100 + outputTokens }
        })
    })
    const result = await provider('anthropic.claude-3-haiku-20240307-v1:0').doGenerate({ prompt })
    expect(result.usage.raw).toMatchObject({ outputTokens })
    const { provenance, counts } = geminiProjection(
      result.usage.outputTokens.total,
      result.usage.outputTokens.reasoning,
      result.usage.raw
    )
    expect(provenance).toEqual({ outputTokens, reasoningTokens: null })
    expect(counts.outputTokens).toBe(outputTokens)
  })

  it.each([undefined, 0, 10])('retains actual Perplexity adapter top-level reasoning usage: %s', async (reasoning) => {
    const raw = {
      prompt_tokens: 100,
      completion_tokens: 25,
      total_tokens: 125,
      ...(reasoning !== undefined ? { reasoning_tokens: reasoning } : {})
    }
    const provider = createPerplexity({
      apiKey: 'fixture',
      fetch: async () =>
        new Response(
          `data: ${JSON.stringify({ id: 'r', model: 'sonar', created: 1, choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }], usage: raw })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } }
        )
    })
    const result = await provider('sonar').doStream({ prompt })
    const chunks: LanguageModelV3StreamPart[] = []
    for await (const chunk of result.stream) chunks.push(chunk)
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false)
    const finish = chunks.find((chunk) => chunk.type === 'finish')
    if (!finish) throw new Error('No provider finish event')
    expect(finish.type).toBe('finish')
    const { provenance, counts } = geminiProjection(
      finish.usage.outputTokens.total,
      finish.usage.outputTokens.reasoning,
      finish.usage.raw
    )
    expect(provenance).toEqual({ outputTokens: 25, reasoningTokens: reasoning ?? null })
    expect(counts.outputTokens).toBe(25)
    expect(counts.reasoningTokens).toBe(reasoning)
  })

  it.each([undefined, 0, 10])('preserves xAI Chat additive reasoning semantics: %s', async (reasoning) => {
    const raw = {
      prompt_tokens: 100,
      completion_tokens: 25,
      total_tokens: 125 + (reasoning ?? 0),
      ...(reasoning !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {})
    }
    const response = () =>
      Response.json({
        id: 'r',
        model: 'grok-3-mini',
        created: 1,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }],
        usage: raw
      })
    const xai = createXai({ apiKey: 'fixture', fetch: async () => response() })
    const result = await xai('grok-3-mini').doGenerate({ prompt })
    const projected = geminiProjection(
      result.usage.outputTokens.total,
      result.usage.outputTokens.reasoning,
      result.usage.raw
    )
    expect(projected.provenance).toEqual({ outputTokens: 25 + (reasoning ?? 0), reasoningTokens: reasoning ?? null })
    expect(projected.counts).toEqual({
      outputTokens: 25 + (reasoning ?? 0),
      ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {})
    })
    // Identical wire fields under an ordinary OpenAI-compatible adapter are inclusive.
    const compatible = createOpenAICompatible({
      name: 'fixture',
      baseURL: 'http://fixture.invalid',
      fetch: async () => response()
    })
    const control = await compatible('m').doGenerate({ prompt })
    expect(
      geminiProjection(control.usage.outputTokens.total, control.usage.outputTokens.reasoning, control.usage.raw).counts
        .outputTokens
    ).toBe(25)
  })

  it('computes Gemini candidates from the same reported pair, not a normalized thoughts default', () => {
    const { counts } = geminiProjection(25, 0, { output_tokens: 25, output_tokens_details: { thinking_tokens: 10 } })
    expect(counts).toEqual({ outputTokens: 25, reasoningTokens: 10 })
  })
})
