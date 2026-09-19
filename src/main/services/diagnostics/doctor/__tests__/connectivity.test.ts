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
import { DOCTOR_REPORT_TTL_MS, type DoctorCheckId, type DoctorExecutionSnapshot } from '@shared/types/doctor'
import type { DoctorConnectivitySubject } from '@shared/types/doctorConnectivity'
import { doctorStateCacheKey } from '@shared/utils/doctor'

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
  let listError: { message: string; code?: string }
  let ids: string[]
  let paths: string[]
  let requests: Record<string, unknown>[]
  let holdConversation: boolean
  let conversationStatus: number
  let doctor: ReadyDoctor

  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    ai = new AiService()
    doctor = new ReadyDoctor()
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
    listError = { message: 'test failure' }
    ids = ['wire-model']
    paths = []
    requests = []
    server = createServer(async (req, res) => {
      paths.push(`${req.method} ${req.url}`)
      if (req.url === '/v1/models') {
        res.writeHead(listStatus, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(listStatus === 200 ? { data: ids.map((id) => ({ id })) } : { error: listError }))
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
        isEnabled: true,
        apiKeys: [{ id: 'key-1', key: 'test-key', isEnabled: true }],
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
    vi.restoreAllMocks()
    await doctor._doStop()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })
  const subject = { kind: 'chat', providerId: 'connectivity', modelId: 'wire-model' } as const
  const result = (snapshot: DoctorExecutionSnapshot, id: DoctorCheckId) =>
    snapshot.results.find((entry) => entry.id === id)
  const start = async (ref: DoctorConnectivitySubject = subject, runId = 'run') => {
    const started = await doctor.checkConnectivity({ subject: ref, runId })
    if (started.status !== 'completed') throw new Error(`Unexpected result: ${started.status}`)
    return started
  }
  const confirm = async (started: Awaited<ReturnType<typeof start>>) => {
    const response = await doctor.confirmCheck({
      scope: started.scope,
      runId: started.runId,
      requestId: started.report.pendingChecks[0].requestId
    })
    if (response.status !== 'completed') throw new Error(`Unexpected confirmation: ${response.status}`)
    return response
  }

  it('finishes automatic diagnostics without sending a billable conversation', async () => {
    const started = await start()
    expect(result(started.report, 'network-model-endpoint')).toMatchObject({
      status: 'pass',
      evidence: [{ key: 'httpStatus', value: 404 }]
    })
    expect(result(started.report, 'provider-model-list')?.status).toBe('pass')
    expect(result(started.report, 'provider-model-conversation')).toBeUndefined()
    expect(started.report.pendingChecks).toEqual([
      expect.objectContaining({
        checkId: 'provider-model-conversation',
        confirmation: {
          messageKey: 'settings.doctor.checks.provider-model-conversation.confirmation',
          params: { model: 'Wire model', modelId: 'wire-model', endpoint: url }
        }
      })
    ])
    expect(requests).toEqual([])
    expect(paths.sort()).toEqual(['GET /v1/models', 'HEAD /v1'])
    const confirmed = await confirm(started)
    expect(result(confirmed, 'provider-model-conversation')?.status).toBe('pass')
    expect(confirmed.pendingChecks).toEqual([])
    expect(paths).toHaveLength(3)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      model: 'wire-model',
      messages: [
        { role: 'system', content: 'test' },
        { role: 'user', content: 'hi' }
      ]
    })
    expect(requests[0]).not.toHaveProperty('tools')
  })

  it('uses the selected model endpoint for both the prompt and the actual request', async () => {
    const config = makeProvider({ endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: url } } })
    config.defaultChatEndpoint = ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    config.endpointConfigs![ENDPOINT_TYPE.ANTHROPIC_MESSAGES] = { baseUrl: `${url}/wrong` }
    dbh.db
      .update(userProviderTable)
      .set({ endpointConfigs: config.endpointConfigs, defaultChatEndpoint: config.defaultChatEndpoint })
      .run()
    const started = await start()
    expect(started.report.pendingChecks[0].confirmation.params.endpoint).toBe(url)
    expect(result(await confirm(started), 'provider-model-conversation')?.status).toBe('pass')
    expect(paths).not.toContain('HEAD /v1/wrong')
    expect(paths).toContain('POST /v1/chat/completions')
  })

  it.each([404, 405, 501])(
    'skips unavailable models HTTP %s without preventing a confirmed conversation',
    async (status) => {
      listStatus = status
      const started = await start()
      expect(result(started.report, 'provider-model-list')).toMatchObject({
        status: 'skip',
        detail: { variant: 'endpoint_unavailable' }
      })
      expect(result(await confirm(started), 'provider-model-conversation')?.status).toBe('pass')
    }
  )

  it.each([
    [401, { message: 'Unauthorized' }, 'auth'],
    [403, { message: 'Forbidden' }, 'permission'],
    [403, { message: 'Request rejected', code: 'unsupported_country' }, 'region'],
    [429, { message: 'Request rejected', code: 'insufficient_balance' }, 'quota'],
    [400, { message: 'Invalid API key' }, 'auth']
  ] as const)('preserves the shared classification for models HTTP %s', async (status, error, category) => {
    listStatus = status
    listError = error
    const started = await start()
    expect(result(started.report, 'provider-model-list')).toMatchObject({
      status: 'fail',
      actions: [{ kind: 'navigate', target: '/settings/provider' }],
      evidence: [
        { key: 'category', value: category },
        { key: 'httpStatus', value: status }
      ]
    })
    expect(requests).toEqual([])
    expect(result(await confirm(started), 'provider-model-conversation')?.status).toBe('pass')
  })

  it('does not use registry entries as remote existence evidence', async () => {
    ids = []
    const started = await start()
    expect(result(started.report, 'provider-model-list')).toMatchObject({
      status: 'warn',
      detail: { variant: 'not_listed' },
      actions: [{ kind: 'navigate', target: '/settings/provider' }]
    })
    expect(result(await confirm(started), 'provider-model-conversation')?.status).toBe('pass')
  })

  it('skips registry-only listings without requesting models', async () => {
    dbh.db.update(userProviderTable).set({ presetProviderId: 'claude-code' }).run()
    const started = await start()
    expect(result(started.report, 'provider-model-list')).toMatchObject({
      status: 'skip',
      detail: { variant: 'unsupported' }
    })
    expect(paths).not.toContain('GET /v1/models')
    expect(requests).toEqual([])
  })

  it('skips API conversation checks for providers using external CLI authentication', async () => {
    dbh.db.update(userProviderTable).set({ presetProviderId: 'claude-code' }).run()
    const started = await start()
    expect(started.report.pendingChecks).toEqual([])
    expect(result(started.report, 'provider-model-conversation')).toMatchObject({
      status: 'skip',
      detail: { variant: 'external_cli' }
    })
    expect(requests).toEqual([])
  })

  it('does not ask for confirmation or generate for an image-only model', async () => {
    dbh.db
      .update(userModelTable)
      .set({
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
        endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
      })
      .where(eq(userModelTable.id, 'connectivity::wire-model'))
      .run()
    const started = await start()
    expect(started.report.pendingChecks).toEqual([])
    expect(result(started.report, 'provider-model-conversation')).toMatchObject({
      status: 'skip',
      detail: { variant: 'not_chat_model' }
    })
    expect(requests).toEqual([])
  })

  it('does not retry or fall back after one confirmed request fails', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.max_attempts', 3)
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
    const started = await start()
    const response = await confirm(started)
    expect(result(response, 'provider-model-conversation')).toMatchObject({
      status: 'fail',
      evidence: [
        { key: 'category', value: 'server' },
        { key: 'httpStatus', value: 503 }
      ]
    })
    expect(requests).toHaveLength(1)
    expect(
      await doctor.confirmCheck({
        scope: started.scope,
        runId: started.runId,
        requestId: started.report.pendingChecks[0].requestId
      })
    ).toEqual({ status: 'stale' })
    expect(requests).toHaveLength(1)
  })

  it('uses a real confirmed Ollama conversation instead of metadata-only health evidence', async () => {
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
    const started = await start()
    expect(requests).toEqual([])
    expect(result(await confirm(started), 'provider-model-conversation')?.status).toBe('pass')
    expect(paths).toContain('POST /api/chat')
    expect(paths).not.toContain('POST /api/show')
    expect(requests[0]).toMatchObject({ model: 'wire-model', stream: false })
  })

  it.each(['endpoint', 'model deletion'] as const)('invalidates confirmation after %s changes', async (change) => {
    const started = await start()
    if (change === 'endpoint')
      dbh.db
        .update(userProviderTable)
        .set({
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: `${url}/wrong` }
          }
        })
        .run()
    else dbh.db.delete(userModelTable).run()
    expect(
      await doctor.confirmCheck({
        scope: started.scope,
        runId: started.runId,
        requestId: started.report.pendingChecks[0].requestId
      })
    ).toEqual({ status: 'stale' })
    expect(requests).toEqual([])
  })

  it('rejects expired, superseded, and wrong-scope confirmations without requests', async () => {
    const first = await start(subject, 'first')
    const second = await start(subject, 'second')
    const input = { scope: second.scope, runId: second.runId, requestId: second.report.pendingChecks[0].requestId }
    expect(
      await doctor.confirmCheck({ ...input, runId: first.runId, requestId: first.report.pendingChecks[0].requestId })
    ).toEqual({ status: 'stale' })
    expect(await doctor.confirmCheck({ ...input, scope: 'agent:other' })).toEqual({ status: 'stale' })
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + DOCTOR_REPORT_TTL_MS + 1)
    expect(await doctor.confirmCheck(input)).toEqual({ status: 'stale' })
    expect(requests).toEqual([])
  })

  it.each(['cancel', 'cancelConnectivity'] as const)(
    'consumes confirmation once and cancels an in-flight request via %s',
    async (cancel) => {
      const started = await start()
      const input = { scope: started.scope, runId: started.runId, requestId: started.report.pendingChecks[0].requestId }
      holdConversation = true
      const pending = doctor.confirmCheck(input)
      await vi.waitFor(() => expect(requests).toHaveLength(1))
      expect(await doctor.confirmCheck(input)).toEqual({ status: 'busy' })
      expect(await doctor.run({ subject, tier: 'quick', checkIds: ['network-online'] })).toEqual({
        status: 'busy',
        runId: started.runId
      })
      expect(await doctor.checkConnectivity({ subject, runId: 'new' })).toEqual({
        status: 'busy',
        runId: started.runId
      })
      expect(doctor[cancel](started.scope, 'wrong-run')).toEqual({ status: 'not_running' })
      expect(doctor[cancel](started.scope, started.runId)).toEqual({ status: 'canceled' })
      expect(await pending).toEqual({ status: 'canceled' })
      expect(await doctor.confirmCheck(input)).toEqual({ status: 'stale' })
      expect(requests).toHaveLength(1)
    }
  )

  it('supersedes a pending connectivity decision with an ordinary run in the same scope', async () => {
    const started = await start()
    const next = await doctor.run({ subject, tier: 'quick', checkIds: ['network-online'] })
    expect(next.status).toBe('completed')
    expect(
      await doctor.confirmCheck({
        scope: started.scope,
        runId: started.runId,
        requestId: started.report.pendingChecks[0].requestId
      })
    ).toEqual({ status: 'stale' })
    expect(requests).toEqual([])
  })

  it('invalidates a pending confirmation when canceled before execution', async () => {
    const started = await start()
    expect(doctor.cancelConnectivity(started.scope, started.runId)).toEqual({ status: 'canceled' })
    expect(
      await doctor.confirmCheck({
        scope: started.scope,
        runId: started.runId,
        requestId: started.report.pendingChecks[0].requestId
      })
    ).toEqual({ status: 'stale' })
    expect(requests).toEqual([])
  })

  it('resolves Agent ownership, detects model reassignment, and preserves another scope report', async () => {
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
    const global = await doctor.run({
      subject: { kind: 'global' },
      tier: 'quick',
      checkIds: ['config-boot-config-valid']
    })
    expect(global.status).toBe('completed')
    const before = structuredClone(application.get('CacheService').getShared(doctorStateCacheKey('global')))
    const chat = await start()
    const agent = await start({ kind: 'agent', agentId: 'agent' }, 'agent-run')
    dbh.db.update(agentTable).set({ model: null }).run()
    expect(
      await doctor.confirmCheck({
        scope: agent.scope,
        runId: agent.runId,
        requestId: agent.report.pendingChecks[0].requestId
      })
    ).toEqual({ status: 'stale' })
    expect(result(await confirm(chat), 'provider-model-conversation')?.status).toBe('pass')
    expect(application.get('CacheService').getShared(doctorStateCacheKey('global'))).toEqual(before)
    expect(requests).toHaveLength(1)
  })

  it('applies the same confirmation policy to an explicitly selected ordinary Doctor check', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'connectivity::wire-model')
    const started = await doctor.run({
      subject: { kind: 'global' },
      tier: 'live',
      checkIds: ['provider-model-conversation']
    })
    if (started.status !== 'completed') throw new Error('Expected report')
    expect(started.report.results).toEqual([])
    expect(requests).toEqual([])
    const response = await doctor.confirmCheck({
      scope: 'global',
      runId: started.report.runId,
      requestId: started.report.pendingChecks![0].requestId
    })
    expect(response.status).toBe('completed')
    expect(application.get('CacheService').getShared(doctorStateCacheKey('global'))).toMatchObject({
      status: 'completed',
      report: {
        runId: started.report.runId,
        pendingChecks: [],
        results: [{ id: 'provider-model-conversation', status: 'pass' }]
      }
    })
    expect(requests).toHaveLength(1)
  })

  it('invalidates a global confirmation if the default model changes', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'connectivity::wire-model')
    const started = await doctor.run({
      subject: { kind: 'global' },
      tier: 'live',
      checkIds: ['provider-model-conversation']
    })
    if (started.status !== 'completed') throw new Error('Expected report')
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', null)
    expect(
      await doctor.confirmCheck({
        scope: 'global',
        runId: started.report.runId,
        requestId: started.report.pendingChecks![0].requestId
      })
    ).toEqual({ status: 'stale' })
    expect(requests).toEqual([])
  })

  it('refuses missing Agent targets instead of falling back to the default model', async () => {
    await expect(
      doctor.checkConnectivity({ subject: { kind: 'agent', agentId: 'missing' }, runId: 'run' })
    ).rejects.toThrow()
    expect(paths).toEqual([])
  })

  it('aborts confirmed HTTP work on shutdown and refuses pending decisions', async () => {
    const started = await start()
    const input = { scope: started.scope, runId: started.runId, requestId: started.report.pendingChecks[0].requestId }
    holdConversation = true
    const pending = doctor.confirmCheck(input)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await doctor._doStop()
    expect(await pending).toEqual({ status: 'canceled' })
    await expect(doctor.confirmCheck(input)).rejects.toThrow('not ready')
  })
})
