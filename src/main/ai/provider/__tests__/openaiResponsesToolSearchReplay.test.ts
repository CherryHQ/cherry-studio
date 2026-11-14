import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

/**
 * A tool we declare as a plain function must replay as a function call even when its name
 * matches a hosted provider tool. `tool_search` is our own meta-tool (see
 * `ai/tools/adapters/aiSdk/meta/toolSearch.ts`), and @ai-sdk/openai used to special-case
 * Responses history by name alone: every replayed `tool_search` call became a
 * provider-executed item with `call_id: null` and its arguments dropped, while the text
 * result kept the real call id. DeepSeek answered those turns with
 * `400 input: invalid type: null, expected a string` (#22433). Fixed upstream in
 * @ai-sdk/openai 3.0.104.
 */
describe('@ai-sdk/openai replayed tool_search function calls', () => {
  it('preserves function identity, arguments, and the paired text result', async () => {
    let body: any
    const provider = createOpenAI({
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
    })
    const model = provider.responses('deepseek-flash')

    await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'find a tool' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_01_probe',
              toolName: 'tool_search',
              input: { query: 'gmail' }
            }
          ]
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_01_probe',
              toolName: 'tool_search',
              output: { type: 'text', value: 'fixture search result' }
            }
          ]
        }
      ],
      tools: [
        {
          type: 'function',
          name: 'tool_search',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
        }
      ],
      providerOptions: { openai: { store: false } }
    })

    const calls = body.input.filter((item: any) => item.type === 'function_call')
    expect(calls, '#22433: replay must contain exactly one client function call').toHaveLength(1)
    expect(calls[0], '#22433: replay must preserve the function name and call_id').toMatchObject({
      name: 'tool_search',
      call_id: 'call_01_probe'
    })
    expect(JSON.parse(calls[0].arguments), '#22433: replay must preserve the function arguments').toEqual({
      query: 'gmail'
    })

    const outputs = body.input.filter((item: any) => item.type === 'function_call_output')
    expect(outputs, '#22433: replay must contain exactly one client function result').toHaveLength(1)
    expect(outputs[0], '#22433: replay must pair the text result with the original call_id').toMatchObject({
      call_id: 'call_01_probe',
      output: 'fixture search result'
    })
    expect(
      body.input.filter((item: any) => item.type === 'tool_search_call' || item.type === 'tool_search_output'),
      '#22433: a client function must not replay as hosted tool_search items'
    ).toEqual([])
  })
})
