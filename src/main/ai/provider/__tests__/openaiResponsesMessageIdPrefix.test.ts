import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

/**
 * Guards the assistant message-id hunk in patches/@ai-sdk__openai@3.0.109.patch (#20237).
 *
 * Contract: Responses message item ids from OpenAI start with `msg_`. Compatible gateways
 * may return a non-empty UUID instead. Inbound parsing must accept that id, but with
 * `store: false` replaying it as assistant input `id` makes strict providers answer
 * `Invalid 'id': message id must be a string starting with 'msg_'` and poison the topic.
 * Only `msg_`-prefixed ids are forwarded when store is false. store:true still replays
 * the original id as an item reference.
 */
describe('patched @ai-sdk/openai responses message ids', () => {
  const uuidItemId = 'bda7112f-9c3e-4a1d-8f52-1e0d6b7a4c99'

  async function captureInput(itemId: string | undefined, store: boolean) {
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
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'hello',
              ...(itemId != null ? { providerOptions: { openai: { itemId } } } : {})
            }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: 'again' }] }
      ],
      providerOptions: { openai: { store } }
    })

    return body.input
  }

  async function captureAssistantInput(itemId: string | undefined) {
    const input = await captureInput(itemId, false)
    return input.filter((item: any) => item.role === 'assistant')
  }

  it('keeps a non-msg_ prior message id on store:true replay', async () => {
    const input = await captureInput(uuidItemId, true)

    expect(input).toContainEqual({ type: 'item_reference', id: uuidItemId })
    expect(input.filter((item: any) => item.role === 'assistant')).toEqual([])
  })

  it('omits a UUID-shaped prior message id on store:false replay', async () => {
    const assistantItems = await captureAssistantInput(uuidItemId)

    expect(assistantItems).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hello' }],
        id: undefined,
        status: 'completed'
      }
    ])
  })

  it('keeps a msg_-prefixed prior message id on store:false replay', async () => {
    const assistantItems = await captureAssistantInput('msg_abc123')

    expect(assistantItems).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hello' }],
        id: 'msg_abc123',
        status: 'completed'
      }
    ])
  })

  it('parses a 200 whose message item id is UUID-shaped', async () => {
    const body = {
      id: 'resp_1',
      created_at: 0,
      model: 'm',
      object: 'response',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          id: uuidItemId,
          status: 'completed',
          content: [{ type: 'output_text', text: 'Hello from a gateway' }]
        }
      ],
      usage: { input_tokens: 1, output_tokens: 4, total_tokens: 5 }
    }
    const model = createOpenAI({
      apiKey: 'test',
      fetch: async () =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }).responses('gateway-model')

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    })

    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Hello from a gateway',
        providerMetadata: { openai: { itemId: uuidItemId } }
      }
    ])
  })
})
