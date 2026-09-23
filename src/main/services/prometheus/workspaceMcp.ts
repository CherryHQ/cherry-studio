import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { getBinaryPath } from '@main/utils/binaryResolver'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { IntegrationConfig, WorkspaceIntegration } from '@shared/types/prometheusIntegration'
import { integrationDirectory, readIntegrationConfig, readSecrets } from './integrationConfig'
import { runIntegrationProcess } from './integrationProcess'
import { compassEnvironment, compassRemoteReady } from './surrealConnection'
import { copyOwnedSkill } from './ownedSkillCopy'
import { detectFullPack } from './fullPackDetection'
import { renderMiniSkill } from './miniCommands'

export const MANAGED_TAG = 'the-boss:workspace-managed'
export function workspaceIdentity(workspace: string): string {
  const normalized = path.resolve(workspace)
  return createHash('sha256').update(process.platform === 'win32' ? normalized.toLowerCase() : normalized).digest('hex').slice(0,16)
}
export const workspaceDirectory = (id: string) => path.join(integrationDirectory(), 'workspaces', id)
export const workspaceDatabase = (id: string) => `workspace_${id}`
const exists = async (filename: string) => fs.access(filename).then(() => true, () => false)

function projectionProfile(config: IntegrationConfig, backend: WorkspaceIntegration['backend']): string {
  const { endpoint, namespace, username, authLevel } = config.compass
  return JSON.stringify(backend === 'remote' ? { backend, endpoint, namespace, username, authLevel } : { backend })
}

async function matchesProjection(output: string, profile: string): Promise<boolean> {
  try { return await fs.readFile(path.join(output, 'boss-projection.json'), 'utf8') === profile } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

async function hasProjection(graph: string, backend: WorkspaceIntegration['backend']): Promise<boolean> {
  const output = path.dirname(graph)
  let snapshot = output
  try {
    const pointer = (await fs.readFile(path.join(output, 'current-snapshot'), 'utf8')).trim()
    const snapshots = path.join(output, 'snapshots')
    snapshot = path.resolve(snapshots, pointer)
    if (!snapshot.startsWith(snapshots + path.sep)) return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return await exists(path.join(snapshot, 'graph.json')) && (backend === 'json' || await exists(path.join(snapshot, backend === 'remote' ? 'surreal.ref' : 'store.ref')))
}

export async function saveWorkspaceState(workspace: WorkspaceIntegration): Promise<void> {
  const directory = workspaceDirectory(workspace.id)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'workspace.json'), JSON.stringify(workspace,null,2) + '\n')
}

export async function loadWorkspaceState(workspace: string): Promise<WorkspaceIntegration> {
  const id = workspaceIdentity(workspace)
  try { return JSON.parse(await fs.readFile(path.join(workspaceDirectory(id), 'workspace.json'), 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const graph = path.join(workspaceDirectory(id), 'local', 'graph.json')
    return { path: workspace, id, graph, backend: 'sqlite', serverIds: [], indexed: await exists(graph) }
  }
}

export async function describeWorkspace(workspace: string, config = readIntegrationConfig()): Promise<WorkspaceIntegration> {
  const id = workspaceIdentity(workspace)
  const remote = ['automatic','remote'].includes(config.compass.storage) && await compassRemoteReady(config, workspaceDatabase(id))
  if (config.compass.storage === 'remote' && !remote) {
    return { path: workspace, id, graph: path.join(workspaceDirectory(id),'remote','graph.json'), backend: 'remote', serverIds: [], indexed: false, error: 'prometheus.error.remoteUnavailable' }
  }
  const backend = remote ? 'remote' : config.compass.storage === 'json' ? 'json' : 'sqlite'
  const graph = path.join(workspaceDirectory(id), remote ? 'remote' : 'local', 'graph.json')
  const indexed = await matchesProjection(path.dirname(graph), projectionProfile(config, backend)) && await hasProjection(graph, backend)
  return { path: workspace, id, graph, backend, serverIds: [], indexed }
}

function upsertManagedServer(key: string, definition: CreateMcpServerDto): McpServer {
  const existing = mcpServerService.list({}).items.find((server) => server.tags?.includes(MANAGED_TAG) && server.reference === key)
  const dto = { ...definition, reference: key, tags: [MANAGED_TAG], installSource: 'builtin' as const }
  if (!existing) return mcpServerService.create(dto)
  const changed = Object.entries(dto).some(([key, value]) => JSON.stringify(existing[key as keyof McpServer]) !== JSON.stringify(value))
  return changed ? mcpServerService.update(existing.id, dto) : existing
}

export async function registerWorkspaceServers(workspace: WorkspaceIntegration, config: IntegrationConfig): Promise<McpServer[]> {
  const suffix = `${path.basename(workspace.path) || 'workspace'}-${workspace.id.slice(0,8)}`
  const servers: McpServer[] = []
  if (config.compass.enabled) {
    const command = await getBinaryPath('compass')
    const server = upsertManagedServer(`compass:${workspace.id}`, {
      name: `Compass · ${suffix}`, type: 'stdio', command, cwd: workspace.path,
      args: ['serve', '--graph', workspace.graph, '--engine', workspace.backend === 'remote' ? 'surreal' : workspace.backend === 'sqlite' ? 'store' : 'json'],
      isActive: !workspace.error, env: { BOSS_COMPASS_WORKSPACE: workspace.id },
      shouldConfig: Boolean(workspace.error), description: workspace.error ?? workspace.path
    })
    if (!workspace.error) servers.push(server)
  }
  if (config.filesystem.enabled) {
    const roots = await Promise.all([workspace.path,...config.filesystem.additionalRoots].map((root) => fs.realpath(root)))
    servers.push(upsertManagedServer(`filesystem:${workspace.id}`, {
      name: `Rust Filesystem · ${suffix}`, type: 'stdio', cwd: workspace.path,
      command: await getBinaryPath('rust-mcp-filesystem'),
      args: [...(config.filesystem.allowWrite ? ['--allow-write'] : []), '--', ...new Set(roots)],
      env: { ALLOW_WRITE: config.filesystem.allowWrite ? 'true' : 'false', ENABLE_ROOTS: 'false' },
      isActive: true, description: roots.join('\n')
    }))
  }
  if (config.services.memoryEnabled) servers.push(upsertManagedServer('surreal-memory', {
    name: 'Surreal Memory (managed)', type: 'sse', baseUrl: config.services.memoryEndpoint, isActive: true
  }))
  return servers
}

export async function indexWorkspace(workspace: WorkspaceIntegration, config: IntegrationConfig, signal: AbortSignal, onOutput: (value: string) => void): Promise<void> {
  if (workspace.error) throw new Error(workspace.error)
  const local = path.join(workspaceDirectory(workspace.id), 'local')
  const remote = path.join(workspaceDirectory(workspace.id), 'remote')
  const binary = await getBinaryPath('compass')
  await fs.mkdir(local, { recursive: true })
  const secrets = await readSecrets()
  const run = (out: string, store: string, env: Record<string,string> = {}, extra: string[] = []) => runIntegrationProcess(binary,
    ['update', workspace.path, '--code-only', '--out', out, '--store', store, '--no-viz', ...extra],
    { cwd: workspace.path, signal, env, onOutput, secrets: Object.values(secrets) })
  await run(local, workspace.backend === 'json' ? 'json' : 'sqlite', { COMPASS_STORE: workspace.backend === 'json' ? 'json' : 'sqlite' })
  await fs.writeFile(path.join(local, 'boss-projection.json'), projectionProfile(config, workspace.backend === 'json' ? 'json' : 'sqlite'))
  if (workspace.backend === 'remote') {
    // Preserve the complete local graph and SQLite snapshot. The projection reuses
    // Compass's extraction cache; a remote outage never removes the local graph.
    await fs.cp(local, remote, { recursive: true, force: true })
    await run(remote, 'surreal', await compassEnvironment(config, workspaceDatabase(workspace.id)), ['--force','--reuse-cache-on-force'])
    await fs.writeFile(path.join(remote, 'boss-projection.json'), projectionProfile(config, 'remote'))
  }
}

// Transport-only secret materialization: never persist these in MCP rows or return
// them to settings. Session signatures still contain the non-secret workspace identity.
export async function materializeManagedServer(server: McpServer): Promise<McpServer> {
  if (!server.tags?.includes(MANAGED_TAG)) return server
  const config = readIntegrationConfig()
  if (server.reference?.startsWith('compass:') && server.args?.includes('surreal')) {
    const id = server.reference.slice('compass:'.length)
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('prometheus.error.workspaceIdentity')
    const binary = await getBinaryPath('compass')
    if (server.command !== binary || server.args[0] !== 'serve' || !server.cwd || workspaceIdentity(server.cwd) !== id) {
      throw new Error('prometheus.error.managedDefinition')
    }
    return { ...server, env: { ...server.env, ...await compassEnvironment(config, workspaceDatabase(id)) } }
  }
  if (server.reference === 'surreal-memory') {
    if (server.baseUrl !== config.services.memoryEndpoint || server.type !== 'sse' || server.command) throw new Error('prometheus.error.managedDefinition')
    const { memoryToken } = await readSecrets()
    return { ...server, headers: memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {} }
  }
  return server
}

export async function installCompassProjectSkills(workspacePath: string, signal: AbortSignal, onOutput: (value: string) => void): Promise<string> {
  const binary = await getBinaryPath('compass')
  let installed = 0
  const fullPack = await detectFullPack()
  if (!fullPack.present) {
    const source = path.join(application.getPath('feature.prometheus.pack.runtime'), 'skills')
    for (const skill of await fs.readdir(source, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue
      for (const harness of ['.agents', '.claude']) {
        signal.throwIfAborted()
        if (await copyOwnedSkill(path.join(source,skill.name), path.join(workspacePath,harness,'skills',skill.name), renderMiniSkill)) installed++
      }
    }
  }
  const compass = await runIntegrationProcess(binary, ['install','--project','--platform','agents','--platform','claude','--format','json'], { cwd: workspacePath, signal, onOutput })
  return JSON.stringify({ miniSkillCopies: installed, fullPackPreserved: fullPack.present, compass })
}
