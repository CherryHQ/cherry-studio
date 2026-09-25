import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const externalSurreal = process.env.GATE_B_EXTERNAL_SURREAL_ENDPOINT?.trim()
const externalUsername = process.env.GATE_B_EXTERNAL_SURREAL_USERNAME?.trim()
const externalPassword = process.env.GATE_B_EXTERNAL_SURREAL_PASSWORD?.trim()
const evidencePath = process.env.GATE_B_EVIDENCE_PATH?.trim()
const memoryPort = Number(process.env.GATE_B_MEMORY_PORT ?? 23101)
const gatewayPort = Number(process.env.GATE_B_GATEWAY_PORT ?? 4010)

type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
type Operation = {
  id: string
  action: string
  status: OperationStatus
  stage: string
  cursor: number
  output: string
  error?: string
  resourceKeys: string[]
  startedAt: number
}
type Workspace = {
  path: string
  id: string
  graph: string
  enabled: boolean
  indexed: boolean
  freshness: { state: string; detail?: string }
  latestOperationId?: string
}
type Snapshot = {
  revisions: Record<'compass' | 'filesystem' | 'uar' | 'services', number>
  config: Record<string, any>
  operations: Operation[]
  workspaces: Workspace[]
  servers: Array<{ name: string; workspace?: string; status: string }>
}
type EventPage = {
  operation: Operation
  events: Array<{ operationId: string; sequence: number; kind: string; output?: string }>
  cursor: number
}
type LogPage = {
  operationId: string
  offset: number
  nextOffset: number
  totalBytes: number
  text: string
  eof: boolean
}

const terminal = new Set<OperationStatus>(['succeeded', 'failed', 'cancelled', 'interrupted'])

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`)
  return value
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
      THE_BOSS_UAR_SIDECAR_PATH: required('THE_BOSS_UAR_SIDECAR_PATH', process.env.THE_BOSS_UAR_SIDECAR_PATH)
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

async function data<T>(page: Page, method: 'POST', path: string, body: unknown): Promise<T> {
  const result = (await page.evaluate(
    ({ method, path, body }) => window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body }),
    { method, path, body }
  )) as { data?: T; error?: { message?: string } }
  if (result.error) throw new Error(result.error.message ?? `${method} ${path} failed`)
  return result.data as T
}

const snapshot = (page: Page) => ipc<Snapshot>(page, 'prometheus.integration.snapshot', {})

async function startOperation(page: Page, action: string, workspacePath?: string): Promise<Operation> {
  return ipc<Operation>(page, 'prometheus.integration.start', {
    action,
    ...(workspacePath ? { workspacePath } : {})
  })
}

async function waitOperation(page: Page, id: string): Promise<Operation> {
  let current: Operation | undefined
  await expect
    .poll(async () => {
      current = (await snapshot(page)).operations.find((operation) => operation.id === id)
      return Boolean(current && terminal.has(current.status))
    })
    .toBe(true)
  return current!
}

async function waitForAction(page: Page, action: string, after = 0): Promise<Operation> {
  let current: Operation | undefined
  await expect
    .poll(async () => {
      current = (await snapshot(page)).operations.find(
        (operation) => operation.action === action && operation.startedAt >= after
      )
      return Boolean(current)
    })
    .toBe(true)
  return current!
}

async function runOperation(page: Page, action: string, workspacePath?: string): Promise<Operation> {
  return waitOperation(page, (await startOperation(page, action, workspacePath)).id)
}

async function configure(page: Page, updates: unknown[], secrets: Record<string, unknown> = {}): Promise<Snapshot> {
  return ipc<Snapshot>(page, 'prometheus.integration.configure', { updates, secrets })
}

function createWorkspace(name: string, large = false): string {
  const workspace = mkdtempSync(join(tmpdir(), `${name}-`))
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'src', 'entry.ts'), `export const project = ${JSON.stringify(name)}\n`)
  writeFileSync(join(workspace, 'src', 'remove-me.ts'), 'export const removeMe = true\n')
  if (large) {
    for (let index = 0; index < 4_000; index++) {
      writeFileSync(
        join(workspace, 'src', `generated-${String(index).padStart(4, '0')}.ts`),
        `export const n${index} = ${index}\n`
      )
    }
  }
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['add', '.'], { cwd: workspace, stdio: 'ignore' })
  execFileSync(
    'git',
    ['-c', 'user.name=Gate B', '-c', 'user.email=gate-b@example.invalid', 'commit', '-m', 'gate-b baseline'],
    { cwd: workspace, stdio: 'ignore' }
  )
  return workspace
}

async function readLog(page: Page, id: string): Promise<{ text: string; totalBytes: number; pages: number }> {
  let offset = 0
  let text = ''
  let pages = 0
  let totalBytes = 0
  do {
    const pageResult = await ipc<LogPage>(page, 'prometheus.integration.operation_log', {
      id,
      offset,
      limit: 64 * 1024
    })
    expect(pageResult.offset).toBe(offset)
    expect(pageResult.nextOffset).toBeGreaterThanOrEqual(offset)
    text += pageResult.text
    pages++
    offset = pageResult.nextOffset
    totalBytes = pageResult.totalBytes
    if (pageResult.eof) break
  } while (pages < 100)
  expect(offset).toBe(totalBytes)
  return { text, totalBytes, pages }
}

async function createServiceLogVolume(
  memoryEndpoint: string,
  gatewayEndpoint: string,
  secrets: string[]
): Promise<void> {
  const targets = [memoryEndpoint, gatewayEndpoint]
  for (let index = 0; index < 3_000; index += 50) {
    await Promise.all(
      Array.from({ length: 50 }, (_, offset) => {
        const marker = index + offset
        const target = targets[marker % targets.length]
        const disclosedOnlyToLocalService = marker < secrets.length ? secrets[marker] : `event-${marker}`
        return fetch(new URL(`/gate-b-log/${encodeURIComponent(disclosedOnlyToLocalService)}`, target)).catch(
          () => undefined
        )
      })
    )
  }
}

test('Gate B: real services and isolated Compass workspaces retain observable operations', async () => {
  test.skip(
    !externalSurreal || !externalUsername || !externalPassword,
    'Gate B requires GATE_B_EXTERNAL_SURREAL_ENDPOINT, GATE_B_EXTERNAL_SURREAL_USERNAME and GATE_B_EXTERNAL_SURREAL_PASSWORD'
  )
  const surrealEndpoint = required('GATE_B_EXTERNAL_SURREAL_ENDPOINT', externalSurreal)
  required('GATE_B_EXTERNAL_SURREAL_USERNAME', externalUsername)
  const surrealPassword = required('GATE_B_EXTERNAL_SURREAL_PASSWORD', externalPassword)
  const externalHealth = new URL('/health', surrealEndpoint).href
  const healthBefore = await fetch(externalHealth)
  expect(healthBefore.ok).toBe(true)

  const profile = `Gate-B-${Date.now()}`
  const workspaceA = createWorkspace('the-boss-gate-b-a')
  const workspaceB = createWorkspace('the-boss-gate-b-b', true)
  const intentionalInvalidPassword = `gate-b-invalid-${crypto.randomUUID()}`
  const secrets = {
    root: surrealPassword,
    memory: `gate-b-memory-${crypto.randomUUID()}`,
    gateway: `gate-b-gateway-${crypto.randomUUID()}`
  }
  const memoryEndpoint = `http://127.0.0.1:${memoryPort}`
  const gatewayEndpoint = `http://127.0.0.1:${gatewayPort}`
  let app: ElectronApplication | undefined
  let page: Page | undefined
  let servicesStarted = false
  try {
    ;({ app, page } = await launch(profile))
    await page.evaluate(async () => {
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped',
        'app.privacy.data_collection.enabled': false
      })
    })
    await data(page, 'POST', '/agent-workspaces', { path: workspaceA })
    await data(page, 'POST', '/agent-workspaces', { path: workspaceB })

    let current = await snapshot(page)
    await configure(
      page,
      [
        {
          feature: 'services',
          expectedRevision: current.revisions.services,
          value: {
            ...current.config.services,
            surrealdb: { ownership: 'external', source: 'manual', endpoint: surrealEndpoint },
            memory: { ownership: 'managed', source: 'application', endpoint: `${memoryEndpoint}/mcp/sse` },
            liter: { ownership: 'managed', source: 'application', endpoint: gatewayEndpoint },
            memoryPort,
            literPort: gatewayPort
          }
        },
        {
          feature: 'compass',
          expectedRevision: current.revisions.compass,
          value: { ...current.config.compass, enabled: true, storage: 'json' }
        }
      ],
      {
        rootPassword: { operation: 'set', value: intentionalInvalidPassword },
        memoryPassword: { operation: 'set', value: secrets.memory },
        literKey: { operation: 'set', value: secrets.gateway }
      }
    )

    await ipc(page, 'navigation.open_route_in_main', { path: '/settings/services' })
    const intentionalFailure = await runOperation(page, 'start')
    expect(intentionalFailure.status).toBe('failed')
    expect(intentionalFailure.resourceKeys).toContain('compose:the-boss-prometheus')
    const serviceManagement = page.locator('#setting-services-service-management')
    await expect(serviceManagement.getByText('Failed', { exact: true })).toBeVisible()
    await expect(serviceManagement.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect((await readLog(page, intentionalFailure.id)).text).not.toContain(intentionalInvalidPassword)

    await configure(page, [], { rootPassword: { operation: 'set', value: secrets.root } })
    const pullStartedAfter = Date.now()
    await page.getByRole('button', { name: 'Set up and pull images' }).click()
    const pull = await waitForAction(page, 'pull', pullStartedAfter)
    const pulled = await waitOperation(page, pull.id)
    expect(pulled.status).toBe('succeeded')

    const started = await runOperation(page, 'start')
    expect(started.status).toBe('succeeded')
    servicesStarted = true
    await createServiceLogVolume(memoryEndpoint, gatewayEndpoint, [secrets.root, secrets.memory, secrets.gateway])

    for (const label of ['Detect Docker and services', 'Service logs']) {
      const operationStartedAfter = Date.now()
      await page.getByRole('button', { name: label }).click()
      const action = label === 'Service logs' ? 'logs' : 'status'
      const latest = await waitForAction(page, action, operationStartedAfter)
      expect((await waitOperation(page, latest.id)).status).toBe('succeeded')
    }

    const indexedA = await runOperation(page, 'index', workspaceA)
    expect(indexedA.status).toBe('succeeded')
    const indexedB = await runOperation(page, 'index', workspaceB)
    expect(indexedB.status).toBe('succeeded')
    expect((await runOperation(page, 'check-drift', workspaceA)).status).toBe('succeeded')
    expect((await runOperation(page, 'check-drift', workspaceB)).status).toBe('succeeded')

    writeFileSync(join(workspaceA, 'src', 'entry.ts'), 'export const project = "changed"\n')
    rmSync(join(workspaceA, 'src', 'remove-me.ts'))
    writeFileSync(join(workspaceA, 'src', 'untracked.ts'), 'export const untracked = true\n')
    expect((await runOperation(page, 'check-drift', workspaceA)).status).toBe('succeeded')
    current = await snapshot(page)
    expect(current.workspaces.find((workspace) => workspace.path === workspaceA)?.freshness.state).toBe('stale')
    expect((await runOperation(page, 'refresh', workspaceA)).status).toBe('succeeded')
    expect((await snapshot(page)).workspaces.find((workspace) => workspace.path === workspaceA)?.freshness.state).toBe(
      'current'
    )

    await ipc(page, 'prometheus.integration.workspace_enabled', { workspacePath: workspaceB, enabled: false })
    const cancelling = await startOperation(page, 'refresh', workspaceB)
    await expect
      .poll(async () => {
        const operation = (await snapshot(page!)).operations.find((candidate) => candidate.id === cancelling.id)
        return operation?.status === 'running' && operation.stage === 'refreshing'
      })
      .toBe(true)
    await ipc(page, 'prometheus.integration.cancel', { id: cancelling.id })
    expect((await waitOperation(page, cancelling.id)).status).toBe('cancelled')

    current = await snapshot(page)
    const isolatedA = current.workspaces.find((workspace) => workspace.path === workspaceA)
    const isolatedB = current.workspaces.find((workspace) => workspace.path === workspaceB)
    expect(isolatedA?.id).not.toBe(isolatedB?.id)
    expect(isolatedA?.graph).not.toBe(isolatedB?.graph)
    expect(isolatedB?.enabled).toBe(false)
    expect(isolatedB?.indexed).toBe(true)

    const replaySource = current.operations.find((operation) => operation.action === 'logs')!
    const beforeRestartEvents = await ipc<EventPage>(page, 'prometheus.integration.operation_events', {
      id: replaySource.id,
      after: 0,
      limit: 500
    })
    expect(beforeRestartEvents.events.map((event) => event.sequence)).toEqual(
      beforeRestartEvents.events.map((_, index) => index + 1)
    )
    await closeApp(app)
    ;({ app, page } = await launch(profile))
    const restored = await snapshot(page)
    expect(restored.operations.find((operation) => operation.id === replaySource.id)?.status).toBe('succeeded')
    expect(restored.workspaces.find((workspace) => workspace.path === workspaceB)?.enabled).toBe(false)
    const replayed = await ipc<EventPage>(page, 'prometheus.integration.operation_events', {
      id: replaySource.id,
      after: 0,
      limit: 500
    })
    expect(replayed.events).toEqual(beforeRestartEvents.events)

    const fullLog = await readLog(page, replaySource.id)
    expect(fullLog.totalBytes).toBeGreaterThan(256 * 1024)
    expect(fullLog.pages).toBeGreaterThan(4)
    for (const secret of Object.values(secrets)) expect(fullLog.text).not.toContain(secret)

    await ipc(page, 'navigation.open_route_in_main', { path: '/settings/compass' })
    await expect(page.getByRole('combobox', { name: 'Recent workspaces' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Recent workspaces' }).selectOption(workspaceB)
    await expect(page.getByRole('checkbox', { name: 'Enable Compass for this workspace' })).not.toBeChecked()
    await expect(page.getByText('Full operation log', { exact: true })).toBeVisible()

    expect((await runOperation(page, 'restart')).status).toBe('succeeded')
    expect((await runOperation(page, 'stop')).status).toBe('succeeded')
    servicesStarted = false
    expect((await fetch(externalHealth)).ok).toBe(true)

    const evidence = {
      gate: 'B',
      topology: { surrealdb: 'external', memory: 'managed', liter: 'managed' },
      intentionalFailure: intentionalFailure.status,
      externalPreserved: true,
      workspaces: [isolatedA?.id, isolatedB?.id],
      disabledWorkspacePersisted: true,
      drift: 'stale-then-current',
      cancellation: 'cancelled',
      replayedEvents: replayed.events.length,
      fullLog: { totalBytes: fullLog.totalBytes, pages: fullLog.pages, credentialsDisclosed: false }
    }
    if (evidencePath) {
      mkdirSync(dirname(evidencePath), { recursive: true })
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
    }
    console.log(`GATE_B_RESULT ${JSON.stringify(evidence)}`)
  } finally {
    if (page && servicesStarted) await runOperation(page, 'stop').catch(() => undefined)
    if (app) await closeApp(app)
    rmSync(workspaceA, { recursive: true, force: true })
    rmSync(workspaceB, { recursive: true, force: true })
  }
})
