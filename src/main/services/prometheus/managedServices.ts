import fs from 'node:fs/promises'
import path from 'node:path'
import { application } from '@application'
import { getBinaryPath } from '@main/utils/binaryResolver'
import type { IntegrationConfig } from '@shared/types/prometheusIntegration'
import { ensureManagedSecrets, integrationDirectory, readSecrets } from './integrationConfig'
import { runIntegrationProcess } from './integrationProcess'
import { surrealSql } from './surrealConnection'
import { writeMiniConfiguration } from './miniCommands'

export const serviceDirectory = () => path.join(integrationDirectory(), 'services')
const toml = (value: string) => JSON.stringify(value)
// Compose interpolation is disabled for single-quoted dotenv values.
const dotenv = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n')}'`

export async function prepareManagedServices(config: IntegrationConfig): Promise<void> {
  const root = application.getPath('feature.prometheus.pack.runtime')
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'release-manifest.json'), 'utf8')) as { images: Record<string, string> }
  const secrets = await ensureManagedSecrets()
  await writeMiniConfiguration()
  const directory = serviceDirectory()
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await fs.copyFile(path.join(root, 'docker', 'compose.yaml'), path.join(directory, 'compose.yaml'))
  const values = {
    SURREAL_ROOT_USERNAME: 'root', SURREAL_ROOT_PASSWORD: secrets.rootPassword!,
    MEMORY_USERNAME: 'memory', MEMORY_PASSWORD: secrets.memoryPassword!,
    COMPASS_USERNAME: config.compass.username, COMPASS_PASSWORD: secrets.compassPassword!,
    LITER_LLM_MASTER_KEY: secrets.literKey!, JUDGE_API_KEY: secrets.judgeKey ?? '', CRITIC_API_KEY: secrets.criticKey ?? '',
    SURREAL_MEMORY_IMAGE: manifest.images['surreal-memory'], LITER_LLM_IMAGE: manifest.images['liter-llm'],
    SURREAL_PORT: String(config.services.surrealPort), MEMORY_PORT: String(config.services.memoryPort), LITER_PORT: String(config.services.literPort)
  }
  for (const image of [values.SURREAL_MEMORY_IMAGE, values.LITER_LLM_IMAGE]) {
    if (!image || !/@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('prometheus.error.imageManifest')
  }
  await fs.writeFile(path.join(directory, '.env'), Object.entries(values).map(([key, value]) => `${key}=${dotenv(value)}`).join('\n') + '\n', { mode: 0o600 })
  const models = (['judge', 'critic'] as const).filter((role) => config.services[role].name).map((role) => {
    const model = config.services[role]
    return `\n[[models]]\nname = "kbd-${role}"\nprovider_model = ${toml(model.name)}\napi_key = "\${${role.toUpperCase()}_API_KEY}"\n${model.baseUrl ? `base_url = ${toml(model.baseUrl)}\n` : ''}`
  }).join('')
  const proxy = '[server]\nhost = "0.0.0.0"\nport = 4000\n\n[general]\nmaster_key = "${LITER_LLM_MASTER_KEY}"\n\n[security]\noutbound_policy = "deny_private"\n' + models
  await fs.writeFile(path.join(directory, 'liter-llm-proxy.toml'), proxy, { mode: 0o600 })
}

export async function runManagedServiceAction(action: 'pull' | 'start' | 'stop' | 'restart' | 'status' | 'logs', config: IntegrationConfig, signal: AbortSignal, onOutput: (output: string) => void): Promise<string> {
  if (config.services.mode === 'external' && !['status'].includes(action)) throw new Error('prometheus.error.externalLifecycle')
  const root = application.getPath('feature.prometheus.pack.runtime')
  if (['pull', 'start', 'restart'].includes(action)) await prepareManagedServices(config)
  const secrets = await readSecrets()
  const node = await getBinaryPath('node')
  const endpoints = { surrealdb: new URL('/health', config.compass.endpoint).href,
    memory: new URL('/health', config.services.memoryEndpoint).href,
    gateway: new URL('/health', config.services.literEndpoint).href }
  const run = (operation: string, service?: string) => runIntegrationProcess(node,
    [path.join(root, 'scripts', 'services.mjs'), operation, ...(service ? [service] : []), '--directory', serviceDirectory(),
      '--endpoints', JSON.stringify(endpoints), ...(config.services.mode === 'external' ? ['--external'] : [])],
    { signal, onOutput, secrets: Object.values(secrets) })
  if (action === 'status') return run('status')
  if (!['start', 'restart'].includes(action)) return run(action)
  if (action === 'restart') await run('stop')
  // Compose's healthcheck is authoritative for container startup. SQL then proves authentication.
  await runIntegrationProcess('docker', ['compose', '--project-name', 'the-boss-prometheus', '--project-directory', serviceDirectory(), '--env-file', path.join(serviceDirectory(), '.env'), '-f', path.join(serviceDirectory(), 'compose.yaml'), 'up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'surrealdb'], { signal, onOutput, secrets: Object.values(secrets) })
  const managedSecrets = await readSecrets()
  await surrealSql(`http://127.0.0.1:${config.services.surrealPort}`,
    `DEFINE NAMESPACE IF NOT EXISTS memory; USE NS memory; DEFINE USER OVERWRITE memory ON NAMESPACE PASSWORD $memoryPassword ROLES OWNER; DEFINE DATABASE IF NOT EXISTS main_local_384; DEFINE NAMESPACE IF NOT EXISTS ${config.compass.namespace}; USE NS ${config.compass.namespace}; DEFINE USER OVERWRITE ${config.compass.username} ON NAMESPACE PASSWORD $compassPassword ROLES OWNER;`,
    { username: 'root', password: managedSecrets.rootPassword!, authLevel: 'root' }, signal,
    { memoryPassword: managedSecrets.memoryPassword!, compassPassword: managedSecrets.compassPassword! })
  return run('up')
}
