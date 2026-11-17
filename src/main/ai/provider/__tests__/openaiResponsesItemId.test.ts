import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

/**
 * Continuation serialization copies `providerOptions.openai.itemId` onto
 * Responses `input[n].id`. Local history and some relays store UUIDs there;
 * the API requires a prefix (`msg_…` / `rs_…`) and 400s otherwise (#20406).
 */
const LOCAL_UUID = '8bfdc98d-13ea-41b8-8825-8a339167ffe8'

async function captureResponsesInput(prompt: LanguageModelV3CallOptions['prompt']) {
  let body: { input: Array<Record<string, unknown>> } | undefined
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
    prompt,
    providerOptions: { openai: { store: false } }
  })
  return body!.input
}

describe('@ai-sdk/openai replayed Responses item ids', () => {
  it('omits a local UUID from message and reasoning item ids', async () => {
    const input = await captureResponsesInput([
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: 'think',
            providerOptions: { openai: { itemId: LOCAL_UUID, reasoningEncryptedContent: 'enc' } }
          },
          {
            type: 'text',
            text: 'Hello',
            providerOptions: { openai: { itemId: LOCAL_UUID } }
          }
        ]
      },
      { role: 'user', content: [{ type: 'text', text: 'Continue' }] }
    ])

    expect(input.map((item) => item.id).filter(Boolean)).not.toContain(LOCAL_UUID)
    expect(input.find((item) => item.type === 'reasoning')).toMatchObject({
      type: 'reasoning',
      encrypted_content: 'enc'
    })
    expect(input.find((item) => item.type === 'reasoning')).not.toHaveProperty('id')
    const message = input.find((item) => item.role === 'assistant')
    expect(message).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello' }]
    })
    expect(message).not.toHaveProperty('id')
  })

  it('round-trips provider-issued msg_ and rs_ ids', async () => {
    const input = await captureResponsesInput([
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: 'think',
            providerOptions: { openai: { itemId: 'rs_abc', reasoningEncryptedContent: 'enc' } }
          },
          {
            type: 'text',
            text: 'Hello',
            providerOptions: { openai: { itemId: 'msg_abc' } }
          }
        ]
      },
      { role: 'user', content: [{ type: 'text', text: 'Continue' }] }
    ])

    expect(input.find((item) => item.type === 'reasoning')).toMatchObject({
      type: 'reasoning',
      id: 'rs_abc',
      encrypted_content: 'enc'
    })
    expect(input.find((item) => item.role === 'assistant')).toMatchObject({
      type: 'message',
      id: 'msg_abc',
      content: [{ type: 'output_text', text: 'Hello' }]
    })
  })
})
