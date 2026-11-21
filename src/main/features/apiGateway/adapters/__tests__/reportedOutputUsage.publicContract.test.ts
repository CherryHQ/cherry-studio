import { describe, expect, it } from 'vitest'

import { REPORTED_OUTPUT_USAGE_KEY } from '@shared/ai/reportedOutputUsage'

import { StreamAdapterFactory } from '..'

const FORMATS = ['anthropic', 'openai', 'openai-responses', 'gemini'] as const

function run(format: (typeof FORMATS)[number], expose: boolean) {
  const adapter = StreamAdapterFactory.createAdapter(format, {
    model: 'fixture',
    inputTokens: 19,
    ...(expose && { exposeReportedOutputUsage: true })
  })
  // Anthropic-backed Gemini request: executor output counts of 3 and 2 give 5 normalized tokens.
  const chunks = [
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'hi' },
    { type: 'text-end', id: 't' },
    {
      type: 'message-metadata',
      messageMetadata: {
        stats: { inputTokens: 19, outputTokens: 5, totalTokens: 24 },
        reportedOutputUsage: { outputTokens: null, reasoningTokens: null }
      }
    },
    { type: 'finish', finishReason: 'stop' }
  ] as never[]
  const events = chunks.flatMap((chunk) => adapter.transformChunk(chunk) as unknown[])
  return [...events, ...adapter.finalizeEvents()] as Record<string, unknown>[]
}

describe('public HTTP gateway usage contract', () => {
  it.each(FORMATS)('%s keeps normalized usage and adds no provenance field by default', (format) => {
    const events = run(format, false)
    expect(events.some((event) => REPORTED_OUTPUT_USAGE_KEY in event)).toBe(false)
  })

  it('keeps Gemini candidatesTokenCount and totals on the public projection', () => {
    const frame = run('gemini', false).at(-1) as { usageMetadata: Record<string, number> }
    expect(frame.usageMetadata).toMatchObject({ promptTokenCount: 19, candidatesTokenCount: 5, totalTokenCount: 24 })
  })

  it.each(FORMATS)('%s exposes provenance only on the private object transport', (format) => {
    const events = run(format, true)
    expect(events.some((event) => REPORTED_OUTPUT_USAGE_KEY in event)).toBe(true)
  })
})
