import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { normalizeContext } from '@earendil-works/pi-ai'
import type { Message } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { application } from '@application'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { ENDPOINT_TYPE, ModelSchema } from '@shared/data/types/model'
import { ProviderSchema } from '@shared/data/types/provider'

import { createPiGatewayModelBinding } from './gatewayModelBinding'

const gateway = vi.hoisted(() => ({ baseUrl: '' }))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = {
    ...defaultServiceInstances,
    ApiGatewayService: {
      ensureInternalGateway: async () => ({ baseUrl: gateway.baseUrl, apiKey: 'local-key' }),
      getAgentSessionUsageHeaders: (id: string) => ({ 'x-cherry-agent-session-id': id })
    }
  }
  return mockApplicationFactory(overrides)
})

beforeEach(() => {
  const getPath = vi.mocked(application.getPath).getMockImplementation()!
  vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
    key === 'feature.provider_registry.data' && filename
      ? resolve(process.cwd(), 'packages/provider-registry/data', filename)
      : getPath(key, filename)
  )
  providerRegistryService.clearCache()
})

afterEach(() => {
  vi.restoreAllMocks()
  providerRegistryService.clearCache()
})

it.each([
  ['anthropic-messages', 'anthropic', '/v1/messages'],
  ['openai-chat-completions', 'openai-compatible', '/v1/chat/completions'],
  ['openai-responses', 'openai', '/v1/responses'],
  ['google-generate-content', 'google', '/v1beta/'],
  ['openai-chat-completions', 'azure', '/v1/chat/completions'],
  ['openai-responses', 'azure-responses', '/v1/chat/completions'],
  ['anthropic-messages', 'bedrock', '/v1/chat/completions'],
  ['google-generate-content', 'google-vertex', '/v1/chat/completions'],
  ['anthropic-messages', 'google-vertex-anthropic', '/v1/chat/completions'],
  ['ollama-chat', 'ollama', '/v1/chat/completions']
] as const)('sends %s / %s requests to the internal gateway', async (endpointType, adapterFamily, path) => {
  const requests: { path?: string; key?: string; body: string }[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({
      path: req.url,
      key:
        req.headers.authorization ?? req.headers['x-api-key']?.toString() ?? req.headers['x-goog-api-key']?.toString(),
      body
    })
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'request capture' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test listener')
  gateway.baseUrl = `http://127.0.0.1:${address.port}`
  const provider = ProviderSchema.parse({
    isEnabled: true,
    apiKeys: [],
    authType: 'api-key',
    settings: {},
    id: 'route-fixture',
    name: 'Route fixture',
    reportsActualCost: false,
    defaultChatEndpoint: endpointType,
    endpointConfigs: { [endpointType]: { adapterFamily, baseUrl: 'https://upstream.invalid' } }
  })
  const model = ModelSchema.parse({
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true,
    id: 'route-fixture::logical-model',
    providerId: provider.id,
    name: 'Route fixture',
    apiModelId: 'wire-model',
    capabilities: []
  })
  const binding = await createPiGatewayModelBinding({ sessionId: 'session-1' }, provider, model)
  await binding.modelRuntime.completeSimple(
    binding.model,
    normalizeContext({ messages: [{ role: 'user', content: 'fixture', timestamp: 1 }] })
  )
  expect(requests).toHaveLength(1)
  expect(requests[0].path).toMatch(new RegExp(`^${path}`))
  expect(requests[0].key).toMatch(/^(Bearer )?local-key$/)
  expect(`${requests[0].path} ${requests[0].body}`).toContain('route-fixture:wire-model')
})

it.each(['grok-cli', 'openai-codex'])('registers %s OAuth models with internal credentials', async (providerId) => {
  gateway.baseUrl = 'http://127.0.0.1:23333'
  const provider = ProviderSchema.parse({
    isEnabled: true,
    apiKeys: [],
    authType: 'api-key',
    settings: {},
    id: providerId,
    name: 'OAuth fixture',
    reportsActualCost: false,
    authMethods: ['oauth'],
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES
  })
  const model = ModelSchema.parse({
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true,
    id: `${providerId}::model`,
    providerId,
    name: 'Fixture',
    capabilities: []
  })
  const binding = await createPiGatewayModelBinding({ sessionId: 'session-1' }, provider, model)
  expect(binding.model.api).toBe('openai-responses')
  expect(await binding.modelRuntime.getAuth(binding.model)).toMatchObject({ auth: { apiKey: 'local-key' } })
})

it('prefers a model protocol over the provider default', async () => {
  gateway.baseUrl = 'http://127.0.0.1:23333'
  const provider = ProviderSchema.parse({
    isEnabled: true,
    apiKeys: [],
    authType: 'api-key',
    settings: {},
    id: 'protocol-fixture',
    name: 'Protocol fixture',
    reportsActualCost: false,
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      'openai-chat-completions': { adapterFamily: 'openai-compatible' },
      'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://upstream.invalid' },
      'openai-responses': { adapterFamily: 'openai' }
    }
  })
  for (const endpointTypes of [
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
    [ENDPOINT_TYPE.OPENAI_RESPONSES, ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
  ]) {
    const model = ModelSchema.parse({
      isEnabled: true,
      isHidden: false,
      supportsStreaming: true,
      id: 'protocol-fixture::model',
      providerId: provider.id,
      name: 'Fixture',
      capabilities: [],
      endpointTypes
    })
    const binding = await createPiGatewayModelBinding({ sessionId: 'session-1' }, provider, model)
    expect(binding.model.api).toBe(
      endpointTypes[0] === ENDPOINT_TYPE.OPENAI_RESPONSES ? 'openai-responses' : 'anthropic-messages'
    )
  }
})

it.each([{ capabilities: ['image-recognition'] }, { capabilities: [], inputModalities: ['image'] }])(
  'registers image and capacity facts used by native execution',
  async (imageSupport) => {
    gateway.baseUrl = 'http://127.0.0.1:23333'
    const provider = ProviderSchema.parse({
      isEnabled: true,
      apiKeys: [],
      authType: 'api-key',
      settings: {},
      id: 'capacity-fixture',
      name: 'Fixture',
      reportsActualCost: false
    })
    const model = ModelSchema.parse({
      isEnabled: true,
      isHidden: false,
      supportsStreaming: true,
      id: 'capacity-fixture::model',
      providerId: provider.id,
      name: 'Fixture',
      contextWindow: 200_000,
      maxOutputTokens: 32_768,
      ...imageSupport
    })
    const binding = await createPiGatewayModelBinding({ sessionId: 'session-1' }, provider, model)
    expect(binding.model).toMatchObject({ input: ['text', 'image'], contextWindow: 200_000, maxTokens: 32_768 })
  }
)

it.each(['custom:anthropic', 'claude-code'])('rejects an unroutable provider %s', async (providerId) => {
  const provider = ProviderSchema.parse({
    isEnabled: true,
    apiKeys: [],
    authType: 'api-key',
    settings: {},
    id: providerId,
    name: 'Fixture',
    reportsActualCost: false,
    ...(providerId === 'claude-code' ? { authMethods: ['external-cli'] } : {})
  })
  const model = ModelSchema.parse({
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true,
    id: `${providerId}::model`,
    providerId,
    name: 'Fixture',
    capabilities: []
  })
  await expect(createPiGatewayModelBinding({ sessionId: 'session-1' }, provider, model)).rejects.toThrow(
    'cannot be routed through the internal gateway'
  )
})

it('preserves a per-call output cap when native reasoning disagrees with the gateway selection', async () => {
  const requests: { maxTokens: number; thinkingBudget?: number; reasoning?: string }[] = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push({
      maxTokens: body.max_tokens,
      thinkingBudget: body.thinking?.budget_tokens,
      reasoning: req.headers['x-cherry-reasoning-effort']?.toString()
    })
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'fixture captures the request without running a model' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test listener')
  gateway.baseUrl = `http://127.0.0.1:${address.port}`
  const provider = ProviderSchema.parse({
    id: 'anthropic-fixture',
    name: 'Anthropic fixture',
    isEnabled: true,
    reportsActualCost: false,
    apiKeys: [],
    authType: 'api-key',
    settings: {},
    defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  })
  const model = ModelSchema.parse({
    id: 'anthropic-fixture::claude-sonnet-4-5',
    providerId: provider.id,
    name: 'Budget fixture',
    apiModelId: 'claude-sonnet-4-5',
    capabilities: ['reasoning'],
    contextWindow: 128000,
    maxOutputTokens: 32768,
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true
  })
  const binding = await createPiGatewayModelBinding(
    { sessionId: 'session-1', reasoningEffort: 'ultra' },
    provider,
    model
  )
  await binding.modelRuntime.completeSimple(
    binding.model,
    normalizeContext({
      messages: [{ role: 'user', content: 'fixture', timestamp: 1 }]
    }),
    { reasoning: 'high', maxTokens: 256 }
  )
  expect(requests).toEqual([{ maxTokens: 256, thinkingBudget: undefined, reasoning: 'ultra' }])
})

it.each(['same', 'provider', 'model', 'api'])(
  'replays Google signatures with %s history ownership after reconnect',
  async (ownership) => {
    type Part = { functionCall?: { name: string; args: unknown }; text?: string; thoughtSignature?: string }
    const requests: Array<{ contents: Array<{ role: string; parts: Part[] }> }> = []
    const signature = Buffer.from('fixture-tool-signature').toString('base64')
    const nextSignature = Buffer.from('fixture-next-tool-signature').toString('base64')
    const textSignature = Buffer.from('fixture-text-signature').toString('base64')
    const call = (id: string, thoughtSignature?: string): Part => ({
      functionCall: { name: 'read', args: { path: `${id}.txt` } },
      ...(thoughtSignature ? { thoughtSignature } : {})
    })
    const responses: Part[][] = [
      [call('a', signature), call('b')],
      [call('c', nextSignature)],
      [{ text: 'complete', thoughtSignature: textSignature }],
      [{ text: 'continued' }]
    ]
    const server = createServer(async (req, res) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      requests.push(JSON.parse(raw))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        `data: ${JSON.stringify({
          candidates: [{ content: { role: 'model', parts: responses[requests.length - 1] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
        })}\n\n`
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test listener')
    gateway.baseUrl = `http://127.0.0.1:${address.port}`
    const provider = ProviderSchema.parse({
      id: 'google-fixture',
      name: 'Google fixture',
      reportsActualCost: false,
      isEnabled: true,
      apiKeys: [],
      authType: 'api-key',
      settings: {},
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    })
    const model = ModelSchema.parse({
      id: 'google-fixture::gemini-4-argon',
      providerId: provider.id,
      name: 'Gemini fixture',
      apiModelId: 'gemini-4-argon',
      capabilities: [],
      isEnabled: true,
      isHidden: false,
      supportsStreaming: true
    })
    const binding = await createPiGatewayModelBinding({ sessionId: 'session-1' }, provider, model)
    const history: Message[] = [{ role: 'user', content: 'Read fixtures.', timestamp: 1 }]
    for (let step = 0; step < 3; step++) {
      const answer = await binding.modelRuntime.completeSimple(binding.model, normalizeContext({ messages: history }))
      expect(answer.stopReason, answer.errorMessage).toBe(step < 2 ? 'toolUse' : 'stop')
      history.push(answer)
      for (const part of answer.content) {
        if (part.type !== 'toolCall') continue
        history.push({
          role: 'toolResult',
          toolCallId: part.id,
          toolName: part.name,
          content: [{ type: 'text', text: 'fixture content' }],
          isError: false,
          timestamp: step + 2
        })
      }
    }
    const calls = (request: (typeof requests)[number]) =>
      request.contents.flatMap((content) => content.parts.filter((part) => part.functionCall))
    expect(calls(requests[1])).toEqual([call('a', signature), call('b')])
    expect(calls(requests[2])).toEqual([call('a', signature), call('b'), call('c', nextSignature)])

    const restored: Message[] = JSON.parse(JSON.stringify(history))
    for (const message of restored) {
      if (message.role !== 'assistant') continue
      if (ownership === 'provider') message.provider = 'foreign-provider'
      if (ownership === 'model') message.model = 'google-fixture:other-model'
      if (ownership === 'api') message.api = 'openai-completions'
    }
    restored.push({ role: 'user', content: 'Continue.', timestamp: 5 })
    const saved = JSON.stringify(restored)
    const reopened = await createPiGatewayModelBinding({ sessionId: 'session-1' }, provider, model)
    const result = await reopened.modelRuntime.completeSimple(reopened.model, normalizeContext({ messages: restored }))
    expect(result.stopReason).toBe('stop')
    expect(JSON.stringify(restored)).toBe(saved)
    expect(calls(requests[3])).toEqual(
      ownership === 'same'
        ? [call('a', signature), call('b'), call('c', nextSignature)]
        : [call('a'), call('b'), call('c')]
    )
    expect(requests[3].contents.flatMap((content) => content.parts).filter((part) => part.text === 'complete')).toEqual(
      [ownership === 'same' ? { text: 'complete', thoughtSignature: textSignature } : { text: 'complete' }]
    )
  }
)

it('preserves each model route and usage owner when a child shares the native gateway registry', async () => {
  const requests: {
    url?: string
    authorization?: string
    session?: string | string[]
    reasoning?: string | string[]
    tier?: string | string[]
    fast?: string | string[]
    body: unknown
  }[] = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    requests.push({
      url: req.url,
      authorization: req.headers.authorization,
      session: req.headers['x-cherry-agent-session-id'],
      reasoning: req.headers['x-cherry-reasoning-effort'],
      tier: req.headers['x-cherry-service-tier'],
      fast: req.headers['x-cherry-fast-mode'],
      body: JSON.parse(raw)
    })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(
      `data: ${JSON.stringify({ id: 'r', model: 'wire-name', choices: [{ index: 0, delta: { content: 'Native answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test listener')
  gateway.baseUrl = `http://127.0.0.1:${address.port}`
  const provider = ProviderSchema.parse({
    id: 'local',
    name: 'Local',
    reportsActualCost: false,
    isEnabled: true,
    apiKeys: [],
    authType: 'api-key',
    settings: {},
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  })
  const model = ModelSchema.parse({
    id: 'local::logical-name',
    providerId: 'local',
    name: 'Logical',
    apiModelId: 'wire-name',
    capabilities: [],
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true
  })
  const usages: Array<{ sessionId: string | undefined; responseId: string | undefined; tokens: number }> = []
  const binding = await createPiGatewayModelBinding(
    { sessionId: 'session-1', reasoningEffort: 'high', serviceTier: 'flex', fastMode: true },
    provider,
    model,
    (usage, sessionId, responseId) => usages.push({ sessionId, responseId, tokens: usage.totalTokens })
  )
  const child = await createPiGatewayModelBinding(
    { sessionId: 'session-1', reasoningEffort: 'low' },
    provider,
    ModelSchema.parse({ ...model, id: 'local::child', apiModelId: 'child-wire' }),
    undefined,
    binding.modelRuntime
  )
  expect(binding.modelRuntime.getModel(binding.model.provider, binding.model.id)).toBeDefined()
  expect(binding.modelRuntime.getModel(child.model.provider, child.model.id)).toBeDefined()
  const answer = await binding.modelRuntime
    .streamSimple(binding.model, normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }), {
      sessionId: 'native-child'
    })
    .result()
  expect(usages).toEqual([{ sessionId: 'native-child', responseId: 'r', tokens: 15 }])
  expect(answer).toMatchObject({
    api: 'openai-completions',
    stopReason: 'stop',
    content: [{ type: 'text', text: 'Native answer' }],
    usage: { input: 10, output: 5 }
  })
  expect(requests).toMatchObject([
    {
      url: '/v1/chat/completions',
      authorization: 'Bearer local-key',
      session: 'session-1',
      reasoning: 'high',
      tier: 'flex',
      fast: 'true',
      body: { model: 'local:wire-name', messages: [{ role: 'user', content: 'Hello' }] }
    }
  ])
  const childAnswer = await child.modelRuntime.completeSimple(
    child.model,
    normalizeContext({ messages: [{ role: 'user', content: 'Child task', timestamp: 2 }] }),
    { sessionId: 'child-session' }
  )
  expect(childAnswer.stopReason).toBe('stop')
  expect(requests[1]).toMatchObject({ reasoning: 'low', body: { model: 'local:child-wire' } })
  expect(usages).toEqual([{ sessionId: 'native-child', responseId: 'r', tokens: 15 }])
})

// A direct-provider replay workaround must not invent a thinking signature from a gateway message ID.
it.each([false, true])('replays CherryIN thinking only when present (empty signature: %s)', async (hasThinking) => {
  let body: { messages: Array<{ role: string; content: unknown[] }> } | undefined
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    body = JSON.parse(raw)
    const events = [
      {
        type: 'message_start',
        message: {
          id: 'msg_gateway_answer',
          type: 'message',
          role: 'assistant',
          model: 'cherryin:anthropic/claude-sonnet-4.6',
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 }
        }
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Read confirmed' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' }
    ]
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => {
    server.closeAllConnections()
    server.close()
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test listener')
  gateway.baseUrl = `http://127.0.0.1:${address.port}`
  const provider = ProviderSchema.parse({
    id: 'cherryin',
    name: 'CherryIN',
    reportsActualCost: false,
    isEnabled: true,
    apiKeys: [],
    authType: 'api-key',
    settings: {}
  })
  const model = ModelSchema.parse({
    id: 'cherryin::anthropic/claude-sonnet-4.6',
    providerId: 'cherryin',
    name: 'Claude Sonnet 4.6',
    apiModelId: 'anthropic/claude-sonnet-4.6',
    endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
    capabilities: [],
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true
  })
  const binding = await createPiGatewayModelBinding({ sessionId: 'session-1' }, provider, model)
  const answer = await binding.modelRuntime
    .streamSimple(
      binding.model,
      normalizeContext({
        messages: [
          { role: 'user', content: 'Read facts.txt', timestamp: 1 },
          {
            role: 'assistant',
            api: 'anthropic-messages',
            provider: 'cherryin',
            model: binding.model.id,
            responseId: 'msg_gateway_generated_id',
            content: [
              ...(hasThinking ? [{ type: 'thinking' as const, thinking: 'Read the file', thinkingSignature: '' }] : []),
              { type: 'toolCall', id: 'call_read', name: 'read', arguments: { path: 'facts.txt' } }
            ],
            stopReason: 'toolUse',
            timestamp: 2,
            usage: {
              input: 10,
              output: 2,
              totalTokens: 12,
              cacheRead: 0,
              cacheWrite: 0,
              cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 }
            }
          },
          {
            role: 'toolResult',
            toolCallId: 'call_read',
            toolName: 'read',
            content: [{ type: 'text', text: 'Orchard' }],
            isError: false,
            timestamp: 3
          }
        ]
      })
    )
    .result()
  expect(answer.stopReason, answer.errorMessage).toBe('stop')
  expect(body?.messages.find((message) => message.role === 'assistant')?.content).toEqual([
    ...(hasThinking ? [{ type: 'thinking', thinking: 'Read the file', signature: '' }] : []),
    { type: 'tool_use', id: 'call_read', name: 'read', input: { path: 'facts.txt' } }
  ])
})

it.each([true, false])(
  'decorates the native terminal message with measured output-limit diagnostics (usage: %s)',
  async (withUsage) => {
    const requests: unknown[] = []
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      requests.push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const chunk of [
        {
          id: 'truncated-1',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }]
        },
        {
          id: 'truncated-1',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'length' }]
        },
        ...(withUsage
          ? [
              {
                id: 'truncated-1',
                object: 'chat.completion.chunk',
                choices: [],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 9,
                  total_tokens: 19,
                  completion_tokens_details: { reasoning_tokens: 4 }
                }
              }
            ]
          : [])
      ])
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      res.end('data: [DONE]\n\n')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listener')
    gateway.baseUrl = `http://127.0.0.1:${address.port}`
    const provider = ProviderSchema.parse({
      id: 'limit-fixture',
      name: 'Limit fixture',
      isEnabled: true,
      apiKeys: [],
      authType: 'api-key',
      settings: {},
      reportsActualCost: false,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    })
    const model = ModelSchema.parse({
      id: `${provider.id}::m`,
      providerId: provider.id,
      name: 'Model',
      isEnabled: true,
      isHidden: false,
      supportsStreaming: true,
      capabilities: [],
      maxOutputTokens: 8192
    })
    const binding = await createPiGatewayModelBinding({ sessionId: 'limit-session' }, provider, model)
    const observed: unknown[] = []
    const stream = binding.modelRuntime.streamSimple(
      binding.model,
      { messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] },
      {
        onProviderStreamEvent: (data) => {
          observed.push(data)
        }
      }
    )
    let terminal: string | undefined
    for await (const event of stream) if (event.type === 'done') terminal = event.message.errorMessage
    expect(terminal).toContain('Configured maximum output: 8192 tokens')
    expect(terminal).toContain(`provider-reported output tokens: ${withUsage ? 9 : 'unknown'}`)
    if (withUsage) expect(terminal).toContain('provider-reported reasoning tokens: 4')
    else expect(terminal).not.toContain('reasoning tokens:')
    expect((await stream.result()).errorMessage).toBe(terminal)
    expect(observed.length).toBeGreaterThan(0)
    expect(requests).toHaveLength(1)
    expect(binding.model.maxTokens).toBe(8192)
  }
)
