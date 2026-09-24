import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { mcpServerService } from '@data/services/McpServerService'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { McpServer } from '@shared/data/types/mcpServer'
import {
  integrationConfigSchema,
  type IntegrationAction,
  type IntegrationConfig,
  type IntegrationOperation,
  type IntegrationSecret,
  type IntegrationSnapshot,
  type WorkspaceIntegration
} from '@shared/types/prometheusIntegration'

import { commandPathInstalled, installCommandPath } from './commandPath'
import { readIntegrationConfig, readSecrets, writeSecrets } from './integrationConfig'
import { runManagedServiceAction, serviceDirectory } from './managedServices'
import { writeMiniConfiguration } from './miniCommands'
import {
  describeWorkspace,
  indexWorkspace,
  installCompassProjectSkills,
  loadWorkspaceState,
  saveWorkspaceState,
  MANAGED_TAG,
  registerWorkspaceServers,
  workspaceIdentity
} from './workspaceMcp'

@Injectable('PrometheusIntegrationService')
@ServicePhase(Phase.Background)
export class PrometheusIntegrationService extends BaseService {
  private operations = new Map<string, IntegrationOperation>()
  private controllers = new Map<string, AbortController>()
  private workspaceJobs = new Map<string, Promise<void>>()
  private workspaces = new Map<string, WorkspaceIntegration>()
  private initialization?: Promise<void>

  protected onAllReady(): void {
    this.initialization = this.initialize().catch((error) => {
      const id = randomUUID()
      this.operations.set(id, {
        id,
        action: 'repair-path',
        startedAt: Date.now(),
        status: 'failed',
        output: '',
        error: String(error)
      })
    })
  }

  private async initialize(): Promise<void> {
    await installCommandPath()
    const config = readIntegrationConfig()
    for (const workspace of agentWorkspaceService.list()) {
      const state = await loadWorkspaceState(workspace.path)
      await registerWorkspaceServers(state, config)
    }
  }

  protected async onStop(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort()
    await Promise.allSettled(this.workspaceJobs.values())
  }

  async snapshot(): Promise<IntegrationSnapshot> {
    await this.initialization
    const secrets = await readSecrets()
    let inventory: IntegrationSnapshot['inventory'] = null
    try {
      inventory = JSON.parse(
        await fs.readFile(
          path.join(application.getPath('feature.prometheus.pack.runtime'), 'release-manifest.json'),
          'utf8'
        )
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const workspace of agentWorkspaceService.list()) {
      const id = workspaceIdentity(workspace.path)
      if (!this.workspaces.has(id)) this.workspaces.set(id, await loadWorkspaceState(workspace.path))
    }
    const uarBinary = (await application.get('BinaryManager').getToolSnapshots(['uar-sidecar']))['uar-sidecar']
    const runningUar = application.get('UarSidecarService').status()
    return {
      config: readIntegrationConfig(),
      secrets: Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, Boolean(value)])),
      operations: [...this.operations.values()].slice(-20).reverse(),
      workspaces: [...this.workspaces.values()],
      commandDirectory: application.getPath('feature.prometheus.commands'),
      serviceDirectory: serviceDirectory(),
      servers: mcpServerService
        .list({})
        .items.filter((server) => server.tags?.includes(MANAGED_TAG))
        .map((server) => ({
          id: server.id,
          name: server.name,
          workspace: server.cwd,
          binary: server.command,
          status: application.get('CacheService').getShared(`mcp.status.${server.id}`)?.state ?? 'disabled'
        })),
      pathInstalled: await commandPathInstalled(),
      inventory,
      uar: {
        state: uarBinary.availability.source === 'none' ? 'unavailable' : runningUar ? 'running' : 'stopped',
        ...(uarBinary.availability.source === 'none'
          ? {}
          : {
              binary: uarBinary.availability.path,
              ...('version' in uarBinary.availability && uarBinary.availability.version
                ? { binaryVersion: uarBinary.availability.version }
                : {})
            }),
        ...(runningUar
          ? { runtimeVersion: runningUar.uarVersion, capabilities: [...runningUar.capabilities] }
          : { capabilities: [] }),
        backend: 'local'
      }
    }
  }

  async configure(
    rawConfig: IntegrationConfig,
    secretPatch: Partial<Record<IntegrationSecret, string>>
  ): Promise<IntegrationSnapshot> {
    if (this.controllers.size) throw new Error('prometheus.error.operationRunning')
    const config = integrationConfigSchema.parse(rawConfig)
    for (const root of config.filesystem.additionalRoots) {
      if (!path.isAbsolute(root) || !(await fs.stat(root)).isDirectory())
        throw new Error('prometheus.error.workspaceDirectory')
    }
    if (new Set([config.services.surrealPort, config.services.memoryPort, config.services.literPort]).size !== 3)
      throw new Error('prometheus.error.portsDistinct')
    if (config.services.mode === 'managed') {
      config.compass.endpoint = `http://127.0.0.1:${config.services.surrealPort}`
      config.compass.authLevel = 'namespace'
      config.services.memoryEndpoint = `http://127.0.0.1:${config.services.memoryPort}/mcp/sse`
      config.services.literEndpoint = `http://127.0.0.1:${config.services.literPort}`
    }
    if (Object.keys(secretPatch).length) await writeSecrets(secretPatch)
    await application.get('PreferenceService').set('app.prometheus.integrations', JSON.stringify(config))
    await writeMiniConfiguration()
    const runtime = application.get('McpRuntimeService')
    for (const server of mcpServerService.list({}).items.filter((value) => value.tags?.includes(MANAGED_TAG))) {
      await runtime.stopServer(server.id)
      mcpServerService.update(server.id, { isActive: false })
    }
    this.workspaces.clear()
    return this.snapshot()
  }

  async resolveSession(
    session: AgentSessionEntity,
    sourceAgent: AgentEntity
  ): Promise<{ agent: AgentEntity; servers: McpServer[] }> {
    await this.initialization
    const config = readIntegrationConfig()
    const workspace = await describeWorkspace(session.workspace.path, config)
    this.workspaces.set(workspace.id, workspace)
    if (config.compass.enabled && !workspace.indexed && !workspace.error) {
      try {
        await this.ensureIndex(workspace, config)
        workspace.indexed = true
      } catch (error) {
        workspace.error = error instanceof Error ? error.message : String(error)
      }
    }
    const servers = await registerWorkspaceServers(workspace, config)
    workspace.serverIds = servers.map((server) => server.id)
    await saveWorkspaceState(workspace)
    // Saved agent configuration never acquires a project-specific ID. Remove managed
    // rows accidentally selected in global settings before mounting this workspace's set.
    const manualIds = (sourceAgent.mcps ?? []).filter(
      (id) => !mcpServerService.findByIdOrName(id)?.tags?.includes(MANAGED_TAG)
    )
    return { agent: { ...sourceAgent, mcps: [...manualIds, ...workspace.serverIds] }, servers }
  }

  private ensureIndex(workspace: WorkspaceIntegration, config: IntegrationConfig): Promise<void> {
    const existing = this.workspaceJobs.get(workspace.id)
    if (existing) return existing
    const job = this.runOperation('index', workspace.path, async (signal, output) => {
      await indexWorkspace(workspace, config, signal, output)
    }).completion.finally(() => this.workspaceJobs.delete(workspace.id))
    this.workspaceJobs.set(workspace.id, job)
    return job
  }

  start(action: IntegrationAction, workspacePath?: string): IntegrationOperation {
    if (this.controllers.size && !['status', 'logs', 'diagnose'].includes(action))
      throw new Error('prometheus.error.operationRunning')
    return this.runOperation(action, workspacePath, async (signal, output, operation) => {
      const config = readIntegrationConfig()
      if (action === 'repair-path') {
        await installCommandPath()
        return
      }
      if (action === 'uar-check' || action === 'uar-restart') {
        const sidecar =
          action === 'uar-restart'
            ? await application.get('UarSidecarService').restart()
            : await application.get('UarSidecarService').ensureReady()
        operation.diagnostics = [
          { id: 'uar.binary', state: 'operational' },
          { id: 'uar.process', state: 'listening', detail: sidecar.uarVersion },
          { id: 'uar.capabilities', state: 'operational', detail: sidecar.capabilities.join(', ') },
          { id: 'uar.storage', state: 'operational', detail: 'settings.prometheus.integration.uarBackendLocal' }
        ]
        return
      }
      if (['pull', 'start', 'stop', 'restart', 'status', 'logs'].includes(action)) {
        const result = await runManagedServiceAction(action as 'start', config, signal, output)
        if (action === 'status') {
          const status = JSON.parse(result) as {
            docker: { state: string; compose: boolean; detail?: string }
            endpoints: Record<string, { reached: boolean; status?: number; detail?: string }>
          }
          operation.diagnostics = [
            { id: 'Docker CLI', state: status.docker.state === 'absent' ? 'failed' : 'operational' },
            {
              id: 'Docker daemon',
              state: status.docker.state === 'running' ? 'operational' : 'failed',
              detail: status.docker.detail
            },
            { id: 'Docker Compose', state: status.docker.compose ? 'operational' : 'failed' },
            ...Object.entries(status.endpoints).map(([id, endpoint]) => ({
              id,
              state: endpoint.reached ? ('listening' as const) : ('failed' as const),
              detail: endpoint.detail
            }))
          ]
        }
        output(result)
        return
      }
      if (!workspacePath || !path.isAbsolute(workspacePath) || !(await fs.stat(workspacePath)).isDirectory())
        throw new Error('prometheus.error.workspaceDirectory')
      const workspace = await describeWorkspace(await fs.realpath(workspacePath), config)
      this.workspaces.set(workspace.id, workspace)
      if (action === 'install-skills') {
        output(await installCompassProjectSkills(workspace.path, signal, output))
        return
      }
      if (action === 'diagnose') {
        const { runIntegrationDiagnostics } = await import('./integrationDiagnostics')
        operation.diagnostics = await runIntegrationDiagnostics(workspace, config, signal)
        if (operation.diagnostics.some((result) => result.state === 'failed'))
          throw new Error('prometheus.error.toolOperation')
        return
      }
      await indexWorkspace(workspace, config, signal, output)
      workspace.indexed = true
      const servers = await registerWorkspaceServers(workspace, config)
      workspace.serverIds = servers.map((server) => server.id)
      await saveWorkspaceState(workspace)
      for (const server of servers) await application.get('McpRuntimeService').stopServer(server.id)
    }).operation
  }

  cancel(id: string): void {
    this.controllers.get(id)?.abort()
  }

  private runOperation(
    action: IntegrationAction,
    workspacePath: string | undefined,
    execute: (signal: AbortSignal, output: (value: string) => void, operation: IntegrationOperation) => Promise<void>
  ): { operation: IntegrationOperation; completion: Promise<void> } {
    const id = randomUUID()
    const operation: IntegrationOperation = {
      id,
      action,
      workspacePath,
      status: 'running',
      output: '',
      startedAt: Date.now()
    }
    const controller = new AbortController()
    this.operations.set(id, operation)
    this.controllers.set(id, controller)
    const completion = execute(
      controller.signal,
      (value) => {
        operation.output = value.slice(-262144)
      },
      operation
    )
      .then(
        () => {
          operation.status = 'done'
        },
        (error: unknown) => {
          operation.status = controller.signal.aborted ? 'cancelled' : 'failed'
          operation.error = error instanceof Error ? error.message : String(error)
          if (workspacePath) {
            const workspace = this.workspaces.get(workspaceIdentity(workspacePath))
            if (workspace) workspace.error = operation.error
          }
          throw error
        }
      )
      .finally(() => this.controllers.delete(id))
    // IPC starts an operation without blocking. Awaiting callers still receive failures.
    void completion.catch(() => {})
    return { operation, completion }
  }
}
