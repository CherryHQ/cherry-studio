import { createOpenResponses } from '@ai-sdk/open-responses'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

/**
 * Guards patches/@ai-sdk__open-responses@1.0.34.patch — the two behaviors subset
 * Responses servers depend on: replaying the chain of thought itself (thinking
 * dialects reject a turn that dropped it, #18150) and closing an unterminated
 * reasoning item with its real id.
 */

function sseModel(events: unknown[]) {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  return createOpenResponses({
    url: 'https://example.com/v1/responses',
    name: 'openai',
    apiKey: 'sk-test',
    fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  })('subset-thinking-model')
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const reader = stream.getReader()
  const chunks: LanguageModelV3StreamPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

describe('patched @ai-sdk/open-responses', () => {
  it('replays assistant reasoning as reasoning_text content items', async () => {
    let body: any
    const model = createOpenResponses({
      url: 'https://example.com/v1/responses',
      name: 'openai',
      apiKey: 'sk-test',
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            created_at: 0,
            model: 'm',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    })('subset-thinking-model')

    await model.doGenerate({
      prompt: [
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'thinking' },
            { type: 'text', text: 'answer' }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: 'next' }] }
      ]
    })

    expect(body.input.filter((item: any) => item.type === 'reasoning')).toEqual([
      { type: 'reasoning', summary: [], content: [{ type: 'reasoning_text', text: 'thinking' }] }
    ])
  })

  it('closes an unterminated reasoning item with its real id on stream end', async () => {
    // Upstream flush() hardcodes id 'reasoning-0'; ai's step assembler only knows the
    // real item id and fails the whole stream with "reasoning part … not found"
    // (seen live on the HuggingFace router).
    const chunks = await collect(
      (
        await sseModel([
          { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_real' } },
          { type: 'response.reasoning_text.delta', item_id: 'rs_real', output_index: 0, delta: 'thinking' },
          { type: 'response.completed', response: { id: 'resp_1', usage: { input_tokens: 1, output_tokens: 1 } } }
        ]).doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
      ).stream
    )

    expect(chunks.filter((chunk) => chunk.type === 'reasoning-end').map((chunk) => (chunk as any).id)).toEqual([
      'rs_real'
    ])
  })
})
