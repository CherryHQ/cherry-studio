import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const sidecarPath = process.env.THE_BOSS_UAR_SIDECAR_PATH
const surrealEndpoint = process.env.GATE_U_SURREAL_ENDPOINT
const surrealUsername = process.env.GATE_U_SURREAL_USERNAME
const surrealPassword = process.env.GATE_U_SURREAL_PASSWORD
const evidencePath = process.env.GATE_U_EVIDENCE_PATH

type Operation = { id: string; status: string; output: string; error?: string }
type Snapshot = {
  revisions: Record<'compass' | 'filesystem' | 'uar' | 'services', number>
  config: Record<string, any>
  secrets: Record<string, boolean>
  operations: Operation[]
  uar: { state: string; effectiveBackend: string; effectiveRevision: number }
}
type Setting = {
  field: string
  saved: unknown
  effective: unknown
  revision: string
  apply: 'live' | 'next_turn' | 'restart'
  applicationStatus: 'effective' | 'pending' | 'restart_required'
}
type SettingsSnapshot = { generation: number; settings: Setting[] }
type ModelSources = {
  generation: number
  sources: Array<{
    source: 'boss' | 'gateway' | 'uar'
    operational: boolean
    providers: Array<{ id: string; credentialConfigured: boolean; models: Array<{ id: string }> }>
  }>
  consumers: Array<{ id: string; state: string; effectiveIdentity?: string }>
}

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

async function prepareSurreal(endpoint: string, username: string, password: string): Promise<void> {
  const httpEndpoint = endpoint.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
  const signin = await fetch(new URL('/signin', httpEndpoint), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ user: username, pass: password })
  })
  const authorization = (await signin.json()) as { token?: string }
  if (!signin.ok || !authorization.token) throw new Error(`Gate U SurrealDB sign-in failed with HTTP ${signin.status}`)
  const response = await fetch(new URL('/rpc', httpEndpoint), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${authorization.token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      id: 'gate-u-setup',
      method: 'query',
      params: ['DEFINE NAMESPACE IF NOT EXISTS gate_u; USE NS gate_u; DEFINE DATABASE IF NOT EXISTS uar;', {}]
    })
  })
  const body = (await response.json()) as { result?: Array<{ status: string }> }
  if (!response.ok || !body.result?.every((result) => result.status === 'OK'))
    throw new Error(`Gate U SurrealDB setup failed with HTTP ${response.status}`)
}

async function mainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => {
      try {
        return new URL(candidate.url()).pathname.endsWith('/windows/main/index.html')
      } catch {
        return false
      }
    })
    if (page) {
      await page.locator('#root').waitFor({ state: 'visible', timeout: 60_000 })
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('The Boss main window did not become ready')
}

async function launch(profile: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      CS_DEV_USER_DATA_SUFFIX: profile,
      THE_BOSS_UAR_SIDECAR_PATH: required('THE_BOSS_UAR_SIDECAR_PATH', sidecarPath)
    },
    timeout: 60_000
  })
  return { app, page: await mainWindow(app) }
}

async function closeApp(app: ElectronApplication): Promise<void> {
  const child = app.process()
  await Promise.race([app.close(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]).catch(() => undefined)
  if (child?.exitCode === null) child.kill('SIGTERM')
}

async function ipcResult<T>(page: Page, route: string, input: unknown) {
  return (await page.evaluate(({ route, input }) => window.api.ipcApi.request(route, input), { route, input })) as {
    ok: boolean
    data?: T
    error?: { message?: string }
  }
}

async function ipc<T>(page: Page, route: string, input: unknown): Promise<T> {
  const result = await ipcResult<T>(page, route, input)
  if (!result.ok) throw new Error(result.error?.message ?? `${route} failed`)
  return result.data as T
}

async function data<T>(page: Page, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ({ method, path, body }) =>
      window.api.dataApi.request({ id: crypto.randomUUID(), method, path, ...(body === undefined ? {} : { body }) }),
    { method, path, body }
  )) as { data?: T; error?: { message?: string } }
  if (result.error) throw new Error(result.error.message ?? `${method} ${path} failed`)
  return result.data as T
}

async function snapshot(page: Page): Promise<Snapshot> {
  return ipc<Snapshot>(page, 'prometheus.integration.snapshot', {})
}

async function runOperation(page: Page, action: string): Promise<Operation> {
  const started = await ipc<Operation>(page, 'prometheus.integration.start', { action })
  let completed: Operation | undefined
  await expect
    .poll(async () => {
      completed = (await snapshot(page)).operations.find((operation) => operation.id === started.id)
      return completed?.status
    })
    .not.toBe('running')
  if (completed?.status === 'failed') throw new Error(`${action} failed: ${completed.error ?? completed.output}`)
  return completed!
}

function setting(settings: SettingsSnapshot, field: string): Setting {
  const found = settings.settings.find((candidate) => candidate.field === field)
  if (!found) throw new Error(`UAR setting ${field} is missing`)
  return found
}

function provider(source: ModelSources, sourceId: 'boss' | 'gateway' | 'uar', id: string) {
  return source.sources
    .find((candidate) => candidate.source === sourceId)
    ?.providers.find((candidate) => candidate.id === id)
}

function sendCompletion(response: ServerResponse, model: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null) =>
    `data: ${JSON.stringify({
      id: 'gate-u-completion',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{ index: 0, delta, finish_reason }]
    })}\n\n`
  response.write(chunk({ role: 'assistant' }, null))
  response.write(chunk({ content: 'Gate U operational.' }, null))
  response.write(chunk({}, 'stop'))
  response.end('data: [DONE]\n\n')
}

test('Gate U: admin authority, model sources, settings and storage profiles survive production boundaries', async () => {
  const remoteEndpoint = required('GATE_U_SURREAL_ENDPOINT', surrealEndpoint)
  const remoteUsername = required('GATE_U_SURREAL_USERNAME', surrealUsername)
  const remotePassword = required('GATE_U_SURREAL_PASSWORD', surrealPassword)
  await prepareSurreal(remoteEndpoint, remoteUsername, remotePassword)
  const profile = `Gate-U-${Date.now()}`
  const workspace = mkdtempSync(join(tmpdir(), 'the-boss-gate-u-'))
  const credentials = {
    boss: 'gate-u-boss-key',
    gateway: 'gate-u-gateway-key',
    uarV1: 'gate-u-uar-v1',
    uarV2: 'gate-u-uar-v2'
  }
  const observed: Array<{ path: string; model: string; credential: string }> = []
  const identifyCredential = (authorization: string | undefined) => {
    const value = authorization?.replace(/^Bearer\s+/i, '')
    return Object.entries(credentials).find(([, credential]) => credential === value)?.[0] ?? 'unknown'
  }
  const fixture: Server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      observed.push({
        path: request.url,
        model: 'catalog',
        credential: identifyCredential(request.headers.authorization)
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'gateway-model' }] }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { model?: string }
    const model = body.model ?? 'unknown'
    observed.push({ path: request.url, model, credential: identifyCredential(request.headers.authorization) })
    sendCompletion(response, model)
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Gate U provider fixture did not bind')
  const providerBaseUrl = `http://127.0.0.1:${address.port}/v1`

  let app: ElectronApplication | undefined
  try {
    let launched = await launch(profile)
    app = launched.app
    await launched.page.evaluate(async () => {
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped',
        'app.privacy.data_collection.enabled': false
      })
    })
    await closeApp(app)

    launched = await launch(profile)
    app = launched.app
    let page = launched.page
    const initial = await snapshot(page)
    await ipc<Snapshot>(page, 'prometheus.integration.configure', {
      updates: [
        {
          feature: 'services',
          expectedRevision: initial.revisions.services,
          value: {
            ...initial.config.services,
            liter: { ownership: 'external', source: 'manual', endpoint: providerBaseUrl }
          }
        }
      ],
      secrets: { literKey: { operation: 'set', value: credentials.gateway } }
    })
    expect((await runOperation(page, 'uar-check')).status).toBe('done')

    const bossProviderId = `gate-u-boss-${Date.now()}`
    const bossModelId = 'boss-model'
    const bossUniqueModelId = `${bossProviderId}::${bossModelId}`
    await data(page, 'POST', '/providers', {
      providerId: bossProviderId,
      name: 'Gate U Boss provider',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: providerBaseUrl } },
      defaultChatEndpoint: 'openai-chat-completions',
      apiKeys: [{ id: crypto.randomUUID(), key: credentials.boss, label: 'Gate U', isEnabled: true }]
    })
    await data(page, 'POST', '/models', [
      {
        providerId: bossProviderId,
        modelId: bossModelId,
        name: 'Gate U Boss model',
        capabilities: ['function-call'],
        endpointTypes: ['openai-chat-completions'],
        supportsStreaming: true
      }
    ])

    const embeddedProviderId = `gate-u-embedded-${Date.now()}`
    const remoteProviderId = `gate-u-remote-${Date.now()}`
    const providerMutation = (mode: 'create' | 'update', id: string, credential: unknown) => ({
      mode,
      id,
      displayName: id,
      baseUrl: providerBaseUrl,
      protocol: 'chat',
      defaultModel: 'uar-model',
      models: [{ id: 'uar-model', displayName: 'UAR model', enabled: true, supportsStreaming: true }],
      enabled: true,
      credential
    })
    await ipc(
      page,
      'prometheus.uar.providers.save',
      providerMutation('create', embeddedProviderId, { operation: 'set', value: credentials.uarV1 })
    )
    expect(
      (
        await ipc<{ ok: boolean }>(page, 'prometheus.uar.providers.test', {
          id: embeddedProviderId,
          modelId: 'uar-model'
        })
      ).ok
    ).toBe(true)
    await ipc(
      page,
      'prometheus.uar.providers.save',
      providerMutation('update', embeddedProviderId, { operation: 'set', value: credentials.uarV2 })
    )
    expect(
      (
        await ipc<{ ok: boolean }>(page, 'prometheus.uar.providers.test', {
          id: embeddedProviderId,
          modelId: 'uar-model'
        })
      ).ok
    ).toBe(true)
    await ipc(
      page,
      'prometheus.uar.providers.save',
      providerMutation('update', embeddedProviderId, { operation: 'clear' })
    )
    const cleared = await ipcResult(page, 'prometheus.uar.providers.test', {
      id: embeddedProviderId,
      modelId: 'uar-model'
    })
    expect(cleared.ok).toBe(false)
    await ipc(
      page,
      'prometheus.uar.providers.save',
      providerMutation('update', embeddedProviderId, { operation: 'set', value: credentials.uarV2 })
    )

    const sources = await ipc<ModelSources>(page, 'prometheus.uar.models.sources', {})
    expect(sources.sources.map((source) => [source.source, source.operational])).toEqual([
      ['boss', true],
      ['gateway', true],
      ['uar', true]
    ])
    expect(provider(sources, 'boss', bossProviderId)).toBeTruthy()
    expect(provider(sources, 'gateway', 'the-boss-gateway')?.models.map((model) => model.id)).toContain('gateway-model')
    expect(provider(sources, 'uar', embeddedProviderId)?.credentialConfigured).toBe(true)
    expect(sources.consumers.find((consumer) => consumer.id === 'knowledge-embeddings')).toMatchObject({
      state: 'local',
      effectiveIdentity: 'fastembed/BAAI-bge-small-en-v1.5'
    })

    const workspaceEntity = await data<{ id: string }>(page, 'POST', '/agent-workspaces', { path: workspace })
    const assignments = [
      { label: 'boss', assignment: { source: 'boss', modelId: bossUniqueModelId }, model: bossModelId },
      { label: 'gateway', assignment: { source: 'gateway', modelId: 'gateway-model' }, model: 'gateway-model' },
      {
        label: 'uar',
        assignment: { source: 'uar', providerId: embeddedProviderId, modelId: 'uar-model' },
        model: 'uar-model'
      }
    ] as const
    for (const assignment of assignments) {
      const agent = await ipc<{ id: string }>(page, 'ai.agent.create', {
        type: 'uar',
        name: `Gate U ${assignment.label}`,
        instructions: 'Return the provider response.',
        model: bossUniqueModelId,
        mcps: [],
        configuration: { permission_mode: 'plan', uar_model_assignment: assignment.assignment }
      })
      const session = await ipc<{ session: { id: string } }>(page, 'ai.agent.session.reuse_or_create', {
        agentId: agent.id,
        workspace: { type: 'user', workspaceId: workspaceEntity.id }
      })
      const stateKey = `__gateU${assignment.label}`
      await page.evaluate(
        async ({ sessionId, stateKey, modelId }) => {
          const state = { done: false, error: '' }
          ;(window as any)[stateKey] = state
          window.api.ipcApi.on('ai.stream.done', (payload: any) => {
            if (payload.topicId === `agent-session:${sessionId}` && payload.isTopicDone) state.done = true
          })
          window.api.ipcApi.on('ai.stream.error', (payload: any) => {
            if (payload.topicId === `agent-session:${sessionId}` && payload.isTopicDone)
              state.error = payload.error?.message ?? 'unknown stream error'
          })
          const result = (await window.api.ipcApi.request('ai.stream.open', {
            trigger: 'submit-message',
            topicId: `agent-session:${sessionId}`,
            mentionedModelIds: [modelId],
            userMessageParts: [{ type: 'text', text: 'Run Gate U.' }]
          })) as { ok: boolean; error?: { message?: string } }
          if (!result.ok) throw new Error(result.error?.message ?? 'ai.stream.open failed')
        },
        { sessionId: session.session.id, stateKey, modelId: bossUniqueModelId }
      )
      await expect
        .poll(() => page.evaluate((key) => (window as any)[key], stateKey), { timeout: 2 * 60_000 })
        .toMatchObject({ done: true, error: '' })
    }

    const governance = await ipc<SettingsSnapshot>(page, 'prometheus.uar.settings.read', { namespace: 'governance' })
    const live = setting(governance, 'policy_reload_enabled')
    const liveResult = await ipc<any>(page, 'prometheus.uar.settings.update', {
      namespace: 'governance',
      changes: [{ field: live.field, value: !live.saved, expectedRevision: live.revision }]
    })
    expect(liveResult.updated[0]).toMatchObject({ apply: 'live', applicationStatus: 'effective' })

    const resilience = await ipc<SettingsSnapshot>(page, 'prometheus.uar.settings.read', { namespace: 'resilience' })
    const nextTurn = setting(resilience, 'retry_max_attempts')
    const partialPeer = setting(resilience, 'retry_base_delay_ms')
    const nextTurnResult = await ipc<any>(page, 'prometheus.uar.settings.update', {
      namespace: 'resilience',
      changes: [
        { field: nextTurn.field, value: Number(nextTurn.saved) + 1, expectedRevision: nextTurn.revision },
        { field: partialPeer.field, value: Number(partialPeer.saved) + 1, expectedRevision: 'stale-revision' }
      ]
    })
    expect(nextTurnResult.status).toBe('partial')
    expect(nextTurnResult.updated[0]).toMatchObject({ apply: 'next_turn', applicationStatus: 'effective' })
    expect(nextTurnResult.errors[0]).toMatchObject({ code: 'setting_revision_conflict' })

    const server = await ipc<SettingsSnapshot>(page, 'prometheus.uar.settings.read', { namespace: 'server' })
    const restart = setting(server, 'shutdown_timeout_secs')
    const restartResult = await ipc<any>(page, 'prometheus.uar.settings.update', {
      namespace: 'server',
      changes: [{ field: restart.field, value: Number(restart.saved) + 1, expectedRevision: restart.revision }]
    })
    expect(restartResult.updated[0]).toMatchObject({ apply: 'restart', applicationStatus: 'restart_required' })
    const generationBeforeRestart = server.generation
    expect((await runOperation(page, 'uar-restart')).status).toBe('done')
    const restartedServer = await ipc<SettingsSnapshot>(page, 'prometheus.uar.settings.read', { namespace: 'server' })
    expect(restartedServer.generation).toBeGreaterThan(generationBeforeRestart)
    expect(setting(restartedServer, restart.field).effective).toBe(Number(restart.saved) + 1)

    const authority = await ipc<any>(page, 'prometheus.uar.admin.diagnose_authority', {})
    expect(authority.diagnostics).toEqual([
      expect.objectContaining({ id: 'uar-admin-authority', state: 'operational' }),
      expect.objectContaining({ id: 'uar-owner-isolation', state: 'operational' })
    ])

    const beforeRemote = await snapshot(page)
    const configuredRemote = await ipc<Snapshot>(page, 'prometheus.integration.configure', {
      updates: [
        {
          feature: 'uar',
          expectedRevision: beforeRemote.revisions.uar,
          value: {
            backend: 'remote',
            endpoint: remoteEndpoint,
            namespace: 'gate_u',
            database: 'uar',
            username: remoteUsername,
            authLevel: 'root'
          }
        },
        {
          feature: 'services',
          expectedRevision: beforeRemote.revisions.services,
          value: {
            ...beforeRemote.config.services,
            surrealdb: {
              ownership: 'external',
              source: 'manual',
              endpoint: remoteEndpoint.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
            }
          }
        }
      ],
      secrets: { uarPassword: { operation: 'set', value: remotePassword } }
    })
    expect(configuredRemote.secrets.uarPassword).toBe(true)
    expect((await runOperation(page, 'uar-apply')).status).toBe('done')
    let remoteSources = await ipc<ModelSources>(page, 'prometheus.uar.models.sources', {})
    expect(provider(remoteSources, 'uar', embeddedProviderId)).toBeUndefined()
    await ipc(
      page,
      'prometheus.uar.providers.save',
      providerMutation('create', remoteProviderId, { operation: 'set', value: credentials.uarV2 })
    )

    const beforeEmbedded = await snapshot(page)
    await ipc(page, 'prometheus.integration.configure', {
      updates: [
        {
          feature: 'uar',
          expectedRevision: beforeEmbedded.revisions.uar,
          value: { ...beforeEmbedded.config.uar, backend: 'embedded' }
        }
      ],
      secrets: {}
    })
    expect((await runOperation(page, 'uar-apply')).status).toBe('done')
    const restoredEmbedded = await ipc<ModelSources>(page, 'prometheus.uar.models.sources', {})
    expect(provider(restoredEmbedded, 'uar', embeddedProviderId)).toBeTruthy()
    expect(provider(restoredEmbedded, 'uar', remoteProviderId)).toBeUndefined()

    const backToRemote = await snapshot(page)
    await ipc(page, 'prometheus.integration.configure', {
      updates: [
        {
          feature: 'uar',
          expectedRevision: backToRemote.revisions.uar,
          value: { ...backToRemote.config.uar, backend: 'remote' }
        }
      ],
      secrets: {}
    })
    expect((await runOperation(page, 'uar-apply')).status).toBe('done')
    remoteSources = await ipc<ModelSources>(page, 'prometheus.uar.models.sources', {})
    expect(provider(remoteSources, 'uar', remoteProviderId)).toBeTruthy()
    expect(provider(remoteSources, 'uar', embeddedProviderId)).toBeUndefined()

    await closeApp(app)
    launched = await launch(profile)
    app = launched.app
    page = launched.page
    const persisted = await snapshot(page)
    expect(persisted.uar.effectiveBackend).toBe('remote')
    const persistedSources = await ipc<ModelSources>(page, 'prometheus.uar.models.sources', {})
    expect(provider(persistedSources, 'uar', remoteProviderId)?.credentialConfigured).toBe(true)
    expect(
      (
        await ipc<{ ok: boolean }>(page, 'prometheus.uar.providers.test', {
          id: remoteProviderId,
          modelId: 'uar-model'
        })
      ).ok
    ).toBe(true)

    for (const expected of [
      { model: bossModelId, credential: 'boss' },
      { model: 'gateway-model', credential: 'gateway' },
      { model: 'uar-model', credential: 'uarV2' }
    ]) {
      expect(observed).toContainEqual(expect.objectContaining(expected))
    }
    const evidence = {
      gate: 'U',
      modelSources: ['boss', 'gateway', 'uar'],
      inferenceModels: [
        ...new Set(
          observed.filter((request) => request.path.endsWith('/chat/completions')).map((request) => request.model)
        )
      ],
      providerCredentialStates: [...new Set(observed.map((request) => request.credential))],
      nonConversationProviderCheck: 'operational',
      applyModes: ['live', 'next_turn', 'restart'],
      partialSave: nextTurnResult.status,
      authority: authority.diagnostics.map((diagnostic: any) => ({ id: diagnostic.id, state: diagnostic.state })),
      activeStorage: persisted.uar.effectiveBackend,
      isolatedCatalogs: { embedded: embeddedProviderId, remote: remoteProviderId },
      restartPersistence: 'operational'
    }
    if (evidencePath) {
      mkdirSync(dirname(evidencePath), { recursive: true })
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
    }
    console.log(`GATE_U_RESULT ${JSON.stringify(evidence)}`)
  } finally {
    if (app) await closeApp(app)
    fixture.closeAllConnections()
    await new Promise<void>((resolve, reject) => fixture.close((error) => (error ? reject(error) : resolve())))
  }
})
