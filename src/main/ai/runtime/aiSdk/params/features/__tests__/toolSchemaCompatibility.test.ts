import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { generateText, jsonSchema, tool, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { readFileInputSchema } from '@shared/ai/builtinTools'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

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

  // Gemini's Schema proto types `enum` as string lists; a numeric or boolean
  // `enum`/`const` 400s the whole request (browser `click.clickCount`).
  it('replaces numeric and boolean enum/const with their bare type on the Gemini endpoint only', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'click',
          inputSchema: {
            type: 'object',
            properties: {
              button: { type: 'string', enum: ['left', 'right', 'middle'] },
              clickCount: {
                default: 1,
                anyOf: [
                  { type: 'number', const: 1 },
                  { type: 'number', const: 2 }
                ]
              },
              level: { type: 'integer', enum: [1, 2, 3] },
              ratio: { enum: [0.5, 1.5] },
              flag: { type: 'boolean', const: true },
              tagged: { enum: ['a', 1] }
            }
          }
        }
      ]
    }

    const transformed = (
      await transform(params, {
        aiSdkProviderId: 'google',
        endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
      })
    ).tools?.[0]
    if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')

    expect(transformed.inputSchema.properties).toEqual({
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      clickCount: { default: 1, anyOf: [{ type: 'number' }, { type: 'number' }] },
      level: { type: 'integer' },
      ratio: { type: 'number' },
      flag: { type: 'boolean' },
      tagged: { enum: ['a', 1] }
    })

    const untouched = (
      await transform(params, {
        aiSdkProviderId: 'anthropic',
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      })
    ).tools?.[0]
    expect(untouched).toBe(params.tools?.[0])
  })

  it('keeps numeric literal unions out of the wire enum field in Google function declarations', async () => {
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
          click: tool({
            inputSchema: z.object({ clickCount: z.union([z.literal(1), z.literal(2)]).default(1) })
          })
        }
      })
    ).rejects.toBeDefined()

    const declaration = (
      capturedBody as {
        tools: Array<{
          functionDeclarations: Array<{ name: string; parameters: { properties: Record<string, unknown> } }>
        }>
      }
    ).tools[0].functionDeclarations[0]
    expect(declaration.name).toBe('click')
    // `z.union([z.literal(1), z.literal(2)])` used to reach Gemini as
    // `anyOf: [{ enum: [1] }, { enum: [2] }]` and 400 the whole request.
    expect(declaration.parameters.properties.clickCount).toEqual({ anyOf: [{ type: 'number' }, { type: 'number' }] })
  })

  // Gemini's function-declaration proto has no `propertyNames` /
  // `additionalProperties` fields (issue #20939) — they 400 the whole
  // request as `Unknown name ... Cannot find field`.
  it('drops propertyNames and additionalProperties for Gemini, keeping them elsewhere', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'search',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'q' },
              options: {
                type: 'object',
                properties: { limit: { type: 'integer' } },
                propertyNames: { pattern: '^[a-z]+$' },
                additionalProperties: { type: 'string' }
              }
            },
            required: ['query'],
            additionalProperties: false
          }
        },
        {
          type: 'function',
          name: 'strict_search',
          strict: true,
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false
          }
        }
      ]
    }

    const transformed = (
      await transform(params, {
        aiSdkProviderId: 'google',
        endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
      })
    ).tools
    const [search, strictSearch] = transformed ?? []
    if (search?.type !== 'function' || strictSearch?.type !== 'function') {
      throw new Error('expected transformed function tools')
    }

    expect(search.inputSchema).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'q' },
        options: { type: 'object', properties: { limit: { type: 'integer' } } }
      },
      required: ['query']
    })
    expect(strictSearch.inputSchema).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    })

    const untouched = (
      await transform(params, {
        aiSdkProviderId: 'anthropic',
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      })
    ).tools
    expect(untouched?.[0]).toBe(params.tools?.[0])
    expect(untouched?.[1]).toBe(params.tools?.[1])
  })

  it('sends Gemini-shaped requests without propertyNames or additionalProperties', async () => {
    // Relay-style scope (e.g. aihubmix/newapi wrapping Gemini): endpointType is
    // GOOGLE_GENERATE_CONTENT while the downstream relay translates schemas
    // literally, so the repo-owned middleware is the last choke point (issue #20939).
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'search',
          // MCP-style raw JSON schema (bypasses zod conversion, like live MCP tools).
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              options: {
                type: 'object',
                properties: { limit: { type: 'integer' } },
                propertyNames: { pattern: '^[a-z]+$' },
                additionalProperties: { type: 'string' }
              }
            },
            required: ['query'],
            additionalProperties: false
          }
        }
      ]
    }

    for (const scope of [
      { aiSdkProviderId: 'google', endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT },
      { aiSdkProviderId: 'aihubmix', endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT }
    ] as const) {
      const transformed = (await transform(params, scope)).tools?.[0]
      if (transformed?.type !== 'function') throw new Error('expected a transformed function tool')
      expect(transformed.inputSchema).toEqual({
        type: 'object',
        properties: {
          query: { type: 'string' },
          options: { type: 'object', properties: { limit: { type: 'integer' } } }
        },
        required: ['query']
      })
    }
  })

  it('keeps propertyNames and additionalProperties out of Gemini wire declarations', async () => {
    // Wire-level guard for the same contract: drives the real @ai-sdk/google
    // package through a capturing fetch and pins the emitted declarations.
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
          // MCP-style raw JSON schema (bypasses zod conversion, like live MCP tools).
          search: {
            description: 'search',
            inputSchema: jsonSchema({
              type: 'object',
              properties: {
                query: { type: 'string' },
                options: {
                  type: 'object',
                  properties: { limit: { type: 'integer' } },
                  propertyNames: { pattern: '^[a-z]+$' },
                  additionalProperties: { type: 'string' }
                }
              },
              required: ['query'],
              additionalProperties: false
            })
          }
        }
      })
    ).rejects.toBeDefined()

    const declaration = (
      capturedBody as {
        tools: Array<{
          functionDeclarations: Array<{ name: string; parameters: { properties: Record<string, unknown> } }>
        }>
      }
    ).tools[0].functionDeclarations[0]
    expect(declaration.name).toBe('search')
    expect(JSON.stringify(declaration.parameters)).not.toMatch(/"(propertyNames|additionalProperties)"/)
  })
})
