/** Regression coverage for the parameterless tool-schema pass (issue #21957). */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { JSONSchema7, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { generateText, jsonSchema, tool, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { createMcpInputSchema } from '@main/ai/tools/adapters/aiSdk/mcpSchema'
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

describe('parameterless function-tool schemas', () => {
  it.each([
    { type: 'object', additionalProperties: false },
    { type: 'object' },
    { type: 'object', additionalProperties: true },
    { type: 'object', additionalProperties: { type: 'string' } }
  ] satisfies JSONSchema7[])('adds only root properties to $type schema %j without mutation', async (inputSchema) => {
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
    ['undefined properties', { type: 'object', properties: undefined }],
    ['empty schema', {}],
    ['string', { type: 'string' }],
    ['array', { type: 'array', items: { type: 'string' } }],
    ['nullable object', { type: ['object', 'null'] }],
    ['reference', { $ref: '#/$defs/x' }],
    ['union', { anyOf: [{ type: 'object' }, { type: 'string' }] }]
  ])('preserves %s by reference without inferring or repairing properties', async (_name, inputSchema) => {
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [{ type: 'function', name: 'untouched', inputSchema: inputSchema as JSONSchema7 }]
    }
    expect(await transform(params)).toBe(params)
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

  it('preserves an object root with $ref by reference without mutation', async () => {
    const inputSchema: JSONSchema7 = {
      type: 'object',
      $ref: '#/$defs/Input',
      $defs: { Input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
    }
    const original = structuredClone(inputSchema)
    const params: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [{ type: 'function', name: 'lookup', inputSchema }]
    }

    const result = await transform(params)

    expect(result).toBe(params)
    expect(inputSchema).toEqual(original)
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
        tools: { lookup: tool({ description: 'lookup', inputSchema: jsonSchema(inputSchema) }) }
      })
    ).rejects.toBeDefined()

    const sent = (capturedBody as { tools: Array<{ functionDeclarations: Array<{ parameters: unknown }> }> }).tools[0]
      .functionDeclarations[0].parameters
    expect(sent).toEqual({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] })
  })
})
