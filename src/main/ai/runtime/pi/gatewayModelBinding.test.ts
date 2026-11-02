import { createServer } from 'node:http'

import { normalizeContext } from '@earendil-works/pi-ai'
import { expect, it, onTestFinished, vi } from 'vitest'

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
  const binding = await createPiGatewayModelBinding(
    { sessionId: 'session-1', reasoningEffort: 'high', serviceTier: 'flex', fastMode: true },
    provider,
    model
  )
  const answer = await binding.modelRuntime
    .streamSimple(binding.model, normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }))
    .result()
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
