import { OpenAICompatibleChatLanguageModel, OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

function sse(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function done(): string {
  return 'data: [DONE]\n\n'
}

async function collectStream(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const chunks: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  while (true) {
    const { done: finished, value } = await reader.read()
    if (finished) break
    chunks.push(value)
  }
  return chunks
}

function textPrompt(text: string) {
  return [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }]
}

function mockFetch(chunks: string[]) {
  return vi.fn().mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk))
          }
          controller.close()
        }
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    )
  )
}

function mockFetchJson(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  )
}

function createChatModel(fetchMock: ReturnType<typeof vi.fn>) {
  return new OpenAICompatibleChatLanguageModel('glm-4-flash', {
    provider: 'zhipu.chat',
    url: ({ path }) => `https://api.example.com${path}`,
    headers: () => ({ Authorization: 'Bearer sk-test' }),
    fetch: fetchMock
  })
}

describe('OpenAICompatibleChatLanguageModel – streaming tool call ID patch', () => {
  it('generates a fallback ID when tool call delta has no id (Zhipu streaming fix)', async () => {
    const fetchMock = mockFetch([
      sse({
        id: 'chatcmpl-1',
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { name: 'get_weather', arguments: '{"city":"London"}' }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      }),
      done()
    ])

    const model = createChatModel(fetchMock)
    const { stream } = await model.doStream({
      prompt: textPrompt('test'),
      toolUsageWarning: undefined,
      responseFormat: { type: 'text' }
    })

    const chunks = await collectStream(stream)
    const toolCalls = chunks.filter((c) => c.type === 'tool-call')

    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({
      type: 'tool-call',
      toolName: 'get_weather',
      input: '{"city":"London"}'
    })
    expect(typeof (toolCalls[0] as any).toolCallId).toBe('string')
    expect((toolCalls[0] as any).toolCallId.length).toBeGreaterThan(0)
  })

  it('coerces numeric tool call ID to string', async () => {
    const fetchMock = mockFetch([
      sse({
        id: 'chatcmpl-1',
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 12345,
                  function: { name: 'search', arguments: '{"q":"test"}' }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      }),
      done()
    ])

    const model = createChatModel(fetchMock)
    const { stream } = await model.doStream({
      prompt: textPrompt('test'),
      toolUsageWarning: undefined,
      responseFormat: { type: 'text' }
    })

    const chunks = await collectStream(stream)
    const toolCalls = chunks.filter((c) => c.type === 'tool-call')

    expect(toolCalls).toHaveLength(1)
    expect((toolCalls[0] as any).toolCallId).toBe('12345')
  })

  it('preserves valid string tool call ID', async () => {
    const fetchMock = mockFetch([
      sse({
        id: 'chatcmpl-1',
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_abc123',
                  function: { name: 'get_weather', arguments: '{}' }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      }),
      done()
    ])

    const model = createChatModel(fetchMock)
    const { stream } = await model.doStream({
      prompt: textPrompt('test'),
      toolUsageWarning: undefined,
      responseFormat: { type: 'text' }
    })

    const chunks = await collectStream(stream)
    const toolCalls = chunks.filter((c) => c.type === 'tool-call')

    expect(toolCalls).toHaveLength(1)
    expect((toolCalls[0] as any).toolCallId).toBe('call_abc123')
  })

  it('handles multiple tool calls with mixed ID presence', async () => {
    const fetchMock = mockFetch([
      sse({
        id: 'chatcmpl-1',
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_valid',
                  function: { name: 'tool_a', arguments: '{}' }
                }
              ]
            },
            finish_reason: null
          }
        ]
      }),
      sse({
        id: 'chatcmpl-1',
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  function: { name: 'tool_b', arguments: '{"x":1}' }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      }),
      done()
    ])

    const model = createChatModel(fetchMock)
    const { stream } = await model.doStream({
      prompt: textPrompt('test'),
      toolUsageWarning: undefined,
      responseFormat: { type: 'text' }
    })

    const chunks = await collectStream(stream)
    const toolCalls = chunks.filter((c) => c.type === 'tool-call')

    expect(toolCalls).toHaveLength(2)
    expect(toolCalls[0]).toMatchObject({
      toolName: 'tool_a',
      toolCallId: 'call_valid'
    })
    expect(toolCalls[1]).toMatchObject({
      toolName: 'tool_b',
      input: '{"x":1}'
    })
    expect(typeof (toolCalls[1] as any).toolCallId).toBe('string')
    expect((toolCalls[1] as any).toolCallId).not.toBe('call_valid')
  })
})

describe('OpenAICompatibleChatLanguageModel – streaming images patch', () => {
  it('parses delta.images with base64 data URL into file content blocks', async () => {
    const base64Data = 'iVBORw0KGgoAAAANSU'
    const fetchMock = mockFetch([
      sse({
        id: 'chatcmpl-1',
        choices: [
          {
            delta: {
              content: 'Here is an image:',
              images: [
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${base64Data}` }
                }
              ]
            },
            finish_reason: null
          }
        ]
      }),
      done()
    ])

    const model = createChatModel(fetchMock)
    const { stream } = await model.doStream({
      prompt: textPrompt('test'),
      toolUsageWarning: undefined,
      responseFormat: { type: 'text' }
    })

    const chunks = await collectStream(stream)
    const fileChunks = chunks.filter((c) => c.type === 'file')

    expect(fileChunks).toHaveLength(1)
    expect(fileChunks[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
      data: base64Data
    })
  })

  it('parses delta.images with plain URL', async () => {
    const imageUrl = 'https://example.com/image.png'
    const fetchMock = mockFetch([
      sse({
        id: 'chatcmpl-1',
        choices: [
          {
            delta: {
              images: [
                {
                  type: 'image_url',
                  image_url: { url: imageUrl }
                }
              ]
            },
            finish_reason: null
          }
        ]
      }),
      done()
    ])

    const model = createChatModel(fetchMock)
    const { stream } = await model.doStream({
      prompt: textPrompt('test'),
      toolUsageWarning: undefined,
      responseFormat: { type: 'text' }
    })

    const chunks = await collectStream(stream)
    const fileChunks = chunks.filter((c) => c.type === 'file')

    expect(fileChunks).toHaveLength(1)
    expect(fileChunks[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/jpeg',
      data: imageUrl
    })
  })

  it('defaults mediaType to image/jpeg when data URL has empty type', async () => {
    const base64Data = 'AAABBB'
    const fetchMock = mockFetch([
      sse({
        id: 'chatcmpl-1',
        choices: [
          {
            delta: {
              images: [
                {
                  type: 'image_url',
                  image_url: { url: `data:;base64,${base64Data}` }
                }
              ]
            },
            finish_reason: null
          }
        ]
      }),
      done()
    ])

    const model = createChatModel(fetchMock)
    const { stream } = await model.doStream({
      prompt: textPrompt('test'),
      toolUsageWarning: undefined,
      responseFormat: { type: 'text' }
    })

    const chunks = await collectStream(stream)
    const fileChunks = chunks.filter((c) => c.type === 'file')

    expect(fileChunks).toHaveLength(1)
    expect(fileChunks[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/jpeg',
      data: base64Data
    })
  })

  it('parses multiple images in a single delta', async () => {
    const fetchMock = mockFetch([
      sse({
        id: 'chatcmpl-1',
        choices: [
          {
            delta: {
              images: [
                {
                  type: 'image_url',
                  image_url: { url: 'data:image/png;base64,AAA' }
                },
                {
                  type: 'image_url',
                  image_url: { url: 'https://example.com/img.jpg' }
                }
              ]
            },
            finish_reason: null
          }
        ]
      }),
      done()
    ])

    const model = createChatModel(fetchMock)
    const { stream } = await model.doStream({
      prompt: textPrompt('test'),
      toolUsageWarning: undefined,
      responseFormat: { type: 'text' }
    })

    const chunks = await collectStream(stream)
    const fileChunks = chunks.filter((c) => c.type === 'file')

    expect(fileChunks).toHaveLength(2)
    expect(fileChunks[0]).toMatchObject({ mediaType: 'image/png', data: 'AAA' })
    expect(fileChunks[1]).toMatchObject({ mediaType: 'image/jpeg', data: 'https://example.com/img.jpg' })
  })
})

describe('OpenAICompatibleChatLanguageModel – non-streaming images patch', () => {
  it('parses choice.message.images in non-streaming response', async () => {
    const fetchMock = mockFetchJson({
      id: 'chatcmpl-1',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Here is an image:',
            images: [
              {
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,/9j/abc' }
              }
            ]
          },
          finish_reason: 'stop'
        }
      ]
    })

    const model = createChatModel(fetchMock)
    const result = await model.doGenerate({
      prompt: textPrompt('test'),
      toolUsageWarning: undefined,
      responseFormat: { type: 'text' }
    })

    expect(result.content).toEqual([
      { type: 'text', text: 'Here is an image:' },
      { type: 'file', mediaType: 'image/jpeg', data: '/9j/abc' }
    ])
  })
})

describe('OpenAICompatibleImageModel – response_format guard patch', () => {
  function makeOkJsonResponse(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  function createImageModel(modelId: string, fetchMock: ReturnType<typeof vi.fn>) {
    return new OpenAICompatibleImageModel(modelId, {
      provider: 'test.image',
      url: ({ path }) => `https://api.example.com${path}`,
      headers: () => ({}),
      fetch: fetchMock
    })
  }

  const callOpts = (overrides: Record<string, unknown> = {}) => ({
    prompt: 'a cat',
    n: 1,
    size: '1024x1024' as const,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
    ...overrides
  })

  it('omits response_format for gpt-image-1 (has default response format)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkJsonResponse({ data: [] }))
    const model = createImageModel('gpt-image-1', fetchMock)

    await model.doGenerate(callOpts())

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).not.toHaveProperty('response_format')
  })

  it('omits response_format for chatgpt-image- prefix models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkJsonResponse({ data: [] }))
    const model = createImageModel('chatgpt-image-2024', fetchMock)

    await model.doGenerate(callOpts())

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).not.toHaveProperty('response_format')
  })

  it('omits response_format for gpt-image-2', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkJsonResponse({ data: [] }))
    const model = createImageModel('gpt-image-2', fetchMock)

    await model.doGenerate(callOpts())

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).not.toHaveProperty('response_format')
  })

  it('omits response_format for gpt-image-1-mini', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkJsonResponse({ data: [] }))
    const model = createImageModel('gpt-image-1-mini', fetchMock)

    await model.doGenerate(callOpts())

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).not.toHaveProperty('response_format')
  })

  it('omits response_format for gpt-image-1.5', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkJsonResponse({ data: [] }))
    const model = createImageModel('gpt-image-1.5', fetchMock)

    await model.doGenerate(callOpts())

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).not.toHaveProperty('response_format')
  })

  it('includes response_format: b64_json for unknown model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkJsonResponse({ data: [] }))
    const model = createImageModel('dall-e-3', fetchMock)

    await model.doGenerate(callOpts())

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).toHaveProperty('response_format', 'b64_json')
  })
})

describe('OpenAICompatibleImageModel – response schema patch (b64_json + url)', () => {
  function makeOkJsonResponse(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  function createImageModel(modelId: string, fetchMock: ReturnType<typeof vi.fn>) {
    return new OpenAICompatibleImageModel(modelId, {
      provider: 'test.image',
      url: ({ path }) => `https://api.example.com${path}`,
      headers: () => ({}),
      fetch: fetchMock
    })
  }

  const callOpts = (overrides: Record<string, unknown> = {}) => ({
    prompt: 'a cat',
    n: 1,
    size: '1024x1024' as const,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
    ...overrides
  })

  it('parses b64_json from image response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkJsonResponse({ data: [{ b64_json: 'AAABBB' }] }))
    const model = createImageModel('dall-e-3', fetchMock)

    const result = await model.doGenerate(callOpts())

    expect(result.images).toEqual(['AAABBB'])
  })

  it('parses url from image response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkJsonResponse({ data: [{ url: 'https://example.com/img.png' }] }))
    const model = createImageModel('dall-e-3', fetchMock)

    const result = await model.doGenerate(callOpts())

    expect(result.images).toEqual(['https://example.com/img.png'])
  })

  it('parses mixed b64_json and url items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkJsonResponse({
        data: [{ b64_json: 'FIRST' }, { url: 'https://example.com/second.png' }, { b64_json: 'THIRD' }]
      })
    )
    const model = createImageModel('dall-e-3', fetchMock)

    const result = await model.doGenerate(callOpts({ n: 3 }))

    expect(result.images).toEqual(['FIRST', 'https://example.com/second.png', 'THIRD'])
  })

  it('skips items with neither b64_json nor url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkJsonResponse({
        data: [{ b64_json: 'VALID' }, { url: 'https://example.com/valid.png' }, {}]
      })
    )
    const model = createImageModel('dall-e-3', fetchMock)

    const result = await model.doGenerate(callOpts({ n: 3 }))

    expect(result.images).toEqual(['VALID', 'https://example.com/valid.png'])
  })
})
