import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

/**
 * A replayed tool call must not carry the item id it was received with. `id` names an
 * object the server stored; we always send `store: false`, so nothing is stored and the
 * id is meaningless. Relays that synthesize their own item ids (UUIDs rather than `fc_…`)
 * used to poison a topic permanently: the bad id lived in the persisted history and every
 * later turn replayed it, so strict channels answered 400 until the topic was abandoned.
 * `call_id` alone pairs the call with its output. Fixed upstream in @ai-sdk/openai 3.0.73.
 */
describe('@ai-sdk/openai replayed tool calls', () => {
  it('pairs by call_id and drops the received item id', async () => {
    let body: any
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            created_at: 0,
            model: 'm',
            status: 'completed',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    }).responses('gpt-5.6')

    await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_abc',
              toolName: 'search',
              input: { query: 'weather' },
              // what a relay handed us on the previous turn
              providerOptions: { openai: { itemId: 'bda7112f-9c3e-4a1d-8f52-1e0d6b7a4c99' } }
            }
          ]
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_abc',
              toolName: 'search',
              output: { type: 'text', value: 'sunny' }
            }
          ]
        }
      ],
      tools: [{ type: 'function', name: 'search', inputSchema: { type: 'object', properties: {} } }],
      providerOptions: { openai: { store: false } }
    })

    const call = body.input.find((item: any) => item.type === 'function_call')
    expect(call).toMatchObject({ call_id: 'call_abc', name: 'search' })
    expect(call).not.toHaveProperty('id')
    expect(body.input.find((item: any) => item.type === 'function_call_output')).toMatchObject({ call_id: 'call_abc' })
  })
})
