import fs from 'node:fs/promises'
import path from 'node:path'

import { parse, stringify } from 'yaml'

import { application } from '@application'
import { getBinaryPath } from '@main/utils/binaryResolver'
import { isUarEnabled } from '@shared/ai/agentRuntimeCapabilities'
import type {
  IntegrationConfig,
  IntegrationOperationProgress,
  IntegrationOperationStage
} from '@shared/types/prometheusIntegration'

import { ensureManagedSecrets, integrationDirectory, readSecrets } from './integrationConfig'
import { runIntegrationProcess } from './integrationProcess'
import { writeMiniConfiguration } from './miniCommands'
import { surrealSql } from './surrealConnection'

export const serviceDirectory = () => path.join(integrationDirectory(), 'services')
const toml = (value: string) => JSON.stringify(value)
const surrealString = (value: string) => JSON.stringify(value)
// Compose interpolation is disabled for single-quoted dotenv values.
const dotenv = (value: string) =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n')}'`

type ComposeService = {
  environment?: Record<string, string>
  depends_on?: unknown
}

type ComposeDocument = {
  services: Record<string, ComposeService>
}

function containerSurrealEndpoint(endpoint: string): string {
  const url = new URL(endpoint)
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) url.hostname = 'host.docker.internal'
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href.replace(/\/$/, '')
}

async function writeManagedCompose(config: IntegrationConfig, source: string, destination: string): Promise<void> {
  const document = parse(await fs.readFile(source, 'utf8')) as ComposeDocument
  const memory = document.services['surreal-memory']
  if (config.services.memory.ownership === 'managed' && config.services.surrealdb.ownership === 'external') {
    delete memory.depends_on
    memory.environment!.SURREAL_ENDPOINT = containerSurrealEndpoint(config.services.surrealdb.endpoint)
  }
  if (config.services.surrealdb.ownership === 'external') delete document.services.surrealdb
  if (config.services.memory.ownership === 'external') delete document.services['surreal-memory']
  if (config.services.liter.ownership === 'external') delete document.services['liter-llm']
  await fs.writeFile(destination, stringify(document))
}

export async function prepareManagedServices(config: IntegrationConfig): Promise<void> {
  const root = application.getPath('feature.prometheus.pack.runtime')
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'release-manifest.json'), 'utf8')) as {
    images: Record<string, string>
  }
  const secrets = await ensureManagedSecrets()
  await writeMiniConfiguration()
  const directory = serviceDirectory()
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await writeManagedCompose(config, path.join(root, 'docker', 'compose.yaml'), path.join(directory, 'compose.yaml'))
  const values = {
    SURREAL_ROOT_USERNAME: 'root',
    SURREAL_ROOT_PASSWORD: secrets.rootPassword!,
    MEMORY_USERNAME: 'memory',
    MEMORY_PASSWORD: secrets.memoryPassword!,
    COMPASS_USERNAME: config.compass.username,
    COMPASS_PASSWORD: secrets.compassPassword!,
    LITER_LLM_MASTER_KEY: secrets.literKey!,
    JUDGE_API_KEY: secrets.judgeKey ?? '',
    CRITIC_API_KEY: secrets.criticKey ?? '',
    SURREAL_MEMORY_IMAGE: manifest.images['surreal-memory'],
    LITER_LLM_IMAGE: manifest.images['liter-llm'],
    SURREAL_PORT: String(config.services.surrealPort),
    MEMORY_PORT: String(config.services.memoryPort),
    LITER_PORT: String(config.services.literPort)
  }
  for (const image of [values.SURREAL_MEMORY_IMAGE, values.LITER_LLM_IMAGE]) {
    if (!image || !/@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('prometheus.error.imageManifest')
  }
  await fs.writeFile(
    path.join(directory, '.env'),
    Object.entries(values)
      .map(([key, value]) => `${key}=${dotenv(value)}`)
      .join('\n') + '\n',
    { mode: 0o600 }
  )
  const models = (['judge', 'critic'] as const)
    .filter((role) => config.services[role].name)
    .map((role) => {
      const model = config.services[role]
      return `\n[[models]]\nname = "kbd-${role}"\nprovider_model = ${toml(model.name)}\napi_key = "\${${role.toUpperCase()}_API_KEY}"\n${model.baseUrl ? `base_url = ${toml(model.baseUrl)}\n` : ''}`
    })
    .join('')
  const proxy =
    '[server]\nhost = "0.0.0.0"\nport = 4000\n\n[general]\nmaster_key = "${LITER_LLM_MASTER_KEY}"\n\n[security]\noutbound_policy = "deny_private"\n' +
    models
  const proxyPath = path.join(directory, 'liter-llm-proxy.toml')
  try {
    await fs.access(proxyPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await fs.writeFile(proxyPath, proxy, { mode: 0o600 })
  }
}

export async function runManagedServiceAction(
  action: 'pull' | 'start' | 'stop' | 'restart' | 'status' | 'logs',
  config: IntegrationConfig,
  signal: AbortSignal,
  onOutput: (output: string) => void,
  onStage: (stage: IntegrationOperationStage, progress?: IntegrationOperationProgress) => void = () => {}
): Promise<string> {
  const managed = (['surrealdb', 'memory', 'liter'] as const).filter(
    (service) => config.services[service].ownership === 'managed'
  )
  if (!managed.length && action !== 'status') throw new Error('prometheus.error.externalLifecycle')
  const root = application.getPath('feature.prometheus.pack.runtime')
  if (['pull', 'start', 'restart'].includes(action)) {
    onStage('preparing')
    await prepareManagedServices(config)
  }
  const secrets = await readSecrets()
  const node = await getBinaryPath('node')
  const endpoints = {
    surrealdb: new URL('/health', config.services.surrealdb.endpoint).href,
    memory: new URL('/health', config.services.memory.endpoint).href,
    gateway: new URL('/health', config.services.liter.endpoint).href
  }
  const run = (operation: string, service?: string) =>
    runIntegrationProcess(
      node,
      [
        path.join(root, 'scripts', 'services.mjs'),
        operation,
        ...(service ? [service] : []),
        '--directory',
        serviceDirectory(),
        '--endpoints',
        JSON.stringify(endpoints),
        ...(!managed.length ? ['--external'] : [])
      ],
      { signal, onOutput, secrets: Object.values(secrets) }
    )
  if (action === 'status') {
    onStage('checking')
    return run('status')
  }
  if (!['start', 'restart'].includes(action)) {
    const results: string[] = []
    const targets = action === 'stop' ? [...managed].reverse() : managed
    onStage(action === 'pull' ? 'pulling' : action === 'stop' ? 'stopping' : 'checking', {
      current: 0,
      total: targets.length,
      unit: 'services'
    })
    for (const [index, service] of targets.entries()) {
      results.push(
        await run(action, service === 'memory' ? 'surreal-memory' : service === 'liter' ? 'liter-llm' : service)
      )
      onStage(action === 'pull' ? 'pulling' : action === 'stop' ? 'stopping' : 'checking', {
        current: index + 1,
        total: targets.length,
        unit: 'services'
      })
    }
    return results.join('\n')
  }
  if (action === 'restart') {
    onStage('restarting', { current: 0, total: managed.length, unit: 'services' })
    for (const [index, service] of [...managed].reverse().entries()) {
      await run('stop', service === 'memory' ? 'surreal-memory' : service === 'liter' ? 'liter-llm' : service)
      onStage('restarting', { current: index + 1, total: managed.length, unit: 'services' })
    }
  }
  // Compose's healthcheck is authoritative for container startup. SQL then proves authentication.
  if (config.services.surrealdb.ownership === 'managed') {
    onStage('starting', { current: 0, total: managed.length, unit: 'services' })
    await runIntegrationProcess(
      'docker',
      [
        'compose',
        '--project-name',
        'the-boss-prometheus',
        '--project-directory',
        serviceDirectory(),
        '--env-file',
        path.join(serviceDirectory(), '.env'),
        '-f',
        path.join(serviceDirectory(), 'compose.yaml'),
        'up',
        '-d',
        '--no-build',
        '--wait',
        '--wait-timeout',
        '120',
        'surrealdb'
      ],
      { signal, onOutput, secrets: Object.values(secrets) }
    )
    onStage('starting', { current: 1, total: managed.length, unit: 'services' })
  }
  if (config.services.surrealdb.ownership === 'managed' || config.services.memory.ownership === 'managed') {
    onStage('authenticating')
    const managedSecrets = await readSecrets()
    const uarProvisioning = isUarEnabled()
      ? ` DEFINE NAMESPACE IF NOT EXISTS ${config.uar.namespace}; USE NS ${config.uar.namespace}; DEFINE USER OVERWRITE ${config.uar.username} ON NAMESPACE PASSWORD ${surrealString(managedSecrets.uarPassword!)} ROLES OWNER; DEFINE DATABASE IF NOT EXISTS ${config.uar.database};`
      : ''
    await surrealSql(
      config.services.surrealdb.endpoint,
      `DEFINE NAMESPACE IF NOT EXISTS memory; USE NS memory; DEFINE USER OVERWRITE memory ON NAMESPACE PASSWORD ${surrealString(managedSecrets.memoryPassword!)} ROLES OWNER; DEFINE DATABASE IF NOT EXISTS main_local_384; DEFINE NAMESPACE IF NOT EXISTS ${config.compass.namespace}; USE NS ${config.compass.namespace}; DEFINE USER OVERWRITE ${config.compass.username} ON NAMESPACE PASSWORD ${surrealString(managedSecrets.compassPassword!)} ROLES OWNER;${uarProvisioning}`,
      { username: 'root', password: managedSecrets.rootPassword!, authLevel: 'root' },
      signal
    )
  }
  const results: string[] = []
  const dependentServices = managed.filter((service) => service !== 'surrealdb')
  for (const [index, service] of dependentServices.entries()) {
    onStage('starting', {
      current: managed.includes('surrealdb') ? index + 1 : index,
      total: managed.length,
      unit: 'services'
    })
    if (service === 'liter') {
      results.push(
        await runIntegrationProcess(
          'docker',
          [
            'compose',
            '--project-name',
            'the-boss-prometheus',
            '--project-directory',
            serviceDirectory(),
            '--env-file',
            path.join(serviceDirectory(), '.env'),
            '-f',
            path.join(serviceDirectory(), 'compose.yaml'),
            'up',
            '-d',
            '--no-build',
            '--force-recreate',
            'liter-llm'
          ],
          { signal, onOutput, secrets: Object.values(secrets) }
        )
      )
    } else {
      results.push(await run('up', 'surreal-memory'))
    }
    onStage('starting', {
      current: (managed.includes('surrealdb') ? 1 : 0) + index + 1,
      total: managed.length,
      unit: 'services'
    })
  }
  return results.join('\n')
}
