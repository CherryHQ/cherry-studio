import { createOpenResponses } from '@ai-sdk/open-responses'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

/** Guards the provider compatibility behaviors in patches/@ai-sdk__open-responses@1.0.34.patch. */

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
  it('drops gateway keep-alive deltas before they become text parts', async () => {
    const chunks = await collect(
      (
        await sseModel([
          {
            type: 'response.output_text.delta',
            item_id: 'SSE-Keep-Alive',
            delta: '\u200b',
            'SSE-Keep-Alive': true
          }
        ]).doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
      ).stream
    )

    expect(chunks.some((chunk) => chunk.type === 'text-delta')).toBe(false)
  })

  it('continues normal text streaming around gateway keep-alive deltas', async () => {
    const heartbeat = {
      type: 'response.output_text.delta',
      item_id: 'SSE-Keep-Alive',
      delta: '\u200b',
      'SSE-Keep-Alive': true
    }
    const chunks = await collect(
      (
        await sseModel([
          heartbeat,
          { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
          { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: 'color' },
          heartbeat,
          { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: ' answer' },
          { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_1' } },
          { type: 'response.completed', response: { id: 'resp_1', usage: { input_tokens: 1, output_tokens: 2 } } }
        ]).doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
      ).stream
    )

    expect(
      chunks
        .filter((chunk) => chunk.type === 'text-start' || chunk.type === 'text-delta' || chunk.type === 'text-end')
        .map((chunk) => ({
          id: chunk.id,
          text: chunk.type === 'text-delta' ? chunk.delta : undefined,
          type: chunk.type
        }))
    ).toEqual([
      { id: 'msg_1', text: undefined, type: 'text-start' },
      { id: 'msg_1', text: 'color', type: 'text-delta' },
      { id: 'msg_1', text: ' answer', type: 'text-delta' },
      { id: 'msg_1', text: undefined, type: 'text-end' }
    ])
  })

  it('does not drop ordinary text solely because its item id resembles a keep-alive marker', async () => {
    const chunks = await collect(
      (
        await sseModel([
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'SSE-Keep-Alive' }
          },
          { type: 'response.output_text.delta', item_id: 'SSE-Keep-Alive', output_index: 0, delta: 'legitimate' },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: { type: 'message', id: 'SSE-Keep-Alive' }
          }
        ]).doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
      ).stream
    )

    expect(chunks.filter((chunk) => chunk.type === 'text-delta')).toEqual([
      { type: 'text-delta', id: 'SSE-Keep-Alive', delta: 'legitimate' }
    ])
  })

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
