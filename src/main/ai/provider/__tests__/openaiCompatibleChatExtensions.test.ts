import { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const reader = stream.getReader()
  const chunks: LanguageModelV3StreamPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) return chunks
    chunks.push(value)
  }
}

function eventSourceResponse(events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

describe('OpenAI-compatible chat response extensions', () => {
  it('keeps streaming when chunks include citations and search results', async () => {
    const model = new OpenAICompatibleChatLanguageModel('extension-model', {
      provider: 'openai-compatible',
      headers: () => ({}),
      url: ({ path }) => `https://example.com/v1${path}`,
      fetch: async () =>
        eventSourceResponse([
          {
            id: 'chatcmpl-1',
            choices: [{ delta: { role: 'assistant', content: 'hello' }, finish_reason: null }],
            citations: [{ url: 'https://example.com/docs', title: 'Docs' }],
            search_results: [{ title: 'Docs', url: 'https://example.com/docs' }]
          },
          {
            id: 'chatcmpl-1',
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            citations: [],
            search_results: []
          }
        ])
    })

    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    })
    const chunks = await collect(result.stream)

    expect(chunks).toContainEqual({ type: 'text-delta', id: 'txt-0', delta: 'hello' })
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'finish', finishReason: expect.objectContaining({ unified: 'stop' }) })
    )
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false)
  })
})
