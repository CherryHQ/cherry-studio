import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createAihubmix } from '../../aihubmix/aihubmixProvider'
import { captureWithFetch } from './captureRequest'

/**
 * AiHubMix → Anthropic tool-schema boundary.
 *
 * Guards `patches/@ai-sdk__anthropic.patch`, which wires
 * `sanitizeJsonSchema` into `prepareTools` so tool `input_schema` is reduced to
 * the JSON Schema subset Anthropic strict tool use / structured outputs accept
 * (shared limits — see the patch). Without it, a tool whose schema carries
 * `maxItems` makes AiHubMix's Claude backend reject the request with a 400
 * ("For 'array' type, property 'maxItems' is not supported"). If a future
 * `@ai-sdk/anthropic` bump drops the patch wiring, this test fails loudly.
 *
 * The sanitizer strips every unsupported validation keyword
 * (`minItems`/`maxItems`/`minLength`/`maxLength`/...) and folds the dropped
 * constraints into the node `description`, keeping `type`/`items`/`required`.
 */
function callOptionsWithToolSchema(inputSchema: unknown): LanguageModelV3CallOptions {
  return {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    tools: [
      {
        type: 'function',
        name: 'web_fetch',
        description: 'Fetch URLs',
        inputSchema
      }
    ]
  } as unknown as LanguageModelV3CallOptions
}

function urlsSchemaFrom(body: unknown): Record<string, unknown> {
  const tool = (body as { tools?: Array<{ input_schema?: { properties?: Record<string, unknown> } }> }).tools?.[0]
  return (tool?.input_schema?.properties?.urls ?? {}) as Record<string, unknown>
}

describe('AiHubMix → Anthropic tool-schema boundary (patched @ai-sdk/anthropic)', () => {
  it('strips array maxItems/minItems from tool input_schema and folds them into description', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'sk', fetch })
        .languageModel('claude-sonnet-4-6')
        .doStream(
          callOptionsWithToolSchema({
            type: 'object',
            properties: {
              urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 }
            },
            required: ['urls'],
            additionalProperties: false
          })
        )
    )

    expect(req.url).toBe('https://aihubmix.com/v1/messages')
    const urls = urlsSchemaFrom(req.body)
    expect(urls.maxItems).toBeUndefined() // unsupported keyword → stripped (the reported 400)
    expect(urls.minItems).toBeUndefined() // folded into description, not sent as a keyword
    expect(urls.type).toBe('array') // structure preserved
    expect(urls.items).toEqual({ type: 'string' })
    expect(String(urls.description)).toContain('max items: 20') // constraint preserved as advisory text
  })

  it('strips string min/maxLength too', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'sk', fetch })
        .languageModel('claude-sonnet-4-6')
        .doStream(
          callOptionsWithToolSchema({
            type: 'object',
            properties: {
              urls: { type: 'string', minLength: 2, maxLength: 200 }
            },
            required: ['urls'],
            additionalProperties: false
          })
        )
    )

    const urls = urlsSchemaFrom(req.body)
    expect(urls.minLength).toBeUndefined()
    expect(urls.maxLength).toBeUndefined()
  })

  // `tool_invoke` needs additionalProperties:true on `params` to accept arbitrary sub-tool arguments.
  // Keep that object open even though AiHubMix omits tool examples.
  it('preserves an explicit additionalProperties:true on a nested object while defaulting others closed', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'sk', fetch })
        .languageModel('claude-sonnet-4-6')
        .doStream(
          callOptionsWithToolSchema({
            type: 'object',
            properties: {
              name: { type: 'string' },
              params: { type: 'object', additionalProperties: true, description: 'Tool input arguments' }
            },
            required: ['name'],
            additionalProperties: false
          })
        )
    )

    const inputSchema = (req.body as { tools: Array<{ input_schema: Record<string, unknown> }> }).tools[0].input_schema
    const params = (inputSchema.properties as Record<string, { additionalProperties?: unknown }>).params
    expect(params.additionalProperties).toBe(true) // arbitrary sub-tool arguments remain valid
    expect(inputSchema.additionalProperties).toBe(false) // outer object still closed by default
  })
})

describe('AiHubMix → Anthropic tool examples boundary', () => {
  const methods = ['doGenerate', 'doStream'] as const

  it.each(
    methods.flatMap((method) => [
      { method, examples: 'populated', inputExamples: [{ input: { query: 'hello' } }] },
      { method, examples: 'empty', inputExamples: [] }
    ])
  )(
    'omits $examples input examples and their beta in $method without mutating inputs',
    async ({ method, inputExamples }) => {
      const eagerStreaming = method === 'doStream' ? { eager_input_streaming: true } : {}
      const originalExamples = structuredClone(inputExamples)
      const inputSchema = {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const },
          input_examples: { type: 'string' as const, description: 'Business input_examples' },
          inputExamples: { type: 'string' as const, description: 'Business inputExamples' }
        },
        required: ['query'],
        additionalProperties: false
      }
      const originalSchema = structuredClone(inputSchema)
      const providerOptions = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } } }
      const tool = {
        type: 'function' as const,
        name: 'custom_lookup',
        description: 'Look up input_examples and inputExamples',
        inputSchema,
        inputExamples,
        providerOptions
      }
      const tools = [tool]
      const options: LanguageModelV3CallOptions = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        tools
      }
      const req = await captureWithFetch((fetch) =>
        createAihubmix({ apiKey: 'test-key', fetch })('claude-haiku-5-5')[method](options)
      )
      expect(req.url).toBe('https://aihubmix.com/v1/messages')
      expect((req.body as { tools: unknown[] }).tools).toEqual([
        {
          name: 'custom_lookup',
          description: 'Look up input_examples and inputExamples',
          input_schema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              input_examples: { type: 'string', description: 'Business input_examples' },
              inputExamples: { type: 'string', description: 'Business inputExamples' }
            },
            required: ['query'],
            additionalProperties: false
          },
          cache_control: { type: 'ephemeral', ttl: '5m' },
          ...eagerStreaming
        }
      ])
      expect(
        req.headers
          .get('anthropic-beta')
          ?.split(',')
          .map((beta) => beta.trim()) ?? []
      ).not.toContain('advanced-tool-use-2025-11-20')
      expect(options.tools).toBe(tools)
      expect(options.tools![0]).toBe(tool)
      expect(tool.inputExamples).toBe(inputExamples)
      expect(inputExamples).toEqual(originalExamples)
      expect(tool.inputSchema).toBe(inputSchema)
      expect(inputSchema).toEqual(originalSchema)
      expect(tool.providerOptions).toBe(providerOptions)
      expect(providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } } })

      const official = await captureWithFetch((fetch) =>
        createAnthropic({ apiKey: 'test-key', fetch })('claude-haiku-5-5')[method](options)
      )
      expect((official.body as { tools: Array<{ input_examples: unknown }> }).tools[0].input_examples).toEqual(
        originalExamples.map((example) => example.input)
      )
    }
  )

  it.each(methods)('preserves allowedCallers and its independent beta in %s', async (method) => {
    const eagerStreaming = method === 'doStream' ? { eager_input_streaming: true } : {}
    const options = callOptionsWithToolSchema({ type: 'object', properties: {}, additionalProperties: false })
    const tool = options.tools![0]
    if (tool.type !== 'function') throw new Error('expected a function tool fixture')
    tool.providerOptions = { anthropic: { allowedCallers: ['direct'] } }
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'test-key', fetch })('claude-haiku-5-5')[method](options)
    )
    expect((req.body as { tools: unknown[] }).tools[0]).toEqual({
      name: 'web_fetch',
      description: 'Fetch URLs',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      allowed_callers: ['direct'],
      ...eagerStreaming
    })
    expect(
      req.headers
        .get('anthropic-beta')
        ?.split(',')
        .map((beta) => beta.trim()) ?? []
    ).toContain('advanced-tool-use-2025-11-20')
  })

  it.each(methods)('preserves a mixed provider tool and its beta in %s', async (method) => {
    const eagerStreaming = method === 'doStream' ? { eager_input_streaming: true } : {}
    const options: LanguageModelV3CallOptions = {
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'lookup',
          description: 'Look up a value',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          inputExamples: [{ input: {} }]
        },
        { type: 'provider', id: 'anthropic.code_execution_20250522', name: 'code_execution', args: {} }
      ]
    }
    const providerTool = options.tools![1]
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'test-key', fetch })('claude-haiku-5-5')[method](options)
    )
    expect((req.body as { tools: unknown[] }).tools).toEqual([
      {
        name: 'lookup',
        description: 'Look up a value',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
        ...eagerStreaming
      },
      { type: 'code_execution_20250522', name: 'code_execution' }
    ])
    const betas =
      req.headers
        .get('anthropic-beta')
        ?.split(',')
        .map((beta) => beta.trim()) ?? []
    expect(betas).toContain('code-execution-2025-05-22')
    expect(betas).not.toContain('advanced-tool-use-2025-11-20')
    expect(options.tools![1]).toBe(providerTool)
    expect(providerTool).toEqual({
      type: 'provider',
      id: 'anthropic.code_execution_20250522',
      name: 'code_execution',
      args: {}
    })
  })
})
