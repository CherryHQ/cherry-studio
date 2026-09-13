import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

const prompt: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'Think before answering.' }] }
]

// Guards patches/@ai-sdk__openai@3.0.109.patch. DeepSeek's Responses API emits
// response.reasoning_text.delta rather than OpenAI's reasoning summary delta event.
describe('patched @ai-sdk/openai Responses model capabilities', () => {
  it('does not send the Codex-only ultra effort to standard OpenAI Astra', async () => {
    let requestBody: { reasoning?: { effort?: string } } = {}
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://api.openai.com/v1',
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            created_at: 0,
            model: 'gpt-6-astra',
            status: 'completed',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
    }).responses('gpt-6-astra')

    const result = await model.doGenerate({
      prompt,
      providerOptions: { openai: { reasoningEffort: 'ultra' } }
    })

    expect(requestBody.reasoning?.effort).toBeUndefined()
    expect(result.warnings).toContainEqual(expect.objectContaining({ type: 'unsupported', feature: 'reasoningEffort' }))
  })
})

// Without the patch, the SDK accepts the event as an unknown chunk and silently
// drops the reasoning text before it reaches Cherry Studio's stream pipeline.
describe('patched @ai-sdk/openai Responses reasoning parser', () => {
  it('replays item-backed raw reasoning content when store is false', async () => {
    let requestBody: any
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            created_at: 0,
            model: 'deepseek-v4-flash',
            status: 'completed',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
    }).responses('deepseek-v4-flash')

    await model.doGenerate({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'First step',
              providerOptions: { openai: { itemId: 'reasoning-item', rawReasoningContent: true } }
            }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: 'Continue.' }] }
      ],
      providerOptions: { openai: { store: false } }
    })

    expect(requestBody.input).toContainEqual({
      type: 'reasoning',
      summary: [],
      content: [{ type: 'reasoning_text', text: 'First step' }]
    })
  })

  it('normalizes response.reasoning_text.delta into reasoning stream parts', async () => {
    const events = [
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'reasoning', id: 'reasoning-item', encrypted_content: null }
      },
      { type: 'response.reasoning_text.delta', item_id: 'reasoning-item', delta: 'First ' },
      { type: 'response.reasoning_text.delta', item_id: 'reasoning-item', delta: 'step' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'reasoning', id: 'reasoning-item', encrypted_content: null }
      },
      {
        type: 'response.completed',
        response: {
          incomplete_details: null,
          service_tier: null,
          usage: {
            input_tokens: 3,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 2,
            output_tokens_details: { reasoning_tokens: 2 }
          }
        }
      }
    ]
    const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }).responses('deepseek-v4-flash')

    const result = await model.doStream({ prompt })
    const reader = result.stream.getReader()
    const chunks: LanguageModelV3StreamPart[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const reasoningChunks: Array<
      { type: 'reasoning-start' | 'reasoning-end'; id: string } | { type: 'reasoning-delta'; id: string; delta: string }
    > = []
    for (const chunk of chunks) {
      switch (chunk.type) {
        case 'reasoning-start':
        case 'reasoning-end':
          reasoningChunks.push({ type: chunk.type, id: chunk.id })
          break
        case 'reasoning-delta':
          reasoningChunks.push({ type: chunk.type, id: chunk.id, delta: chunk.delta })
          break
      }
    }

    expect(reasoningChunks).toEqual([
      { type: 'reasoning-start', id: 'reasoning-item:0' },
      { type: 'reasoning-delta', id: 'reasoning-item:0', delta: 'First ' },
      { type: 'reasoning-delta', id: 'reasoning-item:0', delta: 'step' },
      { type: 'reasoning-end', id: 'reasoning-item:0' }
    ])
  })
})
