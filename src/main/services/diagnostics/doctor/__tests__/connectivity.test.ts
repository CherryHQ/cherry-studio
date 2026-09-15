import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { makeProvider } from '@main/ai/__tests__/fixtures/provider'
import { AiService } from '@main/ai/AiService'
import type * as CustomFetchModule from '@main/ai/utils/customFetch'
import { BaseService } from '@main/core/lifecycle'
import { httpReach } from '@main/services/network/probes'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { checkModelConnectivity } from '../connectivity'
import { DoctorService } from '../DoctorService'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiService: { prepareModelCheck: (id: Parameters<AiService['prepareModelCheck']>[0]) => ai.prepareModelCheck(id) },
    NetworkService: {
      diagnoseEndpoint: async ({ url }: { url: string }, signal: AbortSignal) => ({
        http: await httpReach(url, { signal, fetchImpl: fetch })
      })
    }
  } as never)
})

vi.mock('@main/ai/utils/customFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof CustomFetchModule>()),
  customFetch: fetch
}))

let ai: AiService

class ReadyDoctor extends DoctorService {
  constructor() {
    super()
    this.onAllReady()
  }
}

describe('model connectivity against an HTTP provider', () => {
  const dbh = setupTestDatabase()
  let server: Server
  let url: string
  let listStatus: number
  let ids: string[]
  let paths: string[]
  let requests: Record<string, unknown>[]
  let holdConversation: boolean
  let conversationStatus: number

  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    ai = new AiService()
    holdConversation = false
    conversationStatus = 200
    vi.mocked(application.getPath).mockImplementation((namespace, filename) => {
      const root =
        namespace === 'app.root'
          ? process.cwd()
          : namespace === 'feature.provider_registry.data'
            ? path.join(process.cwd(), 'packages/provider-registry/data')
            : `/mock/${namespace}`
      return filename ? path.join(root, filename) : root
    })
    listStatus = 200
    ids = ['wire-model']
    paths = []
    requests = []
    server = createServer(async (req, res) => {
      paths.push(`${req.method} ${req.url}`)
      if (req.url === '/v1/models') {
        res.writeHead(listStatus, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify(
            listStatus === 200 ? { data: ids.map((id) => ({ id })) } : { error: { message: 'test failure' } }
          )
        )
      } else if (req.url === '/v1/chat/completions') {
        let body = ''
        for await (const chunk of req) body += chunk
        requests.push(JSON.parse(body))
        if (holdConversation) return
        if (conversationStatus !== 200) {
          res.writeHead(conversationStatus, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'probe rejected' } }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'check',
            object: 'chat.completion',
            created: 0,
            model: 'wire-model',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
          })
        )
      } else if (req.url === '/api/chat') {
        let body = ''
        for await (const chunk of req) body += chunk
        requests.push(JSON.parse(body))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            model: 'wire-model',
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: 'ok' },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 2,
            eval_count: 1
          })
        )
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'connectivity',
        name: 'Connectivity',
        orderKey: 'a0',
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: url } }
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'connectivity::wire-model',
        providerId: 'connectivity',
        modelId: 'wire-model',
        name: 'Wire model',
        capabilities: [],
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
  })
  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })
  const target = () => ai.prepareModelCheck('connectivity::wire-model')
  const check = (prepared = target()) => checkModelConnectivity(prepared, new AbortController().signal)

  it('reaches the Base URL, finds the wire model, and sends only a minimal conversation', async () => {
    const report = await check()
    expect(report).toMatchObject({
      baseUrl: { status: 'pass', httpStatus: 404 },
      modelList: { status: 'pass' },
      conversation: { status: 'pass' }
    })
    expect(paths).toEqual(['HEAD /v1', 'GET /v1/models', 'POST /v1/chat/completions'])
    expect(requests[0]).toMatchObject({
      model: 'wire-model',
      messages: [
        { role: 'system', content: 'test' },
        { role: 'user', content: 'hi' }
      ]
    })
    expect(requests[0]).not.toHaveProperty('tools')
  })

  it('probes the model-selected endpoint rather than the provider default', async () => {
    const config = makeProvider({ endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: url } } })
    config.defaultChatEndpoint = ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    config.endpointConfigs![ENDPOINT_TYPE.ANTHROPIC_MESSAGES] = { baseUrl: `${url}/wrong` }
    dbh.db
      .update(userProviderTable)
      .set({ endpointConfigs: config.endpointConfigs, defaultChatEndpoint: config.defaultChatEndpoint })
      .run()
    const result = await check()
    expect(result.baseUrl).toMatchObject({ status: 'pass' })
    expect(result.modelList.status).toBe('pass')
    expect(paths).toEqual(['HEAD /v1', 'GET /v1/models', 'POST /v1/chat/completions'])
  })

  it.each([404, 405, 501])(
    'skips an unavailable models endpoint (%s) while still testing conversation',
    async (status) => {
      listStatus = status
      const report = await check()
      expect(report.modelList).toMatchObject({ status: 'skip', reason: 'model_list_endpoint_unavailable' })
      expect(report.conversation.status).toBe('pass')
    }
  )

  it('does not turn a models authentication error into an empty or unsupported catalog', async () => {
    listStatus = 401
    const report = await check()
    expect(report.modelList).toMatchObject({ status: 'fail', reason: 'authentication', httpStatus: 401 })
    expect(report.conversation.status).toBe('pass')
  })

  it('does not use registry entries as remote existence evidence or block a usable unlisted model', async () => {
    ids = []
    const report = await check()
    expect(report.modelList).toMatchObject({ status: 'warn', reason: 'model_not_listed' })
    expect(report.conversation.status).toBe('pass')
  })

  it('skips registry-only listings without requesting models', async () => {
    const report = await check({ ...target(), supportsModelListing: false })
    expect(report.modelList).toMatchObject({ status: 'skip', reason: 'model_list_unsupported' })
    expect(paths).toEqual(['HEAD /v1', 'POST /v1/chat/completions'])
    expect(report.conversation.status).toBe('pass')
  })

  it('never invokes a generation probe for an image-only model', async () => {
    dbh.db
      .update(userModelTable)
      .set({
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
        endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
      })
      .where(eq(userModelTable.id, 'connectivity::wire-model'))
      .run()
    const report = await check()
    expect(requests).toEqual([])
    expect(report.conversation).toMatchObject({ status: 'skip', reason: 'not_chat_model' })
  })

  it('does not retry or fall back when the conversation is rejected', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.max_attempts', 3)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.backoff_enabled', false)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.fallback_model_ids', ['connectivity::backup'])
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'connectivity::backup',
        providerId: 'connectivity',
        modelId: 'backup',
        name: 'Backup',
        capabilities: [],
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
        supportsStreaming: true,
        orderKey: 'a1'
      })
      .run()
    conversationStatus = 503
    const result = await check()
    expect(result.conversation).toMatchObject({ status: 'fail', reason: 'request_failed', httpStatus: 503 })
    expect(requests).toHaveLength(1)
    expect(requests[0].model).toBe('wire-model')
  })

  it('uses a real conversation for Ollama instead of accepting model metadata as health evidence', async () => {
    dbh.db
      .update(userProviderTable)
      .set({
        presetProviderId: 'ollama',
        endpointConfigs: {
          [ENDPOINT_TYPE.OLLAMA_CHAT]: { baseUrl: new URL(url).origin }
        }
      })
      .run()
    dbh.db
      .update(userModelTable)
      .set({ endpointTypes: [ENDPOINT_TYPE.OLLAMA_CHAT] })
      .run()
    const prepared = target()
    await prepared.checkConversation(new AbortController().signal)
    expect(paths).toEqual(['POST /api/chat'])
    expect(requests[0]).toMatchObject({ model: 'wire-model', stream: false })
  })

  it('keeps the selected endpoint and model stable when settings change after preparation', async () => {
    const prepared = target()
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: `${url}/wrong` }
        }
      })
      .run()
    dbh.db.delete(userModelTable).run()
    const report = await check(prepared)
    expect(report.conversation.status).toBe('pass')
    expect(report.modelList.status).toBe('pass')
    expect(requests[0].model).toBe('wire-model')
    expect(paths).toEqual(['HEAD /v1', 'GET /v1/models', 'POST /v1/chat/completions'])
  })

  it('cancels an in-flight HTTP conversation promptly', async () => {
    holdConversation = true
    const controller = new AbortController()
    const run = checkModelConnectivity(target(), controller.signal)
    const rejection = expect(run).rejects.toThrow('stop check')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    controller.abort(new Error('stop check'))
    await rejection
  })

  it('resolves Agent ownership and isolates concurrent scopes, cancellation, and existing reports', async () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent',
        name: 'Agent',
        instructions: '',
        type: 'claude-code',
        model: 'connectivity::wire-model',
        orderKey: 'a0'
      })
      .run()
    const doctor = new ReadyDoctor()
    const global = await doctor.run({
      tier: 'quick',
      checkIds: ['config-boot-config-valid']
    })
    expect(global.status).toBe('completed')
    const cache = application.get('CacheService')
    const before = structuredClone(cache.getShared('doctor.state'))
    holdConversation = true
    const subject = { kind: 'chat', providerId: 'connectivity', modelId: 'wire-model' } as const
    const first = doctor.checkConnectivity({ subject, runId: 'chat-run' })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(await doctor.checkConnectivity({ subject, runId: 'duplicate' })).toEqual({
      status: 'busy',
      runId: 'chat-run'
    })
    expect(doctor.cancelConnectivity('chat:connectivity/wire-model', 'wrong-run')).toEqual({ status: 'not_running' })
    holdConversation = false
    const agent = await doctor.checkConnectivity({ subject: { kind: 'agent', agentId: 'agent' }, runId: 'agent-run' })
    expect(agent).toMatchObject({
      status: 'completed',
      scope: 'agent:agent',
      report: {
        uniqueModelId: 'connectivity::wire-model',
        conversation: { status: 'pass' }
      }
    })
    expect(doctor.cancelConnectivity('chat:connectivity/wire-model', 'chat-run')).toEqual({ status: 'canceled' })
    expect(await first).toEqual({ status: 'canceled', runId: 'chat-run' })
    expect(cache.getShared('doctor.state')).toEqual(before)
    expect((await doctor.checkConnectivity({ subject, runId: 'retry' })).status).toBe('completed')
  })

  it('refuses missing Agent targets instead of falling back to a default model', async () => {
    await expect(
      new ReadyDoctor().checkConnectivity({ subject: { kind: 'agent', agentId: 'missing' }, runId: 'run' })
    ).rejects.toThrow()
    expect(paths).toEqual([])
  })

  it('aborts pending HTTP work on service shutdown and refuses new runs', async () => {
    holdConversation = true
    const doctor = new ReadyDoctor()
    const input = {
      subject: { kind: 'chat', providerId: 'connectivity', modelId: 'wire-model' } as const,
      runId: 'run'
    }
    const pending = doctor.checkConnectivity(input)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await doctor._doStop()
    expect(await pending).toEqual({ status: 'canceled', runId: 'run' })
    await expect(doctor.checkConnectivity(input)).rejects.toThrow('not ready')
  })
})
