import { createOpenAI } from '@ai-sdk/openai'
import { OpenAIResponsesLanguageModel } from '@ai-sdk/openai/internal'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

// Guards the output_item.added function_call hunk in patches/@ai-sdk__openai@3.0.109.patch.
// Volcano Ark omits `arguments` until later streaming events, which otherwise fails SDK schema
// validation and drops the tool call. An SDK upgrade that loses the patch must fail this test.
describe('patched @ai-sdk/openai Responses function call added event', () => {
  it.each([
    { shape: 'Ark without arguments', addedArguments: undefined },
    { shape: 'OpenAI with empty arguments', addedArguments: '' },
    // Custom providers construct the internal bundle's Responses model directly.
    { shape: 'internal Ark without arguments', addedArguments: undefined, internal: true }
  ])('streams a complete tool call for $shape', async ({ addedArguments, internal }) => {
    const input = '{"city":"Beijing"}'
    const events = [
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'get_weather',
          status: 'in_progress',
          ...(addedArguments === undefined ? {} : { arguments: addedArguments })
        }
      },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"city":' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '"Beijing"}' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'get_weather',
          arguments: input,
          status: 'completed'
        }
      },
      { type: 'response.completed', response: { incomplete_details: null, usage: null, service_tier: null } }
    ]
    const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
    const fetch = async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    const model = internal
      ? new OpenAIResponsesLanguageModel('doubao-seed-2-1-pro-260628', {
          provider: 'test.openai-response',
          url: ({ path }) => `https://example.com/v1${path}`,
          headers: () => ({ Authorization: 'Bearer sk-test' }),
          fetch
        })
      : createOpenAI({ apiKey: 'sk-test', baseURL: 'https://example.com/v1', fetch }).responses(
          'doubao-seed-2-1-pro-260628'
        )

    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Weather in Beijing?' }] }]
    })
    const chunks: LanguageModelV3StreamPart[] = []
    for await (const chunk of result.stream) chunks.push(chunk)

    expect(chunks.filter((chunk) => chunk.type === 'error')).toEqual([])
    expect(chunks.filter((chunk) => chunk.type.startsWith('tool-'))).toEqual([
      { type: 'tool-input-start', id: 'call_1', toolName: 'get_weather' },
      { type: 'tool-input-delta', id: 'call_1', delta: '{"city":' },
      { type: 'tool-input-delta', id: 'call_1', delta: '"Beijing"}' },
      { type: 'tool-input-end', id: 'call_1' },
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'get_weather',
        input,
        providerMetadata: { openai: { itemId: 'fc_1' } }
      }
    ])
  })
})
