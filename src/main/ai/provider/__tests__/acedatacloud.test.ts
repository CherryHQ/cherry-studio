import { resolve } from 'node:path'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, streamText, tool } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { readProviderRegistry } from '@cherrystudio/provider-registry/node'
import { formatApiHost } from '@shared/utils/api'

import { OpenAIModelsResponseSchema } from '../listModelsSchemas'

const registryPath = resolve(__dirname, '../../../../../packages/provider-registry/data/providers.json')
const provider = readProviderRegistry(registryPath).providers.find(({ id }) => id === 'acedatacloud')!
const baseURL = formatApiHost(provider.endpointConfigs?.['openai-chat-completions']?.baseUrl)

describe('Ace Data Cloud preset transport', () => {
  it('discovers models at the documented path without adding a v1 segment', () => {
    const url = `${baseURL}/models`
    expect(url).toBe('https://api.acedata.cloud/openai/models')
    expect(provider.modelListSource).toBe('api')
    expect(provider.authOptional).toBe(false)

    const result = OpenAIModelsResponseSchema.parse({
      object: 'list',
      data: [
        { id: 'gpt-4.1-mini', object: 'model', owned_by: 'acedatacloud' },
        { id: 'newly-published-model', object: 'model', owned_by: 'acedatacloud' }
      ]
    })
    expect(result.data.map(({ id }) => id)).toEqual(['gpt-4.1-mini', 'newly-published-model'])
  })

  it('uses the standard compatible SDK for streaming tools and tool-result continuation', async () => {
    const requests: Array<{
      url: string
      headers: Headers
      body: { model: string; tools?: Array<{ function: { name: string } }>; messages: unknown[] }
    }> = []
    const client = createOpenAICompatible({
      name: provider.id,
      baseURL,
      apiKey: 'test-acedatacloud-key',
      fetch: async (input, init) => {
        const body = JSON.parse(init?.body as string)
        requests.push({ url: String(input), headers: new Headers(init?.headers), body })
        if (body.stream) {
          const chunks = [
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      { index: 0, id: 'call_add', type: 'function', function: { name: 'add', arguments: '{"a":19,' } }
                    ]
                  },
                  finish_reason: null
                }
              ]
            },
            {
              choices: [
                {
                  index: 0,
                  delta: { tool_calls: [{ index: 0, function: { arguments: '"b":23}' } }] },
                  finish_reason: null
                }
              ]
            },
            { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
          ]
          return new Response(
            chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
            {
              headers: { 'content-type': 'text/event-stream' }
            }
          )
        }
        return Response.json({
          id: 'chatcmpl-ace',
          object: 'chat.completion',
          created: 1700000000,
          model: 'gpt-4.1-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: '42' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 48, completion_tokens: 5, total_tokens: 53 }
        })
      }
    })
    const model = client('gpt-4.1-mini')
    const prompt = 'Use add to calculate 19 plus 23.'
    const stream = streamText({
      model,
      prompt,
      maxRetries: 0,
      tools: {
        add: tool({
          description: 'Add two integers',
          inputSchema: z.object({ a: z.number().int(), b: z.number().int() }),
          execute: async ({ a, b }) => a + b
        })
      },
      toolChoice: { type: 'tool', toolName: 'add' }
    })
    await stream.consumeStream()
    expect((await stream.toolResults)[0]?.output).toBe(42)
    const response = await stream.response
    const result = await generateText({
      model,
      messages: [{ role: 'user', content: prompt }, ...response.messages],
      maxRetries: 0
    })

    expect(result.text).toBe('42')
    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.url).toBe('https://api.acedata.cloud/openai/chat/completions')
      expect(request.headers.get('authorization')).toBe('Bearer test-acedatacloud-key')
      expect(request.body.model).toBe('gpt-4.1-mini')
    }
    expect(requests[0].body.tools?.[0].function.name).toBe('add')
    expect(requests[1].body.messages).toContainEqual({ role: 'tool', tool_call_id: 'call_add', content: '42' })
  })
})
