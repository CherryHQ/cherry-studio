import { APICallError, type LanguageModelV3CallOptions, type LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { PerplexityAgentLanguageModel } from '../../perplexity/perplexityAgentLanguageModel'

const config = (fetch: typeof globalThis.fetch) => ({
  baseURL: 'https://api.perplexity.ai',
  headers: () => ({ Authorization: 'Bearer sk-test' }),
  fetch
})

const options: LanguageModelV3CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Q' }] }]
}

const jsonFetch = (body: unknown): typeof globalThis.fetch =>
  (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    )) as typeof globalThis.fetch

const sseFetch = (events: unknown[]): typeof globalThis.fetch => {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  return (() =>
    Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    )) as typeof globalThis.fetch
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const parts: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

describe('Perplexity Agent response boundary', () => {
  it('non-streaming: maps output_text + annotations + search_results to text and deduped sources', async () => {
    const model = new PerplexityAgentLanguageModel(
      'openai/gpt-5.6-sol',
      config(
        jsonFetch({
          id: 'r1',
          status: 'completed',
          model: 'openai/gpt-5.6-sol',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                { type: 'output_text', text: 'Answer', annotations: [{ type: 'url_citation', url: 'https://c.com' }] }
              ]
            },
            { type: 'search_results', results: [{ url: 'https://s.com', title: 'S' }, { url: 'https://c.com' }] }
          ],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }
        })
      )
    )

    const result = await model.doGenerate(options)
    expect(result.content.find((c) => c.type === 'text')).toMatchObject({ text: 'Answer' })
    const sources = result.content.filter((c) => c.type === 'source')
    // c.com appears in both an annotation and a search result — deduped to one.
    expect(sources.map((s) => (s as { url: string }).url).sort()).toEqual(['https://c.com', 'https://s.com'])
    expect(result.finishReason.unified).toBe('stop')
    expect(result.usage.outputTokens.total).toBe(2)
  })

  it('streaming: emits reasoning, source, text, and finish in order', async () => {
    const model = new PerplexityAgentLanguageModel(
      'openai/gpt-5.6-sol',
      config(
        sseFetch([
          { type: 'response.created', response: { id: 'r1', model: 'openai/gpt-5.6-sol' } },
          { type: 'response.reasoning.started', thought: 'Thinking' },
          {
            type: 'response.reasoning.search_results',
            thought: 'Found',
            results: [{ url: 'https://s.com', title: 'S' }]
          },
          { type: 'response.output_text.delta', item_id: 'm1', delta: 'Hel' },
          { type: 'response.output_text.delta', item_id: 'm1', delta: 'lo' },
          { type: 'response.output_text.done', item_id: 'm1', text: 'Hello' },
          {
            type: 'response.completed',
            response: { id: 'r1', status: 'completed', usage: { input_tokens: 3, output_tokens: 2 } }
          }
        ])
      )
    )

    const { stream } = await model.doStream(options)
    const parts = await collect(stream)
    const types = parts.map((p) => p.type)

    expect(types[0]).toBe('stream-start')
    expect(parts).toContainEqual(
      expect.objectContaining({ type: 'response-metadata', id: 'r1', modelId: 'openai/gpt-5.6-sol' })
    )
    expect(types).toContain('reasoning-start')
    expect(types).toContain('reasoning-end')
    expect(parts.filter((p) => p.type === 'reasoning-delta').map((p) => (p as { delta: string }).delta)).toEqual([
      'Thinking\n',
      'Found\n'
    ])
    expect(parts).toContainEqual(expect.objectContaining({ type: 'source', url: 'https://s.com', title: 'S' }))
    expect(
      parts
        .filter((p) => p.type === 'text-delta')
        .map((p) => (p as { delta: string }).delta)
        .join('')
    ).toBe('Hello')

    const finish = parts.find((p) => p.type === 'finish')
    expect(finish).toMatchObject({ finishReason: { unified: 'stop' }, usage: { inputTokens: { total: 3 } } })
  })

  it('non-streaming: failed status throws an AI SDK APICallError', async () => {
    const model = new PerplexityAgentLanguageModel(
      'perplexity/glm-5.2',
      config(
        jsonFetch({
          id: 'r1',
          status: 'failed',
          model: 'perplexity/glm-5.2',
          error: { message: 'invalid request', code: 'invalid_request', type: 'invalid_request' }
        })
      )
    )
    const err = await model.doGenerate(options).catch((e) => e)
    expect(err).toBeInstanceOf(APICallError)
    expect((err as Error).message).toBe('invalid request')
  })

  it('streaming: response.failed yields an AI SDK error, not a plain object', async () => {
    const model = new PerplexityAgentLanguageModel(
      'perplexity/glm-5.2',
      config(
        sseFetch([
          { type: 'response.created', response: { id: 'r1', model: 'perplexity/glm-5.2' } },
          {
            type: 'response.failed',
            error: { message: 'invalid request', code: 'invalid_request', type: 'invalid_request' }
          }
        ])
      )
    )

    const { stream } = await model.doStream(options)
    const parts = await collect(stream)
    const errorPart = parts.find((p) => p.type === 'error') as { type: 'error'; error: unknown } | undefined
    const error = errorPart?.error

    // Must be a real Error so main/ai/utils/serializeError extracts `.message`
    // instead of String(plainObject) === "[object Object]".
    expect(error).toBeInstanceOf(APICallError)
    expect((error as Error | undefined)?.message).toBe('invalid request')
    expect(parts.find((p) => p.type === 'finish')).toMatchObject({ finishReason: { unified: 'error' } })
  })
})
