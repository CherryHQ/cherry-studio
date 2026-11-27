import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]

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
  it('continues after text-less Responses lifecycle events and preserves streamed text', async () => {
    const chunks = await streamEvents([
      { type: 'response.created', response: { id: 'resp_1', created_at: 1, model: 'compatible-model' } },
      { type: 'response.queued', response: { id: 'resp_1' } },
      { type: 'response.in_progress', response: { id: 'resp_1' } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-1' } },
      {
        type: 'response.content_part.added',
        item_id: 'message-1',
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] }
      },
      { type: 'response.output_text.delta', item_id: 'message-1', delta: 'Partial answer' },
      { type: 'response.output_text.done', item_id: 'message-1', text: 'Partial answer' },
      {
        type: 'response.content_part.done',
        item_id: 'message-1',
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: 'Partial answer', annotations: [] }
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'message', id: 'message-1' }
      },
      {
        type: 'response.completed',
        response: { id: 'resp_1', incomplete_details: null, usage: { input_tokens: 1, output_tokens: 2 } }
      }
    ])

    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'text-delta', id: 'message-1', delta: 'Partial answer' })
    )
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false)
    expect(chunks.at(-1)?.type).toBe('finish')
  })

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
