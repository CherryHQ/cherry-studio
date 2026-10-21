import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'

import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { createAgentRuntimeSession, type AgentRuntimeSession } from '@cherrystudio/agent-runtime-pi'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import '@data/services/ProviderRegistryService'
import type * as CustomFetch from '@main/ai/utils/customFetch'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { tempDir } from './aiSdkSupport'
import { createPiModelBinding, restorePiThinkingReplay } from './piModelPort'

const mocks = vi.hoisted(() => ({ messageId: 'original-answer' }))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = {
    DbService: defaultServiceInstances.DbService,
    AgentSessionRuntimeService: { getActiveUsageContext: () => ({ assistantMessageId: mocks.messageId, source: null }) }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('@main/ai/utils/customFetch', async (original) => ({
  ...(await original<typeof CustomFetch>()),
  customFetch: (...args: Parameters<typeof fetch>) => fetch(...args)
}))

describe('production Pi model port', () => {
  const dbh = setupTestDatabase()
  let server: Server
  let session: AgentRuntimeSession | undefined
  const requests: Array<Record<string, unknown>> = []
  let call: (body: Record<string, unknown>) => { content?: string; tool_calls?: unknown[] }
  beforeEach(async () => {
    requests.length = 0
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
        choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 }
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`)
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
        id: 'port::logical',
        providerId: 'port',
        modelId: 'logical',
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
    vi.restoreAllMocks()
  })

  it('uses Cherry provider configuration for each native step, with one tool executor and one billing owner', async () => {
    const usages: unknown[] = []
    const errors: unknown[] = []
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
    const binding = await createPiModelBinding(
      { sessionId: 'session', agentId: 'agent', modelId: 'port::logical' },
      {
        provider: providerService.getByProviderId('port'),
        model: { ...modelService.getByKey('port', 'logical'), apiModelId: 'wire-model' }
      },
      { onError: (error) => errors.push(error) },
      (usage) => usages.push(usage)
    )
    const directory = tempDir('model-port')
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
    expect(errors).toEqual([])
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

  it('freezes message attribution before dispatch and restores the CherryIN tool-only thinking signature', async () => {
    call = () => {
      mocks.messageId = 'later-answer'
      return { content: 'Answer for original turn' }
    }
    const binding = await createPiModelBinding(
      { sessionId: 'session', agentId: 'agent', modelId: 'port::logical' },
      {
        provider: providerService.getByProviderId('port'),
        model: { ...modelService.getByKey('port', 'logical'), apiModelId: 'wire-model' }
      },
      {},
      () => {}
    )
    const directory = tempDir('model-port-attribution')
    session = await createAgentRuntimeSession({ ...binding, cwd: directory, agentDir: directory })
    await session.prompt('question')
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([{ messageId: 'original-answer' }])
    const input = [
      {
        role: 'assistant' as const,
        content: [{ type: 'tool-call' as const, toolCallId: 'one', toolName: 'echo', input: {} }],
        providerOptions: { cherryPi: { responseId: 'msg_signature' } }
      }
    ]
    expect(restorePiThinkingReplay(input)[0]).toMatchObject({
      content: [
        { type: 'reasoning', text: '\u200B', providerOptions: { anthropic: { signature: 'signature' } } },
        { type: 'tool-call', toolCallId: 'one' }
      ]
    })
  })
})
