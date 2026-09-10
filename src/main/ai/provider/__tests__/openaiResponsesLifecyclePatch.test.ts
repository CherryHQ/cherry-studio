import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

const prompt: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
]

async function streamEvents(events: unknown[]): Promise<LanguageModelV3StreamPart[]> {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  const model = createOpenAI({
    apiKey: 'sk-test',
    baseURL: 'https://example.com/v1',
    fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }).responses('compatible-model')

  const result = await model.doStream({ prompt })
  const chunks: LanguageModelV3StreamPart[] = []
  for await (const chunk of result.stream) chunks.push(chunk)
  return chunks
}

/** Guards the lifecycle-event hunks in patches/@ai-sdk__openai@3.0.109.patch. */
describe('patched @ai-sdk/openai Responses lifecycle parser', () => {
  it('accepts a sparse response.created event when the following stream is valid', async () => {
    const chunks = await streamEvents([
      { type: 'response.created', response: { service_tier: null } },
      { type: 'response.output_text.delta', item_id: 'message-1', delta: 'Hello' },
      {
        type: 'response.completed',
        response: { incomplete_details: null, usage: null, reasoning: null, service_tier: null }
      }
    ])

    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', id: 'message-1', delta: 'Hello' }))
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false)
  })

  it('retains partial output and classifies a sparse response.failed event', async () => {
    const chunks = await streamEvents([
      { type: 'response.output_text.delta', item_id: 'message-1', delta: 'Partial answer' },
      {
        type: 'response.failed',
        response: {
          error: { code: 429, message: 'provider concurrency limit reached' },
          incomplete_details: null,
          usage: null,
          reasoning: null,
          service_tier: null
        }
      }
    ])

    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'text-delta', id: 'message-1', delta: 'Partial answer' })
    )
    const errorChunk = chunks.find((chunk) => chunk.type === 'error')
    expect(errorChunk?.type === 'error' && errorChunk.error).toMatchObject({
      message: 'provider concurrency limit reached',
      statusCode: 429,
      isRetryable: true
    })
  })
})
