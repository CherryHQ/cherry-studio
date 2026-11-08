import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'

import { normalizeContext } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { GoogleGenAI } from '@google/genai'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { Type } from 'typebox'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { runtimeId, type Observation, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'
import {
  createPiRuntime,
  type PiRuntime,
  type PiSessionOptions,
  type PiThreadHandle
} from '@cherrystudio/agent-runtime-pi'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { AgentSessionUsageAttribution } from '@main/ai/agentSession/AgentSessionUsageAttribution'
import { AiService } from '@main/ai/AiService'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import type * as CustomFetch from '@main/ai/utils/customFetch'
import { BaseService } from '@main/core/lifecycle'
import type { InputFormat } from '@main/features/apiGateway/adapters/interfaces'
import { processMessage } from '@main/features/apiGateway/proxyStream'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { createTestBehavior, tempDir } from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { createPiGatewayModelBinding } from './gatewayModelBinding'
import { createPiBehaviorHost } from './piBehaviorHost'

const mocks = vi.hoisted(() => ({
  messageId: 'original-answer',
  gatewayUrl: '',
  manager: undefined as AiStreamManager | undefined,
  ai: undefined as AiService | undefined,
  attribution: undefined as AgentSessionUsageAttribution | undefined
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
      captureAgentSessionUsage: () => ({ headers: {}, release: () => {} }),
      ensureInternalGateway: async () => ({ baseUrl: mocks.gatewayUrl, apiKey: 'internal-fixture-key' }),
      getAgentSessionUsageHeaders: (sessionId: string) => ({ 'x-cherry-agent-session-id': sessionId }),
      isInternalRequest: (headers: Headers) => headers.get('authorization') === 'Bearer internal-fixture-key',
      getAgentSessionId: (headers: Headers) => headers.get('x-cherry-agent-session-id'),
      resolveAgentSessionUsage: (headers: Headers, responseId: string) => ({
        agentSessionId: headers.get('x-cherry-agent-session-id')!,
        assistantMessageId: mocks.messageId,
        source: null,
        ...(mocks.attribution && { recordInvocation: mocks.attribution.capture(responseId) })
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
  let session: PiThreadHandle | undefined
  let runtime: PiRuntime | undefined
  let observation: Observation | undefined
  let events: ObservationPayload[] = []
  function confirmed<T>(result: OperationResult<T>): T {
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    return result.value
  }
  async function openSession(options: Omit<PiSessionOptions, 'behavior'>) {
    runtime = confirmed(await createPiRuntime({ backendId: runtimeId('gateway-test') }))
    const handle = confirmed(await runtime.create({ ...options, behavior: createTestBehavior(options.model) }))
    events = []
    observation = confirmed(
      await handle.observe((event) => {
        events.push(event)
      })
    )
    return handle
  }
  async function sendUser(text: string) {
    expect(await session!.input.submit({ inputId: runtimeId(text), text, whenBusy: 'reject' })).toMatchObject({
      status: 'acknowledged'
    })
    await session!.pi.settled()
    await observation!.drain()
  }
  const outcome = () => events.filter((event) => event.type === 'input.changed').at(-1)?.input.outcome
  let holdResponse = false
  let upstreamClosed = false
  let protocol: InputFormat = 'openai'
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
          inputFormat: protocol,
          outputFormat: protocol,
          ...(protocol === 'gemini' && {
            modelString: 'port:wire-model',
            streaming: request.url?.includes(':streamGenerateContent')
          }),
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
    protocol = 'openai'
    mocks.messageId = 'original-answer'
    mocks.attribution = undefined
    call = () => ({ content: 'Model answer' })
    server = createServer(async (req, res) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      requests.push(body)
      if (protocol === 'anthropic') {
        const events = [
          {
            type: 'message_start',
            message: {
              id: `msg_${requests.length}`,
              type: 'message',
              role: 'assistant',
              model: 'wire-model',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 100, output_tokens: 0 }
            }
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'redacted_thinking', data: 'opaque-ciphertext' }
          },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } },
          { type: 'content_block_stop', index: 1 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 25 }
          },
          { type: 'message_stop' }
        ]
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
        return
      }
      if (protocol === 'gemini') {
        const parts = [
          { text: 'reasoning', thought: true, thoughtSignature: Buffer.from('thought-signature').toString('base64') },
          { text: 'answer' },
          { text: '', thoughtSignature: Buffer.from('text-signature').toString('base64') }
        ]
        const events = parts.map((part) => ({ candidates: [{ content: { role: 'model', parts: [part] }, index: 0 }] }))
        const finish = {
          candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP', index: 0 }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25, totalTokenCount: 125 }
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end([...events, finish].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
        return
      }
      if (protocol === 'openai-responses') {
        const reasoning = {
          type: 'reasoning',
          id: `rs_native_${requests.length}`,
          summary: [],
          encrypted_content: 'encrypted-native-state'
        }
        const message = {
          type: 'message',
          id: `msg_native_${requests.length}`,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'answer', annotations: [] }]
        }
        const events = [
          { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, encrypted_content: null } },
          { type: 'response.output_item.done', output_index: 0, item: reasoning },
          { type: 'response.output_item.added', output_index: 1, item: { ...message, content: [] } },
          {
            type: 'response.output_text.delta',
            item_id: message.id,
            output_index: 1,
            content_index: 0,
            delta: 'answer'
          },
          { type: 'response.output_item.done', output_index: 1, item: message },
          {
            type: 'response.completed',
            response: {
              id: `resp_${requests.length}`,
              model: 'wire-model',
              status: 'completed',
              output: [reasoning, message],
              usage: { input_tokens: 100, output_tokens: 25 }
            }
          }
        ]
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
        return
      }
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
    if (runtime) confirmed(await runtime.shutdown())
    await session?.release()
    session = undefined
    runtime = undefined
    await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())))
    gateway.closeAllConnections()
    await new Promise<void>((done, reject) => gateway.close((error) => (error ? reject(error) : done())))
    vi.restoreAllMocks()
  })

  async function behaviorHost() {
    const model = modelService.getByKey('port', 'wire-model')
    const input = { sessionId: 'session', agentId: 'agent', modelId: model.id }
    const binding = await createPiGatewayModelBinding(input, providerService.getByProviderId('port'), model)
    return createPiBehaviorHost({
      input,
      root: runtimeId('root'),
      binding,
      model,
      approval: {
        sessionId: input.sessionId,
        workspacePath: '/tmp',
        agentDataPath: '/tmp',
        additionalReadOnlyRoots: [],
        getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
        getPermissionMode: () => 'default',
        isDisabled: () => false,
        autoApprovedTools: new Set(),
        approvalRequiredTools: new Set(),
        nonBypassableApprovalTools: new Set(),
        delegationTools: new Set()
      },
      usageSessionId: async () => input.sessionId,
      toolCallId: async (call) => call.key,
      emit: () => {},
      observe: () => {}
    })
  }

  it('excludes a disabled provider with the same model name and preserves the inherited model', async () => {
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'disabled', name: 'Disabled', orderKey: 'a1', isEnabled: false })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'disabled::wire-model',
        providerId: 'disabled',
        modelId: 'wire-model',
        name: 'Logical model',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
        supportsStreaming: true,
        isEnabled: true,
        orderKey: 'a0'
      })
      .run()
    const { host } = await behaviorHost()
    const candidates = await host.models.find('wire-model')
    expect(candidates).toHaveLength(1)
    expect(candidates[0].provider).toBe('port')
    expect(await host.models.current(runtimeId('root'))).toMatchObject({
      parentModelKey: candidates[0].key,
      defaultChildModelKey: candidates[0].key,
      supportsTools: true
    })
    dbh.db.update(userProviderTable).set({ isEnabled: false }).where(eq(userProviderTable.providerId, 'port')).run()
    expect(await host.models.find('wire-model')).toEqual([])
    await expect(
      host.summarizer.summarize(
        { thread: runtimeId('root'), reason: 'manual', messages: ['conversation'] },
        new AbortController().signal
      )
    ).rejects.toThrow()
    expect(requests).toEqual([])
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toEqual([])
  })

  it('returns actual summary usage while the gateway records exactly one provider charge', async () => {
    const { host } = await behaviorHost()
    call = () => ({ content: 'Preserved objective and pending work' })
    const result = await host.summarizer.summarize(
      { thread: runtimeId('root'), reason: 'manual', messages: ['conversation'] },
      new AbortController().signal
    )
    expect(result).toMatchObject({
      summary: 'Preserved objective and pending work',
      usage: { input: 100, output: 25, totalTokens: 125 }
    })
    const charges = dbh.db.select().from(aiUsageRecordTable).all()
    expect(charges).toHaveLength(1)
    expect(charges[0]).toMatchObject({ inputTokens: 100, outputTokens: 25, messageId: 'original-answer' })
    expect(charges[0].cost).toBeCloseTo(0.0003)
    expect(requests).toHaveLength(1)
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
    session = await openSession({
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
    await sendUser('Run echo')
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

  it.each(['null', '{}'])('executes only valid optional tool input through the gateway: %s', async (input) => {
    const executed: unknown[] = []
    call = () =>
      requests.length === 1
        ? {
            tool_calls: [
              { index: 0, id: 'optional-call', type: 'function', function: { name: 'optional_tool', arguments: input } }
            ]
          }
        : { content: 'complete' }
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const directory = tempDir('gateway-invalid-tool')
    session = await openSession({
      ...binding,
      cwd: directory,
      agentDir: directory,
      settings: { retry: { enabled: false } },
      tools: [
        defineTool({
          name: 'optional_tool',
          label: 'Optional',
          description: 'Optional input',
          parameters: Type.Object({ path: Type.Optional(Type.String()) }),
          async execute(_id, args) {
            executed.push(args)
            return { content: [{ type: 'text', text: 'done' }], details: undefined }
          }
        })
      ]
    })
    await sendUser('use the optional tool')
    if (input === 'null') {
      expect(executed).toEqual([])
      expect(outcome()).toBe('failed')
    } else {
      expect(executed).toEqual([{}])
      expect(session.pi.archive().messages.findLast((message) => message.role === 'assistant')?.parts).toMatchObject([
        { type: 'text', text: 'complete' }
      ])
    }
  })

  // Catches metadata stripped by the production stream pipeline before native Pi can replay it.
  it('replays encrypted-only reasoning through native Pi and the production Responses gateway', async () => {
    protocol = 'openai-responses'
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: url } },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES
      })
      .where(eq(userProviderTable.providerId, 'port'))
      .run()
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const directory = tempDir('gateway-responses')
    session = await openSession({
      ...binding,
      cwd: directory,
      agentDir: directory,
      settings: { retry: { enabled: false } }
    })
    await sendUser('first question')
    expect(outcome()).toBe('completed')
    await sendUser('continue')
    expect(outcome()).toBe('completed')
    expect(requests).toHaveLength(2)
    expect(requests[1].input).toContainEqual({
      type: 'reasoning',
      id: 'rs_native_1',
      summary: [],
      encrypted_content: 'encrypted-native-state'
    })
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(2)
  })

  it.each([
    { format: 'anthropic', endpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES },
    { format: 'gemini', endpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT }
  ] as const)(
    'replays $format opaque reasoning through the production gateway and native Pi',
    async ({ format, endpoint }) => {
      protocol = format
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${format === 'gemini' ? 'v1beta' : 'v1'}`
      dbh.db
        .update(userProviderTable)
        .set({ endpointConfigs: { [endpoint]: { baseUrl: url } }, defaultChatEndpoint: endpoint })
        .where(eq(userProviderTable.providerId, 'port'))
        .run()
      const binding = await createPiGatewayModelBinding(
        { sessionId: 'session' },
        providerService.getByProviderId('port'),
        modelService.getByKey('port', 'wire-model')
      )
      const directory = tempDir(`gateway-${format}-replay`)
      session = await openSession({
        ...binding,
        cwd: directory,
        agentDir: directory,
        settings: { retry: { enabled: false } }
      })
      await sendUser('first question')
      expect(outcome()).toBe('completed')
      await sendUser('continue')
      expect(outcome()).toBe('completed')
      expect(requests).toHaveLength(2)
      if (format === 'anthropic') {
        const messages = requests[1].messages as Array<{ role: string; content: unknown[] }>
        expect(
          messages.filter((message) => message.role === 'assistant').flatMap((message) => message.content)
        ).toContainEqual({
          type: 'redacted_thinking',
          data: 'opaque-ciphertext'
        })
      } else {
        const contents = requests[1].contents as Array<{ role: string; parts: unknown[] }>
        expect(contents.filter((content) => content.role === 'model').flatMap((content) => content.parts)).toEqual([
          { text: 'reasoning', thought: true, thoughtSignature: Buffer.from('thought-signature').toString('base64') },
          { text: 'answer', thoughtSignature: Buffer.from('text-signature').toString('base64') }
        ])
      }
      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(2)
    }
  )

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
    session = await openSession({ ...binding, cwd: directory, agentDir: directory })
    await sendUser('question')
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([{ messageId: 'original-answer' }])
  })

  it.each([true, false])(
    'binds Google native root and child response identities to stored usage (streaming: %s)',
    async (streaming) => {
      protocol = 'gemini'
      mocks.attribution = new AgentSessionUsageAttribution()
      dbh.db
        .update(userProviderTable)
        .set({
          endpointConfigs: {
            [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
              baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta`
            }
          },
          defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
        })
        .where(eq(userProviderTable.providerId, 'port'))
        .run()
      const received: string[] = []
      const binding = await createPiGatewayModelBinding(
        { sessionId: 'session' },
        providerService.getByProviderId('port'),
        modelService.getByKey('port', 'wire-model')
      )
      const client = new GoogleGenAI({
        apiKey: 'internal-fixture-key',
        httpOptions: {
          baseUrl: mocks.gatewayUrl,
          apiVersion: 'v1beta',
          headers: { 'x-cherry-agent-session-id': 'session' }
        }
      })
      for (const owner of ['root-message', 'child-message']) {
        const response = streaming
          ? await binding.modelRuntime
              .streamSimple(
                binding.model,
                normalizeContext({ messages: [{ role: 'user', content: owner, timestamp: 1 }] }),
                { sessionId: owner }
              )
              .result()
          : await client.models.generateContent({ model: 'port:wire-model', contents: owner })
        expect(response.responseId).toBeTruthy()
        received.push(response.responseId!)
        mocks.attribution.bind(response.responseId!, owner)
        mocks.attribution.bind(response.responseId!, owner)
      }
      expect(new Set(received).size).toBe(2)
      const charges = dbh.db.select().from(aiUsageRecordTable).all()
      expect(charges).toHaveLength(2)
      expect(
        charges.map((row) => ({ messageId: row.messageId, kind: row.messageKind, total: row.totalTokens }))
      ).toEqual([
        { messageId: 'root-message', kind: 'agent-session', total: 125 },
        { messageId: 'child-message', kind: 'agent-session', total: 125 }
      ])
    }
  )
  it.each(['high', 'ultra'] as const)(
    'keeps %s reasoning through native wire defaults and gateway execution',
    async (reasoningEffort) => {
      dbh.db
        .update(userModelTable)
        .set({
          capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
          reasoning: { controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'ultra'] }] }
        })
        .where(eq(userModelTable.id, 'port::wire-model'))
        .run()
      const binding = await createPiGatewayModelBinding(
        { sessionId: 'session', reasoningEffort },
        providerService.getByProviderId('port'),
        modelService.getByKey('port', 'wire-model')
      )
      const directory = tempDir('gateway-options')
      session = await openSession({
        ...binding,
        cwd: directory,
        agentDir: directory,
        systemPrompt: 'Preserve the instructions through the gateway'
      })
      await sendUser('Think carefully')
      expect(requests).toHaveLength(1)
      expect(requests[0].reasoning_effort).toBe(reasoningEffort)
      expect(requests[0].messages).toContainEqual(
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Preserve the instructions through the gateway')
        })
      )
    }
  )

  it('uses the original selection when an internal Anthropic request carries conflicting native thinking', async () => {
    dbh.db
      .update(userModelTable)
      .set({
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
        reasoning: { controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }] }
      })
      .where(eq(userModelTable.id, 'port::wire-model'))
      .run()
    const response = await processMessage({
      params: {
        model: 'port:wire-model',
        stream: true,
        max_tokens: 256,
        thinking: { type: 'enabled', budget_tokens: 16384 },
        messages: [{ role: 'user', content: 'fixture' }]
      },
      inputFormat: 'anthropic',
      outputFormat: 'anthropic',
      requestHeaders: new Headers({
        authorization: 'Bearer internal-fixture-key',
        'x-cherry-reasoning-effort': 'low'
      })
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Model answer')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ reasoning_effort: 'low', max_tokens: 256 })
    expect(requests[0]).not.toHaveProperty('thinking')
  })

  it('propagates a native stop through the gateway to the upstream request', async () => {
    holdResponse = true
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const directory = tempDir('gateway-abort')
    session = await openSession({ ...binding, cwd: directory, agentDir: directory })
    const run = sendUser('Start streaming')
    await expect.poll(() => requests.length).toBe(1)
    confirmed(await session.interrupt!())
    await run
    await expect.poll(() => upstreamClosed).toBe(true)
    expect(outcome()).toBe('aborted')
    expect(requests).toHaveLength(1)
  })
})
