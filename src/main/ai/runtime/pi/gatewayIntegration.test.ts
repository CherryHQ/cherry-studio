import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'

import { UnsupportedFunctionalityError } from '@ai-sdk/provider'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { normalizeContext, type AssistantMessage } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import {
  createRegistry,
  defineExtension,
  defineTool as defineDurableTool,
  Harness,
  MemoryStorage
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { obj } from '@earendil-works/pi-schema'
import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  MediaResolution,
  Modality,
  ServiceTier
} from '@google/genai'
import { trace } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import type { UIMessageChunk } from 'ai'
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
import { createPiTelemetry, observabilitySinks } from '@main/ai/observability'
import { planModelTransportRetry, type RecoverableModelTransportFailure } from '@main/ai/runtime/aiSdk'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import type { InProcessUsageContext } from '@main/ai/types'
import type * as CustomFetch from '@main/ai/utils/customFetch'
import { BaseService } from '@main/core/lifecycle'
import { StreamAdapterFactory } from '@main/features/apiGateway/adapters'
import type { InputFormat } from '@main/features/apiGateway/adapters/interfaces'
import { ApiGatewayService } from '@main/features/apiGateway/ApiGatewayService'
import { gatewayErrorHandler } from '@main/features/apiGateway/errors'
import { processMessage } from '@main/features/apiGateway/proxyStream'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { SpanEntity } from '@shared/data/types/trace'
import type { RetryPartData } from '@shared/data/types/uiParts'

import { createTestBehavior, tempDir } from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { createPiGatewayModelBinding } from './gatewayModelBinding'
import { createPiBehaviorHost } from './piBehaviorHost'

const mocks = vi.hoisted(() => ({
  messageId: 'original-answer',
  gatewayService: undefined as ApiGatewayService | undefined,
  usageContexts: new Map<string, InProcessUsageContext>(),
  gatewayUrl: '',
  gatewayRequests: 0,
  fetchFailure: undefined as (() => Error | undefined) | undefined,
  promptIdleTimeoutMs: undefined as number | undefined,
  manager: undefined as AiStreamManager | undefined,
  ai: undefined as AiService | undefined,
  attribution: undefined as AgentSessionUsageAttribution | undefined
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const isHttpFixture = (headers: Headers) =>
    headers.get('authorization') === 'Bearer internal-fixture-key' ||
    headers.get('x-goog-api-key') === 'internal-fixture-key'
  const overrides = {
    ...defaultServiceInstances,
    AiStreamManager: {
      streamPrompt: (input: Parameters<AiStreamManager['streamPrompt']>[0]) =>
        mocks.manager!.streamPrompt({ ...input, idleTimeoutMs: mocks.promptIdleTimeoutMs ?? input.idleTimeoutMs }),
      abort: (id: string) => mocks.manager!.abort(id, 'gateway-disconnected')
    },
    AiService: { streamText: (input: Parameters<AiService['streamText']>[0]) => mocks.ai!.streamText(input) },
    ApiGatewayService: {
      captureAgentSessionUsage: (...args: Parameters<ApiGatewayService['captureAgentSessionUsage']>) =>
        mocks.gatewayService!.captureAgentSessionUsage(...args),
      createAgentObjectTransports: (...args: Parameters<ApiGatewayService['createAgentObjectTransports']>) =>
        mocks.gatewayService!.createAgentObjectTransports(...args),
      getAgentSessionUsageHeaders: (id: string) => mocks.gatewayService!.getAgentSessionUsageHeaders(id),
      isInternalRequest: (headers: Headers) =>
        headers.get('authorization') === 'Bearer internal-fixture-key' ||
        mocks.gatewayService!.isInternalRequest(headers),
      getAgentSessionId: (headers: Headers) =>
        isHttpFixture(headers)
          ? (headers.get('x-cherry-agent-session-id') ?? undefined)
          : mocks.gatewayService!.getAgentSessionId(headers),
      resolveAgentSessionUsage: (headers: Headers, responseId: string) =>
        isHttpFixture(headers)
          ? application
              .get('AgentSessionRuntimeService')
              .getActiveUsageContext(headers.get('x-cherry-agent-session-id')!, responseId)
          : mocks.gatewayService!.resolveAgentSessionUsage(headers, responseId)
    },
    AgentSessionRuntimeService: {
      getActiveUsageContext: (sessionId: string, responseId?: string) =>
        mocks.usageContexts.get(sessionId) ?? {
          agentSessionId: sessionId,
          assistantMessageId: mocks.messageId,
          source: null,
          ...(mocks.attribution && responseId && { recordInvocation: mocks.attribution.capture(responseId) })
        }
    }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('@main/ai/utils/customFetch', async (original) => ({
  ...(await original<typeof CustomFetch>()),
  customFetch: async (...args: Parameters<typeof fetch>) => {
    const failure = mocks.fetchFailure?.()
    if (failure) throw failure
    return fetch(...args)
  }
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
    expect(await session!.input.submit!({ inputId: runtimeId(text), text })).toMatchObject({
      status: 'acknowledged'
    })
    await session!.pi.settled()
    await observation!.drain()
  }
  const outcome = () => events.filter((event) => event.type === 'input.changed').at(-1)?.input.outcome
  let holdResponse = false
  let failStream = false
  let truncateStream = false
  let upstreamClosed = false
  let protocol: InputFormat = 'openai'
  let plaintextResponse = false
  let geminiEvents: unknown[] | undefined
  const requests: Array<Record<string, unknown>> = []
  const dispatchKeys: Array<string | undefined> = []
  let call: (body: Record<string, unknown>) => { content?: string; tool_calls?: unknown[] }
  let rejectUpstream:
    | (() =>
        | {
            message: string
            code: string
            status?: number
            type?: string
            param?: string
            retryAfter?: string
            stream?: 'before-content' | 'after-content'
          }
        | undefined)
    | undefined
  beforeEach(async () => {
    mocks.fetchFailure = undefined
    mocks.promptIdleTimeoutMs = undefined
    BaseService.resetInstances()
    mocks.manager = new AiStreamManager()
    mocks.ai = new AiService()
    mocks.gatewayService = new ApiGatewayService()
    mocks.usageContexts.clear()
    gateway = createServer(async (request, response) => {
      mocks.gatewayRequests += 1
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
        const headers: Record<string, string> = {}
        const mapped = gatewayErrorHandler({
          code: 'UNKNOWN',
          error,
          request: new Request(`${mocks.gatewayUrl}${request.url}`),
          set: { headers },
          status: (statusCode: number, body: unknown) => ({ statusCode, body })
        } as unknown as Parameters<typeof gatewayErrorHandler>[0]) as unknown as { statusCode: number; body: unknown }
        response.writeHead(mapped.statusCode, { 'content-type': 'application/json', ...headers })
        response.end(JSON.stringify(mapped.body))
      }
    })
    await new Promise<void>((done) => gateway.listen(0, '127.0.0.1', done))
    mocks.gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`
    requests.length = 0
    dispatchKeys.length = 0
    mocks.gatewayRequests = 0
    holdResponse = false
    failStream = false
    truncateStream = false
    upstreamClosed = false
    protocol = 'openai'
    plaintextResponse = false
    geminiEvents = undefined
    mocks.messageId = 'original-answer'
    mocks.attribution = undefined
    call = () => ({ content: 'Model answer' })
    rejectUpstream = undefined
    server = createServer(async (req, res) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      requests.push(body)
      dispatchKeys.push(req.headers.authorization)
      const rejection = rejectUpstream?.()
      if (rejection && !rejection.stream) {
        const { status = 400, retryAfter, ...error } = rejection
        res.writeHead(status, { 'content-type': 'application/json', ...(retryAfter && { 'retry-after': retryAfter }) })
        res.end(
          JSON.stringify({
            error: { ...error, type: error.type ?? 'invalid_request_error' },
            request_id: 'upstream-id'
          })
        )
        return
      }
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
        if (geminiEvents) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.end(geminiEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
          return
        }
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
          status: 'completed',
          summary: [],
          ...(plaintextResponse
            ? { content: [{ type: 'reasoning_text', text: 'native plaintext' }] }
            : { encrypted_content: 'encrypted-native-state' })
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
              object: 'response',
              created_at: 1,
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
        choices: [
          {
            index: 0,
            delta,
            finish_reason:
              holdResponse || failStream || truncateStream ? null : delta.tool_calls ? 'tool_calls' : 'stop'
          }
        ],
        usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 }
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (rejection?.stream) {
        const content = rejection.stream === 'after-content' ? `data: ${JSON.stringify(payload)}\n\n` : ''
        const error = { message: rejection.message, code: rejection.code, type: 'invalid_request_error' }
        res.end(`${content}data: ${JSON.stringify({ error })}\n\n`)
      } else if (failStream) {
        res.end(
          `data: ${JSON.stringify(payload)}\n\ndata: ${JSON.stringify({ error: { message: 'stream failed', type: 'server_error' } })}\n\n`
        )
      } else if (truncateStream) {
        res.end(`data: ${JSON.stringify(payload)}\n\n`)
      } else if (holdResponse) {
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
        : key === 'app.root'
          ? resolve(process.cwd(), file ?? '')
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
      root: () => runtimeId('root'),
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
      toolCallIdentity: async (call) => ({ toolCallId: call.key }),
      emit: () => {},
      observe: () => {}
    })
  }

  it.each([
    { adapterFamily: undefined, presetProviderId: 'omlx', expected: 'instructions' },
    { adapterFamily: 'open-responses', presetProviderId: null, expected: 'instructions' },
    { adapterFamily: 'xai', presetProviderId: null, expected: 'message' },
    { adapterFamily: 'openai', presetProviderId: null, expected: 'separate' }
  ] as const)(
    'preserves caller instructions through the $adapterFamily Responses adapter',
    async ({ adapterFamily, presetProviderId, expected }) => {
      protocol = 'openai-responses'
      const endpoint = providerService.getByProviderId('port').endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      dbh.db
        .update(userProviderTable)
        .set({
          presetProviderId,
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: endpoint!.baseUrl, ...(adapterFamily && { adapterFamily }) }
          },
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES
        })
        .where(eq(userProviderTable.providerId, 'port'))
        .run()
      dbh.db
        .update(userModelTable)
        .set({ endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES] })
        .where(eq(userModelTable.id, 'port::wire-model'))
        .run()
      const response = await processMessage({
        inputFormat: 'openai-responses',
        outputFormat: 'openai-responses',
        params: {
          model: 'port:wire-model',
          stream: true,
          instructions: 'Caller instructions must survive.',
          input: [
            { role: 'developer', content: 'Keep the skill catalog.' },
            { role: 'user', content: 'Hello' }
          ]
        }
      })
      await response.text()
      expect(requests).toHaveLength(1)
      const body = requests[0]
      if (expected === 'instructions') {
        expect(body.instructions).toContain('Caller instructions must survive.')
        expect(body.instructions).toContain('Keep the skill catalog.')
      } else if (expected === 'message') {
        expect(body.input).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('Caller instructions must survive.')
            }),
            expect.objectContaining({ role: 'system', content: expect.stringContaining('Keep the skill catalog.') })
          ])
        )
      } else {
        expect(body.instructions).toBe('Caller instructions must survive.')
        expect(JSON.stringify(body.input)).toContain('Keep the skill catalog.')
        expect(JSON.stringify(body.input)).not.toContain('Caller instructions must survive.')
      }
    }
  )

  it('rotates Pi gateway dispatch credentials once per request', async () => {
    dbh.db
      .update(userProviderTable)
      .set({
        apiKeys: [
          { id: 'key-a', key: 'fixture-a', isEnabled: true },
          { id: 'key-b', key: 'fixture-b', isEnabled: true }
        ]
      })
      .where(eq(userProviderTable.providerId, 'port'))
      .run()
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    for (let attempt = 0; attempt < 4; attempt++) {
      const reply = await binding.modelRuntime.completeSimple(
        binding.model,
        normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] })
      )
      expect(reply.stopReason).toBe('stop')
    }
    expect(dispatchKeys).toEqual(['Bearer fixture-a', 'Bearer fixture-b', 'Bearer fixture-a', 'Bearer fixture-b'])
  })

  it('keeps plaintext and summary distinct in a generic Responses tool continuation', async () => {
    protocol = 'openai-responses'
    const baseUrl =
      providerService.getByProviderId('port').endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: baseUrl!, adapterFamily: 'open-responses' } }
      })
      .where(eq(userProviderTable.providerId, 'port'))
      .run()
    dbh.db
      .update(userModelTable)
      .set({ endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES] })
      .where(eq(userModelTable.id, 'port::wire-model'))
      .run()
    const response = await processMessage({
      inputFormat: 'openai-responses',
      outputFormat: 'openai-responses',
      params: {
        model: 'port:wire-model',
        stream: true,
        input: [
          { role: 'user', content: 'Look up cedar' },
          {
            type: 'reasoning',
            id: 'rs_chain',
            content: [{ type: 'reasoning_text', text: 'Complete reasoning chain' }],
            summary: [{ type: 'summary_text', text: 'Abbreviated chain' }]
          },
          { type: 'function_call', call_id: 'lookup-1', name: 'lookup', arguments: '{}' },
          { type: 'function_call_output', call_id: 'lookup-1', output: 'cedar' }
        ]
      }
    })
    await response.text()
    expect(requests).toHaveLength(1)
    expect(requests[0].input).toEqual(
      expect.arrayContaining([
        {
          type: 'reasoning',
          content: [{ type: 'reasoning_text', text: 'Complete reasoning chain' }],
          summary: [{ type: 'summary_text', text: 'Abbreviated chain' }]
        },
        expect.objectContaining({ type: 'function_call', call_id: 'lookup-1' }),
        expect.objectContaining({ type: 'function_call_output', call_id: 'lookup-1' })
      ])
    )
    expect((requests[0].input as Array<{ type: string }>).filter(({ type }) => type === 'reasoning')).toHaveLength(1)
  })

  it('retains the explicit SDK retry budget with only a replay route guard', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.enabled', false)
    rejectUpstream = () =>
      requests.length === 1 ? { message: 'Try again', code: 'busy', status: 503, retryAfter: '0.01' } : undefined
    const result = await mocks.ai!.streamText({
      conversation: { id: 'chat', topicId: 'chat' },
      trigger: 'submit-message',
      uniqueModelId: 'port::wire-model',
      messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      requestOptions: { maxRetries: 1, signal: new AbortController().signal }
    })
    if (result.kind !== 'chunks') throw new Error('Expected text stream')
    const chunks: UIMessageChunk[] = []
    for await (const chunk of result.stream) chunks.push(chunk)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Model answer' }))
    expect(requests).toHaveLength(2)
  })

  it('lowers a rejected Chat output budget to the provider ceiling', async () => {
    rejectUpstream = () =>
      requests.length === 1
        ? {
            message: 'Invalid max_tokens value, the valid range of max_tokens is [1, 393216]',
            code: 'invalid_request_error'
          }
        : undefined
    const result = await mocks.ai!.streamText({
      conversation: { id: 'chat', topicId: 'chat' },
      trigger: 'submit-message',
      uniqueModelId: 'port::wire-model',
      messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      callOverrides: { maxOutputTokens: 500000 },
      requestOptions: { signal: new AbortController().signal }
    })
    if (result.kind !== 'chunks') throw new Error('Expected text stream')
    const chunks: UIMessageChunk[] = []
    for await (const chunk of result.stream) chunks.push(chunk)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Model answer' }))
    expect(requests).toEqual([expect.objectContaining({ max_tokens: 500000 }), { ...requests[0], max_tokens: 393216 }])
  })

  it('lowers a rejected Pi output budget on the same Work request', async () => {
    rejectUpstream = () =>
      requests.length === 1
        ? {
            message: 'max_tokens is too large: 1024. This model supports at most 512 completion tokens.',
            code: 'bad_request'
          }
        : undefined
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const answer = await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] })
    )
    expect(answer.stopReason).toBe('stop')
    expect(requests).toEqual([expect.objectContaining({ max_tokens: 1024 }), { ...requests[0], max_tokens: 512 }])
  })

  it.each([true, false])(
    'recovers an Anthropic gateway request only for a trusted desktop session (%s)',
    async (internal) => {
      rejectUpstream = () =>
        requests.length === 1
          ? { message: "Field 'max_tokens' must be at most 512", code: 'invalid_request_error' }
          : undefined
      const response = await processMessage({
        params: {
          model: 'port:wire-model',
          stream: true,
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'fixture' }]
        },
        inputFormat: 'anthropic',
        outputFormat: 'anthropic',
        requestHeaders: new Headers({
          ...(internal && { authorization: 'Bearer internal-fixture-key' }),
          'x-cherry-agent-session-id': 'session'
        })
      }).catch((error: unknown) => error)
      if (internal) {
        expect(response).toBeInstanceOf(Response)
        expect(await (response as Response).text()).toContain('Model answer')
        expect(requests).toEqual([expect.objectContaining({ max_tokens: 1024 }), { ...requests[0], max_tokens: 512 }])
      } else {
        expect(response).toMatchObject({ statusCode: 400 })
        expect(requests.map(({ max_tokens }) => max_tokens)).toEqual([1024])
      }
    }
  )

  it('returns the last provider status and body when an internal HTTP call exhausts budget retries', async () => {
    protocol = 'anthropic'
    rejectUpstream = () => ({
      message: `max_tokens is too large (attempt ${requests.length})`,
      code: 'invalid_request_error',
      status: 422
    })
    const response = await fetch(`${mocks.gatewayUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-fixture-key',
        'content-type': 'application/json',
        'x-cherry-agent-session-id': 'session'
      },
      body: JSON.stringify({
        model: 'port:wire-model',
        stream: true,
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'fixture' }]
      })
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { message: 'max_tokens is too large (attempt 4)' } })
    expect(requests.map(({ max_tokens }) => max_tokens)).toEqual([1024, 512, 256, 128])
  })

  it('joins the SDK call to the native phase with one upstream request and billing record', async () => {
    const captured: SpanEntity[] = []
    const tracerProvider = new BasicTracerProvider()
    vi.spyOn(trace, 'getTracer').mockImplementation((name) => tracerProvider.getTracer(name))
    observabilitySinks.register({
      id: 'pi-gateway-native-test',
      writeSpanEntity: (span) => {
        captured.push(span)
      }
    })
    const preferences = application.get('PreferenceService')
    const previous = preferences.get('app.developer_mode.enabled')
    await preferences.set('app.developer_mode.enabled', true)
    const owner = {
      topicId: 'agent-session:native-parent',
      sessionId: 'native-parent',
      turnId: 'turn',
      traceId: '11111111111111111111111111111111',
      rootSpanId: '2222222222222222'
    }
    const native = createPiTelemetry({ getParent: () => owner, isEnabled: () => true })
    try {
      const binding = await createPiGatewayModelBinding(
        { sessionId: owner.sessionId },
        providerService.getByProviderId('port'),
        modelService.getByKey('port', 'wire-model')
      )
      const answer = await native.startSpan({ name: 'pi.durable.phase', attributes: { 'task.id': 7 } }, (telemetry) =>
        binding.modelRuntime.completeSimple(
          binding.model,
          normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 1 }] }),
          { telemetry }
        )
      )
      expect(answer.stopReason).toBe('stop')
      const phase = captured.find((span) => span.name === 'pi.durable.phase')!
      const sdk = captured.filter((span) => span.name === 'ai.streamText')
      expect(sdk).toHaveLength(1)
      expect(sdk[0]).toMatchObject({ traceId: owner.traceId, parentId: phase.id, topicId: owner.topicId })
      expect(captured.filter((span) => span.name.startsWith('pi.')).map((span) => span.name)).toEqual([
        'pi.durable.phase'
      ])
      expect(requests).toHaveLength(1)
      const records = dbh.db.select().from(aiUsageRecordTable).all()
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ inputTokens: 100, outputTokens: 25 })
    } finally {
      await preferences.set('app.developer_mode.enabled', previous)
      await tracerProvider.shutdown()
    }
  })

  it('keeps concurrent roots with the same model on their own gateway session and request settings', async () => {
    dbh.db
      .update(userModelTable)
      .set({
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
        reasoning: { controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }] }
      })
      .where(eq(userModelTable.id, 'port::wire-model'))
      .run()
    for (const id of ['parent', 'fork', 'third']) {
      mocks.usageContexts.set(id, { agentSessionId: id, assistantMessageId: id, source: null })
    }
    const provider = providerService.getByProviderId('port')
    const model = modelService.getByKey('port', 'wire-model')
    const first = await createPiGatewayModelBinding(
      { sessionId: 'parent', serviceTier: 'fast', reasoningEffort: 'high' },
      provider,
      model
    )
    const child = await createPiGatewayModelBinding(
      { sessionId: 'fork', serviceTier: 'standard', reasoningEffort: 'low' },
      provider,
      model,
      undefined,
      first.modelRuntime
    )
    const later = await createPiGatewayModelBinding(
      { sessionId: 'third', serviceTier: 'fast', reasoningEffort: 'medium' },
      provider,
      model,
      undefined,
      first.modelRuntime
    )
    const results = await Promise.all(
      [first, child, later].map((binding) =>
        binding.modelRuntime.completeSimple(
          binding.model,
          normalizeContext({ messages: [{ role: 'user', content: binding.model.provider, timestamp: 1 }] })
        )
      )
    )
    expect(results.map((result) => result.stopReason)).toEqual(['stop', 'stop', 'stop'])
    expect(
      dbh.db
        .select()
        .from(aiUsageRecordTable)
        .all()
        .map((row) => row.messageId)
        .sort()
    ).toEqual(['fork', 'parent', 'third'])
    expect(requests.map((request) => request.reasoning_effort).sort()).toEqual(['high', 'low', 'medium'])
  })

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
    const candidates = await host.models.find('wire-model', runtimeId('root'))
    expect(candidates).toHaveLength(1)
    expect(candidates[0].provider).toBe('port')
    expect(await host.models.current(runtimeId('root'))).toMatchObject({
      parentModelKey: candidates[0].key,
      defaultChildModelKey: candidates[0].key,
      supportsTools: true
    })
    dbh.db.update(userProviderTable).set({ isEnabled: false }).where(eq(userProviderTable.providerId, 'port')).run()
    expect(await host.models.find('wire-model', runtimeId('root'))).toEqual([])
    expect(requests).toEqual([])
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toEqual([])
  })

  it.each([
    [400, 'invalid_parameter', 'invalid_request_error'],
    [401, 'invalid_api_key', 'authentication_error'],
    [403, 'permission_denied', 'permission_error'],
    [429, 'rate_limit_exceeded', 'rate_limit_error'],
    [503, 'server_busy', 'server_error']
  ] as const)('preserves upstream %i error details for internal runtime calls', async (status, code, type) => {
    const message = `provider ${code}: ${'detail '.repeat(110)}`
    rejectUpstream = () => ({ status, code, type, message, param: 'temperature', retryAfter: '19' })
    const response = await fetch(`${mocks.gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer internal-fixture-key', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'port:wire-model', messages: [{ role: 'user', content: 'hello' }], stream: true })
    })
    expect(response.status).toBe(status)
    expect(response.headers.get('retry-after')).toBe('19')
    expect(await response.json()).toEqual({
      error: { code, type, message, param: 'temperature' },
      request_id: 'upstream-id'
    })
  })

  it.each([429, 503])('retries an object request after upstream %i before native output', async (status) => {
    rejectUpstream = () =>
      requests.length === 1
        ? { status, code: 'temporary_failure', message: 'Temporarily unavailable', retryAfter: '0.001' }
        : undefined
    const retryEvents: RetryPartData[] = []
    const response = await directObjectCall(undefined, (event) => retryEvents.push(event))
    let text = ''
    for await (const event of response.events) text += event.choices[0]?.delta.content ?? ''
    expect(text).toBe('Model answer')
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(retryEvents).toEqual([
      expect.objectContaining({ state: 'retrying', attempt: 2, modelId: 'wire-model' }),
      { state: 'settled' }
    ])
  })

  it('preserves the final provider error after three ai-retry retries', async () => {
    rejectUpstream = () => ({
      status: 429,
      code: 'CONCURRENCY_LIMITED',
      message: 'Provider concurrency exceeded',
      retryAfter: '0.001'
    })
    const retryEvents: RetryPartData[] = []
    const error = await directObjectCall(undefined, (event) => retryEvents.push(event)).catch((error: unknown) => error)
    expect(error).toMatchObject({
      status: 429,
      message: 'Provider concurrency exceeded',
      error: { error: { code: 'CONCURRENCY_LIMITED' } }
    })
    expect(requests).toHaveLength(4)
    expect(retryEvents[0]).toMatchObject({ state: 'retrying', attempt: 2 })
    expect(retryEvents.at(-1)).toEqual({ state: 'settled' })
  })

  it('surfaces the final SSE overflow when a transient error already triggered a retry', async () => {
    rejectUpstream = () =>
      requests.length === 1
        ? { status: 429, code: 'CONCURRENCY_LIMITED', message: 'Provider busy', retryAfter: '0.001' }
        : { stream: 'before-content', code: 'context_length_exceeded', message: 'The request cannot be processed.' }
    await expect(directObjectCall()).rejects.toMatchObject({
      status: 400,
      error: { error: { code: 'context_length_exceeded' } }
    })
    expect(requests).toHaveLength(2)
  })

  it.each(['before-content', 'after-content'] as const)(
    'preserves a code-only upstream SSE overflow %s',
    async (stream) => {
      rejectUpstream = () => ({ stream, code: 'context_length_exceeded', message: 'The request cannot be processed.' })
      const response = await fetch(`${mocks.gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'port:wire-model',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true
        })
      })
      const body = await response.text()
      expect(response.status).toBe(stream === 'before-content' ? 400 : 200)
      if (stream === 'after-content') {
        expect(body).toContain('Model answer')
        expect(body).not.toContain('[DONE]')
      }
      const errors =
        stream === 'before-content'
          ? [JSON.parse(body).error]
          : body
              .split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => JSON.parse(line.slice(6)).error)
              .filter(Boolean)
      expect(errors).toEqual([
        expect.objectContaining({
          code: 'context_length_exceeded',
          message: expect.stringContaining('The request cannot be processed.')
        })
      ])
      expect(requests).toHaveLength(1)
    }
  )

  it('preserves non-context provider errors in the native Pi response', async () => {
    const message = `Provider rejected configuration: ${'detail '.repeat(110)}`
    rejectUpstream = () => ({ status: 400, code: 'vendor_config_error', type: 'vendor_error', message, param: 'mode' })
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const answer = await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 1 }] }),
      { maxRetries: 0 }
    )
    expect(answer.stopReason).toBe('error')
    expect(answer.errorMessage).toContain('vendor_config_error')
    expect(answer.errorMessage).toContain('vendor_error')
    expect(answer.errorMessage).toContain(message)
    expect(answer.errorMessage).toContain('mode')
  })

  const overflowCases = [
    {
      name: 'structured overflow',
      code: 'context_length_exceeded',
      message: 'The request cannot be processed.',
      overflow: true
    },
    {
      name: 'DeepSeek overflow',
      code: 'invalid_request_error',
      message: "This model's maximum context length is 1048576 tokens. However, you requested 1065651 tokens.",
      overflow: true
    },
    {
      name: 'ordinary 400',
      code: 'invalid_request_error',
      message: 'Invalid context window parameter',
      overflow: false
    }
  ] as const

  it.each(overflowCases)('handles $name through the gateway', async ({ code, message, overflow }) => {
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const directory = tempDir('gateway-overflow')
    session = await openSession({
      ...binding,
      cwd: directory,
      agentDir: directory,
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 1 }
    })
    await sendUser('Earlier conversation')
    rejectUpstream = () => (requests.length === 2 ? { message, code } : undefined)
    await sendUser('Continue the task')
    expect(session.pi.history().some((entry) => entry.type === 'compaction')).toBe(overflow)
    if (overflow) expect(requests.length).toBeGreaterThanOrEqual(4)
    else expect(requests).toHaveLength(2)
    expect(outcome()).toBe(overflow ? 'completed' : 'failed')
  })

  it.each(overflowCases)('handles $name in Durable through the gateway', async ({ code, message, overflow }) => {
    const { createModels, createProvider } = await import('@earendil-works/pi-ai')
    const { stream, streamSimple } = await import('@earendil-works/pi-ai/api/openai-completions')
    const { MemoryStorage, createRegistry } = await import('@earendil-works/pi-durable')
    const { createPiDurableRuntime } = await import('@cherrystudio/agent-runtime-pi-durable')
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const model = { ...binding.model, provider: 'durable-gateway-test', api: 'openai-completions' as const }
    const models = createModels()
    models.setProvider(
      createProvider({
        id: model.provider,
        models: [model],
        auth: { apiKey: { name: 'gateway', resolve: async () => ({ auth: { apiKey: 'internal-fixture-key' } }) } },
        api: {
          stream: (model, context, options) =>
            stream({ ...model, api: 'openai-completions' }, context, {
              ...options,
              objectTransports: application
                .get('ApiGatewayService')
                .createAgentObjectTransports({ sessionId: 'session' })
            }),
          streamSimple: (model, context, options) =>
            streamSimple({ ...model, api: 'openai-completions' }, context, {
              ...options,
              objectTransports: application
                .get('ApiGatewayService')
                .createAgentObjectTransports({ sessionId: 'session' })
            })
        }
      })
    )
    const durable = confirmed(
      await createPiDurableRuntime({
        backendId: runtimeId('durable-gateway-test'),
        openStorage: async () => new MemoryStorage(),
        harness: {
          models,
          registry: createRegistry(),
          settings: {
            retry: { enabled: false },
            compaction: { reserveTokens: 16_384, keepRecentTokens: 1, backgroundTokens: 0 }
          }
        },
        behavior: createTestBehavior(model)
      })
    )
    try {
      const handle = confirmed(
        await durable.create({
          ownership: { kind: 'ownerless' },
          agent: { model: { provider: model.provider, modelId: model.id } }
        })
      )
      confirmed(await durable.resume())
      await handle.input.submit!({ inputId: runtimeId('first'), text: 'Earlier conversation' })
      await durable.settled()
      rejectUpstream = () => (requests.length === 2 ? { message, code } : undefined)
      await handle.input.submit!({ inputId: runtimeId('second'), text: 'Continue the task' })
      await durable.settled()
      const facts = await handle.durable.facts()
      const compaction = facts.history.findIndex((entry) => entry.kind === 'compaction')
      expect(compaction !== -1).toBe(overflow)
      if (overflow) {
        expect(requests.length).toBeGreaterThanOrEqual(4)
        expect(
          facts.history
            .slice(compaction + 1)
            .some((entry) => entry.kind === 'assistant' && entry.text === 'Model answer')
        ).toBe(true)
      } else expect(requests).toHaveLength(2)
      expect(facts.live.runEnd?.outcome).toBe(overflow ? 'completed' : 'error')
    } finally {
      confirmed(await durable.shutdown())
    }
  })

  it('records each native summary through the gateway once', async () => {
    call = () => ({ content: 'Preserved objective and pending work' })
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const directory = tempDir('gateway-native-summary')
    session = await openSession({
      ...binding,
      cwd: directory,
      agentDir: directory,
      compaction: { enabled: false, reserveTokens: 16_384, keepRecentTokens: 1 }
    })
    await sendUser('Conversation to summarize')
    confirmed(await session.compact!())
    expect(session.pi.history().some((entry) => entry.type === 'compaction')).toBe(true)
    const charges = dbh.db.select().from(aiUsageRecordTable).all()
    expect(charges).toHaveLength(2)
    expect(charges[1]).toMatchObject({ inputTokens: 100, outputTokens: 25, messageId: 'original-answer' })
    expect(charges[1].cost).toBeCloseTo(0.0003)
    expect(requests).toHaveLength(2)
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
  it.each([
    { adapterFamily: 'openai', state: 'encrypted' },
    { adapterFamily: 'xai-responses', state: 'encrypted' },
    { adapterFamily: 'openai', state: 'plaintext' }
  ] as const)('replays $state $adapterFamily reasoning through native Pi', async ({ adapterFamily, state }) => {
    protocol = 'openai-responses'
    plaintextResponse = state === 'plaintext'
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: url, adapterFamily } },
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
    expect(requests[1].input).toContainEqual(
      expect.objectContaining({
        type: 'reasoning',
        summary: [],
        ...(plaintextResponse
          ? { content: [{ type: 'reasoning_text', text: 'native plaintext' }] }
          : { id: 'rs_native_1', encrypted_content: 'encrypted-native-state' })
      })
    )
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(2)
  })

  it.each([
    { format: 'anthropic', endpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES },
    { format: 'gemini', endpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT }
  ] as const)(
    'replays $format opaque reasoning on its original route across native registrations',
    async ({ format, endpoint }) => {
      protocol = format
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${format === 'gemini' ? 'v1beta' : 'v1'}`
      const configure = (baseUrl: string) =>
        dbh.db
          .update(userProviderTable)
          .set({ endpointConfigs: { [endpoint]: { baseUrl } }, defaultChatEndpoint: endpoint })
          .where(eq(userProviderTable.providerId, 'port'))
          .run()
      const gemini = format === 'gemini'
      const wireModelId = gemini ? 'gemini-3-flash-preview' : 'wire-model'
      if (gemini) {
        dbh.db
          .update(userModelTable)
          .set({ id: `port::${wireModelId}`, modelId: wireModelId })
          .where(eq(userModelTable.id, 'port::wire-model'))
          .run()
      }
      configure(url)
      const bind = (sharedModels?: Awaited<ReturnType<typeof createPiGatewayModelBinding>>['modelRuntime']) =>
        createPiGatewayModelBinding(
          { sessionId: 'session' },
          providerService.getByProviderId('port'),
          modelService.getByKey('port', wireModelId),
          undefined,
          sharedModels
        )
      const binding = await bind()
      const question = { role: 'user', content: 'first question', timestamp: 1 } as const
      const original = await binding.modelRuntime.completeSimple(
        binding.model,
        normalizeContext({ messages: [question] })
      )
      expect(original.stopReason).toBe('stop')
      const reopened = await bind(binding.modelRuntime)
      const signature = Buffer.from('tool-signature').toString('base64')
      if (gemini) {
        original.content.push({
          type: 'toolCall',
          id: 'read-0',
          name: 'read',
          arguments: { path: 'fixture' },
          thoughtSignature: signature
        })
      }
      const history = normalizeContext({
        messages: [
          question,
          JSON.parse(JSON.stringify(original)),
          ...(gemini
            ? [
                {
                  role: 'toolResult' as const,
                  toolCallId: 'read-0',
                  toolName: 'read',
                  content: [{ type: 'text' as const, text: 'fixture' }],
                  isError: false,
                  timestamp: 2
                }
              ]
            : []),
          { role: 'user', content: 'continue', timestamp: 3 }
        ]
      })
      configure(url.replace(/\/v1/, '/other/v1'))
      expect((await reopened.modelRuntime.completeSimple(reopened.model, history)).stopReason).toBe('stop')
      expect(JSON.stringify(requests[1])).not.toMatch(/opaque-ciphertext|thoughtSignature/)
      configure(url)
      expect((await reopened.modelRuntime.completeSimple(reopened.model, history)).stopReason).toBe('stop')
      expect(requests).toHaveLength(3)
      if (format === 'anthropic') {
        const messages = requests[2].messages as Array<{ role: string; content: unknown[] }>
        expect(
          messages.filter((message) => message.role === 'assistant').flatMap((message) => message.content)
        ).toContainEqual({
          type: 'redacted_thinking',
          data: 'opaque-ciphertext'
        })
      } else {
        expect(JSON.stringify(requests[1])).toContain('functionResponse')
        const contents = requests[2].contents as Array<{ role: string; parts: unknown[] }>
        expect(
          contents.filter((content) => content.role === 'model').flatMap((content) => content.parts)
        ).toMatchObject([
          { text: 'reasoning', thought: true, thoughtSignature: Buffer.from('thought-signature').toString('base64') },
          { text: 'answer', thoughtSignature: Buffer.from('text-signature').toString('base64') },
          { functionCall: { name: 'read' }, thoughtSignature: signature }
        ])
      }
      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(3)
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

  it('retains the child capture and trace when a root binding makes a detached model call', async () => {
    mocks.usageContexts.set('root', {
      agentSessionId: 'root',
      assistantMessageId: 'root-message',
      source: { type: 'agent', id: 'original-agent', name: 'Original Agent', icon: null }
    })
    const captured: SpanEntity[] = []
    const tracerProvider = new BasicTracerProvider()
    vi.spyOn(trace, 'getTracer').mockImplementation((name) => tracerProvider.getTracer(name))
    observabilitySinks.register({
      id: 'child-capture-test',
      writeSpanEntity: (span) => {
        captured.push(span)
      }
    })
    const preferences = application.get('PreferenceService')
    const previous = preferences.get('app.developer_mode.enabled')
    await preferences.set('app.developer_mode.enabled', true)
    const parent = {
      topicId: 'agent-session:child',
      sessionId: 'child',
      turnId: 'verifier',
      traceId: '11111111111111111111111111111111',
      rootSpanId: '2222222222222222'
    }
    const capture = mocks.gatewayService!.captureAgentSessionUsage('root', 'child', parent)
    const native = createPiTelemetry({
      getParent: () => ({
        ...parent,
        topicId: 'agent-session:root',
        sessionId: 'root',
        traceId: '33333333333333333333333333333333',
        rootSpanId: '4444444444444444'
      }),
      isEnabled: () => true
    })
    try {
      const binding = await createPiGatewayModelBinding(
        { sessionId: 'root' },
        providerService.getByProviderId('port'),
        modelService.getByKey('port', 'wire-model')
      )
      const request = vi.spyOn(mocks.ai!, 'streamText')
      const answer = await native.startSpan({ name: 'root-phase' }, (telemetry) =>
        binding.modelRuntime.completeSimple(
          binding.model,
          normalizeContext({ messages: [{ role: 'user', content: 'verify child', timestamp: 1 }] }),
          { headers: capture.headers, telemetry }
        )
      )
      expect(answer.stopReason).toBe('stop')
      expect(request.mock.calls[0][0].usageContext).toMatchObject({
        agentSessionId: 'child',
        traceContext: parent
      })
      expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([
        { sourceType: 'agent', sourceId: 'original-agent', inputTokens: 100, outputTokens: 25 }
      ])
      expect(captured.filter((span) => span.name === 'ai.streamText')).toMatchObject([
        { traceId: parent.traceId, parentId: parent.rootSpanId, topicId: parent.topicId }
      ])
    } finally {
      capture.release()
      await preferences.set('app.developer_mode.enabled', previous)
      await tracerProvider.shutdown()
    }
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
  it.each([
    { format: 'openai', endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS },
    { format: 'openai-responses', endpoint: ENDPOINT_TYPE.OPENAI_RESPONSES },
    { format: 'anthropic', endpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES },
    { format: 'gemini', endpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT }
  ] as const)('executes $format without internal request JSON or SSE codecs', async ({ format, endpoint }) => {
    protocol = format
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: {
          [endpoint]: {
            baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/${format === 'gemini' ? 'v1beta' : 'v1'}`
          }
        },
        defaultChatEndpoint: endpoint
      })
      .where(eq(userProviderTable.providerId, 'port'))
      .run()
    const stringify = JSON.stringify
    vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
      if (
        value &&
        !Array.isArray(value) &&
        typeof value === 'object' &&
        'model' in value &&
        value.model === 'port:wire-model' &&
        ('messages' in value || 'input' in value || 'contents' in value)
      ) {
        throw new Error('Internal protocol requests must remain objects')
      }
      return stringify(value, replacer, space)
    })
    vi.spyOn(StreamAdapterFactory, 'getFormatter').mockImplementation(() => {
      throw new Error('Internal protocol events must not use an SSE formatter')
    })
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const answer = await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] })
    )
    expect(answer.stopReason).toBe('stop')
    expect(answer.content.some((part) => part.type === 'text' && part.text.length > 0)).toBe(true)
    expect(mocks.gatewayRequests).toBe(0)
    expect(requests).toHaveLength(1)
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(1)
  })

  it.each(['encrypted_content', 'reasoning_details'] as const)('replays Chat %s once', async (field) => {
    const details = [{ type: 'reasoning.encrypted', id: 'r1', format: 'anthropic-claude-v1', data: 'opaque' }]
    const metadata: NonNullable<Extract<UIMessageChunk, { type: 'reasoning-end' }>['providerMetadata']> =
      field === 'encrypted_content'
        ? { openaiCompatible: { reasoningEncryptedContent: 'opaque' } }
        : { openrouter: { reasoning_details: details } }
    let step = 0
    const upstream = vi.spyOn(mocks.ai!, 'streamText').mockImplementation(async () => ({
      kind: 'chunks',
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          if (step++ === 0) {
            controller.enqueue({ type: 'reasoning-start', id: 'r1' })
            controller.enqueue({ type: 'reasoning-end', id: 'r1', providerMetadata: metadata })
            controller.enqueue({
              type: 'tool-input-available',
              toolCallId: 'lookup_1',
              toolName: 'lookup',
              input: { query: 'example' },
              providerMetadata: metadata
            })
            controller.enqueue({ type: 'finish', finishReason: 'tool-calls' })
          } else {
            controller.enqueue({ type: 'text-start', id: 't1' })
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'done' })
            controller.enqueue({ type: 'text-end', id: 't1' })
            controller.enqueue({ type: 'finish', finishReason: 'stop' })
          }
          controller.close()
        }
      })
    }))
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const user = { role: 'user' as const, content: 'look up example', timestamp: 1 }
    const answer = await binding.modelRuntime.completeSimple(binding.model, normalizeContext({ messages: [user] }))
    expect(answer.stopReason).toBe('toolUse')
    expect(answer.content).toContainEqual(expect.objectContaining({ type: 'thinking', thinking: '' }))
    const toolResult = {
      role: 'toolResult' as const,
      toolCallId: 'lookup_1',
      toolName: 'lookup',
      content: [{ type: 'text' as const, text: 'found' }],
      isError: false,
      timestamp: 2
    }
    const result = await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({ messages: [user, answer, toolResult] })
    )
    expect(result.stopReason).toBe('stop')
    const assistant = upstream.mock.calls[1][0].messages?.find((message) => message.role === 'assistant')
    expect(assistant?.parts.filter((part) => part.type === 'reasoning')).toEqual([
      expect.objectContaining({ type: 'reasoning', text: '', providerMetadata: metadata })
    ])
    const foreignAnswer = { ...answer, cherryReplayRouteId: 'foreign-route' }
    await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({
        messages: [user, foreignAnswer, toolResult, { ...user, content: 'Follow-up', timestamp: 3 }]
      })
    )
    const foreignAssistant = upstream.mock.calls[2][0].messages?.find((message) => message.role === 'assistant')
    expect(foreignAssistant?.parts).toContainEqual(
      expect.objectContaining({ type: 'dynamic-tool', state: 'output-available', output: 'found' })
    )
    expect(foreignAssistant?.parts.some((part) => part.type === 'reasoning')).toBe(false)
  })

  it.each([
    {
      endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      api: 'chat',
      usage: { input: 50, output: 10, cacheRead: 20, cacheWrite: 30, totalTokens: 110 }
    },
    {
      endpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      api: 'responses',
      usage: { input: 50, output: 10, cacheRead: 20, cacheWrite: 30, totalTokens: 110 }
    },
    {
      endpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      api: 'anthropic',
      usage: { input: 50, output: 10, cacheRead: 20, cacheWrite: 30, reasoning: 7, totalTokens: 110 }
    }
  ])('retains native $api token breakdowns through the object response', async ({ endpoint, usage }) => {
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: { [endpoint]: { baseUrl: 'http://unused.invalid/v1' } },
        defaultChatEndpoint: endpoint
      })
      .where(eq(userProviderTable.providerId, 'port'))
      .run()
    vi.spyOn(mocks.ai!, 'streamText').mockResolvedValue({
      kind: 'chunks',
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({
            type: 'message-metadata',
            messageMetadata: {
              stats: {
                inputTokens: 100,
                outputTokens: 10,
                inputTokenDetails: { cacheReadTokens: 20, cacheWriteTokens: 30 },
                outputTokenDetails: { reasoningTokens: 7 }
              }
            }
          })
          controller.enqueue({ type: 'finish', finishReason: 'stop' })
          controller.close()
        }
      })
    })
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const answer = await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 1 }] })
    )
    expect(answer.stopReason).toBe('stop')
    expect(answer.usage).toMatchObject(usage)
  })

  it.each(
    [
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      ENDPOINT_TYPE.OPENAI_RESPONSES,
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    ].flatMap((endpoint) => [
      { endpoint, reason: 'length' as const, stop: 'length' },
      { endpoint, reason: 'content-filter' as const, stop: 'error' }
    ])
  )('keeps native $reason after a complete tool call on $endpoint', async ({ endpoint, reason, stop }) => {
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: { [endpoint]: { baseUrl: 'http://unused.invalid/v1' } },
        defaultChatEndpoint: endpoint
      })
      .where(eq(userProviderTable.providerId, 'port'))
      .run()
    vi.spyOn(mocks.ai!, 'streamText').mockResolvedValue({
      kind: 'chunks',
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: 'tool-input-available', toolCallId: 'lookup_1', toolName: 'lookup', input: {} })
          controller.enqueue({ type: 'finish', finishReason: reason })
          controller.close()
        }
      })
    })
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const answer = await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 1 }] })
    )
    expect(answer.stopReason).toBe(stop)
    expect(answer.content.some((part) => part.type === 'toolCall' && part.name === 'lookup')).toBe(true)
  })

  it.each(['object', 'http'] as const)('preserves supported Gemini configuration on the %s path', async (path) => {
    protocol = 'gemini'
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
    const config = {
      temperature: 0.4,
      topP: 0.8,
      topK: 20,
      maxOutputTokens: 128,
      stopSequences: ['END'],
      presencePenalty: 0.2,
      frequencyPenalty: 0.3,
      seed: 42,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ],
      cachedContent: 'cachedContents/context',
      labels: { task: 'gateway' },
      serviceTier: ServiceTier.FLEX,
      continuationToken: 'resume-here',
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      audioTimestamp: true,
      tools: [
        {
          functionDeclarations: [
            { name: 'lookup', parametersJsonSchema: { type: 'object', properties: {} } },
            { name: 'other', parametersJsonSchema: { type: 'object', properties: {} } }
          ]
        }
      ],
      toolConfig: {
        functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['lookup'] },
        retrievalConfig: { latLng: { latitude: 10, longitude: 20 } }
      }
    }
    const contents = [{ role: 'user', parts: [{ text: 'hello' }] }]
    if (path === 'object') {
      const response = await mocks
        .gatewayService!.createAgentObjectTransports({ sessionId: 'session' })
        ['google-generative-ai'](
          { model: 'port:wire-model', contents, config: { ...config, automaticFunctionCalling: { disable: true } } },
          {}
        )
      for await (const event of response.events) expect(event).toHaveProperty('candidates')
    } else {
      const {
        tools,
        toolConfig,
        safetySettings,
        cachedContent,
        labels,
        serviceTier,
        continuationToken,
        ...generationConfig
      } = config
      const response = await fetch(`${mocks.gatewayUrl}/v1beta/models/port:wire-model:streamGenerateContent`, {
        method: 'POST',
        body: JSON.stringify({
          contents,
          tools,
          toolConfig,
          safetySettings,
          cachedContent,
          labels,
          serviceTier,
          continuationToken,
          generationConfig
        })
      })
      expect(response.status).toBe(200)
      await response.text()
    }
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      generationConfig: {
        temperature: 0.4,
        topP: 0.8,
        topK: 20,
        maxOutputTokens: 128,
        stopSequences: ['END'],
        presencePenalty: 0.2,
        frequencyPenalty: 0.3,
        seed: 42,
        responseMimeType: 'application/json',
        responseSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
        mediaResolution: 'MEDIA_RESOLUTION_HIGH',
        audioTimestamp: true
      },
      safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }],
      cachedContent: 'cachedContents/context',
      labels: { task: 'gateway' },
      serviceTier: 'flex',
      continuationToken: 'resume-here',
      toolConfig: {
        functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] },
        retrievalConfig: { latLng: { latitude: 10, longitude: 20 } }
      }
    })
    expect(mocks.gatewayRequests).toBe(path === 'object' ? 0 : 1)
  })

  it.each(['object', 'http'] as const)(
    'retains Gemini media and continuation metadata on the %s path',
    async (path) => {
      protocol = 'gemini'
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
      const safetyRatings = [{ category: 'HARM_CATEGORY_HARASSMENT', probability: 'LOW', blocked: false }]
      geminiEvents = [
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { inlineData: { mimeType: 'image/png', data: 'AQID' }, thoughtSignature: 'media-signature' },
                  { text: 'caption' }
                ]
              }
            }
          ]
        },
        {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'MAX_TOKENS',
              finishMessage: 'Budget exhausted',
              continuationToken: 'resume-token',
              safetyRatings
            }
          ],
          promptFeedback: { safetyRatings },
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25, totalTokenCount: 125, serviceTier: 'flex' }
        }
      ]
      const contents = [{ role: 'user', parts: [{ text: 'hello' }] }]
      const frames: unknown[] = []
      if (path === 'object') {
        const response = await mocks
          .gatewayService!.createAgentObjectTransports({ sessionId: 'session' })
          ['google-generative-ai']({ model: 'port:wire-model', contents }, {})
        for await (const event of response.events) frames.push(event)
      } else {
        const response = await fetch(`${mocks.gatewayUrl}/v1beta/models/port:wire-model:streamGenerateContent`, {
          method: 'POST',
          body: JSON.stringify({ contents })
        })
        expect(response.status).toBe(200)
        for (const frame of (await response.text()).split('\n\n')) {
          if (frame.startsWith('data: ')) frames.push(JSON.parse(frame.slice(6)))
        }
      }
      expect(frames).toContainEqual(
        expect.objectContaining({
          candidates: [
            expect.objectContaining({
              content: {
                role: 'model',
                parts: [{ inlineData: { mimeType: 'image/png', data: 'AQID' }, thoughtSignature: 'media-signature' }]
              }
            })
          ]
        })
      )
      expect(frames.at(-1)).toMatchObject({
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            finishMessage: 'Budget exhausted',
            continuationToken: 'resume-token',
            safetyRatings
          }
        ],
        promptFeedback: { safetyRatings },
        usageMetadata: { serviceTier: 'flex' }
      })
    }
  )

  it.each([
    { mode: FunctionCallingConfigMode.NONE, allowed: undefined },
    { mode: FunctionCallingConfigMode.AUTO, allowed: undefined },
    { mode: FunctionCallingConfigMode.ANY, allowed: ['lookup', 'second'] },
    { mode: FunctionCallingConfigMode.VALIDATED, allowed: ['lookup'] }
  ])('retains Gemini $mode function selection without gateway execution', async ({ mode, allowed }) => {
    protocol = 'gemini'
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
    const response = await mocks
      .gatewayService!.createAgentObjectTransports({ sessionId: 'session' })
      ['google-generative-ai'](
        {
          model: 'port:wire-model',
          contents: 'hello',
          config: {
            tools: [
              {
                functionDeclarations: ['lookup', 'second', 'other'].map((name) => ({
                  name,
                  parametersJsonSchema: { type: 'object', properties: {} }
                }))
              }
            ],
            toolConfig: { functionCallingConfig: { mode, allowedFunctionNames: allowed } }
          }
        },
        {}
      )
    for await (const event of response.events) expect(event).toHaveProperty('candidates')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      tools: [
        {
          functionDeclarations: (allowed ?? ['lookup', 'second', 'other']).map((name) =>
            expect.objectContaining({ name })
          )
        }
      ],
      toolConfig: { functionCallingConfig: { mode } }
    })
  })

  function directObjectCall(signal?: AbortSignal, onRetryEvent?: (event: RetryPartData) => void) {
    const transports = mocks.gatewayService!.createAgentObjectTransports({ sessionId: 'session', onRetryEvent })
    return transports['openai-completions'](
      { model: 'port:wire-model', messages: [{ role: 'user', content: 'Hello' }], stream: true },
      { signal }
    )
  }

  it.each([{ speechConfig: { languageCode: 'en-US' } }, { automaticFunctionCalling: { disable: false } }])(
    'rejects unsupported Gemini config as a local capability failure without an HTTP envelope: %j',
    async (config) => {
      const transports = mocks.gatewayService!.createAgentObjectTransports({ sessionId: 'session' })
      const error = await transports['google-generative-ai'](
        { model: 'port:wire-model', contents: 'hello', config },
        {}
      ).catch((error: unknown) => error)
      expect(UnsupportedFunctionalityError.isInstance(error)).toBe(true)
      expect(error).toHaveProperty('message', expect.stringContaining('Unsupported Gemini config'))
      expect(error).not.toHaveProperty('status')
      expect(error).not.toHaveProperty('error')
      expect(requests).toHaveLength(0)
    }
  )

  it('keeps local Gemini capability failures out of the native provider HTTP error display', async () => {
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: { [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'http://unused.invalid/v1beta' } },
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
      })
      .where(eq(userProviderTable.providerId, 'port'))
      .run()
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const answer = await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 1 }] }),
      {
        onPayload: () => ({
          model: 'port:wire-model',
          contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
          config: { speechConfig: { languageCode: 'en-US' } }
        })
      }
    )
    expect(answer.stopReason).toBe('error')
    expect(answer.errorMessage).toContain('Unsupported Gemini config: speechConfig')
    expect(answer.errorMessage).not.toMatch(/\b400\b|INVALID_ARGUMENT/)
    expect(requests).toHaveLength(0)
  })

  it('returns protocol-shaped preparation failures from object calls', async () => {
    const transports = mocks.gatewayService!.createAgentObjectTransports({ sessionId: 'session' })
    await expect(
      transports['openai-completions']({ model: 'missing', messages: [], stream: true }, {})
    ).rejects.toMatchObject({ status: 400, error: { error: { message: expect.any(String) } } })
    expect(requests).toHaveLength(0)
  })

  it('rejects object calls when execution cannot start', async () => {
    vi.spyOn(mocks.manager!, 'streamPrompt').mockImplementation(() => {
      throw new Error('execution unavailable')
    })
    await expect(directObjectCall()).rejects.toThrow('execution unavailable')
    expect(requests).toHaveLength(0)
  })

  it('retains partial object output and rejects a failed stream instead of completing it', async () => {
    let upstream!: ReadableStreamDefaultController<UIMessageChunk>
    vi.spyOn(mocks.ai!, 'streamText').mockResolvedValue({
      kind: 'chunks',
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          upstream = controller
          controller.enqueue({ type: 'start', messageId: 'failed-test' })
          controller.enqueue({ type: 'text-start', id: 'text' })
          controller.enqueue({ type: 'text-delta', id: 'text', delta: 'partial' })
        }
      })
    })
    const response = await directObjectCall()
    let text = ''
    const reading = (async () => {
      for await (const event of response.events) text += event.choices[0]?.delta.content ?? ''
    })()
    const failed = expect(reading).rejects.toThrow('connection lost')
    await expect.poll(() => text).toBe('partial')
    upstream.error(new Error('connection lost'))
    await failed
    expect(text).toBe('partial')
  })

  it('aborts upstream when an object iterator is closed before its first read', async () => {
    holdResponse = true
    const response = await directObjectCall()
    const iterator = response.events[Symbol.asyncIterator]()
    await iterator.return?.()
    await expect.poll(() => upstreamClosed).toBe(true)
    expect(mocks.gatewayRequests).toBe(0)
  })

  it('does not retry after partial upstream output', async () => {
    failStream = true
    const response = await directObjectCall()
    let text = ''
    const reading = (async () => {
      for await (const event of response.events) text += event.choices[0]?.delta.content ?? ''
    })()
    await expect(reading).rejects.toThrow()
    expect(text).toBe('Model answer')
    expect(requests).toHaveLength(1)
  })

  async function durableRetryModel(baseDelayMs = 15) {
    const failures = new WeakMap<AssistantMessage, RecoverableModelTransportFailure>()
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model'),
      undefined,
      undefined,
      undefined,
      { transportFailures: failures }
    )
    return {
      models: binding.modelRuntime,
      model: { provider: binding.model.provider, modelId: binding.model.id },
      retry: {
        enabled: false,
        transportRetry: (message: AssistantMessage, state: Parameters<typeof planModelTransportRetry>[1]) =>
          planModelTransportRetry(failures.get(message), state, { maxRetries: 2, baseDelayMs, maxDelayMs: 60_000 })
      }
    }
  }

  it.each(['truncation', 'idle timeout'])(
    'retries a native Durable generation after %s with its committed tool result',
    async (failure) => {
      let executions = 0
      if (failure === 'idle timeout') mocks.promptIdleTimeoutMs = 250
      call = () => {
        const interrupted = requests.length === 2
        truncateStream = interrupted && failure === 'truncation'
        holdResponse = interrupted && failure === 'idle timeout'
        if (requests.length === 1) {
          return {
            tool_calls: [
              {
                index: 0,
                id: 'record-once',
                type: 'function',
                function: { name: 'record_once', arguments: '{}' }
              }
            ]
          }
        }
        return { content: interrupted ? 'Interrupted draft' : 'Final answer after reconnect' }
      }
      const { models, model, retry } = await durableRetryModel()
      const registry = createRegistry()
      registry.install(
        defineExtension({
          name: 'record-once',
          tools: [
            defineDurableTool({
              name: 'record_once',
              description: 'Return a committed tool result.',
              parameters: obj({}),
              async execute() {
                executions++
                return { output: [{ type: 'text', text: 'Committed tool result' }] }
              }
            })
          ]
        })
      )
      const ctx = BACKGROUND_CONTEXT
      const harness = await Harness.open(new MemoryStorage(), { models, registry, settings: { retry } }, ctx)
      try {
        const root = await harness.createConversation(
          {
            ownership: { kind: 'ownerless' },
            agent: { model }
          },
          ctx
        )
        const submission = await root.submit(
          { type: 'input', content: 'Run the tool, then answer.', whenBusy: 'reject' },
          ctx
        )
        harness.resume()
        expect((await submission.wait(ctx)).status).toBe('done')
        expect(executions).toBe(1)
        expect(requests).toHaveLength(3)
        expect(JSON.stringify(requests[2]?.messages)).toContain('Committed tool result')
        expect(JSON.stringify(requests[2]?.messages)).not.toContain('Interrupted draft')
      } finally {
        await harness.close(ctx)
      }
    }
  )

  it.each(['resume', 'cancel'] as const)(
    'can %s a persisted offline run beyond its bounded retry budget',
    async (action) => {
      let failedRequests = 0
      mocks.fetchFailure = () => {
        failedRequests++
        return new Error('net::ERR_INTERNET_DISCONNECTED')
      }
      const { models, model, retry } = await durableRetryModel(100)
      const ctx = BACKGROUND_CONTEXT
      const path = resolve(tempDir('gateway-offline'), 'session.sqlite')
      const reopen = async () =>
        Harness.open(
          await openNodeSqliteStorage(path),
          {
            models,
            registry: createRegistry(),
            settings: { retry }
          },
          ctx
        )
      let harness = await reopen()
      try {
        const root = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model } }, ctx)
        const submission = await root.submit({ type: 'input', content: 'Keep this run.', whenBusy: 'reject' }, ctx)
        harness.resume()
        let retryAt = 0
        await expect
          .poll(
            () => {
              const wake = harness.wake()
              if (failedRequests >= 4 && !wake.active && wake.at !== undefined) retryAt = wake.at
              return retryAt
            },
            { timeout: 5_000 }
          )
          .toBeGreaterThan(0)
        const placed = await submission.status(ctx)
        expect(placed).toMatchObject({ status: 'placed', runId: expect.any(Number) })
        await harness.close(ctx)
        mocks.fetchFailure = undefined
        harness = await reopen()
        const restored = (await harness.submission(submission.id, ctx))!
        expect(await restored.status(ctx)).toEqual(placed)
        if (action === 'cancel') {
          await (await harness.conversation(root.id, ctx))!.abort(ctx)
          harness.resume()
          expect(await restored.wait(ctx)).toMatchObject({ status: 'unanswered', reason: 'aborted' })
          // Give the restored task's native backoff a chance to fire after cancellation.
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, retryAt - Date.now()) + 50))
          expect(requests).toHaveLength(0)
        } else {
          harness.resume()
          expect(await restored.wait(ctx)).toMatchObject({
            status: 'done',
            id: submission.id,
            runId: placed.type === 'input' ? placed.runId : undefined
          })
          expect(requests).toHaveLength(1)
        }
      } finally {
        await harness.close(ctx)
      }
    }
  )

  it.each([
    { message: 'net::ERR_CONNECTION_RESET', expectedCalls: 3 },
    { message: 'net::ERR_CERT_AUTHORITY_INVALID', expectedCalls: 1 },
    { message: 'Provider rejected credentials', status: 401, expectedCalls: 1 }
  ])('uses the original failure and bounds requests after $message', async ({ message, status, expectedCalls }) => {
    let calls = 0
    if (status) rejectUpstream = () => ({ message, status, code: 'invalid_api_key' })
    else
      mocks.fetchFailure = () => {
        calls++
        return new Error(message)
      }
    const { models, model, retry } = await durableRetryModel()
    const ctx = BACKGROUND_CONTEXT
    const harness = await Harness.open(
      new MemoryStorage(),
      { models, registry: createRegistry(), settings: { retry } },
      ctx
    )
    try {
      const root = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model } }, ctx)
      const submission = await root.submit({ type: 'input', content: 'Hello', whenBusy: 'reject' }, ctx)
      harness.resume()
      expect(await submission.wait(ctx)).toMatchObject({
        status: 'unanswered',
        reason: 'model_error',
        detail: expect.stringContaining(message)
      })
      expect(calls + requests.length).toBe(expectedCalls)
    } finally {
      await harness.close(ctx)
    }
  })

  it('cancels ai-retry during upstream backoff', async () => {
    rejectUpstream = () => ({
      status: 429,
      code: 'rate_limit',
      message: 'Wait before retry',
      retryAfter: requests.length === 1 ? '0.01' : '10'
    })
    const abort = new AbortController()
    const retryEvents: RetryPartData[] = []
    const rejected = expect(directObjectCall(abort.signal, (event) => retryEvents.push(event))).rejects.toThrow(
      'stop retrying'
    )
    await expect.poll(() => retryEvents[0]?.state).toBe('retrying')
    abort.abort(new Error('stop retrying'))
    await rejected
    await expect.poll(() => mocks.manager!.hasLiveStreams()).toBe(false)
    expect(requests.length).toBeLessThanOrEqual(2)
    expect(retryEvents.at(-1)).toEqual({ state: 'settled' })
  })

  it('aborts an object call while waiting for its first semantic output', async () => {
    holdResponse = true
    call = () => ({})
    const abort = new AbortController()
    const transportFailures: RecoverableModelTransportFailure[] = []
    const transport = mocks.gatewayService!.createAgentObjectTransports({
      sessionId: 'session',
      onModelTransportFailure: (failure) => transportFailures.push(failure)
    })['openai-completions']
    const pending = transport(
      { model: 'port:wire-model', messages: [{ role: 'user', content: 'Hello' }], stream: true },
      { signal: abort.signal }
    )
    const rejected = expect(pending).rejects.toThrow('cancel before content')
    await expect.poll(() => requests.length).toBe(1)
    abort.abort(new Error('cancel before content'))
    await rejected
    await expect.poll(() => upstreamClosed).toBe(true)
    await expect.poll(() => mocks.manager!.hasLiveStreams()).toBe(false)
    expect(transportFailures).toEqual([])
  })

  it('honors native request timeout before semantic output and releases the upstream', async () => {
    holdResponse = true
    call = () => ({})
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const answer = await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({ messages: [{ role: 'user', content: 'wait', timestamp: 1 }] }),
      { timeoutMs: 500, signal: AbortSignal.timeout(2_000) }
    )
    expect(answer.stopReason).toBe('error')
    expect(answer.errorMessage).toMatch(/timeout/i)
    await expect.poll(() => upstreamClosed).toBe(true)
  })

  it.each([
    { format: 'openai', endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS },
    { format: 'openai-responses', endpoint: ENDPOINT_TYPE.OPENAI_RESPONSES },
    { format: 'anthropic', endpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES },
    { format: 'gemini', endpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT }
  ])('cancels the $format upstream when onResponse rejects before iteration', async ({ endpoint }) => {
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: { [endpoint]: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` } },
        defaultChatEndpoint: endpoint
      })
      .where(eq(userProviderTable.providerId, 'port'))
      .run()
    let cancelled = false
    vi.spyOn(mocks.ai!, 'streamText').mockResolvedValue({
      kind: 'chunks',
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: 'start', messageId: 'hook-failure' })
          controller.enqueue({ type: 'text-start', id: 'text' })
          controller.enqueue({ type: 'text-delta', id: 'text', delta: 'hello' })
        },
        cancel() {
          cancelled = true
        }
      })
    })
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const abort = new AbortController()
    try {
      const answer = await binding.modelRuntime.completeSimple(
        binding.model,
        normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 1 }] }),
        {
          signal: abort.signal,
          onResponse: () => {
            throw new Error('consumer hook failed')
          }
        }
      )
      expect(answer.stopReason).toBe('error')
      expect(answer.errorMessage).toContain('consumer hook failed')
      await expect.poll(() => cancelled, { timeout: 500 }).toBe(true)
    } finally {
      abort.abort()
    }
  })

  it('delivers a textless Responses batch of tool errors as native tool calls', async () => {
    const calls = Array.from({ length: 8 }, (_, index) => ({
      id: `unknown-${index}`,
      name: `unknown_tool_${index}`,
      arguments: { index }
    }))
    let nextCall = 0
    vi.spyOn(mocks.ai!, 'streamText').mockResolvedValue({
      kind: 'chunks',
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: 'start', messageId: 'tool-errors' })
        },
        async pull(controller) {
          await new Promise<void>((resolve) => setImmediate(resolve))
          const call = calls[nextCall++]
          if (call) {
            controller.enqueue({
              type: 'tool-input-error',
              toolCallId: call.id,
              toolName: call.name,
              input: call.arguments,
              errorText: 'Unknown tool'
            })
          } else {
            controller.enqueue({ type: 'finish', finishReason: 'tool-calls' })
            controller.close()
          }
        }
      })
    })
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
            baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
          }
        },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES
      })
      .where(eq(userProviderTable.providerId, 'port'))
      .run()
    const binding = await createPiGatewayModelBinding(
      { sessionId: 'session' },
      providerService.getByProviderId('port'),
      modelService.getByKey('port', 'wire-model')
    )
    const answer = await binding.modelRuntime.completeSimple(
      binding.model,
      normalizeContext({ messages: [{ role: 'user', content: 'Run the tools', timestamp: 1 }] }),
      { signal: AbortSignal.timeout(2_000) }
    )
    expect(answer.stopReason, answer.errorMessage).toBe('toolUse')
    expect(answer.content.filter((part) => part.type === 'toolCall')).toMatchObject(
      calls.map(({ name, arguments: input }) => ({ name, arguments: input }))
    )
    expect(
      answer.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    ).toBe('')
    expect(mocks.gatewayRequests).toBe(0)
  })
})
