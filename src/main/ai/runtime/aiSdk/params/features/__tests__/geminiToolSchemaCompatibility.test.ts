import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { generateText, tool, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { geminiToolSchemaCompatibilityFeature } from '../geminiToolSchemaCompatibility'

async function getMiddleware(): Promise<LanguageModelMiddleware> {
  const [plugin] = geminiToolSchemaCompatibilityFeature.contributeModelAdapters!({} as never)
  if (!plugin) throw new Error('Gemini tool-schema compatibility plugin was not contributed')

  const context = { middlewares: [] as LanguageModelMiddleware[] }
  await plugin.configureContext?.(context as never)
  expect(context.middlewares).toHaveLength(1)
  return context.middlewares[0]
}

async function transform(params: LanguageModelV3CallOptions): Promise<LanguageModelV3CallOptions> {
  const middleware = await getMiddleware()
  return middleware.transformParams!({
    params,
    type: 'generate',
    model: {} as never
  })
}

describe('geminiToolSchemaCompatibilityFeature', () => {
  it('removes only a function tool input schema root $schema without mutating the source', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'lookup',
          description: 'Look up a value',
          strict: true,
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              $schema: { type: 'string' },
              query: { type: 'string' }
            },
            required: ['$schema', 'query'],
            additionalProperties: false
          }
        }
      ]
    }

    const originalTool = params.tools![0]
    if (originalTool.type !== 'function') throw new Error('expected a function tool fixture')

    const result = await transform(params)
    const transformedTool = result.tools?.[0]
    if (transformedTool?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformedTool.inputSchema.$schema).toBeUndefined()
    expect(transformedTool.inputSchema.properties?.['$schema']).toEqual({ type: 'string' })
    expect(transformedTool.inputSchema).toMatchObject({
      type: 'object',
      required: ['$schema', 'query'],
      additionalProperties: false
    })
    expect(transformedTool).toMatchObject({
      name: 'lookup',
      description: 'Look up a value',
      strict: true
    })

    expect(result).not.toBe(params)
    expect(transformedTool).not.toBe(originalTool)
    expect(transformedTool.inputSchema).not.toBe(originalTool.inputSchema)
    expect(originalTool.inputSchema.$schema).toBe('http://json-schema.org/draft-07/schema#')
  })

  it('is a reference-preserving no-op when no function tool has a root $schema', async () => {
    const withoutTools: LanguageModelV3CallOptions = { prompt: [] }
    expect(await transform(withoutTools)).toBe(withoutTools)

    const cleanTools: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'lookup',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
        },
        {
          type: 'provider',
          id: 'google.search',
          name: 'search',
          args: { mode: 'auto' }
        }
      ]
    }
    expect(await transform(cleanTools)).toBe(cleanTools)
  })

  it.each([
    {
      adapter: 'openai-compatible',
      createModel: (fetch: typeof globalThis.fetch) =>
        createOpenAICompatible({
          name: 'gemini-proxy',
          apiKey: 'test-key',
          baseURL: 'https://example.invalid/v1',
          fetch
        })('gemini-3.5-flash-lite')
    },
    {
      adapter: 'openai-chat',
      createModel: (fetch: typeof globalThis.fetch) =>
        createOpenAI({
          apiKey: 'test-key',
          baseURL: 'https://example.invalid/v1',
          fetch
        }).chat('gemini-3.5-flash-lite')
    }
  ])('removes root schema metadata from the final $adapter request body', async ({ createModel }) => {
    let capturedBody: unknown
    const captureFetch: typeof globalThis.fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: 'captured' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    }

    const middleware = await getMiddleware()
    const model = wrapLanguageModel({ model: createModel(captureFetch), middleware })

    await expect(
      generateText({
        model,
        prompt: 'hello',
        tools: {
          lookup: tool({
            description: 'Look up a value',
            inputSchema: z.object({ query: z.string() })
          })
        }
      })
    ).rejects.toBeDefined()

    const parameters = (
      capturedBody as {
        tools: Array<{ function: { parameters: Record<string, unknown> } }>
      }
    ).tools[0].function.parameters

    expect(parameters.$schema).toBeUndefined()
    expect(parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false
    })
  })
})
