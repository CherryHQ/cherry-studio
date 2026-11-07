import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelMiddleware } from 'ai'
import { generateText, jsonSchema, streamText, tool, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { toolSchemaCompatibilityFeature } from '@main/ai/runtime/aiSdk/params/features/toolSchemaCompatibility'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import { AnthropicMessageConverter } from '../converters/AnthropicMessageConverter'

async function getMiddleware(
  scope: { aiSdkProviderId?: string; endpointType?: EndpointType; runtimeProviderId?: string } = {}
): Promise<LanguageModelMiddleware> {
  const [plugin] = toolSchemaCompatibilityFeature.contributeModelAdapters!({
    ...scope,
    sdkConfig: { providerId: scope.runtimeProviderId ?? scope.aiSdkProviderId ?? 'openai-compatible' }
  } as never)
  if (!plugin) throw new Error('Tool-schema compatibility plugin was not contributed')

  const context = { middlewares: [] as LanguageModelMiddleware[] }
  await plugin.configureContext?.(context as never)
  expect(context.middlewares).toHaveLength(1)
  return context.middlewares[0]
}

describe('gateway tool-schema compatibility', () => {
  it.each(['generate', 'stream'] as const)(
    'normalizes gateway-invented empty additionalProperties in OpenAI-compatible %s requests',
    async (mode) => {
      const gatewayTools = new AnthropicMessageConverter().toAiSdkTools({
        model: 'gateway-model',
        max_tokens: 64,
        messages: [],
        tools: [
          {
            name: 'gateway_search',
            description: 'Search',
            input_schema: {
              type: 'object',
              properties: { options: { type: 'object', properties: { query: { type: 'string' } } } },
              required: ['options']
            }
          }
        ]
      })
      const explicitSchema = {
        type: 'object' as const,
        properties: {
          open: { type: 'object' as const, additionalProperties: true },
          closed: { type: 'object' as const, additionalProperties: false },
          typed: { type: 'object' as const, additionalProperties: { type: 'string' as const } }
        },
        additionalProperties: true
      }

      for (const withMiddleware of [false, true]) {
        const bodies: Array<{
          stream?: boolean
          tools: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
        }> = []
        const captureFetch: typeof globalThis.fetch = async (_input, init) => {
          bodies.push(JSON.parse(String(init?.body)))
          const chunk = {
            id: 'capture',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'gateway-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
          }
          return mode === 'stream'
            ? new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
                headers: { 'content-type': 'text/event-stream' }
              })
            : new Response(
                JSON.stringify({
                  id: 'capture',
                  object: 'chat.completion',
                  created: 0,
                  model: 'gateway-model',
                  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
                }),
                { headers: { 'content-type': 'application/json' } }
              )
        }
        const sdkModel = createOpenAICompatible({
          name: 'openai-compatible',
          baseURL: 'https://provider.test/v1',
          fetch: captureFetch
        }).chatModel('gateway-model')
        const model = withMiddleware
          ? wrapLanguageModel({
              model: sdkModel,
              middleware: await getMiddleware({
                aiSdkProviderId: 'openai-compatible',
                endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
              })
            })
          : sdkModel
        const options = {
          model,
          prompt: 'hello',
          maxRetries: 0,
          tools: {
            ...gatewayTools,
            explicit: tool({ description: 'Explicit', inputSchema: jsonSchema(explicitSchema) })
          }
        }

        if (mode === 'stream') {
          const result = streamText(options)
          await result.consumeStream()
          expect(await result.text).toBe('ok')
          expect(await result.finishReason).toBe('stop')
        } else {
          expect((await generateText(options)).text).toBe('ok')
        }

        expect(bodies).toHaveLength(1)
        if (mode === 'stream') expect(bodies[0].stream).toBe(true)
        expect(bodies[0].tools).toEqual([
          {
            type: 'function',
            function: {
              name: 'gateway_search',
              description: 'Search',
              parameters: {
                ...(withMiddleware ? {} : { $schema: 'http://json-schema.org/draft-07/schema#' }),
                type: 'object',
                properties: {
                  options: {
                    type: 'object',
                    properties: { query: { type: 'string' } },
                    ...(withMiddleware ? {} : { additionalProperties: {} })
                  }
                },
                required: ['options'],
                ...(withMiddleware ? {} : { additionalProperties: {} })
              }
            }
          },
          { type: 'function', function: { name: 'explicit', description: 'Explicit', parameters: explicitSchema } }
        ])
      }
    }
  )
})
