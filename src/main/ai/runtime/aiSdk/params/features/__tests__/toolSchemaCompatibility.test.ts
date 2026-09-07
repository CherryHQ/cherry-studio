import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { readFileInputSchema } from '@shared/ai/builtinTools'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { LanguageModelMiddleware } from 'ai'
import { generateText, tool, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { toolSchemaCompatibilityFeature } from '../toolSchemaCompatibility'

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

async function transform(
  params: LanguageModelV3CallOptions,
  scope: { aiSdkProviderId?: string; endpointType?: EndpointType; runtimeProviderId?: string } = {}
): Promise<LanguageModelV3CallOptions> {
  const middleware = await getMiddleware(scope)
  return middleware.transformParams!({ params, type: 'generate', model: {} as never })
}

describe('toolSchemaCompatibilityFeature', () => {
  it('strips unsupported validation keywords from nested strict schemas without mutating the source', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'lookup',
          strict: true,
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', minLength: 1, pattern: '^.+$', description: 'q' },
              offset: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
              tags: { type: 'array', minItems: 1, items: { type: 'string', maxLength: 8 } },
              mode: {
                anyOf: [
                  { type: 'string', enum: ['a', 'b'] },
                  { type: 'number', multipleOf: 2 }
                ]
              }
            },
            required: ['query', 'offset'],
            additionalProperties: false
          }
        }
      ]
    }
    const originalTool = params.tools![0]
    if (originalTool.type !== 'function') throw new Error('expected a function tool fixture')

    const result = await transform(params)
    const transformed = result.tools?.[0]
    if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformed.inputSchema).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'q' },
        offset: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
        mode: { anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'number' }] }
      },
      required: ['query', 'offset'],
      additionalProperties: false
    })
    expect(originalTool.inputSchema.properties).toMatchObject({ offset: { type: 'integer', minimum: 0 } })
  })

  it('keeps a property that is named like a keyword', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'range',
          strict: true,
          inputSchema: {
            type: 'object',
            properties: { minimum: { type: 'integer', minimum: 0 }, pattern: { type: 'string' } },
            required: ['minimum', 'pattern']
          }
        }
      ]
    }

    const transformed = (await transform(params)).tools?.[0]
    if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformed.inputSchema.properties).toEqual({
      minimum: { type: 'integer' },
      pattern: { type: 'string' }
    })
  })

  it('strips the Gemini-rejected keywords from non-strict tools too, and only those (issue #10052)', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'mcp_tool',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              $schema: { type: 'string' },
              ratio: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, multipleOf: 0.1, minimum: 0 },
              ids: { type: 'array', uniqueItems: true, minItems: 1, items: { type: 'string', minLength: 1 } }
            }
          }
        }
      ]
    }

    const transformed = (await transform(params)).tools?.[0]
    if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformed.inputSchema.$schema).toBeUndefined()
    expect(transformed.inputSchema.properties).toEqual({
      // A property named `$schema` is not the dialect keyword; `minimum`/`minItems`/
      // `minLength` are real Gemini Schema fields and only strict mode rejects them.
      $schema: { type: 'string' },
      ratio: { type: 'number', minimum: 0 },
      ids: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } }
    })
  })

  it('drops only tools with untyped array items on the Gemini endpoint', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'calendar_create',
          inputSchema: {
            type: 'object',
            properties: { attendeesToAdd: { type: 'array' } }
          }
        },
        {
          type: 'function',
          name: 'calendar_update',
          inputSchema: {
            type: 'object',
            properties: { reminders: { type: 'array', items: {} } }
          }
        },
        {
          type: 'function',
          name: 'lookup',
          inputSchema: {
            type: 'object',
            properties: { ids: { type: 'array', items: { type: 'string' } } }
          }
        },
        { type: 'provider', id: 'google.search', name: 'search', args: { mode: 'auto' } }
      ]
    }

    const result = await transform(params, {
      aiSdkProviderId: 'google',
      endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    })

    expect(result.tools?.map((tool) => tool.name)).toEqual(['lookup', 'search'])
    expect(params.tools).toHaveLength(4)
  })

  it('keeps boolean-true array items because the Google SDK serializes them with a type', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'accept_any_value',
          inputSchema: {
            type: 'object',
            properties: { values: { type: 'array', items: true } }
          }
        }
      ]
    }

    expect(
      await transform(params, {
        aiSdkProviderId: 'google',
        endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        runtimeProviderId: 'google'
      })
    ).toBe(params)
  })

  it('does not apply Gemini array filtering to Vertex MaaS tools', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'calendar_create',
          inputSchema: { type: 'object', properties: { attendees: { type: 'array' } } }
        }
      ]
    }

    expect(
      await transform(params, {
        aiSdkProviderId: 'google-vertex',
        endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        runtimeProviderId: 'google-vertex-maas'
      })
    ).toBe(params)
  })

  // Keep every schema-bearing traversal route covered, not just properties.
  it.each([
    ['patternProperties', { patternProperties: { nested: { type: 'array' } } }],
    ['$defs', { $defs: { nested: { type: 'array' } } }],
    ['definitions', { definitions: { nested: { type: 'array' } } }],
    ['dependentSchemas', { dependentSchemas: { nested: { type: 'array' } } }],
    ['allOf', { allOf: [{ type: 'array' }] }],
    ['anyOf', { anyOf: [{ type: 'array' }] }],
    ['oneOf', { oneOf: [{ type: 'array' }] }],
    ['prefixItems', { prefixItems: [{ type: 'array' }] }],
    ['items', { items: { type: 'array' } }],
    ['additionalItems', { additionalItems: { type: 'array' } }],
    ['additionalProperties', { additionalProperties: { type: 'array' } }],
    ['contains', { contains: { type: 'array' } }],
    ['propertyNames', { propertyNames: { type: 'array' } }],
    ['not', { not: { type: 'array' } }],
    ['if', { if: { type: 'array' } }],
    ['then', { then: { type: 'array' } }],
    ['else', { else: { type: 'array' } }]
  ] as const)('drops an incompatible array found through %s', async (branchName, branch) => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: `nested_${branchName}`,
          inputSchema: { type: 'object', properties: { nested: branch } } as never
        }
      ]
    }

    const result = await transform(params, {
      aiSdkProviderId: 'google',
      endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    })

    expect(result.tools).toEqual([])
  })

  it('does not drop untyped array tools outside the Gemini endpoint', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'calendar_create',
          inputSchema: { type: 'object', properties: { attendees: { type: 'array' } } }
        }
      ]
    }

    expect(
      await transform(params, {
        aiSdkProviderId: 'anthropic',
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      })
    ).toBe(params)
  })

  it('prevents an item-less array from reaching Google function declarations', async () => {
    let capturedBody: unknown
    const captureFetch: typeof globalThis.fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: 'captured' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    }

    const model = wrapLanguageModel({
      model: createGoogleGenerativeAI({ apiKey: 'test-key', fetch: captureFetch })('gemini-3.5-flash'),
      middleware: await getMiddleware({
        aiSdkProviderId: 'google',
        endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
      })
    })

    await expect(
      generateText({
        model,
        prompt: 'hello',
        tools: {
          malformed: tool({ inputSchema: z.object({ attendees: z.array(z.unknown()) }) }),
          valid: tool({ inputSchema: z.object({ ids: z.array(z.string()) }) })
        }
      })
    ).rejects.toBeDefined()

    const declarations = (
      capturedBody as {
        tools: Array<{
          functionDeclarations: Array<{
            name: string
            parameters: { properties: Record<string, unknown> }
          }>
        }>
      }
    ).tools[0].functionDeclarations
    expect(declarations.map((declaration) => declaration.name)).toEqual(['valid'])
    expect(declarations[0].parameters.properties.ids).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('is a reference-preserving no-op on already-clean schemas', async () => {
    const withoutTools: LanguageModelV3CallOptions = { prompt: [] }
    expect(await transform(withoutTools)).toBe(withoutTools)

    const untouched: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'loose',
          inputSchema: { type: 'object', properties: { n: { type: 'integer', minimum: 0 } } }
        },
        {
          type: 'function',
          name: 'clean',
          strict: true,
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } }
        },
        { type: 'provider', id: 'google.search', name: 'search', args: { mode: 'auto' } }
      ]
    }
    expect(await transform(untouched)).toBe(untouched)
  })

  // Anthropic 400s on the numeric bounds (issue #18037); OpenAI's strict subset
  // rejects minLength/maxLength. Both schemas must go out clean.
  it.each([
    {
      provider: 'anthropic',
      createModel: (fetch: typeof globalThis.fetch) => createAnthropic({ apiKey: 'test-key', fetch })('claude-opus-5'),
      readTool: (body: unknown) => (body as { tools: Array<{ strict?: boolean; input_schema: unknown }> }).tools[0]
    },
    {
      provider: 'openai',
      createModel: (fetch: typeof globalThis.fetch) => createOpenAI({ apiKey: 'test-key', fetch }).chat('gpt-5'),
      readTool: (body: unknown) => {
        const { function: fn } = (body as { tools: Array<{ function: { strict?: boolean; parameters: unknown } }> })
          .tools[0]
        return { strict: fn.strict, input_schema: fn.parameters }
      }
    }
  ])('sends a $provider-acceptable read_file strict schema', async ({ createModel, readTool }) => {
    let capturedBody: unknown
    const captureFetch: typeof globalThis.fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: 'captured' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    }

    const model = wrapLanguageModel({ model: createModel(captureFetch), middleware: await getMiddleware() })

    await expect(
      generateText({
        model,
        prompt: 'hello',
        tools: { read_file: tool({ inputSchema: readFileInputSchema, strict: true }) }
      })
    ).rejects.toBeDefined()

    const sent = readTool(capturedBody)
    expect(sent.strict).toBe(true)
    expect(JSON.stringify(sent.input_schema)).not.toMatch(/"(minimum|maximum|minLength)"/)
  })
})
