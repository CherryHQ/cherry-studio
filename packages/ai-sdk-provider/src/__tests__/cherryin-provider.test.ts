import { createAnthropic } from '@ai-sdk/anthropic'
import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3StreamPart
} from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { createCherryIn } from '../cherryin-provider'

function captureRequest() {
  type WireBody = {
    model?: string
    stream?: boolean
    messages?: unknown
    contents?: unknown
    tools: {
      name?: string
      strict?: boolean
      function?: { name: string; strict?: boolean }
      input_schema?: unknown
      input_examples?: unknown
      functionDeclarations?: unknown
    }[]
  }
  const requests: { url: string; body: WireBody; headers: Headers }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) })
    return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'captured' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    })
  }
  return { requests, fetch }
}

function successfulAnthropicFetch(): typeof globalThis.fetch {
  return async (_input, init) => {
    const message = {
      type: 'message',
      id: 'msg_test',
      model: 'claude-fable-5',
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 }
    }
    if (!JSON.parse(String(init?.body)).stream) {
      return new Response(JSON.stringify(message), { headers: { 'content-type': 'application/json' } })
    }
    const events = [
      { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' }
    ]
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
      headers: { 'content-type': 'text/event-stream' }
    })
  }
}

function exampleTool(): LanguageModelV3FunctionTool {
  return {
    type: 'function',
    name: 'lookup',
    description: 'Look up a value',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    inputExamples: [{ input: { query: 'hello' } }]
  }
}

function callOptions(tool = exampleTool()): LanguageModelV3CallOptions {
  return { prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], tools: [tool] }
}

const advancedBeta = 'advanced-tool-use-2025-11-20'

describe('CherryIN Anthropic tool input examples', () => {
  it('omits unsupported Anthropic tool fields while preserving schema and metadata', async () => {
    const { requests, fetch } = captureRequest()
    const tool = exampleTool()
    tool.strict = true
    tool.providerOptions = {
      anthropic: { cacheControl: { type: 'ephemeral' }, deferLoading: true, allowedCallers: ['direct'] }
    }
    const model = createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-haiku-5.5')
    await expect(model.doGenerate(callOptions(tool))).rejects.toMatchObject({ statusCode: 400 })
    expect(requests).toHaveLength(1)
    expect(requests[0].body.model).toBe('claude-haiku-5.5')
    expect(requests[0].body.tools).toEqual([
      {
        name: 'lookup',
        description: 'Look up a value',
        input_schema: { ...tool.inputSchema, additionalProperties: false },
        cache_control: { type: 'ephemeral' },
        defer_loading: true,
        allowed_callers: ['direct']
      }
    ])
    expect(requests[0].body.tools[0]).not.toHaveProperty('strict')
    expect(requests[0].body.tools[0]).not.toHaveProperty('input_examples')
    expect(requests[0].headers.get('anthropic-beta')?.split(',')).toContain(advancedBeta)
  })

  it('omits examples when the model id automatically routes to Anthropic', async () => {
    const { requests, fetch } = captureRequest()
    await expect(
      createCherryIn({ apiKey: 'test-key', fetch })('anthropic/claude-haiku-5.5').doGenerate(callOptions())
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0].url).pathname).toBe('/v1/messages')
    expect(requests[0].body.model).toBe('anthropic/claude-haiku-5.5')
    expect(requests[0].body.tools[0].name).toBe('lookup')
    expect(requests[0].body.tools[0]).not.toHaveProperty('input_examples')
  })

  it('omits empty inputExamples arrays', async () => {
    const { requests, fetch } = captureRequest()
    const tool = exampleTool()
    tool.inputExamples = []
    await expect(
      createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-haiku-5.5').doGenerate(
        callOptions(tool)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests[0].body.tools).toEqual([
      {
        name: 'lookup',
        description: 'Look up a value',
        input_schema: { ...tool.inputSchema, additionalProperties: false }
      }
    ])
    expect(requests[0].headers.get('anthropic-beta') ?? '').not.toContain(advancedBeta)
  })

  it.each(['openai', 'gemini'] as const)('preserves requests on explicit %s endpoints', async (endpointType) => {
    const { requests, fetch } = captureRequest()
    const modelId = endpointType === 'openai' ? 'gpt-5' : 'gemini-3.5-flash'
    await expect(
      createCherryIn({ apiKey: 'test-key', endpointType, fetch })(modelId).doGenerate(callOptions())
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests).toHaveLength(1)
    const { body, url } = requests[0]
    if (endpointType === 'openai') {
      expect(new URL(url).pathname).toBe('/v1/chat/completions')
      expect(body.model).toBe('gpt-5')
      expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
      expect(body.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Look up a value',
            parameters: exampleTool().inputSchema
          }
        }
      ])
    } else {
      expect(new URL(url).pathname).toBe('/v1beta/models/models/gemini-3.5-flash:generateContent')
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }])
      expect(body.tools[0].functionDeclarations).toEqual([
        {
          name: 'lookup',
          description: 'Look up a value',
          parameters: exampleTool().inputSchema
        }
      ])
    }
  })

  it('preserves caller options and references while copying only tools with examples', async () => {
    const { requests, fetch } = captureRequest()
    const tool = exampleTool()
    tool.providerOptions = { anthropic: { cacheControl: { type: 'ephemeral' } } }
    const clean = { ...exampleTool(), name: 'clean' }
    delete clean.inputExamples
    const options = callOptions(tool)
    options.tools!.push(clean)
    options.providerOptions = { anthropic: { thinking: { type: 'disabled' } } }
    const before = structuredClone(options)
    const tools = options.tools
    const spy = vi.spyOn(AnthropicMessagesLanguageModel.prototype, 'doGenerate')
    try {
      await expect(
        createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-haiku-5.5').doGenerate(options)
      ).rejects.toMatchObject({ statusCode: 400 })
      const forwarded = spy.mock.calls[0][0]
      expect(forwarded).not.toBe(options)
      expect(forwarded.tools).not.toBe(tools)
      expect(forwarded.tools![0]).not.toBe(tool)
      expect(forwarded.tools![1]).toBe(clean)
      expect(forwarded.tools![0]).not.toHaveProperty('inputExamples')
      expect((forwarded.tools![0] as LanguageModelV3FunctionTool).inputSchema).toBe(tool.inputSchema)
      expect((forwarded.tools![0] as LanguageModelV3FunctionTool).providerOptions).toBe(tool.providerOptions)
      expect(forwarded.providerOptions).toBe(options.providerOptions)
      expect(options).toEqual(before)
      expect(options.tools).toBe(tools)
      expect(options.tools![0]).toBe(tool)
      expect(requests[0].body.tools.map((entry) => entry.name)).toEqual(['lookup', 'clean'])
    } finally {
      spy.mockRestore()
    }
  })

  it.each([undefined, []])('forwards unchanged options when tools have no examples: %s', async (tools) => {
    const { requests, fetch } = captureRequest()
    const options: LanguageModelV3CallOptions = { prompt: [], tools }
    const spy = vi.spyOn(AnthropicMessagesLanguageModel.prototype, 'doGenerate')
    try {
      await expect(
        createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-haiku-5.5').doGenerate(options)
      ).rejects.toMatchObject({ statusCode: 400 })
      expect(spy.mock.calls[0][0]).toBe(options)
      expect(requests[0].body.model).toBe('claude-haiku-5.5')
      expect(requests[0].body).not.toHaveProperty('tools')
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps shared examples available for a subsequent official Anthropic call', async () => {
    const { requests, fetch } = captureRequest()
    const options = callOptions()
    const before = structuredClone(options)
    await expect(
      createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-haiku-5.5').doGenerate(options)
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      createAnthropic({ apiKey: 'test-key', fetch })('claude-haiku-5.5').doGenerate(options)
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests).toHaveLength(2)
    expect(requests[0].body.tools[0]).not.toHaveProperty('input_examples')
    expect(requests[1].body.tools[0].input_examples).toEqual([{ query: 'hello' }])
    expect(requests[1].headers.get('anthropic-beta')?.split(',')).toContain(advancedBeta)
    expect(options).toEqual(before)
  })

  it('preserves provider tools mixed with function tools', async () => {
    const { requests, fetch } = captureRequest()
    const providerTool = {
      type: 'provider',
      id: 'anthropic.web_search_20250305',
      name: 'web_search',
      args: { maxUses: 2 }
    } as const
    const options = callOptions()
    options.tools!.push(providerTool)
    const before = structuredClone(options)
    const spy = vi.spyOn(AnthropicMessagesLanguageModel.prototype, 'doGenerate')
    try {
      await expect(
        createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-haiku-5.5').doGenerate(options)
      ).rejects.toMatchObject({ statusCode: 400 })
      expect(spy.mock.calls[0][0].tools![1]).toBe(providerTool)
      expect(requests[0].body.tools[0]).not.toHaveProperty('input_examples')
      expect(requests[0].body.tools[1]).toEqual({ type: 'web_search_20250305', name: 'web_search', max_uses: 2 })
      expect(options).toEqual(before)
    } finally {
      spy.mockRestore()
    }
  })

  it('preserves business schema properties named input_examples and inputExamples', async () => {
    const { requests, fetch } = captureRequest()
    const tool = exampleTool()
    tool.inputSchema = {
      type: 'object',
      properties: {
        input_examples: { type: 'string' },
        inputExamples: { type: 'array', items: { type: 'string' } }
      }
    }
    await expect(
      createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-haiku-5.5').doGenerate(
        callOptions(tool)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests[0].body.tools[0].input_schema).toEqual({ ...tool.inputSchema, additionalProperties: false })
    expect(requests[0].body.tools[0]).not.toHaveProperty('input_examples')
  })

  it('omits examples on doStream requests', async () => {
    const { requests, fetch } = captureRequest()
    await expect(
      createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-haiku-5.5').doStream(
        callOptions()
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests[0].body.stream).toBe(true)
    expect(requests[0].body.tools[0].name).toBe('lookup')
    expect(requests[0].body.tools[0]).not.toHaveProperty('input_examples')
  })

  it.each([false, true])('removes example-only beta while preserving explicit headers: %s', async (explicit) => {
    const { requests, fetch } = captureRequest()
    await expect(
      createCherryIn({
        apiKey: 'test-key',
        endpointType: 'anthropic',
        fetch,
        headers: explicit ? { 'anthropic-beta': `${advancedBeta},interleaved-thinking-2025-05-14` } : undefined
      })('claude-haiku-5.5').doGenerate(callOptions())
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests[0].body.tools[0]).not.toHaveProperty('input_examples')
    const betas = requests[0].headers.get('anthropic-beta')?.split(',') ?? []
    if (explicit) {
      expect(betas).toContain(advancedBeta)
      expect(betas).toContain('interleaved-thinking-2025-05-14')
    } else {
      expect(betas).not.toContain(advancedBeta)
    }
  })
})

describe('CherryIN Anthropic strict tools', () => {
  it.each(['doGenerate', 'doStream'] as const)(
    'reports unsupported strict when a tool declares one (%s)',
    async (method) => {
      const model = createCherryIn({
        apiKey: 'test-key',
        endpointType: 'anthropic',
        fetch: successfulAnthropicFetch()
      })('claude-fable-5')
      for (const strict of [true, false, undefined]) {
        const tool = exampleTool()
        delete tool.inputExamples
        if (strict !== undefined) tool.strict = strict
        let warnings
        if (method === 'doGenerate') {
          const result = await model.doGenerate(callOptions(tool))
          expect(result.content).toContainEqual({ type: 'text', text: 'hello' })
          expect(result.finishReason.unified).toBe('stop')
          warnings = result.warnings
        } else {
          const { stream } = await model.doStream(callOptions(tool))
          const reader = stream.getReader()
          const chunks: LanguageModelV3StreamPart[] = []
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
          }
          expect(chunks.filter((chunk) => chunk.type === 'error')).toEqual([])
          expect(chunks).toContainEqual({ type: 'text-delta', id: '0', delta: 'hello' })
          expect(chunks).toContainEqual(
            expect.objectContaining({ type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' } })
          )
          const start = chunks.find((chunk) => chunk.type === 'stream-start')
          expect(start).toBeDefined()
          warnings = start!.warnings
        }
        if (strict === undefined) expect(warnings).not.toContainEqual(expect.objectContaining({ feature: 'strict' }))
        else expect(warnings).toContainEqual(expect.objectContaining({ type: 'unsupported', feature: 'strict' }))
      }
    }
  )

  it.each(
    [true, false].flatMap((strict) =>
      (['doGenerate', 'doStream'] as const).flatMap((method) =>
        (['explicit', 'automatic'] as const).map((route) => ({ strict, method, route }))
      )
    )
  )('omits explicit strict without inputExamples ($strict, $method, $route)', async ({ strict, method, route }) => {
    const { requests, fetch } = captureRequest()
    const tool = exampleTool()
    delete tool.inputExamples
    tool.strict = strict
    const modelId = route === 'explicit' ? 'claude-fable-5' : 'anthropic/claude-fable-5'
    const model = createCherryIn({
      apiKey: 'test-key',
      fetch,
      ...(route === 'explicit' ? { endpointType: 'anthropic' } : {})
    })(modelId)

    await expect(model[method](callOptions(tool))).rejects.toMatchObject({ statusCode: 400 })

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://open.cherryin.net/v1/messages')
    expect(requests[0].body.model).toBe(modelId)
    expect(requests[0].body.tools[0].name).toBe('lookup')
    expect(requests[0].body.tools[0]).not.toHaveProperty('strict')
    expect(requests[0].body.tools[0].input_schema).toMatchObject(tool.inputSchema)
    if (method === 'doStream') expect(requests[0].body.stream).toBe(true)
  })

  it.each(['doGenerate', 'doStream'] as const)('keeps tools without strict free of strict (%s)', async (method) => {
    const { requests, fetch } = captureRequest()
    const tool = exampleTool()
    delete tool.inputExamples
    await expect(
      createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-fable-5')[method](
        callOptions(tool)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests[0].body.tools[0].name).toBe('lookup')
    expect(requests[0].body.tools[0]).not.toHaveProperty('strict')
  })

  it('preserves a business schema property named strict', async () => {
    const { requests, fetch } = captureRequest()
    const tool = exampleTool()
    tool.strict = true
    tool.inputSchema = { type: 'object', properties: { strict: { type: 'string' } } }
    await expect(
      createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-fable-5').doGenerate(
        callOptions(tool)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests[0].body.tools[0].input_schema).toMatchObject({ properties: { strict: { type: 'string' } } })
    expect(requests[0].body.tools[0]).not.toHaveProperty('strict')
  })

  it('keeps shared strict tools reusable with official Anthropic', async () => {
    const { requests, fetch } = captureRequest()
    const tool = exampleTool()
    delete tool.inputExamples
    tool.strict = true
    const options = callOptions(tool)
    const before = structuredClone(options)
    await expect(
      createCherryIn({ apiKey: 'test-key', endpointType: 'anthropic', fetch })('claude-fable-5').doGenerate(options)
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(options).toEqual(before)
    await expect(
      createAnthropic({ apiKey: 'test-key', fetch })('claude-fable-5').doGenerate(options)
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests).toHaveLength(2)
    expect(requests[0].body.tools[0]).not.toHaveProperty('strict')
    expect(requests[1].body.tools[0].strict).toBe(true)
    expect(options).toEqual(before)
    expect(options.tools![0]).toBe(tool)
  })

  it.each(
    (['openai', 'openai-response'] as const).flatMap((endpoint) =>
      [true, false].map((strict) => ({ endpoint, strict }))
    )
  )('preserves explicit strict on CherryIN $endpoint tools ($strict)', async ({ endpoint, strict }) => {
    const { requests, fetch } = captureRequest()
    const tool = exampleTool()
    tool.strict = strict
    await expect(
      createCherryIn({ apiKey: 'test-key', endpointType: endpoint, fetch })('gpt-5').doGenerate(callOptions(tool))
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(requests).toHaveLength(1)
    if (endpoint === 'openai') {
      expect(new URL(requests[0].url).pathname).toBe('/v1/chat/completions')
      expect(requests[0].body.tools[0].function).toMatchObject({ name: 'lookup', strict })
    } else {
      expect(new URL(requests[0].url).pathname).toBe('/v1/responses')
      expect(requests[0].body.tools[0]).toMatchObject({ name: 'lookup', strict })
    }
  })
})
