import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { extractReasoningMiddleware, type TextStreamPart, type ToolSet, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import type { ModelCallInfo, ModelCallPort, UnmappedStreamPart } from '../src'
import { createTestSession, finish, lastAssistant, plain, scriptedModel, streamTextPort, textParts } from './support'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function weatherTool(calls: unknown[]) {
  return defineTool({
    name: 'get_weather',
    label: 'Weather',
    description: 'Get the weather for a city',
    parameters: Type.Object({ city: Type.String() }),
    async execute(_id, params) {
      calls.push(params)
      return { content: [{ type: 'text', text: `Sunny, 25C in ${params.city}` }], details: undefined }
    }
  })
}

const messagesOf = (prompt: LanguageModelV3Prompt, role: string) => prompt.filter((m) => m.role === role)

describe('Pi agent loop over the AI SDK port', () => {
  it('streams reasoning and text into Pi, maps usage, and keeps the reasoning signature', async () => {
    const { model } = scriptedModel([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'response-metadata', id: 'resp-1', modelId: 'upstream-model' },
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'Thinking about greeting' },
        { type: 'reasoning-end', id: 'r1', providerMetadata: { anthropic: { signature: 'sig-123' } } },
        ...textParts('t1', 'Hello', ' world'),
        finish('stop', 10, 5)
      ]
    ])
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({ port })
    const deltas: string[] = []
    session.subscribe((event) => {
      if (event.type !== 'message_update') return
      const e = event.assistantMessageEvent
      if (e.type === 'text_delta' || e.type === 'thinking_delta') deltas.push(`${e.type}:${e.delta}`)
    })
    await session.prompt('hi')

    expect(deltas).toEqual(['thinking_delta:Thinking about greeting', 'text_delta:Hello', 'text_delta: world'])
    const message = lastAssistant(session)
    expect(message.stopReason).toBe('stop')
    expect(message.responseId).toBe('resp-1')
    expect(message.responseModel).toBe('upstream-model')
    expect(message.content.map((block) => block.type)).toEqual(['thinking', 'text'])
    expect(message.content[1]).toMatchObject({ text: 'Hello world' })
    expect(message.content[0]).toMatchObject({ thinkingSignature: expect.stringContaining('sig-123') })
    expect(message.usage).toMatchObject({ input: 10, cacheRead: 2, output: 5 })
    expect(message.usage.cost.total).toBeGreaterThan(0)

    expect(requests).toHaveLength(1)
    expect(requests[0].system?.startsWith('You are Cherry.')).toBe(true)
    expect(plain(requests[0].messages)).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(Object.keys(requests[0].tools)).toEqual([])
  })

  it('lets Pi execute tool calls and replays call, result and signatures to the model', async () => {
    const weatherCalls: unknown[] = []
    const { model, calls } = scriptedModel([
      [
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'Need weather' },
        // Anthropic's shape: the signature arrives on an empty delta, the end part carries none.
        { type: 'reasoning-delta', id: 'r1', delta: '', providerMetadata: { anthropic: { signature: 'sig-A' } } },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'tool-input-start', id: 'call_1', toolName: 'get_weather' },
        { type: 'tool-input-delta', id: 'call_1', delta: '{"city":' },
        { type: 'tool-input-delta', id: 'call_1', delta: '"Paris"}' },
        { type: 'tool-input-end', id: 'call_1' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'get_weather',
          input: '{"city":"Paris"}',
          providerMetadata: { google: { thoughtSignature: 'ts-1' } }
        },
        finish('tool-calls')
      ],
      [...textParts('t2', "It's sunny in Paris."), finish('stop')]
    ])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [weatherTool(weatherCalls)]
    })
    const toolEvents: string[] = []
    session.subscribe((event) => {
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') toolEvents.push(event.type)
    })
    await session.prompt('Weather in Paris?')

    expect(weatherCalls).toEqual([{ city: 'Paris' }])
    expect(toolEvents).toEqual(['tool_execution_start', 'tool_execution_end'])
    expect(calls).toHaveLength(2)
    expect(calls[0].tools?.map((t) => t.name)).toEqual(['get_weather'])
    expect(calls[0].tools?.[0]).toMatchObject({ inputSchema: { required: ['city'] } })

    const [assistant] = messagesOf(calls[1].prompt, 'assistant')
    expect(plain(assistant.content)).toEqual([
      { type: 'reasoning', text: 'Need weather', providerOptions: { anthropic: { signature: 'sig-A' } } },
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'get_weather',
        input: { city: 'Paris' },
        providerOptions: { google: { thoughtSignature: 'ts-1' } }
      }
    ])
    const [toolMessage] = messagesOf(calls[1].prompt, 'tool')
    expect(plain(toolMessage.content)).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'get_weather',
        output: { type: 'text', value: 'Sunny, 25C in Paris' }
      }
    ])
    expect(lastAssistant(session).content).toEqual([{ type: 'text', text: "It's sunny in Paris." }])
  })

  it('passes images from the user prompt and from tool results to the model', async () => {
    const { model, calls } = scriptedModel([
      [{ type: 'tool-call', toolCallId: 'shot_1', toolName: 'screenshot', input: '{}' }, finish('tool-calls')],
      [...textParts('t', 'Both look alike.'), finish('stop')]
    ])
    const screenshot = defineTool({
      name: 'screenshot',
      label: 'Screenshot',
      description: 'Capture the screen',
      parameters: Type.Object({}),
      async execute() {
        return {
          content: [
            { type: 'text', text: 'captured' },
            { type: 'image', data: PNG, mimeType: 'image/png' }
          ],
          details: undefined
        }
      }
    })
    const { session } = await createTestSession({ port: streamTextPort(model).port, tools: [screenshot] })
    await session.prompt('Compare with my screen', { images: [{ type: 'image', data: PNG, mimeType: 'image/png' }] })

    const [user] = messagesOf(calls[0].prompt, 'user')
    expect(user.content).toContainEqual(expect.objectContaining({ type: 'file', mediaType: 'image/png' }))
    const [toolMessage] = messagesOf(calls[1].prompt, 'tool')
    expect(plain(toolMessage.content[0])).toMatchObject({
      type: 'tool-result',
      output: {
        type: 'content',
        value: [
          { type: 'text', text: 'captured' },
          { type: 'image-data', data: PNG, mediaType: 'image/png' }
        ]
      }
    })
  })

  it('keeps the host plugin chain (model middleware, stream transforms) in force for Pi requests', async () => {
    const { model } = scriptedModel([
      [...textParts('t', '<think>plan the answer</think>', 'Final answer'), finish('stop')]
    ])
    const wrapped = wrapLanguageModel({ model, middleware: extractReasoningMiddleware({ tagName: 'think' }) })
    const upperCaseText = () =>
      new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
        transform(part, controller) {
          controller.enqueue(part.type === 'text-delta' ? { ...part, text: part.text.toUpperCase() } : part)
        }
      })
    const { port } = streamTextPort(wrapped, { experimental_transform: upperCaseText })
    const { session } = await createTestSession({ port })
    await session.prompt('question')

    const message = lastAssistant(session)
    expect(message.content.find((b) => b.type === 'thinking')).toMatchObject({ thinking: 'plan the answer' })
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    expect(text).toBe('FINAL ANSWER')
  })

  it('forwards the host reasoning setting on every request without deriving it from Pi thinking levels', async () => {
    const { model, calls } = scriptedModel([[...textParts('t', 'ok'), finish('stop')]])
    const { port, requests } = streamTextPort<{ reasoningEffort: string }>(model)
    const { session } = await createTestSession({
      port,
      requestOptions: { reasoningEffort: 'ultra' },
      thinkingLevel: 'high'
    })
    await session.prompt('first')
    session.setThinkingLevel('low')
    await session.prompt('second')

    expect(requests.map((r) => r.options)).toEqual([{ reasoningEffort: 'ultra' }, { reasoningEffort: 'ultra' }])
    expect(calls.map((c) => c.providerOptions)).toEqual([undefined, undefined])
  })

  it('aborts the AI SDK call and settles the turn as aborted', async () => {
    const chunks = Array.from({ length: 50 }, (_, i) => `chunk${i} `)
    const { model } = scriptedModel([[...textParts('t', ...chunks), finish('stop')]], 30)
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({ port })
    session.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') void session.abort()
    })
    await session.prompt('long answer')

    expect(lastAssistant(session).stopReason).toBe('aborted')
    expect(requests[0].abortSignal?.aborted).toBe(true)
  })

  it('settles an aborted turn even when the port stream ignores the abort signal', async () => {
    const port: ModelCallPort = {
      streamText: () => ({
        fullStream: new ReadableStream<TextStreamPart<ToolSet>>({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 't' })
            controller.enqueue({ type: 'text-delta', id: 't', text: 'partial' })
          }
        })
      })
    }
    const { session } = await createTestSession({ port })
    session.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') void session.abort()
    })
    await session.prompt('hang')

    expect(lastAssistant(session).stopReason).toBe('aborted')
  })

  it('hands parts Pi cannot store (sources, files) to the host with the identity of their request', async () => {
    const { model } = scriptedModel([
      [
        { type: 'source', sourceType: 'url', id: 's1', url: 'https://example.com', title: 'Example' },
        { type: 'file', mediaType: 'image/png', data: PNG },
        ...textParts('t', 'See [1].'),
        finish('stop')
      ]
    ])
    const unmapped: { part: UnmappedStreamPart; call: ModelCallInfo }[] = []
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({
      port,
      sideChannel: { onUnmappedPart: (part, call) => unmapped.push({ part, call }) }
    })
    await session.prompt('cite something')

    expect(unmapped.map(({ part }) => part.type)).toEqual(['source', 'file'])
    expect(unmapped[0].part).toMatchObject({ url: 'https://example.com', title: 'Example' })
    expect(unmapped[1].part).toMatchObject({ file: { mediaType: 'image/png', base64: PNG } })
    for (const { call } of unmapped) {
      expect(call).toEqual({
        requestId: requests[0].requestId,
        sessionId: session.sessionId,
        model: { provider: 'cherry', id: 'bridged-model' }
      })
    }
    expect(lastAssistant(session).content).toEqual([{ type: 'text', text: 'See [1].' }])
  })

  it('lets Pi extensions observe raw stream parts and replace the request before it is sent', async () => {
    const { model } = scriptedModel([
      [
        { type: 'source', sourceType: 'url', id: 's1', url: 'https://example.com' },
        ...textParts('t', 'ok'),
        finish('stop')
      ]
    ])
    const providerEvents: unknown[] = []
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({
      port,
      extensionFactories: [
        (pi) => {
          pi.on('provider_stream_event', (event) => {
            providerEvents.push(event.data)
          })
          pi.on('before_provider_request', (event) => ({ ...(event.payload as object), system: 'Rewritten.' }))
        }
      ]
    })
    await session.prompt('hi')

    expect(requests[0].system).toBe('Rewritten.')
    expect(providerEvents).toContainEqual(expect.objectContaining({ type: 'source', url: 'https://example.com' }))
  })

  it('keeps provider-executed tools (server web search) away from Pi’s tool executor', async () => {
    const { model } = scriptedModel([
      [
        {
          type: 'tool-call',
          toolCallId: 'ws_1',
          toolName: 'web_search',
          input: '{"query":"cherry"}',
          providerExecuted: true,
          dynamic: true
        },
        { type: 'tool-result', toolCallId: 'ws_1', toolName: 'web_search', result: { hits: 1 }, dynamic: true },
        ...textParts('t', 'Found it.'),
        finish('stop')
      ]
    ])
    const unmapped: UnmappedStreamPart[] = []
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      sideChannel: { onUnmappedPart: (part) => unmapped.push(part) }
    })
    await session.prompt('search')

    const message = lastAssistant(session)
    expect(message.stopReason).toBe('stop')
    expect(message.content.map((b) => b.type)).toEqual(['text'])
    expect(unmapped.map((p) => p.type)).toEqual(['tool-call', 'tool-result'])
  })

  it('runs a tool round trip through a real provider package over HTTP', async () => {
    const weatherCalls: unknown[] = []
    const bodies: { tools?: { function: { name: string } }[]; messages: Record<string, any>[] }[] = []
    const sse = (chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
    const base = { id: 'cmpl', object: 'chat.completion.chunk', created: 1, model: 'gpt-x' }
    const delta = (value: object, extra: object = {}) => ({ ...base, choices: [{ index: 0, delta: value, ...extra }] })
    const server = createServer((req, res) => {
      let raw = ''
      req.on('data', (d) => (raw += d))
      req.on('end', () => {
        bodies.push(JSON.parse(raw))
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(
          bodies.length === 1
            ? sse([
                delta({ role: 'assistant', reasoning_content: 'look it up' }),
                delta({
                  tool_calls: [
                    { index: 0, id: 'call_x', type: 'function', function: { name: 'get_weather', arguments: '{"ci' } }
                  ]
                }),
                delta({ tool_calls: [{ index: 0, function: { arguments: 'ty":"Tokyo"}' } }] }),
                { ...delta({}, { finish_reason: 'tool_calls' }), usage: { prompt_tokens: 20, completion_tokens: 8 } }
              ])
            : sse([
                delta({ role: 'assistant', content: 'Tokyo is sunny.' }),
                { ...delta({}, { finish_reason: 'stop' }), usage: { prompt_tokens: 40, completion_tokens: 4 } }
              ])
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const provider = createOpenAICompatible({
        name: 'local',
        baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        apiKey: 'k',
        includeUsage: true
      })
      const { session } = await createTestSession({
        port: streamTextPort(provider.chatModel('gpt-x')).port,
        tools: [weatherTool(weatherCalls)]
      })
      await session.prompt('Weather in Tokyo?')

      expect(weatherCalls).toEqual([{ city: 'Tokyo' }])
      expect(bodies).toHaveLength(2)
      expect(bodies[0].tools?.[0].function.name).toBe('get_weather')
      const second = bodies[1].messages
      expect(second.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
      expect(second[2].tool_calls[0]).toMatchObject({ id: 'call_x', function: { arguments: '{"city":"Tokyo"}' } })
      expect(second[3]).toMatchObject({ tool_call_id: 'call_x', content: 'Sunny, 25C in Tokyo' })
      const message = lastAssistant(session)
      expect(message.content).toEqual([{ type: 'text', text: 'Tokyo is sunny.' }])
      expect(message.usage.input).toBe(40)
    } finally {
      server.close()
    }
  })
})
