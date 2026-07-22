import { APICallError, type LanguageModelV3CallOptions, type LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { PerplexityAgentLanguageModel } from '../../perplexity/PerplexityAgentLanguageModel'
import { perplexityAgentEventSchema } from '../../perplexity/perplexityAgentSchemas'

const config = (fetch: typeof globalThis.fetch) => ({
  baseURL: 'https://api.perplexity.ai',
  headers: () => ({ Authorization: 'Bearer sk-test' }),
  fetch
})

const options: LanguageModelV3CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Q' }] }]
}

const serverToolOptions: LanguageModelV3CallOptions = {
  ...options,
  tools: [{ type: 'provider', name: 'webSearch', id: 'perplexity.web_search', args: {} }]
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
  it('accepts unknown event types without letting them mask malformed known events', () => {
    expect(perplexityAgentEventSchema.safeParse({ type: 'response.content_part.added', future: true }).success).toBe(
      true
    )
    expect(perplexityAgentEventSchema.safeParse({ type: 'response.output_text.delta', item_id: 'm1' }).success).toBe(
      false
    )
  })

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
                {
                  type: 'output_text',
                  text: 'Answer',
                  annotations: [
                    { type: 'citation', url: 'https://c.com' },
                    { type: 'url_citation', url: 'https://u.com', title: 'U' }
                  ]
                }
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
    expect(sources.map((s) => (s as { url: string }).url).sort()).toEqual([
      'https://c.com',
      'https://s.com',
      'https://u.com'
    ])
    expect(result.finishReason.unified).toBe('stop')
    expect(result.usage.outputTokens.total).toBe(2)
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolName: 'webSearch',
        providerExecuted: true,
        dynamic: true
      })
    )
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: 'tool-result',
        toolName: 'webSearch',
        dynamic: true,
        result: { type: 'search_results', results: [{ url: 'https://s.com', title: 'S' }, { url: 'https://c.com' }] }
      })
    )
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
            type: 'response.output_item.done',
            item: {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Hello',
                  annotations: [{ type: 'citation', url: 'https://citation.example', title: 'Citation' }]
                }
              ]
            }
          },
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
    expect(parts).toContainEqual(
      expect.objectContaining({ type: 'source', url: 'https://citation.example', title: 'Citation' })
    )
    expect(
      parts
        .filter((p) => p.type === 'text-delta')
        .map((p) => (p as { delta: string }).delta)
        .join('')
    ).toBe('Hello')

    const finish = parts.find((p) => p.type === 'finish')
    expect(finish).toMatchObject({ finishReason: { unified: 'stop' }, usage: { inputTokens: { total: 3 } } })
  })

  it('non-streaming: preserves the incomplete reason as the length finish reason', async () => {
    const model = new PerplexityAgentLanguageModel(
      'anthropic/claude-sonnet-5',
      config(
        jsonFetch({
          id: 'r1',
          status: 'incomplete',
          model: 'anthropic/claude-sonnet-5',
          output: [],
          incomplete_details: { reason: 'max_output_tokens' }
        })
      )
    )

    const result = await model.doGenerate(options)

    expect(result.content).toEqual([])
    expect(result.finishReason).toEqual({ unified: 'length', raw: 'max_output_tokens' })
  })

  it('streaming: handles response.incomplete and preserves max_output_tokens', async () => {
    const model = new PerplexityAgentLanguageModel(
      'anthropic/claude-sonnet-5',
      config(
        sseFetch([
          { type: 'response.created', response: { id: 'r1', model: 'anthropic/claude-sonnet-5' } },
          {
            type: 'response.incomplete',
            response: {
              id: 'r1',
              status: 'incomplete',
              output: [],
              usage: null,
              incomplete_details: { reason: 'max_output_tokens' }
            }
          }
        ])
      )
    )

    const { stream } = await model.doStream(options)
    const parts = await collect(stream)

    expect(parts.find((part) => part.type === 'finish')).toMatchObject({
      finishReason: { unified: 'length', raw: 'max_output_tokens' }
    })
  })

  it('non-streaming: maps function_call output to an AI SDK tool call', async () => {
    const model = new PerplexityAgentLanguageModel(
      'openai/gpt-5.6-sol',
      config(
        jsonFetch({
          id: 'r1',
          status: 'completed',
          model: 'openai/gpt-5.6-sol',
          output: [
            {
              type: 'function_call',
              id: 'fc-1',
              status: 'completed',
              name: 'lookup_order',
              call_id: 'call-1',
              arguments: '{"orderId":"ORD-1"}',
              thought_signature: 'sig-1'
            }
          ]
        })
      )
    )

    const result = await model.doGenerate(options)

    expect(result.content).toContainEqual({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'lookup_order',
      input: '{"orderId":"ORD-1"}',
      providerMetadata: { perplexity: { itemId: 'fc-1', thoughtSignature: 'sig-1' } }
    })
    expect(result.finishReason).toEqual({ unified: 'tool-calls', raw: undefined })
  })

  it('streaming: maps output-item lifecycle to AI SDK tool input and tool-call parts', async () => {
    const functionCall = {
      type: 'function_call',
      id: 'fc-1',
      status: 'completed',
      name: 'lookup_order',
      call_id: 'call-1',
      arguments: '{"orderId":"ORD-1"}',
      thought_signature: 'sig-1'
    }
    const model = new PerplexityAgentLanguageModel(
      'openai/gpt-5.6-sol',
      config(
        sseFetch([
          { type: 'response.created', response: { id: 'r1', model: 'openai/gpt-5.6-sol' } },
          { type: 'response.output_item.added', output_index: 0, item: functionCall },
          { type: 'response.output_item.done', output_index: 0, item: functionCall },
          {
            type: 'response.completed',
            response: { id: 'r1', status: 'completed', output: [functionCall], usage: { input_tokens: 3 } }
          }
        ])
      )
    )

    const { stream } = await model.doStream(options)
    const parts = await collect(stream)

    expect(parts).toContainEqual({ type: 'tool-input-start', id: 'call-1', toolName: 'lookup_order' })
    expect(parts).toContainEqual({ type: 'tool-input-delta', id: 'call-1', delta: '{"orderId":"ORD-1"}' })
    expect(parts).toContainEqual({ type: 'tool-input-end', id: 'call-1' })
    expect(parts).toContainEqual({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'lookup_order',
      input: '{"orderId":"ORD-1"}',
      providerMetadata: { perplexity: { itemId: 'fc-1', thoughtSignature: 'sig-1' } }
    })
    expect(parts.filter((part) => part.type === 'tool-call')).toHaveLength(1)
    expect(parts.find((part) => part.type === 'finish')).toMatchObject({
      finishReason: { unified: 'tool-calls', raw: 'function_call' }
    })
  })

  it('streaming: emits a provider-executed server-tool call/result once and preserves the raw output item', async () => {
    const searchResults = {
      type: 'search_results',
      queries: ['latest AI news'],
      results: [{ url: 'https://example.com', title: 'Example', snippet: 'News', rank: 1 }],
      request_id: 'search-1'
    }
    const model = new PerplexityAgentLanguageModel(
      'openai/gpt-5.6-sol',
      config(
        sseFetch([
          { type: 'response.created', response: { id: 'r1', model: 'openai/gpt-5.6-sol' } },
          { type: 'response.output_item.done', output_index: 0, item: searchResults },
          {
            type: 'response.completed',
            response: { id: 'r1', status: 'completed', output: [searchResults], usage: { input_tokens: 3 } }
          }
        ])
      )
    )

    const { stream } = await model.doStream(serverToolOptions)
    const parts = await collect(stream)

    expect(parts).toContainEqual({
      type: 'tool-call',
      toolCallId: 'r1:search_results:0',
      toolName: 'webSearch',
      input: '{}',
      providerExecuted: true,
      providerMetadata: { perplexity: { serverToolType: 'search_results' } }
    })
    expect(parts).toContainEqual({
      type: 'tool-result',
      toolCallId: 'r1:search_results:0',
      toolName: 'webSearch',
      result: searchResults,
      providerMetadata: { perplexity: { serverToolType: 'search_results' } }
    })
    expect(parts.filter((part) => part.type === 'tool-call')).toHaveLength(1)
    expect(parts.filter((part) => part.type === 'tool-result')).toHaveLength(1)
    expect(parts).toContainEqual(expect.objectContaining({ type: 'source', url: 'https://example.com' }))
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
