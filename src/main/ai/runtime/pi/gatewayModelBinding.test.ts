import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { normalizeContext } from '@earendil-works/pi-ai'
import { expect, it, onTestFinished, vi } from 'vitest'

import { application } from '@application'
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

it('uses the internal gateway, wire model route and session attribution with a native provider', async () => {
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
  const usages: Array<{ sessionId: string | undefined; tokens: number }> = []
  const binding = await createPiGatewayModelBinding(
    { sessionId: 'session-1', reasoningEffort: 'high', serviceTier: 'flex', fastMode: true },
    provider,
    model,
    (usage, sessionId) => usages.push({ sessionId, tokens: usage.totalTokens })
  )
  const answer = await binding.modelRuntime
    .streamSimple(binding.model, normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }), {
      sessionId: 'native-child'
    })
    .result()
  expect(usages).toEqual([{ sessionId: 'native-child', tokens: 15 }])
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
})

// A direct-provider replay workaround must not invent a thinking signature from a gateway message ID.
it('replays a tool-only CherryIN gateway response without a fabricated thinking block', async () => {
  const getPath = vi.mocked(application.getPath).getMockImplementation()!
  const path = vi
    .spyOn(application, 'getPath')
    .mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data' && filename
        ? resolve(process.cwd(), 'packages/provider-registry/data', filename)
        : getPath(key, filename)
    )
  onTestFinished(() => path.mockRestore())
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
            content: [{ type: 'toolCall', id: 'call_read', name: 'read', arguments: { path: 'facts.txt' } }],
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
  expect(answer.stopReason).toBe('stop')
  expect(body?.messages.find((message) => message.role === 'assistant')?.content).toEqual([
    { type: 'tool_use', id: 'call_read', name: 'read', input: { path: 'facts.txt' } }
  ])
})
