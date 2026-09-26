import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

import type { LiterConfigApplyResult, LiterConfigExportResult, LiterConfigSnapshot } from '@shared/types/literConfig'
import type {
  LiterAliasMutation,
  LiterConnectionMutation,
  LiterGatewayCatalogSnapshot
} from '@shared/types/literGateway'
import type { LiterRoleAssignments, LiterRoleSnapshot } from '@shared/types/literRoles'
import type {
  IntegrationConfig,
  IntegrationOperation,
  IntegrationSnapshot,
  UarModelSourceSnapshot
} from '@shared/types/prometheusIntegration'

const endpoint = process.env.GATE_C_FULL_PACK_ENDPOINT?.trim() || 'http://127.0.0.1:4000'
const managedEndpoint = process.env.GATE_C_MANAGED_ENDPOINT?.trim() || 'http://127.0.0.1:4010'
const evidencePath = process.env.GATE_C_EVIDENCE_PATH?.trim()
const gatewayKey = process.env.GATE_C_GATEWAY_KEY?.trim() || process.env.LITER_LLM_MASTER_KEY?.trim()
const miniRoot = process.env.GATE_C_MINI_ROOT?.trim() || resolve(process.cwd(), '..', '..', 'prometheus-skills-mini')
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])

type IntegrationSources = {
  sources: Record<string, { repository: string; revision: string }>
}

type PayloadManifest = {
  sources: Record<string, { repository: string; revision: string }>
  files: Array<{ path: string; sha256: string }>
}

function sha256(filename: string): string {
  return createHash('sha256').update(readFileSync(filename)).digest('hex')
}

function preparePinnedLiterCatalog(): void {
  const sourcePin = JSON.parse(
    readFileSync(join(process.cwd(), 'build', 'integration-sources.json'), 'utf8')
  ) as IntegrationSources
  const literPin = sourcePin.sources['liter-llm']
  if (!literPin) throw new Error('build/integration-sources.json does not pin liter-llm')

  const literRoot = join(miniRoot, 'tools', 'liter-llm')
  const actualRevision = execFileSync('git', ['-C', literRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (actualRevision !== literPin.revision) {
    throw new Error(`Gate C liter-llm source ${actualRevision} does not match pinned revision ${literPin.revision}`)
  }

  const payloadRoot = join(process.cwd(), 'build', 'prometheus-payload')
  const catalogRoot = join(payloadRoot, 'catalogs', 'liter-llm')
  const providersSource = join(literRoot, 'schemas', 'providers.json')
  const catalogSource = join(literRoot, 'schemas', 'catalog.json')
  const providersDestination = join(catalogRoot, 'providers.json')
  const catalogDestination = join(catalogRoot, 'catalog.json')
  const catalogManifestDestination = join(catalogRoot, 'catalog-manifest.json')

  mkdirSync(catalogRoot, { recursive: true })
  copyFileSync(providersSource, providersDestination)
  copyFileSync(catalogSource, catalogDestination)
  writeFileSync(
    catalogManifestDestination,
    `${JSON.stringify(
      {
        schema: 1,
        repository: literPin.repository,
        revision: literPin.revision,
        providersSha256: sha256(providersDestination),
        catalogSha256: sha256(catalogDestination)
      },
      null,
      2
    )}\n`
  )

  const payloadManifestPath = join(payloadRoot, 'release-manifest.json')
  const payloadManifest = JSON.parse(readFileSync(payloadManifestPath, 'utf8')) as PayloadManifest
  payloadManifest.sources['liter-llm'] = literPin
  const catalogFiles = [providersDestination, catalogDestination, catalogManifestDestination].map((filename) => ({
    path: filename
      .slice(payloadRoot.length + 1)
      .split('\\')
      .join('/'),
    sha256: sha256(filename)
  }))
  payloadManifest.files = payloadManifest.files
    .filter((file) => !file.path.startsWith('catalogs/liter-llm/'))
    .concat(catalogFiles)
    .sort((left, right) => left.path.localeCompare(right.path))
  writeFileSync(payloadManifestPath, `${JSON.stringify(payloadManifest, null, 2)}\n`)
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function mainWindow(app: ElectronApplication): Promise<Page> {
  await expect
    .poll(() =>
      app.windows().find((candidate) => {
        try {
          return new URL(candidate.url()).pathname.endsWith('/windows/main/index.html')
        } catch {
          return false
        }
      })
    )
    .toBeTruthy()
  const page = app.windows().find((candidate) => candidate.url().includes('/windows/main/index.html'))!
  await page.locator('#root').waitFor({ state: 'visible', timeout: 60_000 })
  return page
}

async function ipc<T>(page: Page, route: string, input: unknown): Promise<T> {
  const result = (await page.evaluate(({ route, input }) => window.api.ipcApi.request(route, input), {
    route,
    input
  })) as { ok: boolean; data?: T; error?: { message?: string } }
  if (!result.ok) throw new Error(result.error?.message ?? `${route} failed`)
  return result.data as T
}

async function data<T>(page: Page, path: string, body: unknown): Promise<T> {
  const result = (await page.evaluate(
    ({ path, body }) => window.api.dataApi.request({ id: crypto.randomUUID(), method: 'POST', path, body }),
    { path, body }
  )) as { data?: T; error?: { message?: string } }
  if (result.error) throw new Error(result.error.message ?? path)
  return result.data as T
}

async function configure(page: Page, snapshot: IntegrationSnapshot, services: IntegrationConfig['services']) {
  return ipc<IntegrationSnapshot>(page, 'prometheus.integration.configure', {
    updates: [{ feature: 'services', expectedRevision: snapshot.revisions.services, value: services }],
    secrets: { literKey: { operation: 'set', value: required('GATE_C_GATEWAY_KEY', gatewayKey) } }
  })
}

async function waitOperation(page: Page, id: string, timeout = 30_000): Promise<IntegrationOperation> {
  let operation: IntegrationOperation | undefined
  await expect
    .poll(
      async () => {
        operation = (await ipc<IntegrationSnapshot>(page, 'prometheus.integration.snapshot', {})).operations.find(
          (candidate) => candidate.id === id
        )
        return Boolean(operation && terminal.has(operation.status))
      },
      { timeout }
    )
    .toBe(true)
  return operation!
}

async function runOperation(page: Page, action: 'start' | 'stop' | 'diagnose', workspacePath?: string) {
  const operation = await ipc<IntegrationOperation>(page, 'prometheus.integration.start', {
    action,
    ...(workspacePath ? { workspacePath } : {})
  })
  return waitOperation(page, operation.id, action === 'diagnose' ? 190_000 : 30_000)
}

test('Gate C: detected and managed liter-llm administration drives real inference and UAR model refresh', async () => {
  test.skip(!gatewayKey, 'Gate C requires GATE_C_GATEWAY_KEY or LITER_LLM_MASTER_KEY')
  const key = required('GATE_C_GATEWAY_KEY', gatewayKey)
  const health = await fetch(new URL('/health', endpoint))
  expect(health.ok).toBe(true)
  preparePinnedLiterCatalog()

  const profile = `Gate-C-${Date.now()}`
  const workspace = mkdtempSync(join(tmpdir(), 'the-boss-gate-c-'))
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'src', 'index.ts'), 'export const gate = "C"\n')
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      CS_DEV_USER_DATA_SUFFIX: profile,
      THE_BOSS_UAR_SIDECAR_PATH: required('THE_BOSS_UAR_SIDECAR_PATH', process.env.THE_BOSS_UAR_SIDECAR_PATH),
      THE_BOSS_LITER_LLM_PATH: required('THE_BOSS_LITER_LLM_PATH', process.env.THE_BOSS_LITER_LLM_PATH)
    },
    timeout: 60_000
  })
  let servicesStarted = false
  try {
    const page = await mainWindow(app)
    await page.evaluate(async () => {
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped',
        'app.privacy.data_collection.enabled': false
      })
    })
    await data(page, '/agent-workspaces', { path: workspace })

    let snapshot = await ipc<IntegrationSnapshot>(page, 'prometheus.integration.snapshot', {})
    snapshot = await configure(page, snapshot, {
      ...snapshot.config.services,
      liter: { ownership: 'external', source: 'full-pack', endpoint }
    })
    let catalog = await ipc<LiterGatewayCatalogSnapshot>(page, 'prometheus.liter.catalog.refresh', {})
    expect(catalog.gateway.operational).toBe(true)
    expect(catalog.gateway.candidates.some((candidate) => candidate.source === 'full-pack')).toBe(true)
    const liveModels = catalog.aliases.filter((alias) => alias.available).map((alias) => alias.identity.alias)
    for (const model of ['MiniMax-M3', 'k3', 'gpt-5.5']) expect(liveModels).toContain(model)

    snapshot = await ipc<IntegrationSnapshot>(page, 'prometheus.integration.snapshot', {})
    snapshot = await ipc<IntegrationSnapshot>(page, 'prometheus.integration.configure', {
      updates: [
        {
          feature: 'compass',
          expectedRevision: snapshot.revisions.compass,
          value: { ...snapshot.config.compass, storage: 'sqlite' }
        }
      ],
      secrets: {}
    })
    snapshot = await configure(page, snapshot, {
      ...snapshot.config.services,
      surrealdb: { ownership: 'external', source: 'manual', endpoint: 'http://127.0.0.1:28000' },
      memory: { ownership: 'external', source: 'manual', endpoint: 'http://127.0.0.1:23101/mcp/sse' },
      memoryEnabled: false,
      liter: { ownership: 'managed', source: 'application', endpoint: managedEndpoint },
      literPort: Number(new URL(managedEndpoint).port)
    })
    catalog = await ipc<LiterGatewayCatalogSnapshot>(page, 'prometheus.liter.catalog.read', {})
    const connection: Omit<LiterConnectionMutation, 'expectedRevision'> = {
      mode: 'create',
      connection: {
        providerConnectionId: 'full-pack-upstream',
        providerId: 'openai',
        displayName: 'Detected full-pack gateway',
        baseUrl: `${endpoint.replace(/\/$/, '')}/v1`,
        timeoutMs: 60_000,
        enabled: true
      },
      credential: { operation: 'set', value: key }
    }
    catalog = await ipc<LiterGatewayCatalogSnapshot>(page, 'prometheus.liter.connections.save', {
      ...connection,
      expectedRevision: catalog.revision
    })

    const gatewayConnectionId = catalog.gateway.identity.gatewayConnectionId
    const assignments: LiterRoleAssignments = {
      critic: {
        model: { providerConnectionId: 'full-pack-upstream', providerId: 'openai', modelId: 'MiniMax-M3' },
        servedAlias: { gatewayConnectionId, alias: 'kbd-critic' }
      },
      judge: {
        model: { providerConnectionId: 'full-pack-upstream', providerId: 'openai', modelId: 'k3' },
        servedAlias: { gatewayConnectionId, alias: 'kbd-judge' }
      },
      backup: {
        model: { providerConnectionId: 'full-pack-upstream', providerId: 'openai', modelId: 'gpt-5.5' },
        servedAlias: { gatewayConnectionId, alias: 'kbd-backup' }
      }
    }
    for (const assignment of Object.values(assignments)) {
      const alias: Omit<LiterAliasMutation, 'expectedRevision'> = {
        mode: 'create',
        alias: {
          gatewayConnectionId,
          alias: assignment.servedAlias.alias,
          target: assignment.model,
          displayName: assignment.servedAlias.alias,
          enabled: true,
          custom: false
        }
      }
      catalog = await ipc<LiterGatewayCatalogSnapshot>(page, 'prometheus.liter.aliases.save', {
        ...alias,
        expectedRevision: catalog.revision
      })
    }
    const roleSnapshot = await ipc<LiterRoleSnapshot>(page, 'prometheus.liter.roles.save', {
      expectedRevision: catalog.revision,
      assignments
    })
    expect(roleSnapshot.assignments).toEqual(assignments)

    const config = await ipc<LiterConfigSnapshot>(page, 'prometheus.liter_config.read', {
      source: { ownership: 'managed' }
    })
    expect(config.validation.valid).toBe(true)
    const applied = await ipc<LiterConfigApplyResult>(page, 'prometheus.liter_config.apply_saved', {
      source: { ownership: 'managed' },
      expectedRevision: config.revision
    })
    expect(applied.state).toBe('restart-required')
    const conflict = await ipc<LiterConfigApplyResult>(page, 'prometheus.liter_config.apply_saved', {
      source: { ownership: 'managed' },
      expectedRevision: config.revision
    })
    expect(conflict.state).toBe('conflict')
    const exported = await ipc<LiterConfigExportResult>(page, 'prometheus.liter_config.export_saved', {
      source: { ownership: 'managed' },
      expectedRevision: applied.nextRevision,
      remoteEndpoint: endpoint
    })
    expect(exported.state).toBe('deployment-required')
    expect(exported.path).toBeTruthy()

    const started = await runOperation(page, 'start')
    expect(started.status).toBe('succeeded')
    servicesStarted = true
    const diagnosed = await runOperation(page, 'diagnose', workspace)
    expect(diagnosed.status).toBe('succeeded')
    for (const role of ['critic', 'judge', 'backup']) {
      expect(diagnosed.diagnostics).toContainEqual(
        expect.objectContaining({ id: `liter:${role}`, state: 'operational' })
      )
    }

    const sources = await ipc<UarModelSourceSnapshot>(page, 'prometheus.uar.models.sources', {})
    const gateway = sources.sources.find((source) => source.source === 'gateway')
    expect(gateway?.operational).toBe(true)
    for (const alias of ['kbd-critic', 'kbd-judge', 'kbd-backup']) {
      expect(gateway?.providers[0]?.models.map((model) => model.id)).toContain(alias)
    }

    catalog = await ipc<LiterGatewayCatalogSnapshot>(page, 'prometheus.liter.catalog.read', {})
    expect(JSON.stringify(catalog)).not.toContain(key)
    expect(catalog.connections.find((item) => item.providerConnectionId === 'full-pack-upstream')).toMatchObject({
      credentialConfigured: true
    })

    const modelsDocument = await ipc<{ path: string }>(page, 'prometheus.liter.roles.read_document', {
      source: { ownership: 'managed' }
    })
    const preflight = JSON.parse(
      execFileSync(process.execPath, ['scripts/adversarial-review/preflight-models.mjs', '--force'], {
        cwd: miniRoot,
        env: {
          ...process.env,
          PROMETHEUS_KBD_MODELS_CONFIG: modelsDocument.path,
          LITER_LLM_BASE_URL: `${managedEndpoint.replace(/\/$/, '')}/v1`,
          LITER_LLM_MASTER_KEY: key,
          KBD_PRODUCER_PROVIDER_CONNECTION_ID: assignments.judge.model.providerConnectionId,
          KBD_PRODUCER_PROVIDER_ID: assignments.judge.model.providerId,
          KBD_PRODUCER_MODEL_ID: assignments.judge.model.modelId
        },
        encoding: 'utf8'
      })
    ) as { roles: Record<string, { alias?: string }>; distinct_models: number }
    expect(preflight.roles.backup.alias).toBe('kbd-backup')
    expect(preflight.distinct_models).toBeGreaterThanOrEqual(3)

    const packetPath = join(workspace, 'gate-c-packet.json')
    const findingsPath = join(workspace, 'gate-c-findings.json')
    writeFileSync(
      packetPath,
      `${JSON.stringify({
        schema_version: '1.0',
        mode: 'decision',
        producer_model: 'kbd-judge',
        producer_identity: assignments.judge.model,
        objective: 'Confirm that a distinct backup reviewer is selected when the judge matches the producer.',
        decision: { critic: 'kbd-critic', judge: 'kbd-judge', backup: 'kbd-backup' }
      })}\n`
    )
    const dispatch = spawnSync(
      process.execPath,
      [
        'scripts/adversarial-review/dispatch-judge.mjs',
        '--mode',
        'decision',
        '--packet',
        packetPath,
        '--out',
        findingsPath
      ],
      {
        cwd: miniRoot,
        env: {
          ...process.env,
          PROMETHEUS_KBD_MODELS_CONFIG: modelsDocument.path,
          LITER_LLM_BASE_URL: `${managedEndpoint.replace(/\/$/, '')}/v1`,
          LITER_LLM_MASTER_KEY: key,
          ADV_JUDGE_RETRIES: '1',
          ADV_JUDGE_TIMEOUT: '120'
        },
        encoding: 'utf8',
        timeout: 180_000
      }
    )
    expect(dispatch.status, dispatch.stderr).toBe(0)
    expect(dispatch.stderr).toContain("switching to configured backup 'kbd-backup'")
    const findings = JSON.parse(readFileSync(findingsPath, 'utf8')) as { judge_model?: string }
    expect(findings.judge_model).toBe('kbd-backup')

    const evidence = {
      gate: 'C',
      fullPackDetected: true,
      managedGateway: 'operational',
      realInference: ['critic', 'judge', 'backup'],
      configApply: applied.state,
      conflict: conflict.state,
      remoteExport: exported.state,
      fallback: 'kbd-backup-dispatched',
      uarRefresh: true,
      credentialsDisclosed: false
    }
    if (evidencePath) {
      mkdirSync(dirname(evidencePath), { recursive: true })
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
    }
    console.log(`GATE_C_RESULT ${JSON.stringify(evidence)}`)
  } finally {
    if (servicesStarted) {
      const page = app.windows().find((candidate) => candidate.url().includes('/windows/main/index.html'))
      if (page) await runOperation(page, 'stop').catch(() => undefined)
    }
    await app.close().catch(() => undefined)
    rmSync(workspace, { recursive: true, force: true })
  }
})
