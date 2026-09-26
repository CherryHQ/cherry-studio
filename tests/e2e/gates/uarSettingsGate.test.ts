import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const sidecarPath = process.env.THE_BOSS_UAR_SIDECAR_PATH
const surrealEndpoint = process.env.GATE_A_SURREAL_ENDPOINT
const surrealUsername = process.env.GATE_A_SURREAL_USERNAME
const surrealPassword = process.env.GATE_A_SURREAL_PASSWORD
const evidencePath = process.env.GATE_A_EVIDENCE_PATH

type Operation = { id: string; status: string; output: string; error?: string }
type Snapshot = {
  schemaVersion: number
  revisions: Record<'compass' | 'filesystem' | 'uar' | 'services', number>
  config: Record<string, any>
  operations: Operation[]
  serviceDiscovery: { candidates: unknown[]; errors: string[] }
  uar: {
    state: string
    requestedBackend: string
    effectiveBackend: string
    requestedRevision: number
    effectiveRevision: number
    applyRequired: boolean
    authLevel?: string
    lastApplyError?: string
  }
}

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value.trim()
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

async function launch(profile: string, providerBaseUrl: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      CS_DEV_USER_DATA_SUFFIX: profile,
      THE_BOSS_UAR_SIDECAR_PATH: required('THE_BOSS_UAR_SIDECAR_PATH', sidecarPath),
      GATE_A_PROVIDER_BASE_URL: providerBaseUrl
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

async function ipc<T>(page: Page, route: string, input: unknown): Promise<T> {
  const result = (await page.evaluate(({ route, input }) => window.api.ipcApi.request(route, input), {
    route,
    input
  })) as { ok: boolean; data?: T; error?: { message?: string } }
  if (!result.ok) throw new Error(result.error?.message ?? `${route} failed`)
  return result.data as T
}

async function data<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
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
  return completed!
}

function sendCompletion(response: ServerResponse, text: string): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null) =>
    `data: ${JSON.stringify({
      id: 'gate-a-completion',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1_000),
      model: 'gate-a-model',
      choices: [{ index: 0, delta, finish_reason }]
    })}\n\n`
  response.write(chunk({ role: 'assistant' }, null))
  response.write(chunk({ content: text }, null))
  response.write(chunk({}, 'stop'))
  response.end('data: [DONE]\n\n')
}

test('Gate A: migrated settings drive embedded and remote UAR conversations', async () => {
  const remoteEndpoint = required('GATE_A_SURREAL_ENDPOINT', surrealEndpoint)
  const remoteUsername = required('GATE_A_SURREAL_USERNAME', surrealUsername)
  const remotePassword = required('GATE_A_SURREAL_PASSWORD', surrealPassword)
  const profile = `Gate-A-${Date.now()}`
  const workspace = mkdtempSync(join(tmpdir(), 'the-boss-gate-a-'))
  const requests: string[] = []
  let firstProviderRequest!: () => void
  let releaseFirst!: () => void
  const firstRequest = new Promise<void>((resolve) => (firstProviderRequest = resolve))
  const firstRelease = new Promise<void>((resolve) => (releaseFirst = resolve))
  let providerCalls = 0
  const provider: Server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(404).end()
      return
    }
    for await (const _chunk of request) {
      // Drain the request without recording credentials or message content.
    }
    requests.push(request.url ?? '')
    providerCalls += 1
    if (providerCalls === 1) {
      firstProviderRequest()
      await firstRelease
    }
    sendCompletion(response, providerCalls === 1 ? 'embedded storage operational' : 'remote storage operational')
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Provider fixture did not bind a TCP port')
  const providerBaseUrl = `http://127.0.0.1:${address.port}/v1`

  let app: ElectronApplication | undefined
  try {
    let launched = await launch(profile, providerBaseUrl)
    app = launched.app
    await launched.page.evaluate(async () => {
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped',
        'app.privacy.data_collection.enabled': false,
        'app.prometheus.integrations': JSON.stringify({
          revisions: { compass: 2, filesystem: 1, uar: 3, services: 4 },
          config: {
            compass: { enabled: false, endpoint: 'http://127.0.0.1:28000' },
            filesystem: { enabled: false },
            uar: { backend: 'embedded' },
            services: {
              mode: 'external',
              surrealPort: 28000,
              memoryPort: 23001,
              literPort: 4000,
              memoryEndpoint: 'http://127.0.0.1:23001/mcp/sse',
              literEndpoint: 'http://127.0.0.1:4000'
            }
          }
        })
      })
    })
    await closeApp(app)

    launched = await launch(profile, providerBaseUrl)
    app = launched.app
    const page = launched.page
    const migrated = await snapshot(page)
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.revisions).toEqual({ compass: 2, filesystem: 1, uar: 3, services: 4 })
    expect(migrated.config.services.surrealdb).toMatchObject({ ownership: 'external', source: 'manual' })
    expect(migrated.config.services.memory).toMatchObject({ ownership: 'external', source: 'manual' })
    expect(migrated.config.services.liter).toMatchObject({ ownership: 'external', source: 'manual' })

    const embeddedCheck = await runOperation(page, 'uar-check')
    expect(embeddedCheck.status).toBe('done')
    const embeddedSnapshot = await snapshot(page)
    expect(embeddedSnapshot.uar).toMatchObject({ state: 'running', effectiveBackend: 'embedded' })

    const providerId = `gate-a-provider-${Date.now()}`
    const modelId = 'gate-a-model'
    const uniqueModelId = `${providerId}::${modelId}`
    await data(page, 'POST', '/providers', {
      providerId,
      name: 'Gate A local provider',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: providerBaseUrl } },
      defaultChatEndpoint: 'openai-chat-completions',
      apiKeys: [{ id: crypto.randomUUID(), key: 'gate-a-local-key', label: 'Gate A', isEnabled: true }]
    })
    await data(page, 'POST', '/models', [
      {
        providerId,
        modelId,
        name: 'Gate A model',
        capabilities: ['function-call'],
        endpointTypes: ['openai-chat-completions'],
        supportsStreaming: true
      }
    ])
    const agent = await ipc<{ id: string }>(page, 'ai.agent.create', {
      type: 'uar',
      name: 'Gate A UAR agent',
      instructions: 'Reply with the provider response.',
      model: uniqueModelId,
      mcps: [],
      configuration: { permission_mode: 'plan' }
    })
    const workspaceEntity = await data<{ id: string }>(page, 'POST', '/agent-workspaces', { path: workspace })

    const createSession = () =>
      ipc<{ session: { id: string } }>(page, 'ai.agent.session.reuse_or_create', {
        agentId: agent.id,
        workspace: { type: 'user', workspaceId: workspaceEntity.id }
      })
    const beginConversation = async (sessionId: string, stateKey: string, text: string) => {
      return page.evaluate(
        async ({ sessionId, stateKey, text, uniqueModelId }) => {
          const state = { done: false, error: '' }
          ;(window as any)[stateKey] = state
          window.api.ipcApi.on('ai.stream.done', (payload: any) => {
            if (payload.topicId === `agent-session:${sessionId}` && payload.isTopicDone) state.done = true
          })
          window.api.ipcApi.on('ai.stream.error', (payload: any) => {
            if (payload.topicId === `agent-session:${sessionId}` && payload.isTopicDone) {
              state.error = payload.error?.message ?? 'unknown stream error'
            }
          })
          const response = (await window.api.ipcApi.request('ai.stream.open', {
            trigger: 'submit-message',
            topicId: `agent-session:${sessionId}`,
            mentionedModelIds: [uniqueModelId],
            userMessageParts: [{ type: 'text', text }]
          })) as { ok: boolean; error?: { message?: string } }
          if (!response.ok) throw new Error(response.error?.message ?? 'ai.stream.open failed')
        },
        { sessionId, stateKey, text, uniqueModelId }
      )
    }
    const waitConversation = async (stateKey: string) => {
      await expect
        .poll(() => page.evaluate((key) => (window as any)[key], stateKey), { timeout: 2 * 60_000 })
        .toMatchObject({ done: true, error: '' })
    }

    const embeddedSession = await createSession()
    await beginConversation(embeddedSession.session.id, '__gateAEmbedded', 'Use embedded storage.')
    await firstRequest
    const blockedRestart = await runOperation(page, 'uar-restart')
    expect(blockedRestart.status).toBe('failed')
    expect(blockedRestart.error).toContain('prometheus.error.uarActiveRuns')
    releaseFirst()
    await waitConversation('__gateAEmbedded')

    const beforeRemote = await snapshot(page)
    await ipc(page, 'prometheus.integration.configure', {
      updates: [
        {
          feature: 'services',
          expectedRevision: beforeRemote.revisions.services,
          value: {
            ...beforeRemote.config.services,
            surrealdb: { ownership: 'external', source: 'manual', endpoint: remoteEndpoint },
            memory: { ownership: 'managed', source: 'application', endpoint: 'http://127.0.0.1:23001/mcp/sse' },
            liter: { ownership: 'external', source: 'manual', endpoint: providerBaseUrl }
          }
        },
        {
          feature: 'uar',
          expectedRevision: beforeRemote.revisions.uar,
          value: {
            backend: 'remote',
            endpoint: remoteEndpoint,
            namespace: 'gate_a',
            database: 'uar',
            username: remoteUsername,
            authLevel: 'namespace'
          }
        }
      ],
      secrets: { uarPassword: { operation: 'set', value: 'intentionally-invalid' } }
    })
    const invalidApply = await runOperation(page, 'uar-apply')
    expect(invalidApply.status).toBe('failed')
    const rejected = await snapshot(page)
    expect(rejected.uar.effectiveBackend).toBe('embedded')
    expect(rejected.uar.requestedBackend).toBe('remote')
    expect(rejected.uar.lastApplyError).toBeTruthy()

    await ipc(page, 'prometheus.integration.configure', {
      updates: [],
      secrets: { uarPassword: { operation: 'set', value: remotePassword } }
    })
    const applied = await runOperation(page, 'uar-apply')
    expect(applied.status).toBe('done')
    const remote = await snapshot(page)
    expect(remote.uar).toMatchObject({
      state: 'running',
      requestedBackend: 'remote',
      effectiveBackend: 'remote',
      applyRequired: false,
      authLevel: 'namespace'
    })

    const discovery = await runOperation(page, 'discover-services')
    expect(discovery.status).toBe('done')
    const discovered = await snapshot(page)
    expect(discovered.config.services).toMatchObject({
      surrealdb: { ownership: 'external' },
      memory: { ownership: 'managed' },
      liter: { ownership: 'external' }
    })

    const remoteSession = await createSession()
    await beginConversation(remoteSession.session.id, '__gateARemote', 'Use remote storage.')
    await waitConversation('__gateARemote')
    const restarted = await runOperation(page, 'uar-restart')
    expect(restarted.status).toBe('done')

    await ipc(page, 'navigation.open_route_in_main', { path: '/settings/uar' })
    await expect(page.locator('[data-ui="settings.view"]')).toBeVisible()
    for (const label of ['Universal Agent Runtime', 'Compass', 'liter-llm', 'Docker and services']) {
      await expect(
        page.locator('[data-ui="settings.navigation"] [data-slot="menu-item"]').filter({ hasText: label }).first()
      ).toBeVisible()
    }
    const runtimeStorage = page.locator('#setting-uar-runtime-storage')
    await expect(runtimeStorage.getByText('Runtime storage', { exact: true })).toBeVisible()
    await expect(runtimeStorage.getByText('Remote SurrealDB', { exact: true })).toBeVisible()

    await closeApp(app)
    launched = await launch(profile, providerBaseUrl)
    app = launched.app
    const persisted = await snapshot(launched.page)
    expect(persisted.uar).toMatchObject({
      requestedBackend: 'remote',
      effectiveBackend: 'remote',
      applyRequired: false,
      authLevel: 'namespace'
    })
    expect(persisted.config.services).toMatchObject({
      surrealdb: { ownership: 'external' },
      memory: { ownership: 'managed' },
      liter: { ownership: 'external' }
    })

    const evidence = {
      gate: 'A',
      schemaVersion: persisted.schemaVersion,
      migratedRevisions: migrated.revisions,
      embeddedConversation: 'completed',
      activeRunRestart: blockedRestart.status,
      invalidCredentials: invalidApply.status,
      remoteConversation: 'completed',
      remoteRestart: restarted.status,
      effectiveBackend: persisted.uar.effectiveBackend,
      authLevel: persisted.uar.authLevel,
      topology: {
        surrealdb: persisted.config.services.surrealdb.ownership,
        memory: persisted.config.services.memory.ownership,
        liter: persisted.config.services.liter.ownership
      },
      providerRequestCount: requests.length,
      providerPaths: [...new Set(requests)]
    }
    if (evidencePath) {
      mkdirSync(dirname(evidencePath), { recursive: true })
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
    }
    console.log(`GATE_A_RESULT ${JSON.stringify(evidence)}`)
  } finally {
    releaseFirst?.()
    if (app) await closeApp(app)
    provider.closeAllConnections()
    await new Promise<void>((resolve, reject) => provider.close((error) => (error ? reject(error) : resolve())))
  }
})
