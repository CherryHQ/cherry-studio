import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { sendGateVCompletion } from './support/uarExperienceProvider'

const sidecarPath = process.env.THE_BOSS_UAR_SIDECAR_PATH
const evidencePath = process.env.GATE_V_EVIDENCE_PATH
const screenshotDirectory = process.env.GATE_V_SCREENSHOT_DIRECTORY

type Catalog = {
  agents: Array<{ id: string; revision: string; definition: Record<string, any> }>
  skills: Array<{ id: string; enabled: boolean }>
}
type PresentationSnapshot = {
  presentations: Array<{ id: string; revision: number; title: string }>
}
type IntegrationSnapshot = {
  revisions: { filesystem: number }
  config: {
    filesystem: { enabled: boolean; allowWrite: boolean; additionalRoots: string[] }
  }
  servers: Array<{ id: string; name: string; workspace?: string }>
}
type OperationSnapshot = {
  runs: Array<{ runId: string; ownerSessionId: string; status: string; agentRevision?: string }>
  approvals: Array<{
    rootRunId: string
    ownerSessionId: string
    state: string
    action: { operation?: string; target?: string }
  }>
  knowledgeBases: Array<{
    id: string
    name: string
    documents: Array<{ id: string; filename: string; status: string; chunkCount: number }>
  }>
  protocols: { a2a: string; acp: string }
  failures: Array<{ surface: string; message: string }>
}
type AdministrationSnapshot = {
  uarVersion: string
  surfaces: Array<{
    id: string
    group: string
    availability: string
    methods: Array<{ id: string; adapter: 'available' | 'unavailable' }>
  }>
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

async function ipc<T>(page: Page, route: string, input: unknown): Promise<T> {
  const result = (await page.evaluate(({ route, input }) => window.api.ipcApi.request(route, input), {
    route,
    input
  })) as { ok: boolean; data?: T; error?: { message?: string } }
  if (!result.ok) throw new Error(result.error?.message ?? `${route} failed`)
  return result.data as T
}

async function data<T>(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ({ method, path, body }) =>
      window.api.dataApi.request({ id: crypto.randomUUID(), method, path, ...(body === undefined ? {} : { body }) }),
    { method, path, body }
  )) as { data?: T; error?: { message?: string } }
  if (result.error) throw new Error(result.error.message ?? `${method} ${path} failed`)
  return result.data as T
}

test('Gate V: a configured catalog agent runs through Boss with A2UI, approval reconnect and knowledge', async () => {
  const profile = `Gate-V-${Date.now()}`
  const workspace = mkdtempSync(join(tmpdir(), 'the-boss-gate-v-'))
  const documentPath = join(workspace, 'gate-v-knowledge.txt')
  writeFileSync(documentPath, 'The Gate V acceptance phrase is sapphire integration.\n')
  const providerRequests: Array<{ hasTools: boolean; afterTool: boolean; bodyKeys: string[]; toolNames: string[] }> = []
  const provider: Server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'gate-v-model' }] }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, any>
    const tools = Array.isArray(body.tools) ? body.tools : []
    providerRequests.push({
      hasTools: tools.length > 0,
      afterTool: Array.isArray(body.messages) && body.messages.some((message: any) => message?.role === 'tool'),
      bodyKeys: Object.keys(body).sort(),
      toolNames: tools
        .map((tool: any) => tool?.function?.name ?? tool?.name)
        .filter((name: unknown): name is string => typeof name === 'string')
    })
    sendGateVCompletion(response, String(body.model ?? 'gate-v-model'), body, workspace)
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Gate V provider fixture did not bind')
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
    const integration = await ipc<IntegrationSnapshot>(page, 'prometheus.integration.snapshot', {})
    await ipc<IntegrationSnapshot>(page, 'prometheus.integration.configure', {
      updates: [
        {
          feature: 'filesystem',
          expectedRevision: integration.revisions.filesystem,
          value: { ...integration.config.filesystem, enabled: true, allowWrite: true }
        }
      ],
      secrets: {}
    })
    const workspaceEntity = await data<{ id: string }>(page, 'POST', '/agent-workspaces', { path: workspace })
    await closeApp(app)

    launched = await launch(profile)
    app = launched.app
    page = launched.page
    const configuredIntegration = await ipc<IntegrationSnapshot>(page, 'prometheus.integration.snapshot', {})
    const filesystem = configuredIntegration.servers.find(
      (server) => server.name.startsWith('Rust Filesystem') && server.workspace === workspace
    )
    if (!filesystem) throw new Error(`Managed Rust Filesystem server was not registered for ${workspace}`)

    const bossProviderId = `gate-v-boss-${Date.now()}`
    const bossModelId = `${bossProviderId}::gate-v-model`
    await data(page, 'POST', '/providers', {
      providerId: bossProviderId,
      name: 'Gate V Boss fallback',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: providerBaseUrl } },
      defaultChatEndpoint: 'openai-chat-completions',
      apiKeys: [{ id: crypto.randomUUID(), key: 'gate-v-boss-key', label: 'Gate V', isEnabled: true }]
    })
    await data(page, 'POST', '/models', [
      {
        providerId: bossProviderId,
        modelId: 'gate-v-model',
        name: 'Gate V model',
        capabilities: ['function-call'],
        endpointTypes: ['openai-chat-completions'],
        supportsStreaming: true,
        contextWindow: 128_000,
        maxOutputTokens: 8_192
      }
    ])
    await ipc(page, 'prometheus.uar.providers.save', {
      mode: 'create',
      id: 'gate-v-uar',
      displayName: 'Gate V UAR provider',
      baseUrl: providerBaseUrl,
      protocol: 'chat',
      defaultModel: 'gate-v-model',
      models: [
        {
          id: 'gate-v-model',
          displayName: 'Gate V model',
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
          enabled: true,
          supportsTools: true
        }
      ],
      enabled: true,
      credential: { operation: 'set', value: 'gate-v-uar-key' }
    })
    const governance = await ipc<any>(page, 'prometheus.uar.settings.read', { namespace: 'governance' })
    const governanceEnabled = governance.settings.find((candidate: any) => candidate.field === 'enabled')
    if (!governanceEnabled) throw new Error('UAR governance enabled setting is unavailable')
    if (governanceEnabled.saved !== true) {
      const updatedGovernance = await ipc<any>(page, 'prometheus.uar.settings.update', {
        namespace: 'governance',
        changes: [{ field: 'enabled', value: true, expectedRevision: governanceEnabled.revision }]
      })
      expect(updatedGovernance.errors).toEqual([])
    }
    const effectiveGovernance = await ipc<any>(page, 'prometheus.uar.settings.read', { namespace: 'governance' })
    expect(effectiveGovernance.settings.find((candidate: any) => candidate.field === 'enabled')).toMatchObject({
      saved: true,
      effective: true,
      applicationStatus: 'effective'
    })

    let presentations = await ipc<PresentationSnapshot>(page, 'prometheus.uar.presentations.save', {
      title: 'Gate V presentation',
      description: 'A real A2UI template selected by the Gate V agent.',
      enabled: true,
      template: {
        version: 'v0.9.1',
        catalog_id: 'urn:uar:a2ui:catalog:1',
        components: [{ id: 'root', component: 'Text', text: { path: '/message' } }],
        default_data: { message: 'Gate V ready' }
      }
    })
    const presentation = presentations.presentations.find((candidate) => candidate.title === 'Gate V presentation')
    expect(presentation).toBeTruthy()

    let catalog = await ipc<Catalog>(page, 'prometheus.uar.catalog.read', {})
    const template = structuredClone(catalog.agents[0]?.definition)
    if (!template) throw new Error('UAR did not expose a catalog agent template')
    template.id = 'gate-v-agent'
    template.metadata = {
      ...(template.metadata ?? {}),
      title: 'Gate V catalog agent',
      description: 'Exercises the complete Boss catalog-to-conversation workflow.'
    }
    template.policy.provider.default = { provider: 'gate-v-uar', model: 'gate-v-model' }
    template.policy.tools = { ...template.policy.tools, allow: ['*'], deny: [] }
    template.extensions = {
      ...(template.extensions ?? {}),
      'uar.run_policy': {
        version: 1,
        tools: { mode: 'all', ids: [], denied_ids: [] },
        mcp_servers: { mode: 'selected', ids: [filesystem.id], denied_ids: [] },
        tool_approval: 'ask',
        presentations: { mode: 'selected', ids: [presentation!.id], denied_ids: [] }
      }
    }
    catalog = await ipc<Catalog>(page, 'prometheus.uar.catalog.save_agent', {
      mode: 'create',
      id: 'gate-v-agent',
      definition: template
    })
    const selectedSkill = catalog.skills.find((skill) => skill.enabled)
    if (selectedSkill) {
      catalog = await ipc<Catalog>(page, 'prometheus.uar.catalog.save_agent_skills', {
        agentId: 'gate-v-agent',
        skillIds: [selectedSkill.id]
      })
    }
    const target = await ipc<any>(page, 'prometheus.uar.catalog.prepare_run', {
      agentId: 'gate-v-agent',
      bossModelId
    })
    expect(target).toMatchObject({
      catalogAgentId: 'gate-v-agent',
      effectiveModel: { identity: 'gate-v-uar/gate-v-model' },
      presentation: { mode: 'selected', ids: [presentation!.id] }
    })
    await data(page, 'PATCH', `/agents/${target.bossAgentId}`, {
      mcps: [filesystem.id],
      configuration: { permission_mode: 'default' }
    })
    const session = await ipc<{ session: { id: string } }>(page, 'ai.agent.session.reuse_or_create', {
      agentId: target.bossAgentId,
      workspace: { type: 'user', workspaceId: workspaceEntity.id }
    })
    const topicId = `agent-session:${session.session.id}`

    await page.evaluate(
      async ({ topicId, bossModelId }) => {
        const state = { done: false, error: '', approvalId: '', approvalCount: 0, reattached: false, toolOutput: false }
        ;(window as any).__gateV = state
        window.api.ipcApi.on('ai.stream.chunk', (payload: any) => {
          if (payload.topicId !== topicId) return
          if (payload.chunk?.type === 'tool-output-available') state.toolOutput = true
          if (payload.chunk?.type !== 'tool-approval-request' || state.approvalId) return
          state.approvalId = payload.chunk.approvalId
          state.approvalCount += 1
          void (async () => {
            await window.api.ipcApi.request('ai.stream.detach', { topicId })
            await window.api.ipcApi.request('ai.stream.attach', { topicId })
            state.reattached = true
            const result = (await window.api.ipcApi.request('ai.tool.respond_approval', {
              approvalId: state.approvalId,
              approved: true,
              topicId
            })) as { ok: boolean; data?: { ok: boolean } }
            if (!result.ok || result.data?.ok === false) state.error = 'Approval response was rejected'
          })().catch((error) => {
            state.error = error instanceof Error ? error.message : String(error)
          })
        })
        window.api.ipcApi.on('ai.stream.done', (payload: any) => {
          if (payload.topicId === topicId && payload.isTopicDone) state.done = true
        })
        window.api.ipcApi.on('ai.stream.error', (payload: any) => {
          if (payload.topicId === topicId && payload.isTopicDone)
            state.error = payload.error?.message ?? 'unknown stream error'
        })
        const opened = (await window.api.ipcApi.request('ai.stream.open', {
          trigger: 'submit-message',
          topicId,
          mentionedModelIds: [bossModelId],
          userMessageParts: [{ type: 'text', text: 'Write the Gate V approval marker, then report completion.' }]
        })) as { ok: boolean; error?: { message?: string } }
        if (!opened.ok) throw new Error(opened.error?.message ?? 'ai.stream.open failed')
      },
      { topicId, bossModelId }
    )
    await expect
      .poll(() => page.evaluate(() => Boolean((window as any).__gateV.done || (window as any).__gateV.error)), {
        timeout: 3 * 60_000
      })
      .toBe(true)
    let operations = await ipc<OperationSnapshot>(page, 'prometheus.uar.operations.read', {})
    const run = operations.runs.find((candidate) => candidate.ownerSessionId === session.session.id)
    expect(run).toBeTruthy()
    const runDetail = await ipc<any>(page, 'prometheus.uar.runs.read', { runId: run!.runId })
    const gateState = await page.evaluate(() => (window as any).__gateV)
    expect(gateState, JSON.stringify({ providerRequests, runDetail }, null, 2)).toMatchObject({
      done: true,
      error: '',
      approvalCount: 1,
      reattached: true,
      toolOutput: true
    })
    expect(readFileSync(join(workspace, 'gate-v-approved.txt'), 'utf8')).toContain('approved filesystem operation')
    expect(providerRequests).toMatchObject([
      { hasTools: true, afterTool: false },
      { hasTools: true, afterTool: true }
    ])

    expect(run).toMatchObject({ status: 'done', agentRevision: target.catalogRevision })
    expect(runDetail.run.effectivePolicy.presentations).toMatchObject({ mode: 'selected', ids: [presentation!.id] })
    expect(runDetail.run.presentationSelection).toMatchObject({
      requested_mode: 'auto',
      effective_mode: 'auto',
      fallback_reason: null
    })
    const approvalLifecycle = operations.approvals.find((candidate) => candidate.rootRunId === run!.runId)
    expect(approvalLifecycle).toMatchObject({
      ownerSessionId: session.session.id,
      state: 'succeeded'
    })
    expect(JSON.stringify(approvalLifecycle?.action)).not.toContain('approved filesystem operation')

    operations = await ipc<OperationSnapshot>(page, 'prometheus.uar.knowledge.create', {
      sessionId: session.session.id,
      name: 'Gate V knowledge',
      description: 'Upload and query acceptance.'
    })
    const knowledge = operations.knowledgeBases.find((candidate) => candidate.name === 'Gate V knowledge')
    expect(knowledge).toBeTruthy()
    await app.evaluate(({ dialog }, path) => {
      ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, documentPath)
    const upload = await ipc<any>(page, 'prometheus.uar.knowledge.upload', {
      sessionId: session.session.id,
      knowledgeBaseId: knowledge!.id
    })
    expect(upload).toMatchObject({ cancelled: false, filename: 'gate-v-knowledge.txt' })
    await expect
      .poll(async () => {
        const snapshot = await ipc<OperationSnapshot>(page, 'prometheus.uar.operations.read', {})
        return snapshot.knowledgeBases.find((candidate) => candidate.id === knowledge!.id)?.documents[0]?.status
      })
      .toMatch(/ready|completed|indexed/i)
    const search = await ipc<Array<{ content: string; score: number }>>(page, 'prometheus.uar.knowledge.search', {
      sessionId: session.session.id,
      knowledgeBaseId: knowledge!.id,
      query: 'What is the Gate V acceptance phrase?'
    })
    expect(search.some((result) => result.content.includes('sapphire integration'))).toBe(true)

    operations = await ipc<OperationSnapshot>(page, 'prometheus.uar.operations.read', {})
    expect(operations.protocols).toEqual({ a2a: 'available', acp: 'available' })
    expect(operations.failures).toEqual([])
    const administration = await ipc<AdministrationSnapshot>(page, 'prometheus.uar.admin.snapshot', {})
    expect(administration.surfaces.length).toBeGreaterThan(10)
    const unjustifiedUnavailable = administration.surfaces.flatMap((surface) =>
      surface.methods
        .filter((method) => method.adapter === 'unavailable')
        .filter(() => surface.availability === 'available')
        .map((method) => `${surface.id}:${method.id}`)
    )
    expect(unjustifiedUnavailable).toEqual([])

    await ipc(page, 'navigation.open_route_in_main', {
      path: `/settings/uar?panel=agents&agentId=gate-v-agent`
    })
    await expect(page.getByText('Gate V catalog agent', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Configure and run', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true })
      await page.screenshot({ path: join(screenshotDirectory, 'gate-v-agents-wide.png'), fullPage: true })
    }
    const unnamedControls = await page.locator('main').evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>('button, input, select, textarea')]
        .filter((element) => element.offsetParent !== null)
        .filter((element) => {
          const id = element.getAttribute('id')
          const label = id ? root.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() : ''
          return !(
            element.getAttribute('aria-label')?.trim() ||
            element.getAttribute('aria-labelledby')?.trim() ||
            element.getAttribute('title')?.trim() ||
            element.textContent?.trim() ||
            label
          )
        })
        .map((element) => element.outerHTML.slice(0, 180))
    )
    expect(unnamedControls).toEqual([])
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
    await page.setViewportSize({ width: 640, height: 900 })
    await expect(page.getByRole('combobox', { name: 'Administration destination' })).toBeVisible()
    const overflow = await page.locator('[data-ui="settings.view"]').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
    if (screenshotDirectory) {
      await page.screenshot({ path: join(screenshotDirectory, 'gate-v-agents-narrow.png'), fullPage: true })
    }

    await ipc(page, 'navigation.open_route_in_main', { path: '/settings/uar?panel=approvals' })
    await expect(page.getByText('Tool approval lifecycle', { exact: true })).toBeVisible()
    await expect(page.getByText('Completed results', { exact: true })).toBeVisible()
    await expect(page.getByText('Succeeded', { exact: true }).first()).toBeVisible()

    const evidence = {
      gate: 'V',
      uarVersion: administration.uarVersion,
      catalogRevision: target.catalogRevision,
      bossAgentId: target.bossAgentId,
      sessionId: session.session.id,
      runId: run!.runId,
      selectedSkill: selectedSkill?.id ?? null,
      presentationId: presentation!.id,
      approvalReconnect: 'operational',
      approvalLifecycle: {
        state: approvalLifecycle!.state,
        safeProjection: approvalLifecycle!.action
      },
      toolOutput: join(workspace, 'gate-v-approved.txt'),
      knowledge: { id: knowledge!.id, queryResults: search.length },
      protocols: operations.protocols,
      administration: {
        surfaces: administration.surfaces.length,
        methods: administration.surfaces.reduce((total, surface) => total + surface.methods.length, 0),
        unavailableAdapters: administration.surfaces
          .flatMap((surface) => surface.methods)
          .filter((method) => method.adapter === 'unavailable').length
      },
      accessibility: { unnamedControls: unnamedControls.length, keyboardFocus: 'operational', narrowOverflow: overflow }
    }
    if (evidencePath) {
      mkdirSync(dirname(evidencePath), { recursive: true })
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
    }
    console.log(`GATE_V_RESULT ${JSON.stringify(evidence)}`)
  } finally {
    if (app) await closeApp(app)
    provider.closeAllConnections()
    await new Promise<void>((resolve, reject) => provider.close((error) => (error ? reject(error) : resolve())))
    if (existsSync(join(workspace, 'gate-v-approved.txt'))) {
      expect(readFileSync(join(workspace, 'gate-v-approved.txt'), 'utf8')).toContain('Gate V approved')
    }
  }
})
