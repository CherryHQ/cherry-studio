import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

import { definePlugin } from '../../plugins'
import { RuntimeExecutor } from '../executor'

describe('RuntimeExecutor.streamText provider boundary', () => {
  it('streams provider chunks in order and retains final usage through V4 middleware', async () => {
    let body: Record<string, any> | undefined
    const provider = createOpenAI({
      apiKey: 'test',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        const chunks = ['Hello', ' world'].map((content) => ({
          id: 'chat-1',
          model: 'gpt-4o',
          created: 0,
          choices: [{ index: 0, delta: { content }, finish_reason: null }]
        }))
        return new Response(
          [
            ...chunks,
            {
              id: 'chat-1',
              model: 'gpt-4o',
              created: 0,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
            }
          ]
            .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
            .join('') + 'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } }
        )
      }
    })
    const executor = RuntimeExecutor.create(
      'openai',
      provider,
      {},
      [
        definePlugin({
          name: 'sampling',
          configureContext: (context) => {
            context.middlewares = [
              { specificationVersion: 'v4', transformParams: async ({ params }) => ({ ...params, temperature: 0.4 }) }
            ]
          }
        })
      ],
      (id) => provider.chat(id)
    )
    const result = await executor.streamText({ model: 'gpt-4o', instructions: 'Be concise.', prompt: 'Hello.' })
    const chunks: string[] = []
    for await (const chunk of result.textStream) chunks.push(chunk)
    expect(chunks).toEqual(['Hello', ' world'])
    expect(await result.text).toBe('Hello world')
    expect(await result.usage).toMatchObject({ inputTokens: 4, outputTokens: 2, totalTokens: 6 })
    expect(body).toMatchObject({
      stream: true,
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hello.' }
      ]
    })
  })
})
