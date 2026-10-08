import { createOpenAI } from '@ai-sdk/openai'
import { Output } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { definePlugin } from '../../plugins'
import { RuntimeExecutor } from '../executor'

// These exercise the SDK and provider serializer: a mocked generateText cannot detect v7 contract changes.
describe('RuntimeExecutor.generateText provider boundary', () => {
  it('applies plugin order and middleware to the wire request and validates structured output', async () => {
    let body: Record<string, any> | undefined
    const provider = createOpenAI({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return Response.json({
          id: 'chat-1',
          model: 'gpt-4o',
          created: 0,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"answer":42}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        })
      }
    })
    const executor = RuntimeExecutor.create(
      'openai',
      provider,
      {},
      [
        definePlugin({
          name: 'suffix',
          transformParams: (params: any) => ({ ...params, instructions: `${params.instructions} Then answer.` })
        }),
        definePlugin({
          name: 'prefix',
          enforce: 'pre',
          transformParams: (params: any) => ({ ...params, instructions: `Read carefully. ${params.instructions}` })
        }),
        definePlugin({
          name: 'sampling',
          configureContext: (context) => {
            context.middlewares = [
              { specificationVersion: 'v4', transformParams: async ({ params }) => ({ ...params, temperature: 0.25 }) }
            ]
          }
        })
      ],
      (id) => provider.chat(id)
    )
    const result = await executor.generateText({
      model: 'gpt-4o',
      instructions: 'Use JSON.',
      prompt: 'What is the answer?',
      maxOutputTokens: 100,
      output: Output.object({ schema: z.object({ answer: z.number() }) })
    })
    expect(result.output).toEqual({ answer: 42 })
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    expect(body).toMatchObject({
      model: 'gpt-4o',
      temperature: 0.25,
      max_tokens: 100,
      messages: [
        { role: 'system', content: 'Read carefully. Use JSON. Then answer.' },
        { role: 'user', content: 'What is the answer?' }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { strict: true, schema: { type: 'object', required: ['answer'] } }
      }
    })
  })

  it('rejects invalid structured output from a successful provider response', async () => {
    const provider = createOpenAI({
      apiKey: 'test',
      fetch: async () =>
        Response.json({
          id: 'chat-2',
          model: 'gpt-4o',
          created: 0,
          choices: [
            { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"answer":"wrong type"}' } }
          ]
        })
    })
    const executor = RuntimeExecutor.create('openai', provider, {})
    await expect(
      executor.generateText({
        model: provider.chat('gpt-4o'),
        prompt: 'Answer.',
        output: Output.object({ schema: z.object({ answer: z.number() }) })
      })
    ).rejects.toThrow('No object generated')
  })

  it('propagates an HTTP failure to the caller and error observers without a completion event', async () => {
    const events: string[] = []
    const provider = createOpenAI({
      apiKey: 'test',
      fetch: async () => Response.json({ error: { message: 'Denied' } }, { status: 403 })
    })
    const executor = RuntimeExecutor.create('openai', provider, {}, [
      definePlugin({
        name: 'observe',
        onError: () => {
          events.push('error')
        },
        onRequestEnd: () => {
          events.push('completed')
        }
      })
    ])
    await expect(
      executor.generateText({ model: provider.chat('gpt-4o'), prompt: 'Hello', maxRetries: 0 })
    ).rejects.toThrow('Denied')
    expect(events).toEqual(['error'])
  })
})
