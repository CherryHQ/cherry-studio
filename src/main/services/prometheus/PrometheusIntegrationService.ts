import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { readAppliedUarStorage, readUarModelSources, type UarSidecarEndpoint } from '@main/ai/runtime/uar'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { installPrometheusPack } from '@main/utils/prometheusPack'
import { assertUarEnabled, isUarEnabled, UAR_FEATURE_DISABLED_ERROR } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { McpServer } from '@shared/data/types/mcpServer'
import type {
  LiterAliasMutation,
  LiterConnectionMutation,
  LiterGatewayCatalogSnapshot,
  LiterGatewaySelection
} from '@shared/types/literGateway'
import type { LiterRoleMutation, LiterRoleSnapshot } from '@shared/types/literRoles'
import {
  integrationConfigSchema,
  secretNames,
  type IntegrationAction,
  type IntegrationConfig,
  type IntegrationOperation,
  type IntegrationOperationEventPage,
  type IntegrationOperationLogExport,
  type IntegrationOperationLogPage,
  type IntegrationSecretPatch,
  type ServiceDiscovery,
  type IntegrationSnapshot,
  type IntegrationUpdate,
  type WorkspaceIntegration
} from '@shared/types/prometheusIntegration'

import { commandPathInstalled, installCommandPath } from './commandPath'
import {
  migrateIntegrationDocument,
  readIntegrationConfig,
  readIntegrationDocument,
  stageLiterConnectionCredential,
  readSecrets,
  writeIntegrationDocument,
  writeSecrets
} from './integrationConfig'
import { StaleIntegrationRevisionError } from './integrationErrors'
import { IntegrationOperationRunner, type IntegrationOperationControls } from './integrationOperationRunner'
import { fetchLiterLiveModels, reconcileLiterCatalog, type LiterLiveModel } from './literGatewayCatalog'
import { runManagedServiceAction, serviceDirectory } from './managedServices'
import { writeMiniConfiguration } from './miniCommands'
import { discoverServiceCandidates } from './serviceDiscovery'
import { surrealSql } from './surrealConnection'
import {
  checkWorkspaceFreshness,
  describeWorkspace,
  indexWorkspace,
  installCompassProjectSkills,
  loadWorkspaceState,
  saveWorkspaceState,
  MANAGED_TAG,
  registerWorkspaceServers,
  workspaceIdentity
} from './workspaceMcp'

const logger = loggerService.withContext('PrometheusIntegrationService')

@Injectable('PrometheusIntegrationService')
@ServicePhase(Phase.Background)
export class PrometheusIntegrationService extends BaseService {
  private readonly operationRunner = new IntegrationOperationRunner()
  private workspaceJobs = new Map<string, Promise<void>>()
  private workspaces = new Map<string, WorkspaceIntegration>()
  private initialization?: Promise<void>
  private configurationMutation: Promise<void> = Promise.resolve()
  private serviceDiscovery: ServiceDiscovery = { candidates: [], errors: [] }
  private lastUarApplyError?: string
  private literLiveModels?: LiterLiveModel[]
  private literLiveError?: string

  protected onAllReady(): void {
    void this.ensureInitialized().catch(() => undefined)
  }

  private ensureInitialized(): Promise<void> {
    this.initialization ??= this.initialize().catch(async (error) => {
      logger.error('Integration initialization failed', error)
      await this.operationRunner.recordInitializationFailure(error)
      throw error
    })
    return this.initialization
  }

  private async initialize(): Promise<void> {
    await this.operationRunner.initialize()
    await installPrometheusPack()
    await migrateIntegrationDocument()
    await installCommandPath()
    const config = readIntegrationConfig()
    this.serviceDiscovery = await discoverServiceCandidates(config)
    for (const workspace of agentWorkspaceService.list()) {
      const state = await loadWorkspaceState(workspace.path)
      await registerWorkspaceServers(state, config)
    }
  }

  protected async onStop(): Promise<void> {
    await this.operationRunner.stop()
  }

  async snapshot(): Promise<IntegrationSnapshot> {
    await this.ensureInitialized()
    const document = readIntegrationDocument()
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
    let uar: IntegrationSnapshot['uar']
    if (isUarEnabled()) {
      const uarBinary = (await application.get('BinaryManager').getToolSnapshots(['uar-sidecar']))['uar-sidecar']
      const runningUar = application.get('UarSidecarService').status()
      const uarBinaryOverride = process.env.THE_BOSS_UAR_SIDECAR_PATH?.trim()
      const uarBinaryPath =
        uarBinaryOverride || (uarBinary.availability.source === 'none' ? undefined : uarBinary.availability.path)
      const appliedUar = runningUar?.storage ?? (await readAppliedUarStorage())
      uar = {
        state: runningUar ? 'running' : uarBinaryPath ? 'stopped' : 'unavailable',
        ...(!uarBinaryPath
          ? {}
          : {
              binary: uarBinaryPath,
              ...('version' in uarBinary.availability && uarBinary.availability.version
                ? { binaryVersion: uarBinary.availability.version }
                : {})
            }),
        ...(runningUar
          ? { runtimeVersion: runningUar.uarVersion, capabilities: [...runningUar.capabilities] }
          : { capabilities: [] }),
        requestedBackend: document.config.uar.backend,
        effectiveBackend: appliedUar.profile.backend,
        requestedRevision: document.revisions.uar,
        effectiveRevision: appliedUar.revision,
        applyRequired: document.revisions.uar !== appliedUar.revision,
        ...(appliedUar.profile.backend === 'remote'
          ? {
              endpoint: appliedUar.profile.endpoint,
              namespace: appliedUar.profile.namespace,
              database: appliedUar.profile.database,
              authLevel: appliedUar.profile.authLevel
            }
          : {}),
        ...(this.lastUarApplyError ? { lastApplyError: this.lastUarApplyError } : {})
      }
    } else {
      uar = {
        state: 'unavailable',
        capabilities: [],
        requestedBackend: document.config.uar.backend,
        effectiveBackend: document.config.uar.backend,
        requestedRevision: document.revisions.uar,
        effectiveRevision: document.revisions.uar,
        applyRequired: false,
        lastApplyError: UAR_FEATURE_DISABLED_ERROR
      }
    }
    return {
      config: document.config,
      schemaVersion: document.schemaVersion,
      revisions: document.revisions,
      secrets: Object.fromEntries(
        secretNames.filter((key) => key !== 'uarPassword' || isUarEnabled()).map((key) => [key, Boolean(secrets[key])])
      ),
      operations: this.operationRunner
        .list()
        .filter((operation) => isUarEnabled() || !operation.action.startsWith('uar-'))
        .slice(0, 20),
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
      serviceDiscovery: this.serviceDiscovery,
      uar
    }
  }

  async configure(updates: IntegrationUpdate[], secretPatch: IntegrationSecretPatch): Promise<IntegrationSnapshot> {
    if (
      !isUarEnabled() &&
      (updates.some((update) => update.feature === 'uar') ||
        (secretPatch.uarPassword && secretPatch.uarPassword.operation !== 'unchanged'))
    ) {
      assertUarEnabled()
    }
    await this.ensureInitialized()
    return this.serializeConfigurationMutation(() => this.applyConfiguration(updates, secretPatch))
  }

  private serializeConfigurationMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.configurationMutation.then(mutation)
    this.configurationMutation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async readLiterCatalog(refresh = false): Promise<LiterGatewayCatalogSnapshot> {
    await this.ensureInitialized()
    const document = readIntegrationDocument()
    if (refresh || !this.literLiveModels) {
      try {
        this.literLiveModels = await fetchLiterLiveModels(document.config)
        this.literLiveError = undefined
      } catch (error) {
        this.literLiveModels = []
        this.literLiveError = error instanceof Error ? error.message : String(error)
      }
    }
    return reconcileLiterCatalog(
      document.config,
      document.revisions.services,
      this.serviceDiscovery,
      this.literLiveModels,
      this.literLiveError
    )
  }

  async readLiterRoles(): Promise<LiterRoleSnapshot> {
    await this.ensureInitialized()
    const document = readIntegrationDocument()
    return {
      revision: document.revisions.services,
      ...(document.config.services.literRoles ? { assignments: document.config.services.literRoles } : {})
    }
  }

  async saveLiterRoles(mutation: LiterRoleMutation): Promise<LiterRoleSnapshot> {
    await this.ensureInitialized()
    return this.serializeConfigurationMutation(async () => {
      const document = readIntegrationDocument()
      if (document.revisions.services !== mutation.expectedRevision) {
        throw new StaleIntegrationRevisionError('services', mutation.expectedRevision, document.revisions.services)
      }
      const config = integrationConfigSchema.parse({
        ...document.config,
        services: { ...document.config.services, literRoles: mutation.assignments }
      })
      await writeIntegrationDocument({
        schemaVersion: 4,
        revisions: { ...document.revisions, services: document.revisions.services + 1 },
        config
      })
      await writeMiniConfiguration()
      if (isUarEnabled()) await readUarModelSources()
      return { revision: document.revisions.services + 1, assignments: mutation.assignments }
    })
  }

  async selectLiterGateway(selection: LiterGatewaySelection): Promise<LiterGatewayCatalogSnapshot> {
    await this.ensureInitialized()
    return this.serializeConfigurationMutation(async () => {
      const document = readIntegrationDocument()
      if (document.revisions.services !== selection.expectedRevision) {
        throw new StaleIntegrationRevisionError('services', selection.expectedRevision, document.revisions.services)
      }
      let profile: IntegrationConfig['services']['liter']
      if (selection.kind === 'manual') {
        profile = { ownership: 'external', source: 'manual', endpoint: selection.endpoint }
      } else {
        const candidate = this.serviceDiscovery.candidates.find(
          (entry) =>
            entry.id === selection.candidateId &&
            entry.service === 'liter' &&
            entry.provenance.some(
              (provenance) => provenance.source === selection.source && provenance.ownership === selection.ownership
            )
        )
        if (!candidate) throw new Error('prometheus.error.gatewayCandidateUnavailable')
        profile = { ownership: selection.ownership, source: selection.source, endpoint: candidate.endpoint }
      }
      const config = integrationConfigSchema.parse({
        ...document.config,
        services: { ...document.config.services, liter: profile }
      })
      await writeIntegrationDocument({
        schemaVersion: 4,
        revisions: { ...document.revisions, services: document.revisions.services + 1 },
        config
      })
      await writeMiniConfiguration()
      this.serviceDiscovery = await discoverServiceCandidates(config)
      this.literLiveModels = undefined
      this.literLiveError = undefined
      return this.readLiterCatalog(true)
    })
  }

  async saveLiterConnection(mutation: LiterConnectionMutation): Promise<LiterGatewayCatalogSnapshot> {
    await this.ensureInitialized()
    return this.serializeConfigurationMutation(async () => {
      const document = readIntegrationDocument()
      if (document.revisions.services !== mutation.expectedRevision) {
        throw new StaleIntegrationRevisionError('services', mutation.expectedRevision, document.revisions.services)
      }
      const connections = [...document.config.services.literConnections]
      const index = connections.findIndex(
        (connection) => connection.providerConnectionId === mutation.connection.providerConnectionId
      )
      if (mutation.mode === 'create' && index !== -1) throw new Error('prometheus.error.literConnectionExists')
      if (mutation.mode === 'update' && index === -1) throw new Error('prometheus.error.literConnectionMissing')
      if (index === -1) connections.push(mutation.connection)
      else connections[index] = mutation.connection
      const config = integrationConfigSchema.parse({
        ...document.config,
        services: { ...document.config.services, literConnections: connections }
      })
      const rollbackCredential = await stageLiterConnectionCredential(
        mutation.connection.providerConnectionId,
        mutation.credential
      )
      try {
        await writeIntegrationDocument({
          schemaVersion: 4,
          revisions: { ...document.revisions, services: document.revisions.services + 1 },
          config
        })
      } catch (error) {
        await rollbackCredential()
        throw error
      }
      return this.readLiterCatalog(false)
    })
  }

  async deleteLiterConnection(
    providerConnectionId: string,
    expectedRevision: number
  ): Promise<LiterGatewayCatalogSnapshot> {
    await this.ensureInitialized()
    return this.serializeConfigurationMutation(async () => {
      const document = readIntegrationDocument()
      if (document.revisions.services !== expectedRevision) {
        throw new StaleIntegrationRevisionError('services', expectedRevision, document.revisions.services)
      }
      if (
        document.config.services.literAliases.some(
          (alias) => alias.target.providerConnectionId === providerConnectionId
        )
      ) {
        throw new Error('prometheus.error.literConnectionInUse')
      }
      const connections = document.config.services.literConnections.filter(
        (connection) => connection.providerConnectionId !== providerConnectionId
      )
      if (connections.length === document.config.services.literConnections.length) {
        throw new Error('prometheus.error.literConnectionMissing')
      }
      const config = integrationConfigSchema.parse({
        ...document.config,
        services: { ...document.config.services, literConnections: connections }
      })
      const rollbackCredential = await stageLiterConnectionCredential(providerConnectionId, { operation: 'clear' })
      try {
        await writeIntegrationDocument({
          schemaVersion: 4,
          revisions: { ...document.revisions, services: document.revisions.services + 1 },
          config
        })
      } catch (error) {
        await rollbackCredential()
        throw error
      }
      return this.readLiterCatalog(false)
    })
  }

  async saveLiterAlias(mutation: LiterAliasMutation): Promise<LiterGatewayCatalogSnapshot> {
    await this.ensureInitialized()
    return this.serializeConfigurationMutation(async () => {
      const document = readIntegrationDocument()
      if (document.revisions.services !== mutation.expectedRevision) {
        throw new StaleIntegrationRevisionError('services', mutation.expectedRevision, document.revisions.services)
      }
      const aliases = [...document.config.services.literAliases]
      const index = aliases.findIndex(
        (alias) =>
          alias.gatewayConnectionId === mutation.alias.gatewayConnectionId && alias.alias === mutation.alias.alias
      )
      if (mutation.mode === 'create' && index !== -1) throw new Error('prometheus.error.literAliasExists')
      if (mutation.mode === 'update' && index === -1) throw new Error('prometheus.error.literAliasMissing')
      if (index === -1) aliases.push(mutation.alias)
      else aliases[index] = mutation.alias
      const config = integrationConfigSchema.parse({
        ...document.config,
        services: { ...document.config.services, literAliases: aliases }
      })
      await writeIntegrationDocument({
        schemaVersion: 4,
        revisions: { ...document.revisions, services: document.revisions.services + 1 },
        config
      })
      return this.readLiterCatalog(false)
    })
  }

  async deleteLiterAlias(
    gatewayConnectionId: string,
    alias: string,
    expectedRevision: number
  ): Promise<LiterGatewayCatalogSnapshot> {
    await this.ensureInitialized()
    return this.serializeConfigurationMutation(async () => {
      const document = readIntegrationDocument()
      if (document.revisions.services !== expectedRevision) {
        throw new StaleIntegrationRevisionError('services', expectedRevision, document.revisions.services)
      }
      const aliases = document.config.services.literAliases.filter(
        (entry) => entry.gatewayConnectionId !== gatewayConnectionId || entry.alias !== alias
      )
      if (aliases.length === document.config.services.literAliases.length) {
        throw new Error('prometheus.error.literAliasMissing')
      }
      const config = integrationConfigSchema.parse({
        ...document.config,
        services: { ...document.config.services, literAliases: aliases }
      })
      await writeIntegrationDocument({
        schemaVersion: 4,
        revisions: { ...document.revisions, services: document.revisions.services + 1 },
        config
      })
      return this.readLiterCatalog(false)
    })
  }

  private async applyConfiguration(
    updates: IntegrationUpdate[],
    secretPatch: IntegrationSecretPatch
  ): Promise<IntegrationSnapshot> {
    const document = readIntegrationDocument()
    const features = new Set(updates.map((update) => update.feature))
    if (features.size !== updates.length) throw new Error('prometheus.error.duplicateIntegrationUpdate')
    for (const update of updates) {
      const current = document.revisions[update.feature]
      if (current !== update.expectedRevision) {
        throw new StaleIntegrationRevisionError(update.feature, update.expectedRevision, current)
      }
    }
    const candidate = { ...document.config }
    for (const update of updates) {
      if (update.feature === 'compass') candidate.compass = update.value
      if (update.feature === 'filesystem') candidate.filesystem = update.value
      if (update.feature === 'uar') candidate.uar = update.value
      if (update.feature === 'services') candidate.services = update.value
    }
    const config = integrationConfigSchema.parse(candidate)
    for (const root of config.filesystem.additionalRoots) {
      if (!path.isAbsolute(root) || !(await fs.stat(root)).isDirectory())
        throw new Error('prometheus.error.workspaceDirectory')
    }
    if (new Set([config.services.surrealPort, config.services.memoryPort, config.services.literPort]).size !== 3)
      throw new Error('prometheus.error.portsDistinct')
    if (config.services.surrealdb.ownership === 'managed') {
      config.services.surrealdb.endpoint = `http://127.0.0.1:${config.services.surrealPort}`
      config.compass.authLevel = 'namespace'
      if (isUarEnabled() && config.uar.backend === 'remote') {
        config.uar.endpoint = config.services.surrealdb.endpoint
        config.uar.authLevel = 'namespace'
      }
    }
    if (config.services.memory.ownership === 'managed')
      config.services.memory.endpoint = `http://127.0.0.1:${config.services.memoryPort}/mcp/sse`
    if (config.services.liter.ownership === 'managed')
      config.services.liter.endpoint = `http://127.0.0.1:${config.services.literPort}`
    config.compass.endpoint = config.services.surrealdb.endpoint
    const changedFeatures = (['compass', 'filesystem', 'uar', 'services'] as const).filter(
      (feature) =>
        (feature !== 'uar' || isUarEnabled()) &&
        JSON.stringify(document.config[feature]) !== JSON.stringify(config[feature])
    )
    const secretChanged = Object.values(secretPatch).some((mutation) => mutation.operation !== 'unchanged')
    const uarSecretChanged =
      isUarEnabled() &&
      secretPatch.uarPassword?.operation !== undefined &&
      secretPatch.uarPassword.operation !== 'unchanged'
    if (uarSecretChanged && !changedFeatures.includes('uar')) changedFeatures.push('uar')
    if (changedFeatures.length) {
      const revisions = { ...document.revisions }
      for (const feature of changedFeatures) revisions[feature] += 1
      await writeIntegrationDocument({ schemaVersion: 4, revisions, config })
    }
    if (secretChanged) await writeSecrets(secretPatch)
    if (!changedFeatures.length && !secretChanged) return this.snapshot()
    await writeMiniConfiguration()
    const runtime = application.get('McpRuntimeService')
    for (const server of mcpServerService.list({}).items.filter((value) => value.tags?.includes(MANAGED_TAG))) {
      await runtime.stopServer(server.id)
      mcpServerService.update(server.id, { isActive: false })
    }
    this.workspaces.clear()
    this.serviceDiscovery = await discoverServiceCandidates(config)
    return this.snapshot()
  }

  async resolveSession(
    session: AgentSessionEntity,
    sourceAgent: AgentEntity
  ): Promise<{ agent: AgentEntity; servers: McpServer[] }> {
    await this.ensureInitialized()
    const config = readIntegrationConfig()
    const workspace = await describeWorkspace(session.workspace.path, config)
    this.workspaces.set(workspace.id, workspace)
    if (config.compass.enabled && workspace.enabled && !workspace.error) {
      try {
        const { completion } = await this.runOperation(
          'check-drift',
          workspace.path,
          async (signal, output, operation, controls) => {
            controls.stage('checking')
            workspace.freshness = { state: 'checking' }
            workspace.latestOperationId = operation.id
            await saveWorkspaceState(workspace)
            workspace.freshness = await checkWorkspaceFreshness(workspace, config, signal, output)
            workspace.indexed = workspace.freshness.state === 'current'
            await saveWorkspaceState(workspace)
          }
        )
        await completion
        if (!workspace.indexed) await this.ensureIndex(workspace, config)
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
    const job = this.runOperation('index', workspace.path, async (signal, output, operation, controls) => {
      controls.stage('indexing')
      workspace.freshness = { state: 'checking' }
      workspace.latestOperationId = operation.id
      await saveWorkspaceState(workspace)
      workspace.freshness = await indexWorkspace(workspace, config, signal, output)
      workspace.indexed = workspace.freshness.state === 'current'
      workspace.lastIndexedAt = Date.now()
      await saveWorkspaceState(workspace)
    })
      .then(({ completion }) => completion)
      .finally(() => this.workspaceJobs.delete(workspace.id))
    this.workspaceJobs.set(workspace.id, job)
    return job
  }

  async setWorkspaceEnabled(workspacePath: string, enabled: boolean): Promise<WorkspaceIntegration> {
    await this.ensureInitialized()
    if (!path.isAbsolute(workspacePath) || !(await fs.stat(workspacePath)).isDirectory())
      throw new Error('prometheus.error.workspaceDirectory')
    const resolved = path.resolve(workspacePath)
    const workspace = await describeWorkspace(resolved)
    workspace.enabled = enabled
    const servers = await registerWorkspaceServers(workspace, readIntegrationConfig())
    workspace.serverIds = servers.map((server) => server.id)
    await saveWorkspaceState(workspace)
    this.workspaces.set(workspace.id, workspace)
    if (!enabled) {
      const compass = mcpServerService
        .list({})
        .items.find((server) => server.reference === `compass:${workspace.id}` && server.tags?.includes(MANAGED_TAG))
      if (compass) await application.get('McpRuntimeService').stopServer(compass.id)
    }
    return workspace
  }

  async start(action: IntegrationAction, workspacePath?: string): Promise<IntegrationOperation> {
    if (!isUarEnabled() && action.startsWith('uar-')) assertUarEnabled()
    await this.ensureInitialized()
    const { operation } = await this.runOperation(
      action,
      workspacePath,
      async (signal, output, operation, controls) => {
        const config = readIntegrationConfig()
        if (action === 'repair-path') {
          await installCommandPath()
          return
        }
        if (action === 'discover-services') {
          this.serviceDiscovery = await discoverServiceCandidates(config, signal)
          output(
            JSON.stringify({
              candidates: this.serviceDiscovery.candidates.length,
              errors: this.serviceDiscovery.errors
            })
          )
          return
        }
        if (action === 'uar-check' || action === 'uar-apply' || action === 'uar-restart') {
          if (
            action !== 'uar-check' &&
            application.get('AgentSessionRuntimeService').hasBusySessionsForRuntime('uar')
          ) {
            throw new Error('prometheus.error.uarActiveRuns')
          }
          let sidecar: UarSidecarEndpoint
          if (action === 'uar-apply') {
            const document = readIntegrationDocument()
            const secrets = await readSecrets()
            const candidate = {
              revision: document.revisions.uar,
              profile: document.config.uar,
              ...(secrets.uarPassword ? { password: secrets.uarPassword } : {})
            }
            try {
              if (candidate.profile.backend === 'remote') {
                if (!candidate.password) throw new Error('prometheus.error.authentication')
                const probeEndpoint = candidate.profile.endpoint.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
                await surrealSql(
                  probeEndpoint,
                  'UPSERT __the_boss_uar_probe:connection CONTENT { checked_at: time::now() }; DELETE __the_boss_uar_probe:connection; RETURN 1;',
                  { ...candidate.profile, password: candidate.password },
                  signal
                )
              }
              sidecar = await application.get('UarSidecarService').applyStorage(candidate)
              this.lastUarApplyError = undefined
            } catch (error) {
              this.lastUarApplyError = error instanceof Error ? error.message : String(error)
              throw error
            }
          } else {
            sidecar =
              action === 'uar-restart'
                ? await application.get('UarSidecarService').restart()
                : await application.get('UarSidecarService').ensureReady()
          }
          operation.diagnostics = [
            { id: 'uar.binary', state: 'operational' },
            { id: 'uar.process', state: 'listening', detail: sidecar.uarVersion },
            { id: 'uar.capabilities', state: 'operational', detail: sidecar.capabilities.join(', ') },
            {
              id: 'uar.storage',
              state: 'operational',
              detail: sidecar.storage.profile.backend
            }
          ]
          output(
            JSON.stringify({
              backend: sidecar.storage.profile.backend,
              revision: sidecar.storage.revision,
              ...(sidecar.storage.profile.backend === 'remote'
                ? {
                    endpoint: sidecar.storage.profile.endpoint,
                    namespace: sidecar.storage.profile.namespace,
                    database: sidecar.storage.profile.database
                  }
                : {})
            })
          )
          return
        }
        if (['pull', 'start', 'stop', 'restart', 'status', 'logs'].includes(action)) {
          const result = await runManagedServiceAction(action as 'start', config, signal, output, (stage, progress) => {
            controls.stage(stage)
            if (progress) controls.progress(progress)
          })
          if (action === 'status') {
            const status = JSON.parse(result.trim().split(/\r?\n/).at(-1)!) as {
              docker: { state: string; compose: boolean; detail?: string }
              endpoints: Record<string, { reached: boolean; status?: number; detail?: string }>
            }
            controls.diagnostics([
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
            ])
          }
          return
        }
        if (!workspacePath || !path.isAbsolute(workspacePath) || !(await fs.stat(workspacePath)).isDirectory())
          throw new Error('prometheus.error.workspaceDirectory')
        const workspace = await describeWorkspace(path.resolve(workspacePath), config)
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
        workspace.latestOperationId = operation.id
        workspace.freshness = { state: 'checking' }
        await saveWorkspaceState(workspace)
        if (action === 'check-drift') {
          controls.stage('checking')
          workspace.freshness = await checkWorkspaceFreshness(workspace, config, signal, output)
          workspace.indexed = workspace.freshness.state === 'current'
          await saveWorkspaceState(workspace)
          return
        }
        controls.stage(action === 'refresh' ? 'refreshing' : 'indexing')
        workspace.freshness = await indexWorkspace(workspace, config, signal, output)
        workspace.indexed = workspace.freshness.state === 'current'
        workspace.lastIndexedAt = Date.now()
        const servers = await registerWorkspaceServers(workspace, config)
        workspace.serverIds = servers.map((server) => server.id)
        await saveWorkspaceState(workspace)
        for (const server of servers) await application.get('McpRuntimeService').stopServer(server.id)
      }
    )
    return operation
  }

  async cancel(id: string): Promise<void> {
    await this.ensureInitialized()
    this.operationRunner.cancel(id)
  }

  async operationEvents(id: string, after?: number, limit?: number): Promise<IntegrationOperationEventPage> {
    await this.ensureInitialized()
    return this.operationRunner.events(id, after, limit)
  }

  async readOperationLog(id: string, offset?: number, limit?: number): Promise<IntegrationOperationLogPage> {
    await this.ensureInitialized()
    return this.operationRunner.log(id, offset, limit)
  }

  async exportOperationLog(id: string): Promise<IntegrationOperationLogExport> {
    await this.ensureInitialized()
    return this.operationRunner.exportLog(id)
  }

  private async runOperation(
    action: IntegrationAction,
    workspacePath: string | undefined,
    execute: (
      signal: AbortSignal,
      output: (value: string) => void,
      operation: IntegrationOperation,
      controls: IntegrationOperationControls
    ) => Promise<void>
  ): Promise<{ operation: IntegrationOperation; completion: Promise<void> }> {
    const workspaceId = workspacePath ? workspaceIdentity(path.resolve(workspacePath)) : undefined
    const readOnly = ['status', 'logs', 'diagnose', 'discover-services', 'uar-check'].includes(action)
    const resourceKeys = readOnly
      ? []
      : ['pull', 'start', 'stop', 'restart'].includes(action)
        ? ['compose:the-boss-prometheus']
        : ['uar-apply', 'uar-restart'].includes(action)
          ? ['uar:process']
          : ['index', 'refresh', 'check-drift'].includes(action) && workspaceId
            ? [`compass:${workspaceId}`]
            : action === 'repair-path'
              ? ['prometheus:commands']
              : []
    const target = workspaceId
      ? `workspace:${workspaceId}`
      : ['pull', 'start', 'stop', 'restart', 'status', 'logs'].includes(action)
        ? 'services'
        : action.startsWith('uar-')
          ? 'uar'
          : 'prometheus'
    const secrets = Object.values(await readSecrets()).filter((value): value is string => Boolean(value))
    return this.operationRunner.start({
      action,
      workspacePath,
      target,
      resourceKeys,
      secrets,
      execute: async (controls) => {
        await execute(controls.signal, controls.output, controls.operation, controls)
        if (controls.operation.diagnostics) controls.diagnostics(controls.operation.diagnostics)
      },
      onFailure: (error) => {
        if (!workspacePath) return
        const workspace = this.workspaces.get(workspaceIdentity(path.resolve(workspacePath)))
        if (workspace) workspace.error = error
      }
    })
  }
}
