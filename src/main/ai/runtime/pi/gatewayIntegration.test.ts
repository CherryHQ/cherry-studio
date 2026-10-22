import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'

import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { createAgentRuntimeSession, type AgentRuntimeSession } from '@cherrystudio/agent-runtime-pi'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { AiService } from '@main/ai/AiService'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import type * as CustomFetch from '@main/ai/utils/customFetch'
import { BaseService } from '@main/core/lifecycle'
import { processMessage } from '@main/features/apiGateway/proxyStream'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { lastAssistant, tempDir } from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { createPiGatewayModelBinding } from './gatewayModelBinding'

const mocks = vi.hoisted(() => ({
  messageId: 'original-answer',
  gatewayUrl: '',
  manager: undefined as AiStreamManager | undefined,
  ai: undefined as AiService | undefined
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = {
    ...defaultServiceInstances,
    AiStreamManager: {
      streamPrompt: (input: Parameters<AiStreamManager['streamPrompt']>[0]) => mocks.manager!.streamPrompt(input),
      abort: (id: string) => mocks.manager!.abort(id, 'gateway-disconnected')
    },
    AiService: { streamText: (input: Parameters<AiService['streamText']>[0]) => mocks.ai!.streamText(input) },
    ApiGatewayService: {
      ensureInternalGateway: async () => ({ baseUrl: mocks.gatewayUrl, apiKey: 'internal-fixture-key' }),
      getAgentSessionUsageHeaders: (sessionId: string) => ({ 'x-cherry-agent-session-id': sessionId }),
      isInternalRequest: (headers: Headers) => headers.get('authorization') === 'Bearer internal-fixture-key',
      getAgentSessionId: (headers: Headers) => headers.get('x-cherry-agent-session-id'),
      resolveAgentSessionUsage: (headers: Headers) => ({
        agentSessionId: headers.get('x-cherry-agent-session-id')!,
        assistantMessageId: mocks.messageId,
        source: null
      })
    },
    AgentSessionRuntimeService: { getActiveUsageContext: () => ({ assistantMessageId: mocks.messageId, source: null }) }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('@main/ai/utils/customFetch', async (original) => ({
  ...(await original<typeof CustomFetch>()),
  customFetch: (...args: Parameters<typeof fetch>) => fetch(...args)
}))

describe('native Pi through the production gateway', () => {
  const dbh = setupTestDatabase()
  let server: Server
  let gateway: Server
  let session: AgentRuntimeSession | undefined
  let holdResponse = false
  let upstreamClosed = false
  const requests: Array<Record<string, unknown>> = []
  let call: (body: Record<string, unknown>) => { content?: string; tool_calls?: unknown[] }
  beforeEach(async () => {
    BaseService.resetInstances()
    mocks.manager = new AiStreamManager()
    mocks.ai = new AiService()
    gateway = createServer(async (request, response) => {
      const abort = new AbortController()
      response.on('close', () => abort.abort())
      try {
        let raw = ''
        for await (const chunk of request) raw += chunk
        const headers = new Headers()
        for (const [name, value] of Object.entries(request.headers)) if (value) headers.set(name, String(value))
        const result = await processMessage({
          params: JSON.parse(raw),
          inputFormat: 'openai',
          outputFormat: 'openai',
          signal: abort.signal,
          requestHeaders: headers
        })
        response.writeHead(result.status, Object.fromEntries(result.headers))
        if (result.body) for await (const chunk of result.body) response.write(chunk)
        response.end()
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: String(error) } }))
      }
    })
    await new Promise<void>((done) => gateway.listen(0, '127.0.0.1', done))
    mocks.gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`
    requests.length = 0
    holdResponse = false
    upstreamClosed = false
    mocks.messageId = 'original-answer'
    call = () => ({ content: 'Model answer' })
    server = createServer(async (req, res) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      requests.push(body)
      const delta = call(body)
      const payload = {
        id: `response-${requests.length}`,
        model: 'wire-model',
        object: 'chat.completion.chunk',
        created: 1,
        choices: [{ index: 0, delta, finish_reason: holdResponse ? null : delta.tool_calls ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 }
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (holdResponse) {
        res.on('close', () => {
          upstreamClosed = true
        })
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      } else res.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`)
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, file) =>
      key === 'feature.provider_registry.data'
        ? resolve('packages/provider-registry/data', file ?? '')
        : getPath(key, file)
    )
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'port',
        name: 'Port provider',
        orderKey: 'a0',
        isEnabled: true,
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: url } },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiKeys: [{ id: 'fixture-key', key: 'fixture-local-key', isEnabled: true }]
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'port::wire-model',
        providerId: 'port',
        modelId: 'wire-model',
        name: 'Logical model',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
        supportsStreaming: true,
        isEnabled: true,
        orderKey: 'a0',
        contextWindow: 32000,
        maxOutputTokens: 1024,
        pricing: { input: { perMillionTokens: 2, currency: 'USD' }, output: { perMillionTokens: 4, currency: 'USD' } }
      })
      .run()
  })
  afterEach(async () => {
    await session?.dispose()
    session = undefined
    await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())))
    gateway.closeAllConnections()
    await new Promise<void>((done, reject) => gateway.close((error) => (error ? reject(error) : done())))
    vi.restoreAllMocks()
  })

  it('uses Cherry provider configuration for each native step, with one tool executor and one billing owner', async () => {
    const usages: unknown[] = []
    const toolInputs: string[] = []
    call = () =>
      requests.length === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'tool-one',
                type: 'function',
                function: { name: 'echo', arguments: '{"text":"native result"}' }
              }
            ]
          }
        : { content: 'Final answer' }
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model'),
      (usage) => usages.push(usage)
    )
    const directory = tempDir('gateway')
    session = await createAgentRuntimeSession({
      ...binding,
      cwd: directory,
      agentDir: directory,
      systemPrompt: 'Native system prompt',
      tools: [
        defineTool({
          name: 'echo',
          label: 'Echo',
          description: 'Echo input',
          parameters: Type.Object({ text: Type.String() }),
          async execute(_id, args) {
            toolInputs.push(args.text)
            return { content: [{ type: 'text', text: args.text }], details: undefined }
          }
        })
      ]
    })
    await session.prompt('Run echo')
    expect(toolInputs).toEqual(['native result'])
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ model: 'wire-model', max_tokens: 1024 })
    expect(JSON.stringify(requests[0].messages)).toContain('Native system prompt')
    expect(JSON.stringify(requests[1].messages)).toContain('native result')
    expect(usages).toHaveLength(2)
    for (const row of dbh.db.select().from(aiUsageRecordTable).all()) expect(row.cost).toBeCloseTo(0.0003)
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([
      { providerId: 'port', messageId: 'original-answer', inputTokens: 100, outputTokens: 25 },
      { providerId: 'port', messageId: 'original-answer', inputTokens: 100, outputTokens: 25 }
    ])
  })

  it('freezes message attribution before gateway dispatch', async () => {
    call = () => {
      mocks.messageId = 'later-answer'
      return { content: 'Answer for original turn' }
    }
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const directory = tempDir('gateway-attribution')
    session = await createAgentRuntimeSession({ ...binding, cwd: directory, agentDir: directory })
    await session.prompt('question')
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([{ messageId: 'original-answer' }])
  })
  it('keeps the explicit reasoning selection through native wire defaults and gateway execution', async () => {
    dbh.db
      .update(userModelTable)
      .set({
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
        reasoning: { controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }] }
      })
      .where(eq(userModelTable.id, 'port::wire-model'))
      .run()
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session', reasoningEffort: 'high' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const directory = tempDir('gateway-options')
    session = await createAgentRuntimeSession({ ...binding, cwd: directory, agentDir: directory })
    await session.prompt('Think carefully')
    expect(requests).toHaveLength(1)
    expect(requests[0].reasoning_effort).toBe('high')
  })

  it('propagates a native stop through the gateway to the upstream request', async () => {
    holdResponse = true
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const directory = tempDir('gateway-abort')
    session = await createAgentRuntimeSession({ ...binding, cwd: directory, agentDir: directory })
    const run = session.prompt('Start streaming')
    await expect.poll(() => requests.length).toBe(1)
    await session.abort()
    await run
    await expect.poll(() => upstreamClosed).toBe(true)
    expect(lastAssistant(session.session).stopReason).toBe('aborted')
    expect(requests).toHaveLength(1)
  })
})
