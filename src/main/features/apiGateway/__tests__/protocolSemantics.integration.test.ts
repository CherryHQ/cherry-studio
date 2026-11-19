import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { ChatCompletionChunk } from '@cherrystudio/openai/resources'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import '@data/services/ProviderRegistryService'
import { AiService } from '@main/ai/AiService'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import type * as CustomFetch from '@main/ai/utils/customFetch'
import { BaseService } from '@main/core/lifecycle'
import { ENDPOINT_TYPE, MODEL_CAPABILITY, type EndpointType } from '@shared/data/types/model'

import type { InputFormat } from '../adapters/interfaces'
import { gatewayErrorHandler } from '../errors'
import { createGatewayObjectTransports } from '../objectStream'
import { processMessage } from '../proxyStream'
import { chatRoutes } from '../routes/chat'
import { messagesRoutes } from '../routes/messages'
import { responsesRoutes } from '../routes/responses'

const mocks = vi.hoisted(() => ({
  transport: vi.fn<typeof fetch>(),
  manager: undefined as AiStreamManager | undefined,
  ai: undefined as AiService | undefined
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = {
    ...defaultServiceInstances,
    AiStreamManager: {
      streamPrompt: (input: Parameters<AiStreamManager['streamPrompt']>[0]) => mocks.manager!.streamPrompt(input),
      abort: (id: string) => mocks.manager!.abort(id, 'client disconnected')
    },
    AiService: { streamText: (input: Parameters<AiService['streamText']>[0]) => mocks.ai!.streamText(input) },
    ApiGatewayService: {
      isInternalRequest: () => false,
      getAgentSessionId: () => undefined,
      resolveAgentSessionUsage: () => undefined
    }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('@main/ai/utils/customFetch', async (original) => ({
  ...(await original<typeof CustomFetch>()),
  customFetch: mocks.transport
}))

const LOGPROBS = [{ token: 'Done', logprob: -0.25, top_logprobs: [{ token: 'Done', logprob: -0.25 }] }]

function chatResponse(text = 'Done', reason = 'stop') {
  return new Response(
    `data: ${JSON.stringify({
      id: 'upstream',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: text }, logprobs: { content: LOGPROBS }, finish_reason: reason }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } }
  )
}

function sse(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })
}

function anthropicResponse(text = 'Done', reason = 'end_turn') {
  return sse([
    {
      type: 'message_start',
      message: {
        id: 'upstream',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 }
      }
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: reason, stop_sequence: reason === 'stop_sequence' ? 'END' : null },
      usage: { output_tokens: 5 }
    },
    { type: 'message_stop' }
  ])
}

function responsesResponse(text = 'Done', reason?: string) {
  return sse([
    { type: 'response.created', response: { id: 'upstream', created_at: 1, model: 'gpt-4o', status: 'in_progress' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'message', id: 'msg-upstream', role: 'assistant', content: [] }
    },
    {
      type: 'response.output_text.delta',
      item_id: 'msg-upstream',
      output_index: 0,
      content_index: 0,
      delta: text,
      logprobs: LOGPROBS
    },
    {
      type: reason ? 'response.incomplete' : 'response.completed',
      response: {
        id: 'upstream',
        service_tier: 'priority',
        incomplete_details: reason ? { reason } : null,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
      }
    }
  ])
}

describe('native request semantics through production gateway execution', () => {
  const dbh = setupTestDatabase()
  let imageUrl: string
  beforeAll(async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    imageUrl = `data:image/png;base64,${png.toString('base64')}`
  })
  let bodies: Array<Record<string, unknown>>
  let upstream: () => Response
  let responseText: string
  beforeEach(() => {
    BaseService.resetInstances()
    mocks.manager = new AiStreamManager()
    mocks.ai = new AiService()
    mocks.transport.mockReset()
    bodies = []
    upstream = () => chatResponse()
    mocks.transport.mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return upstream()
    })
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, file) =>
      key === 'feature.provider_registry.data'
        ? resolve('packages/provider-registry/data', file ?? '')
        : getPath(key, file)
    )
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'wire',
        name: 'Wire',
        isEnabled: true,
        orderKey: 'a0',
        apiKeys: [{ id: 'key', key: 'test-secret', isEnabled: true }],
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://upstream.test/v1', adapterFamily: 'openai' }
        },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'wire::gpt-4o',
        providerId: 'wire',
        modelId: 'gpt-4o',
        name: 'Wire model',
        capabilities: [
          MODEL_CAPABILITY.FUNCTION_CALL,
          MODEL_CAPABILITY.IMAGE_RECOGNITION,
          MODEL_CAPABILITY.AUDIO_RECOGNITION
        ],
        supportsStreaming: true,
        isEnabled: true,
        orderKey: 'a0',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })
      .run()
  })
  afterEach(() => vi.restoreAllMocks())

  const tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }]
  async function chat(overrides: Record<string, unknown> = {}) {
    const response = await processMessage({
      inputFormat: 'openai',
      outputFormat: 'openai',
      params: {
        model: 'wire:gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        ...overrides
      }
    })
    responseText = await response.text()
    return response
  }

  it.each(['none', 'auto', 'required', { type: 'function', function: { name: 'lookup' } }])(
    'preserves tool selection %j and disables parallel execution on the upstream wire',
    async (choice) => {
      await chat({ tools, tool_choice: choice, parallel_tool_calls: false })
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toMatchObject({ tool_choice: choice, parallel_tool_calls: false })
    }
  )

  it('preserves zero-valued seed and penalties rather than defaulting them away', async () => {
    await chat({ seed: 0, frequency_penalty: 0.25, presence_penalty: -0.5 })
    expect(bodies[0]).toMatchObject({ seed: 0, frequency_penalty: 0.25, presence_penalty: -0.5 })
  })

  it('retains audio-only input as input_audio instead of dropping the message', async () => {
    await chat({
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { format: 'wav', data: 'UklGRg==' } }] }]
    })
    expect(bodies[0].messages).toEqual([
      { role: 'user', content: [{ type: 'input_audio', input_audio: { format: 'wav', data: 'UklGRg==' } }] }
    ])
  })

  function target(endpoint: EndpointType, modelId = 'gpt-4o') {
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: {
          [endpoint]: {
            baseUrl: 'https://upstream.test/v1',
            adapterFamily: endpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ? 'anthropic' : 'openai'
          }
        },
        defaultChatEndpoint: endpoint
      })
      .where(eq(userProviderTable.providerId, 'wire'))
      .run()
    dbh.db
      .update(userModelTable)
      .set({ modelId, endpointTypes: [endpoint] })
      .where(eq(userModelTable.id, 'wire::gpt-4o'))
      .run()
  }

  async function native(
    format: InputFormat,
    overrides: Record<string, unknown> = {},
    stream = false,
    modelId = 'gpt-4o'
  ) {
    const app = new Elysia()
      .onError(gatewayErrorHandler)
      .group('/v1', (app) => app.use(chatRoutes).use(responsesRoutes).use(messagesRoutes))
    const path = format === 'openai' ? 'chat/completions' : format === 'openai-responses' ? 'responses' : 'messages'
    const body = {
      model: `wire:${modelId}`,
      stream,
      ...(format === 'openai-responses' ? { input: 'Hello' } : { messages: [{ role: 'user', content: 'Hello' }] }),
      ...(format === 'anthropic' ? { max_tokens: 1024 } : {}),
      ...overrides
    }
    const response = await app.handle(
      new Request(`http://localhost/v1/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    )
    responseText = await response.text()
    return { response, body: stream ? responseText : JSON.parse(responseText) }
  }

  it.each(['wav', 'mp3'])('preserves %s audio and image detail on the wire', async (format) => {
    await chat({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            { type: 'input_audio', input_audio: { data: 'YXVkaW8=', format } }
          ]
        }
      ]
    })
    expect(bodies[0].messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          { type: 'input_audio', input_audio: { data: 'YXVkaW8=', format } }
        ]
      }
    ])
  })

  it('retains file-only Chat PDF input with its filename', async () => {
    await chat({
      messages: [{ role: 'user', content: [{ type: 'file', file: { filename: 'report.pdf', file_data: 'JVBERg==' } }] }]
    })
    expect(bodies[0].messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'file', file: { filename: 'report.pdf', file_data: 'data:application/pdf;base64,JVBERg==' } }]
      }
    ])
  })

  it.each(['none', 'auto', 'required', { type: 'function', name: 'lookup' }])(
    'serializes Responses tool choice %j and native controls',
    async (choice) => {
      target(ENDPOINT_TYPE.OPENAI_RESPONSES)
      upstream = () => responsesResponse()
      const result = await native('openai-responses', {
        tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object', properties: {} } }],
        tool_choice: choice,
        parallel_tool_calls: false,
        text: { verbosity: 'low' },
        truncation: 'disabled',
        service_tier: 'priority',
        include: ['message.output_text.logprobs'],
        top_logprobs: 2
      })
      expect(result.response.status).toBe(200)
      expect(bodies[0]).toMatchObject({
        tool_choice: choice,
        parallel_tool_calls: false,
        text: { verbosity: 'low' },
        truncation: 'disabled',
        service_tier: 'priority',
        top_logprobs: 2,
        include: ['message.output_text.logprobs'],
        store: false
      })
      expect(result.body.service_tier).toBe('priority')
      expect(
        result.body.output.find((item: { type: string }) => item.type === 'message').content[0].logprobs
      ).toMatchObject(LOGPROBS)
      expect(bodies[0]).not.toHaveProperty('seed')
      expect(bodies[0]).not.toHaveProperty('frequency_penalty')
    }
  )

  it('preserves standard Responses reasoning along with unrelated options', async () => {
    target(ENDPOINT_TYPE.OPENAI_RESPONSES, 'o3')
    upstream = () => responsesResponse()
    const result = await native(
      'openai-responses',
      {
        reasoning: { effort: 'high', summary: 'detailed' },
        reasoning_effort: 'low',
        service_tier: 'flex',
        truncation: 'disabled'
      },
      false,
      'o3'
    )
    expect(result.response.status).toBe(200)
    expect(bodies[0]).toMatchObject({
      reasoning: { effort: 'high', summary: 'detailed' },
      service_tier: 'flex',
      truncation: 'disabled'
    })
  })

  it.each([false, true])(
    'preserves Responses native metadata in complete/stream output (stream=%s)',
    async (stream) => {
      target(ENDPOINT_TYPE.OPENAI_RESPONSES)
      upstream = () => responsesResponse()
      const result = await native('openai-responses', { include: ['message.output_text.logprobs'] }, stream)
      expect(result.response.status).toBe(200)
      if (stream) {
        const events = responseText
          .split('\n')
          .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
          .map((line) => JSON.parse(line.slice(6)))
        expect(events.find((event) => event.type === 'response.output_text.done').logprobs).toMatchObject(LOGPROBS)
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'response.completed',
            response: expect.objectContaining({ service_tier: 'priority' })
          })
        )
      } else expect(result.body.service_tier).toBe('priority')
    }
  )

  it.each([false, true])('retains Chat logprobs in complete/stream output (stream=%s)', async (stream) => {
    const result = await native('openai', { logprobs: true, top_logprobs: 2, service_tier: 'priority' }, stream)
    expect(result.response.status).toBe(200)
    expect(bodies[0]).toMatchObject({ logprobs: true, top_logprobs: 2, service_tier: 'priority' })
    const output = stream
      ? responseText
          .split('\n')
          .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
          .map((line) => JSON.parse(line.slice(6)))
          .at(-1)
      : result.body
    expect(output.choices[0].logprobs.content).toMatchObject(LOGPROBS)
  })

  it.each(['stop_sequence', 'pause_turn'])('preserves Anthropic %s and its native stop string', async (reason) => {
    target(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'claude-sonnet-4-6')
    upstream = () => anthropicResponse('Done', reason)
    for (const stream of [false, true]) {
      const result = await native('anthropic', {}, stream, 'claude-sonnet-4-6')
      expect(result.response.status).toBe(200)
      const output = stream
        ? responseText
            .split('\n')
            .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
            .map((line) => JSON.parse(line.slice(6)))
            .find((event) => event.type === 'message_delta').delta
        : result.body
      expect(output).toMatchObject({ stop_reason: reason, stop_sequence: reason === 'stop_sequence' ? 'END' : null })
    }
  })

  it.each(['base64', 'url', 'text'])('retains Anthropic %s documents and document-only messages', async (type) => {
    target(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'claude-sonnet-4-6')
    upstream = () => anthropicResponse()
    const source =
      type === 'base64'
        ? { type, media_type: 'application/pdf', data: 'JVBERg==' }
        : type === 'url'
          ? { type, url: 'https://files.test/report.pdf' }
          : { type, media_type: 'text/plain', data: 'Document contents' }
    const document = {
      type: 'document',
      title: 'Report',
      context: 'Review this report',
      source,
      cache_control: { type: 'ephemeral' }
    }
    const result = await native(
      'anthropic',
      { messages: [{ role: 'user', content: [document] }] },
      false,
      'claude-sonnet-4-6'
    )
    expect(result.response.status).toBe(200)
    expect(bodies[0].messages).toMatchObject([{ role: 'user', content: [document] }])
  })

  it.each(['url', 'base64'])('retains Responses %s user files without text', async (kind) => {
    target(ENDPOINT_TYPE.OPENAI_RESPONSES)
    upstream = () => responsesResponse()
    const file =
      kind === 'url'
        ? { type: 'input_file', file_url: 'https://files.test/report.pdf' }
        : { type: 'input_file', filename: 'report.pdf', file_data: 'data:application/pdf;base64,JVBERg==' }
    const result = await native('openai-responses', { input: [{ role: 'user', content: [file] }] })
    expect(result.response.status).toBe(200)
    expect(bodies[0].input).toEqual([{ role: 'user', content: [file] }])
  })

  const schema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false
  }
  it.each(['openai', 'openai-responses', 'anthropic'] as const)(
    'preserves JSON schema through %s HTTP output configuration',
    async (format) => {
      if (format === 'openai-responses') target(ENDPOINT_TYPE.OPENAI_RESPONSES)
      if (format === 'anthropic') target(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'claude-sonnet-4-6')
      upstream = () =>
        format === 'openai'
          ? chatResponse('{"answer":"yes"}')
          : format === 'anthropic'
            ? anthropicResponse('{"answer":"yes"}')
            : responsesResponse('{"answer":"yes"}')
      for (const stream of [false, true]) {
        const options =
          format === 'openai'
            ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema, strict: true } } }
            : format === 'openai-responses'
              ? { text: { format: { type: 'json_schema', name: 'answer', schema, strict: true } } }
              : { output_config: { format: { type: 'json_schema', schema } } }
        const result = await native(format, options, stream, format === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
        expect(result.response.status).toBe(200)
        expect(responseText).toContain(stream ? 'answer' : 'yes')
        expect(bodies.at(-1)).toMatchObject(
          format === 'openai'
            ? { response_format: { type: 'json_schema', json_schema: { schema } } }
            : format === 'openai-responses'
              ? { text: { format: { type: 'json_schema', schema } } }
              : { output_config: { format: { type: 'json_schema', schema } } }
        )
      }
    }
  )

  it.each(['openai', 'openai-responses'] as const)('preserves %s JSON mode and length termination', async (format) => {
    if (format === 'openai-responses') target(ENDPOINT_TYPE.OPENAI_RESPONSES)
    upstream = () =>
      format === 'openai' ? chatResponse('{"answer":', 'length') : responsesResponse('{"answer":', 'max_output_tokens')
    const options =
      format === 'openai' ? { response_format: { type: 'json_object' } } : { text: { format: { type: 'json_object' } } }
    for (const stream of [false, true]) {
      const result = await native(format, options, stream)
      expect(result.response.status).toBe(200)
      expect(responseText).toContain(format === 'openai' ? 'length' : 'max_output_tokens')
      expect(bodies.at(-1)).toMatchObject(
        format === 'openai'
          ? { response_format: { type: 'json_object' } }
          : { text: { format: { type: 'json_object' } } }
      )
    }
  })

  it('keeps trusted object reasoning priority while preserving other request controls', async () => {
    target(ENDPOINT_TYPE.OPENAI_RESPONSES, 'o3')
    upstream = () => responsesResponse()
    const transports = createGatewayObjectTransports({
      agentContext: {
        agentSessionId: 'session',
        reasoningEffort: 'low',
        fastMode: false,
        resolveUsage: () => undefined
      }
    })
    const response = await transports['openai-responses'](
      {
        model: 'wire:o3',
        stream: true,
        input: 'Hello',
        reasoning: { effort: 'high', summary: 'detailed' },
        parallel_tool_calls: false,
        truncation: 'disabled',
        service_tier: 'flex'
      },
      {}
    )
    const events: unknown[] = []
    for await (const event of response.events) events.push(event)
    expect(events.length).toBeGreaterThan(0)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      reasoning: { effort: 'low', summary: 'detailed' },
      parallel_tool_calls: false,
      truncation: 'disabled',
      service_tier: 'flex'
    })
  })

  it.each([
    { format: 'openai', options: { n: 2 } },
    {
      format: 'openai',
      options: { messages: [{ role: 'user', content: [{ type: 'file', file: { file_id: 'file-secret' } }] }] }
    },
    { format: 'openai-responses', options: { previous_response_id: 'resp-old' } },
    { format: 'openai-responses', options: { conversation: 'conv-old' } },
    { format: 'openai-responses', options: { background: true } },
    { format: 'openai-responses', options: { store: true } },
    { format: 'openai-responses', options: { tools: [{ type: 'web_search_preview' }] } },
    {
      format: 'openai-responses',
      options: { input: [{ role: 'user', content: [{ type: 'input_file', file_id: 'file-secret' }] }] }
    },
    { format: 'anthropic', options: { tools: [{ type: 'bash_20250124', name: 'bash' }] } }
  ])('rejects unsupported $format semantics before upstream execution: $options', async ({ format, options }) => {
    const inputFormat = format === 'openai' ? 'openai' : format === 'anthropic' ? 'anthropic' : 'openai-responses'
    const result = await native(inputFormat, options)
    expect(result.response.status).toBeGreaterThanOrEqual(400)
    expect(responseText).toMatch(/not supported/)
    expect(bodies).toEqual([])
  })

  it('preserves adaptive thinking display and binding without dropping unrelated cache controls', async () => {
    target(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'claude-sonnet-4-6')
    upstream = () => anthropicResponse()
    const result = await native(
      'anthropic',
      {
        thinking: { type: 'adaptive', display: 'omitted', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
        cache_control: { type: 'ephemeral', ttl: '1h' },
        tool_choice: { type: 'auto', disable_parallel_tool_use: true }
      },
      false,
      'claude-sonnet-4-6'
    )
    expect(result.response.status).toBe(200)
    expect(bodies[0]).toMatchObject({
      thinking: { type: 'adaptive', display: 'omitted', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      cache_control: { type: 'ephemeral', ttl: '1h' }
    })
  })

  it('preserves document attachments on parallel tool results with the correct call identity', async () => {
    target(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'claude-sonnet-4-6')
    upstream = () => anthropicResponse()
    const result = await native(
      'anthropic',
      {
        tools: [{ name: 'report', input_schema: { type: 'object', properties: {} } }],
        messages: [
          { role: 'user', content: 'Fetch reports' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'one', name: 'report', input: {} },
              { type: 'tool_use', id: 'two', name: 'report', input: {} }
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'two',
                content: [
                  {
                    type: 'document',
                    title: 'Second',
                    source: { type: 'base64', media_type: 'application/pdf', data: 'U0VDT05E' }
                  }
                ]
              },
              {
                type: 'tool_result',
                tool_use_id: 'one',
                content: [
                  {
                    type: 'document',
                    title: 'First',
                    source: { type: 'base64', media_type: 'application/pdf', data: 'RklSU1Q=' }
                  }
                ]
              }
            ]
          }
        ]
      },
      false,
      'claude-sonnet-4-6'
    )
    expect(result.response.status).toBe(200)
    expect(bodies[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: expect.stringContaining('call_id="two"') }),
            expect.objectContaining({
              type: 'document',
              title: 'Second',
              source: { type: 'base64', media_type: 'application/pdf', data: 'U0VDT05E' }
            }),
            expect.objectContaining({ type: 'text', text: expect.stringContaining('call_id="one"') }),
            expect.objectContaining({
              type: 'document',
              title: 'First',
              source: { type: 'base64', media_type: 'application/pdf', data: 'RklSU1Q=' }
            })
          ])
        })
      ])
    )
    const assistant = JSON.stringify(bodies[0])
    expect(assistant).toContain('tool_use')
  })

  it('maps Chat tool and parallel restrictions onto an Anthropic target', async () => {
    target(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'claude-sonnet-4-6')
    upstream = () => anthropicResponse()
    const result = await native(
      'openai',
      { tools, tool_choice: 'required', parallel_tool_calls: false },
      false,
      'claude-sonnet-4-6'
    )
    expect(result.response.status).toBe(200)
    expect(bodies[0]).toMatchObject({ tool_choice: { type: 'any', disable_parallel_tool_use: true } })
  })

  it('maps Anthropic parallel restrictions onto an OpenAI target', async () => {
    const result = await native('anthropic', {
      tools: [{ name: 'lookup', input_schema: { type: 'object', properties: {} } }],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true }
    })
    expect(result.response.status).toBe(200)
    expect(bodies[0]).toMatchObject({ tool_choice: 'auto', parallel_tool_calls: false })
  })

  it('preserves genuine upstream HTTP errors with structured output enabled', async () => {
    upstream = () =>
      new Response(JSON.stringify({ error: { message: 'upstream overloaded', type: 'rate_limit_error' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' }
      })
    for (const stream of [false, true]) {
      const result = await native(
        'openai',
        { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } } },
        stream
      )
      expect(result.response.status).toBe(429)
      expect(responseText).toContain('upstream overloaded')
    }
    expect(bodies).toHaveLength(2)
  })

  it('keeps object capability failures local rather than inventing an upstream HTTP status', async () => {
    const transports = createGatewayObjectTransports({
      agentContext: {
        agentSessionId: 'session',
        reasoningEffort: 'default',
        fastMode: false,
        resolveUsage: () => undefined
      }
    })
    const result = transports['openai-responses'](
      { model: 'wire:gpt-4o', stream: true, input: 'Hello', previous_response_id: 'resp-old' },
      {}
    )
    await expect(result).rejects.toMatchObject({ name: 'AI_UnsupportedFunctionalityError' })
    await expect(result).rejects.not.toHaveProperty('status')
    expect(bodies).toEqual([])
  })

  it('preserves object tool/schema/attachment requests through the same execution path', async () => {
    const transports = createGatewayObjectTransports({
      agentContext: {
        agentSessionId: 'session',
        reasoningEffort: 'default',
        fastMode: false,
        resolveUsage: () => undefined
      }
    })
    upstream = () => chatResponse('{"answer":"yes"}')
    const response = await transports['openai-completions'](
      {
        model: 'wire:gpt-4o',
        stream: true,
        messages: [
          { role: 'user', content: [{ type: 'file', file: { filename: 'report.pdf', file_data: 'JVBERg==' } }] }
        ],
        tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }],
        tool_choice: 'none',
        parallel_tool_calls: false,
        response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } }
      },
      {}
    )
    const events: ChatCompletionChunk[] = []
    for await (const event of response.events) events.push(event)
    expect(events.at(-1)).toMatchObject({ choices: [{ finish_reason: 'stop' }] })
    expect(bodies[0]).toMatchObject({
      tool_choice: 'none',
      parallel_tool_calls: false,
      response_format: { type: 'json_schema', json_schema: { schema } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'file', file: { filename: 'report.pdf', file_data: 'data:application/pdf;base64,JVBERg==' } }
          ]
        }
      ]
    })
  })

  it('keeps trusted service tier priority over the body without dropping native options', async () => {
    target(ENDPOINT_TYPE.OPENAI_RESPONSES, 'o3')
    upstream = () => responsesResponse()
    const transports = createGatewayObjectTransports({
      agentContext: {
        agentSessionId: 'session',
        reasoningEffort: 'low',
        serviceTier: 'standard',
        fastMode: false,
        resolveUsage: () => undefined
      }
    })
    const response = await transports['openai-responses'](
      { model: 'wire:o3', stream: true, input: 'Hello', service_tier: 'flex', truncation: 'disabled' },
      {}
    )
    const events: unknown[] = []
    for await (const event of response.events) events.push(event)
    expect(events.length).toBeGreaterThan(0)
    expect(bodies[0]).not.toHaveProperty('service_tier')
    expect(bodies[0]).toMatchObject({ truncation: 'disabled' })
  })

  it.each(['openai', 'openai-responses'] as const)(
    'rejects parallel restrictions missing in a generic %s SDK adapter',
    async (format) => {
      const endpoint = format === 'openai' ? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS : ENDPOINT_TYPE.OPENAI_RESPONSES
      target(endpoint)
      dbh.db
        .update(userProviderTable)
        .set({
          endpointConfigs: {
            [endpoint]: {
              baseUrl: 'https://upstream.test/v1',
              adapterFamily: format === 'openai' ? 'openai-compatible' : 'open-responses'
            }
          }
        })
        .where(eq(userProviderTable.providerId, 'wire'))
        .run()
      const result = await native(format, { parallel_tool_calls: false })
      expect(result.response.status).toBe(400)
      expect(responseText).toContain('not supported')
      expect(bodies).toEqual([])
    }
  )

  it('rejects Chat seed/penalties when the target is Responses rather than silently losing them', async () => {
    target(ENDPOINT_TYPE.OPENAI_RESPONSES)
    const result = await native('openai', { seed: 0, frequency_penalty: 0.5 })
    expect(result.response.status).toBe(400)
    expect(responseText).toContain('Seed/penalties')
    expect(bodies).toEqual([])
  })

  it.each([
    { truncation: 'disabled' },
    { reasoning: { summary: 'detailed' } },
    { include: ['reasoning.encrypted_content'] }
  ])('rejects Responses-only controls on a Chat target: %j', async (options) => {
    const result = await native('openai-responses', options)
    expect(result.response.status).toBe(400)
    expect(responseText).toContain('Responses-only options')
    expect(bodies).toEqual([])
  })

  it.each(['openai', 'openai-responses', 'anthropic'] as const)(
    'preserves schema truncation on %s without hiding it behind JSON parsing',
    async (format) => {
      if (format === 'openai-responses') target(ENDPOINT_TYPE.OPENAI_RESPONSES)
      if (format === 'anthropic') target(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'claude-sonnet-4-6')
      upstream = () =>
        format === 'openai'
          ? chatResponse('{"answer":', 'length')
          : format === 'anthropic'
            ? anthropicResponse('{"answer":', 'max_tokens')
            : responsesResponse('{"answer":', 'max_output_tokens')
      const options =
        format === 'openai'
          ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } } }
          : format === 'openai-responses'
            ? { text: { format: { type: 'json_schema', name: 'answer', schema } } }
            : { output_config: { format: { type: 'json_schema', schema } } }
      for (const stream of [false, true]) {
        const result = await native(format, options, stream, format === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
        expect(result.response.status).toBe(200)
        expect(responseText).toContain(
          format === 'openai' ? 'length' : format === 'anthropic' ? 'max_tokens' : 'max_output_tokens'
        )
      }
    }
  )

  it.each(['image', 'audio'] as const)(
    'rejects model-incompatible %s input before attachment routing can replace it with text',
    async (kind) => {
      dbh.db
        .update(userModelTable)
        .set({ modelId: 'text-only', capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
        .where(eq(userModelTable.id, 'wire::gpt-4o'))
        .run()
      const content =
        kind === 'image'
          ? { type: 'image_url', image_url: { url: imageUrl } }
          : { type: 'input_audio', input_audio: { format: 'wav', data: 'UklGRg==' } }
      const result = await native('openai', { messages: [{ role: 'user', content: [content] }] }, false, 'text-only')
      expect(result.response.status).toBe(400)
      expect(responseText).toContain('Model input media')
      expect(bodies).toEqual([])
    }
  )

  it('rejects JSON object mode in the generic Open Responses adapter before sending an invalid schema request', async () => {
    target(ENDPOINT_TYPE.OPENAI_RESPONSES)
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://upstream.test/v1', adapterFamily: 'open-responses' }
        }
      })
      .where(eq(userProviderTable.providerId, 'wire'))
      .run()
    const result = await native('openai-responses', { text: { format: { type: 'json_object' } } })
    expect(result.response.status).toBe(400)
    expect(responseText).toContain('JSON object mode')
    expect(bodies).toEqual([])
  })
})
