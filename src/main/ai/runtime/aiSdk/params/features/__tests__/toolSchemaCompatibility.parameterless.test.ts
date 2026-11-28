/** Regression coverage for root object and parameterless tool-schema normalization (issues #21957, #25073). */
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { JSONSchema7, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { asSchema, generateText, jsonSchema, tool, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createCherryIn } from '@cherrystudio/ai-sdk-provider'
import { createAihubmix } from '@main/ai/provider/custom/aihubmix/aihubmixProvider'
import { createMcpInputSchema } from '@main/ai/tools/adapters/aiSdk/mcpSchema'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'

import { toolSchemaCompatibilityFeature } from '../toolSchemaCompatibility'

async function getMiddleware(
  scope: { aiSdkProviderId?: string; endpointType?: EndpointType; runtimeProviderId?: string } = {}
): Promise<LanguageModelMiddleware> {
  const [plugin] = toolSchemaCompatibilityFeature.contributeModelAdapters!({
    ...scope,
    model: {
      id: 'custom::test-model',
      apiModelId: 'test-model',
      providerId: 'custom',
      name: 'Test Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } satisfies Model,
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

describe('parameterless function-tool schemas', () => {
  it('preserves record key constraints without a model identity on chat and Responses scopes', async () => {
    const inputSchema = await asSchema(z.object({ options: z.record(z.string(), z.string()) })).jsonSchema
    delete inputSchema.$schema
    const original = JSON.parse(JSON.stringify(inputSchema))
    const descriptor = { type: 'function' as const, name: 'map_tool', inputSchema }
    const params: LanguageModelV3CallOptions = { prompt: [], tools: [descriptor] }

    expect(inputSchema.properties?.options).toMatchObject({ propertyNames: { type: 'string' } })
    await expect(transform(params, { endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS })).resolves.toBe(params)
    await expect(transform(params, { endpointType: ENDPOINT_TYPE.OPENAI_RESPONSES })).resolves.toEqual({
      ...params,
      tools: [{ ...descriptor, strict: false }]
    })
    expect(inputSchema).toEqual(original)
  })

  it.each([
    { type: 'object', additionalProperties: false },
    { type: 'object' },
    { type: 'object', additionalProperties: true },
    { type: 'object', additionalProperties: { type: 'string' } }
  ] satisfies JSONSchema7[])('adds only root properties to $type schema %j without mutation', async (inputSchema) => {
    // oxlint-disable-next-line no-restricted-globals -- Isolate synthetic fixture data from later test mutations.
    const original = structuredClone(inputSchema)
    const descriptor = { type: 'function' as const, name: 'parameterless', inputSchema }
    const params: LanguageModelV3CallOptions = { prompt: [], tools: [descriptor] }

    const result = await transform(params)
    const transformed = result.tools?.[0]
    if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformed.inputSchema).toEqual({ ...original, properties: {} })
    expect(transformed.inputSchema).not.toBe(inputSchema)
    expect(transformed).not.toBe(descriptor)
    expect(result).not.toBe(params)
    expect(inputSchema).toEqual(original)
    expect(params).toEqual({ prompt: [], tools: [{ type: 'function', name: 'parameterless', inputSchema: original }] })
    expect(params.tools?.[0]).toBe(descriptor)
    expect(await transform(result)).toBe(result)
  })

  it.each([
    ['empty properties', { type: 'object', properties: {} }],
    ['populated properties', { type: 'object', properties: { q: { type: 'string' } } }],
    ['null properties', { type: 'object', properties: null }],
    ['undefined properties', { type: 'object', properties: undefined }]
  ])('preserves %s by reference without unnecessary cloning', async (_name, inputSchema) => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [{ type: 'function', name: 'untouched', inputSchema: inputSchema as JSONSchema7 }]
    }
    expect(await transform(params)).toBe(params)
  })

  it.each([
    ['empty schema', {}, { type: 'object', properties: {} }],
    [
      'missing type with properties',
      { properties: { q: { type: 'string' } }, required: ['q'] },
      { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
    ],
    ['string', { type: 'string', minLength: 1 }, { type: 'object', properties: {} }],
    ['array', { type: 'array', items: { type: 'string' } }, { type: 'object', properties: {} }],
    ['nullable object', { type: ['object', 'null'] }, { type: 'object', properties: {} }],
    ['non-object type array', { type: ['string', 'number'] }, { type: 'object', properties: {} }],
    ['unresolvable reference', { $ref: '#/$defs/x' }, { type: 'object', properties: {} }],
    [
      'non-object union',
      { anyOf: [{ type: 'string' }, { type: 'number' }], description: 'scalar union' },
      { type: 'object', properties: {}, description: 'scalar union' }
    ],
    [
      'mixed object/scalar union',
      { anyOf: [{ type: 'object' }, { type: 'string' }] },
      { type: 'object', properties: {}, anyOf: [{ type: 'object' }, { type: 'string' }] }
    ],
    [
      'object union without root type',
      {
        anyOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] }
        ]
      },
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        anyOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] }
        ]
      }
    ],
    [
      'oneOf without root type',
      {
        oneOf: [
          { type: 'object', properties: { mode: { const: 'fast' } } },
          { type: 'object', properties: { mode: { const: 'deep' } }, limit: { type: 'integer' } }
        ].map((entry) => ({
          type: 'object',
          properties: 'limit' in entry ? { mode: entry.properties.mode, limit: entry.limit } : entry.properties
        }))
      },
      {
        type: 'object',
        properties: {
          mode: { anyOf: [{ const: 'fast' }, { const: 'deep' }] },
          limit: { type: 'integer' }
        },
        oneOf: [
          { type: 'object', properties: { mode: { const: 'fast' } } },
          { type: 'object', properties: { mode: { const: 'deep' }, limit: { type: 'integer' } } }
        ]
      }
    ],
    [
      'allOf without root type',
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } }
        ]
      },
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } }
        ]
      }
    ],
    ['null schema', null, { type: 'object', properties: {} }],
    ['boolean schema', true, { type: 'object', properties: {} }],
    ['string schema', 'object', { type: 'object', properties: {} }],
    ['array schema', [], { type: 'object', properties: {} }]
  ])('normalizes %s to a valid object root schema without mutating input', async (_name, inputSchema, expected) => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [{ type: 'function', name: 'normalized', inputSchema: inputSchema as JSONSchema7 }]
    }
    const transformed = (await transform(params)).tools?.[0]
    if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformed.inputSchema).toEqual(expected)
    expect(transformed.inputSchema.type).toBe('object')
  })

  it('adds properties only at the explicit object root and preserves all other fields and branches', async () => {
    const inputSchema: JSONSchema7 = {
      type: 'object',
      description: 'root',
      required: ['q'],
      additionalProperties: false,
      anyOf: [{ type: 'object' }, { type: 'object', properties: { q: { type: 'string' } } }]
    }
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [{ type: 'function', name: 'composed', inputSchema }]
    }
    const transformed = (await transform(params)).tools?.[0]
    if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformed.inputSchema).toEqual({ ...inputSchema, properties: {} })
    expect(transformed.inputSchema.anyOf).toBe(inputSchema.anyOf)
    expect(Object.hasOwn(inputSchema, 'properties')).toBe(false)
  })

  it.each([undefined, 'object'] as const)(
    'dereferences a local root $ref (type=%s) while keeping $defs and never mutating the source',
    async (type) => {
      const inputSchema: JSONSchema7 = {
        ...(type ? { type } : {}),
        $ref: '#/$defs/Input',
        $defs: { Input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
      }
      // oxlint-disable-next-line no-restricted-globals -- Isolate synthetic fixture data from later test mutations.
      const original = structuredClone(inputSchema)
      const params: LanguageModelV3CallOptions = {
        prompt: [],
        tools: [{ type: 'function', name: 'lookup', inputSchema }]
      }

      const result = await transform(params)
      const transformed = result.tools?.[0]
      if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

      expect(transformed.inputSchema).toEqual({
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        $defs: original.$defs
      })
      expect(inputSchema).toEqual(original)
    }
  )

  it('resolves chained root $ref and preserves nested $defs references', async () => {
    const inputSchema: JSONSchema7 = {
      $ref: '#/$defs/Alias',
      $defs: {
        Alias: { $ref: '#/$defs/Input' },
        Input: {
          type: 'object',
          properties: { item: { $ref: '#/$defs/Item' } },
          required: ['item']
        },
        Item: { type: 'string' }
      }
    }
    const result = await transform({
      prompt: [],
      tools: [{ type: 'function', name: 'nested_ref', inputSchema }]
    })
    const transformed = result.tools?.[0]
    if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformed.inputSchema).toEqual({
      type: 'object',
      properties: { item: { $ref: '#/$defs/Item' } },
      required: ['item'],
      $defs: inputSchema.$defs
    })
  })

  it.each([
    ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
    ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
  ])('canonicalizes the root on %s while retaining existing endpoint passes', async (endpointType) => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [{ type: 'function', name: 'parameterless', inputSchema: { type: 'object', additionalProperties: false } }]
    }
    const transformed = (await transform(params, { endpointType })).tools?.[0]
    if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformed.inputSchema).toEqual(
      endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
        ? { type: 'object', properties: {} }
        : { type: 'object', additionalProperties: false, properties: {} }
    )
  })

  it('keeps local MCP validation closed or open according to additionalProperties', async () => {
    const closed = createMcpInputSchema({ type: 'object', additionalProperties: false })
    expect(await closed.validate!({})).toMatchObject({ success: true })
    for (const invalid of [{ unexpected: 1 }, [], null, 'x']) {
      expect(await closed.validate!(invalid)).toMatchObject({ success: false })
    }
    const open = createMcpInputSchema({ type: 'object' })
    expect(await open.validate!({ unexpected: 1 })).toMatchObject({ success: true })
  })

  it('sends explicit empty properties through the real MCP wrapper at the OpenAI request boundary', async () => {
    const inputSchema: JSONSchema7 = { type: 'object', additionalProperties: false }
    let capturedBody: unknown
    const captureFetch: typeof globalThis.fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: 'captured' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    }
    const model = wrapLanguageModel({
      model: createOpenAI({ apiKey: 'test-key', fetch: captureFetch }).chat('test-model'),
      middleware: await getMiddleware({ endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS })
    })

    await expect(
      generateText({
        model,
        prompt: 'hello',
        tools: { nexttraceCapabilities: tool({ inputSchema: createMcpInputSchema(inputSchema) }) }
      })
    ).rejects.toBeDefined()

    const sent = (capturedBody as { tools: Array<{ function: { parameters: unknown } }> }).tools[0].function.parameters
    expect(sent).toEqual({ type: 'object', additionalProperties: false, properties: {} })
    expect(inputSchema).toEqual({ type: 'object', additionalProperties: false })
  })

  it('preserves referenced parameters at the Google request boundary', async () => {
    const inputSchema: JSONSchema7 = {
      type: 'object',
      $ref: '#/$defs/Input',
      $defs: { Input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
    }
    let capturedBody: unknown
    const captureFetch: typeof globalThis.fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: 'captured' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    }
    const model = wrapLanguageModel({
      model: createGoogleGenerativeAI({ apiKey: 'x', fetch: captureFetch })('gemini-3.5-flash'),
      middleware: await getMiddleware({
        aiSdkProviderId: 'google',
        endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
      })
    })

    await expect(
      generateText({
        model,
        prompt: 'hello',
        tools: { lookup: tool({ description: 'lookup', inputSchema: createMcpInputSchema(inputSchema) }) }
      })
    ).rejects.toBeDefined()

    const sent = (capturedBody as { tools: Array<{ functionDeclarations: Array<{ parameters: unknown }> }> }).tools[0]
      .functionDeclarations[0].parameters
    expect(sent).toEqual({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] })
  })

  it.each([
    {
      provider: 'anthropic',
      createModel: (fetch: typeof globalThis.fetch) => createAnthropic({ apiKey: 'test-key', fetch })('claude-opus-5')
    },
    {
      provider: 'aihubmix',
      createModel: (fetch: typeof globalThis.fetch) =>
        createAihubmix({ apiKey: 'test-key', baseURL: 'http://127.0.0.1:1', fetch })('claude-sonnet-4-6')
    },
    {
      provider: 'cherryin',
      createModel: (fetch: typeof globalThis.fetch) =>
        createCherryIn({
          apiKey: 'test-key',
          endpointType: 'anthropic',
          anthropicBaseURL: 'http://127.0.0.1:1',
          fetch
        })('anthropic/claude-haiku-5.5')
    }
  ])(
    'always emits input_schema.type === "object" on $provider for non-object and $ref root schemas',
    async ({ provider, createModel }) => {
      let capturedBody: unknown
      const captureFetch: typeof globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ error: { message: 'captured' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      }
      const model = wrapLanguageModel({
        model: createModel(captureFetch),
        middleware: await getMiddleware({
          aiSdkProviderId: provider,
          runtimeProviderId: provider,
          endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
        })
      })

      const mcpRefSchema: JSONSchema7 = {
        $ref: '#/$defs/Input',
        $defs: { Input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
      }

      await expect(
        generateText({
          model,
          prompt: 'hello',
          tools: {
            empty_obj: tool({ inputSchema: jsonSchema({}) }),
            missing_type_props: tool({
              inputSchema: jsonSchema({ properties: { q: { type: 'string' } }, required: ['q'] })
            }),
            scalar_type: tool({ inputSchema: jsonSchema({ type: 'string' }) }),
            mcp_root_ref: tool({ inputSchema: createMcpInputSchema(mcpRefSchema) }),
            root_union: tool({
              inputSchema: jsonSchema({
                anyOf: [
                  { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
                  { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] }
                ]
              })
            }),
            root_oneof: tool({
              inputSchema: jsonSchema({
                oneOf: [
                  { type: 'object', properties: { id: { type: 'string' } } },
                  { type: 'object', properties: { slug: { type: 'string' } } }
                ]
              })
            }),
            root_allof: tool({
              inputSchema: jsonSchema({
                allOf: [
                  { type: 'object', properties: { x: { type: 'string' } } },
                  { type: 'object', properties: { y: { type: 'number' } } }
                ]
              })
            }),
            malformed_null: tool({ inputSchema: jsonSchema(null as never) }),
            malformed_string: tool({ inputSchema: jsonSchema('invalid' as never) })
          }
        })
      ).rejects.toBeDefined()

      const sentTools = (
        capturedBody as {
          tools: Array<{
            name: string
            input_schema: { type?: unknown; properties?: Record<string, unknown>; $ref?: string }
          }>
        }
      ).tools
      const byName = Object.fromEntries(sentTools.map((entry) => [entry.name, entry.input_schema]))

      for (const sentTool of sentTools) {
        expect(sentTool.input_schema.type, `${sentTool.name} missing object type`).toBe('object')
        expect(sentTool.input_schema.$ref, `${sentTool.name} kept root $ref`).toBeUndefined()
        expect(sentTool.input_schema.properties, `${sentTool.name} missing properties`).toEqual(expect.any(Object))
      }
      expect(byName.missing_type_props.properties).toEqual({ q: { type: 'string' } })
      expect(byName.mcp_root_ref.properties).toEqual({ query: { type: 'string' } })
      expect(byName.root_union.properties).toEqual({ a: { type: 'string' }, b: { type: 'number' } })
      expect(byName.root_oneof.properties).toEqual({ id: { type: 'string' }, slug: { type: 'string' } })
      expect(byName.root_allof.properties).toEqual({ x: { type: 'string' }, y: { type: 'number' } })
    }
  )
})
