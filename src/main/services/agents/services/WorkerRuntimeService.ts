import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { modelsService } from '@main/apiServer/services/models'
import { configManager } from '@main/services/ConfigManager'
import getShellEnv from '@main/utils/shell-env'
import type {
  AgentEntity,
  AgentStyleMode,
  AgentType,
  CreateAgentRequest,
  WorkerCostClass,
  WorkerInstanceRole
} from '@types'
import {
  AGENT_STYLE_MODE_PRESETS,
  AgentConfigurationSchema,
  AgentStyleModeSchema,
  WorkerInstanceRoleSchema
} from '@types'
import { count, inArray } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { collaborationRoomRunsTable } from '../database/schema'
import { agentService } from './AgentService'
import { isBuiltinAgentId } from './builtin/BuiltinAgentIds'
import { sessionService } from './SessionService'

const logger = loggerService.withContext('WorkerRuntimeService')
const execFileAsync = promisify(execFile)

const EXTERNAL_WORKER_MODEL_ID = 'worker:external'
const PROBE_TTL_MS = 15_000
const VERSION_TIMEOUT_MS = 5_000
const DEFAULT_CLAUDE_CODE_COMMAND = path.join(
  process.env.HOME ?? '/Users/mac',
  'Library',
  'Application Support',
  'Claude',
  'claude-code',
  '2.1.128',
  'claude.app',
  'Contents',
  'MacOS',
  'claude'
)

// ---- Local types ----

export type WorkerRuntimeStatus = 'unbound' | 'missing_command' | 'online' | 'running' | 'offline'
export type VisibleWorkerType = Extract<AgentType, 'codex' | 'opencode' | 'claude-code' | 'gemini-cli' | 'hermes'>

export interface WorkerDefinition {
  type: VisibleWorkerType
  label: string
  engine: string
  defaultCommand: string
  defaultArgs: string[]
  versionArgs: string[]
  tags: string[]
  costClass: WorkerCostClass
  instructions: string
}

export interface WorkerRuntimeInstance {
  key: string
  family: VisibleWorkerType
  type: VisibleWorkerType
  label: string
  engine: string
  role: WorkerInstanceRole
  agent: AgentEntity
  command?: string
  resolvedCommand?: string
  version?: string
  status: WorkerRuntimeStatus
  healthLabel: string
  canRun: boolean
  workload: { activeRuns: number; label: string }
  styleMode: AgentStyleMode
  styleLabel: string
  lastHeartbeatAt?: string
  message?: string
  modelManagedBy?: string
  displayModelId?: string
  displayModelName?: string
}

export interface WorkerRuntimeFamily {
  key: string
  type: VisibleWorkerType
  label: string
  engine: string
  defaultCommand?: string
  defaultArgs?: string[]
  tags: string[]
  agent?: AgentEntity
  command?: string
  resolvedCommand?: string
  version?: string
  status: WorkerRuntimeStatus
  healthLabel: string
  canRun: boolean
  workload: { activeRuns: number; label: string }
  styleMode: AgentStyleMode
  styleLabel: string
  lastHeartbeatAt?: string
  message?: string
  primaryInstanceId?: string
  instances: WorkerRuntimeInstance[]
}

// ---- Helper functions ----

const VISIBLE_WORKER_TYPES = new Set<string>(['codex', 'opencode', 'claude-code', 'gemini-cli', 'hermes'])

export function isVisibleWorkerType(type: unknown): type is VisibleWorkerType {
  return typeof type === 'string' && VISIBLE_WORKER_TYPES.has(type)
}

export function normalizeStyleMode(value: unknown): AgentStyleMode {
  const parsed = AgentStyleModeSchema.safeParse(value)
  return parsed.success ? parsed.data : 'normal'
}

export function normalizeInstanceRole(value: unknown): WorkerInstanceRole {
  const parsed = WorkerInstanceRoleSchema.safeParse(value)
  return parsed.success ? parsed.data : 'member'
}

export function shouldRefreshDefaultArgs(definition: WorkerDefinition, currentArgs: string[]): boolean {
  if (currentArgs.length === 0) return true
  if (definition.type === 'codex') {
    return JSON.stringify(currentArgs) === JSON.stringify(['exec', '--skip-git-repo-check', '{{prompt}}'])
  }
  return false
}

// ---- Worker definitions ----

const WORKER_DEFINITIONS: WorkerDefinition[] = [
  {
    type: 'codex',
    label: 'Codex',
    engine: 'Codex CLI',
    defaultCommand: 'codex',
    defaultArgs: ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '{{prompt}}'],
    versionArgs: ['--version'],
    tags: ['code', 'repo', 'cli'],
    costClass: 'cloud',
    instructions: '你是 Codex CLI Worker，负责代码修改、仓库检查、测试验证和工程任务执行。'
  },
  {
    type: 'opencode',
    label: 'OpenCode',
    engine: 'OpenCode CLI',
    defaultCommand: 'opencode',
    defaultArgs: ['run', '{{prompt}}'],
    versionArgs: ['--version'],
    tags: ['code', 'agent', 'cli'],
    costClass: 'cloud',
    instructions: '你是 OpenCode CLI Worker，负责代码实现、仓库内任务和自动化执行。'
  },
  {
    type: 'claude-code',
    label: 'Claude Code',
    engine: 'Claude Code SDK',
    defaultCommand: DEFAULT_CLAUDE_CODE_COMMAND,
    defaultArgs: [],
    versionArgs: ['--version'],
    tags: ['code', 'review', 'cli'],
    costClass: 'cloud',
    instructions: '你是 Claude Code Worker，负责代码实现、重构、评审和需要稳健工具调用的任务。'
  },
  {
    type: 'gemini-cli',
    label: 'Gemini',
    engine: 'Gemini CLI',
    defaultCommand: 'gemini',
    defaultArgs: ['-p', '{{prompt}}'],
    versionArgs: ['--version'],
    tags: ['research', 'code', 'cli'],
    costClass: 'cloud',
    instructions: '你是 Gemini CLI Worker，负责研究、代码辅助、长上下文整理和多角度分析。'
  },
  {
    type: 'hermes',
    label: 'Hermes',
    engine: 'Hermes CLI',
    defaultCommand: 'hermes',
    defaultArgs: [],
    versionArgs: ['--version'],
    tags: ['local', 'music', 'agent'],
    costClass: 'local-heavy',
    instructions: '你是 Hermes Worker，优先处理本机 Hermes 能力、音乐制作、自动化和本地模型相关任务。'
  }
]

const definitionsByType = new Map(WORKER_DEFINITIONS.map((d) => [d.type, d]))
const DEFAULT_WORKER_FAMILY_ORDER = WORKER_DEFINITIONS.map((d) => d.type)

// ---- Internal probe types ----

interface ProbeResult {
  status: WorkerRuntimeStatus
  resolvedCommand?: string
  version?: string
  heartbeatAt: string
  message?: string
}

interface ProbeCacheEntry {
  expiresAt: number
  result: ProbeResult
}

// ---- Utilities ----

function trimVersionOutput(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 80)
}

// ---- Service ----

export class WorkerRuntimeService extends BaseService {
  static instance: WorkerRuntimeService | null = null
  private probeCache = new Map<string, ProbeCacheEntry>()
  private pendingProbes = new Map<string, Promise<ProbeResult>>()
  private startupReadyPromise: Promise<WorkerRuntimeFamily[]> | null = null

  static getInstance(): WorkerRuntimeService {
    if (!WorkerRuntimeService.instance) WorkerRuntimeService.instance = new WorkerRuntimeService()
    return WorkerRuntimeService.instance
  }

  getDefinitions(): WorkerDefinition[] {
    const normalizedOrder = [...configManager.getWorkerFamilyOrder().filter(isVisibleWorkerType)]
    for (const type of DEFAULT_WORKER_FAMILY_ORDER) {
      if (!normalizedOrder.includes(type)) normalizedOrder.push(type)
    }
    return normalizedOrder.map((type) => definitionsByType.get(type)).filter((d): d is WorkerDefinition => Boolean(d))
  }

  setWorkerFamilyOrder(order: string[]): string[] {
    const normalizedOrder = [...order.filter(isVisibleWorkerType)]
    for (const type of DEFAULT_WORKER_FAMILY_ORDER) {
      if (!normalizedOrder.includes(type)) normalizedOrder.push(type)
    }
    configManager.setWorkerFamilyOrder(normalizedOrder)
    return normalizedOrder
  }

  async listWorkers(): Promise<WorkerRuntimeFamily[]> {
    const [{ agents }, workloadByAgentId] = await Promise.all([
      agentService.listAgents({ sortBy: 'sort_order', orderBy: 'asc' }),
      this.getActiveRunCounts()
    ])

    const grouped = new Map<string, AgentEntity[]>()
    for (const agent of agents) {
      const family = this.resolveWorkerFamily(agent)
      if (!family) continue
      const bucket = grouped.get(family) ?? []
      bucket.push(agent)
      grouped.set(family, bucket)
    }

    return await Promise.all(
      this.getDefinitions().map(async (definition) => {
        const familyAgents = grouped.get(definition.type) ?? []
        const instances = await Promise.all(
          familyAgents.map((agent) => this.buildInstance(definition, agent, workloadByAgentId.get(agent.id) ?? 0))
        )
        return await this.buildFamily(definition, instances)
      })
    )
  }

  async bindWorker(type: string): Promise<WorkerRuntimeFamily> {
    if (!isVisibleWorkerType(type)) throw new Error(`Unsupported worker type: ${type}`)
    const definition = definitionsByType.get(type)
    if (!definition) throw new Error(`Unsupported worker type: ${type}`)

    const { agents } = await agentService.listAgents({ sortBy: 'sort_order', orderBy: 'asc' })
    const familyAgents = agents.filter((a) => this.resolveWorkerFamily(a) === definition.type)
    const primary = familyAgents.find((a) => this.readInstanceRole(a) === 'primary') ?? familyAgents[0]

    if (primary) {
      await agentService.updateAgent(primary.id, {
        configuration: this.buildConfiguration(definition, primary, 'primary'),
        instructions: primary.instructions || definition.instructions
      })
    } else {
      const created = await agentService.createAgent(await this.buildCreateRequest(definition, undefined, 'primary'))
      await sessionService.createSession(created.id, {})
    }

    this.invalidateFamilyProbeCache(definition.type)
    return this.getFamilyOrThrow(definition.type)
  }

  async createInstance(type: string): Promise<WorkerRuntimeFamily> {
    if (!isVisibleWorkerType(type)) throw new Error(`Unsupported worker type: ${type}`)
    const definition = definitionsByType.get(type)
    if (!definition) throw new Error(`Unsupported worker type: ${type}`)

    const { agents } = await agentService.listAgents({ sortBy: 'sort_order', orderBy: 'asc' })
    const familyAgents = agents.filter((a) => this.resolveWorkerFamily(a) === definition.type)
    const baseAgent =
      familyAgents.find((a) => this.readInstanceRole(a) === 'primary') ??
      familyAgents.find((a) => this.readInstanceRole(a) === 'router') ??
      familyAgents[0]

    if (definition.type === 'claude-code' && !baseAgent) {
      throw new Error('Claude Code 需要先存在一个可用实例，才能继续创建长期分身。')
    }

    if (!baseAgent && familyAgents.length === 0) {
      await this.bindWorker(definition.type)
      return this.createInstance(definition.type)
    }

    const created = await agentService.createAgent(await this.buildCreateRequest(definition, baseAgent, 'member'))
    await sessionService.createSession(created.id, {})
    this.invalidateFamilyProbeCache(definition.type)
    return this.getFamilyOrThrow(definition.type)
  }

  async getInstance(agentId: string): Promise<WorkerRuntimeInstance | null> {
    const agent = await agentService.getAgent(agentId)
    if (!agent) return null
    const family = this.resolveWorkerFamily(agent)
    if (!family) return null
    const definition = definitionsByType.get(family)
    if (!definition) return null
    const workloadByAgentId = await this.getActiveRunCounts()
    return this.buildInstance(definition, agent, workloadByAgentId.get(agent.id) ?? 0)
  }

  async findHealthyInstances(agentIds: string[]): Promise<WorkerRuntimeInstance[]> {
    return (await Promise.all(agentIds.map((id) => this.getInstance(id)))).filter(
      (inst): inst is WorkerRuntimeInstance => Boolean(inst?.canRun)
    )
  }

  async getFamilyOrThrow(type: VisibleWorkerType): Promise<WorkerRuntimeFamily> {
    const family = (await this.listWorkers()).find((w) => w.type === type)
    if (!family) throw new Error(`Failed to load worker family: ${type}`)
    return family
  }

  async ensureStartupWorkersReady(): Promise<WorkerRuntimeFamily[]> {
    if (this.startupReadyPromise) return this.startupReadyPromise
    this.startupReadyPromise = this._doEnsureStartupWorkersReady()
    return this.startupReadyPromise
  }

  private async _doEnsureStartupWorkersReady(): Promise<WorkerRuntimeFamily[]> {
    // Pre-warm shell env so the first probe doesn't block on a cold login shell spawn
    void getShellEnv().catch(() => {})

    for (const type of DEFAULT_WORKER_FAMILY_ORDER) {
      try {
        await this.bindWorker(type)
      } catch {
        // ignore individual failures
      }
    }

    const families = await this.listWorkers()

    for (const family of families) {
      for (const instance of family.instances) {
        if (instance.modelManagedBy === 'worker' && instance.displayModelId) {
          try {
            const cfg = AgentConfigurationSchema.parse(instance.agent.configuration ?? {})

            // [Fix] 增加差异检测：只有当检测到的模型信息真的变了，才更新数据库
            const hasChanged =
              cfg.worker_model_source !== 'worker' ||
              cfg.worker_detected_model !== instance.displayModelId ||
              cfg.worker_detected_model_name !== instance.displayModelName

            if (hasChanged) {
              await agentService.updateAgent(instance.agent.id, {
                configuration: {
                  ...cfg,
                  worker_model_source: 'worker',
                  worker_detected_model: instance.displayModelId,
                  worker_detected_model_name: instance.displayModelName
                }
              })
              logger.info(`Updated detected model for worker: ${instance.label}`, {
                modelId: instance.displayModelId
              })
            }
          } catch (err) {
            logger.warn(`Failed to sync model for ${instance.label}`, {
              error: err instanceof Error ? err.message : String(err)
            })
          }
        }
      }
    }

    return this.listWorkers()
  }

  resolveWorkerFamily(agent: AgentEntity): VisibleWorkerType | null {
    if (isBuiltinAgentId(agent.id)) return null
    const config = AgentConfigurationSchema.parse(agent.configuration ?? {})
    if (typeof config.worker_family === 'string' && isVisibleWorkerType(config.worker_family)) {
      return config.worker_family
    }
    if (isVisibleWorkerType(agent.type)) return agent.type
    return null
  }

  readInstanceRole(agent: AgentEntity): WorkerInstanceRole {
    return normalizeInstanceRole(AgentConfigurationSchema.parse(agent.configuration ?? {}).worker_instance_role)
  }

  private async buildCreateRequest(
    definition: WorkerDefinition,
    baseAgent: AgentEntity | undefined,
    role: WorkerInstanceRole
  ): Promise<CreateAgentRequest> {
    const configuration = this.buildConfiguration(definition, baseAgent, role)
    const instanceCount = this.countFamilyIndex(definition.type, baseAgent?.name)
    const defaultName = role === 'primary' ? definition.label : `${definition.label} ${Math.max(2, instanceCount)}`
    const model = await this.resolveModelForCreate(definition, baseAgent)
    return {
      type: definition.type,
      name: role === 'primary' ? baseAgent?.name || definition.label : defaultName,
      description:
        role === 'primary'
          ? baseAgent?.description || `${definition.label} 本机 Worker`
          : `${definition.label} 长期分身`,
      instructions: baseAgent?.instructions || definition.instructions,
      model,
      plan_model: baseAgent?.plan_model,
      small_model: baseAgent?.small_model,
      accessible_paths: baseAgent?.accessible_paths ?? [],
      allowed_tools: baseAgent?.allowed_tools ?? [],
      mcps: baseAgent?.mcps ?? [],
      configuration
    }
  }

  private async resolveModelForCreate(
    definition: WorkerDefinition,
    baseAgent: AgentEntity | undefined
  ): Promise<string> {
    if (baseAgent?.model) return baseAgent.model
    if (definition.type !== 'claude-code') return EXTERNAL_WORKER_MODEL_ID
    const modelId = (await modelsService.getModels({ providerType: 'anthropic', limit: 1 })).data?.[0]?.id
    if (modelId) return modelId
    throw new Error('请先在模型服务中配置至少一个 Anthropic 兼容模型，再绑定 Claude Code。')
  }

  private countFamilyIndex(_type: string, name?: string): number {
    const match = name?.match(/(\d+)\s*$/)
    return match ? Number(match[1]) + 1 : 2
  }

  buildConfiguration(definition: WorkerDefinition, existing: AgentEntity | undefined, role: WorkerInstanceRole) {
    const current = AgentConfigurationSchema.parse(existing?.configuration ?? {})
    const styleMode = normalizeStyleMode(current.style_mode)
    const permissionMode =
      current.permission_mode && current.permission_mode !== 'default' ? current.permission_mode : 'bypassPermissions'
    return {
      ...current,
      permission_mode: permissionMode,
      worker_family: definition.type,
      worker_instance_role: role,
      worker_command: definition.defaultCommand
        ? current.worker_command || definition.defaultCommand
        : current.worker_command,
      worker_args:
        Array.isArray(current.worker_args) && !shouldRefreshDefaultArgs(definition, current.worker_args)
          ? current.worker_args
          : definition.defaultArgs,
      worker_capability_tags:
        Array.isArray(current.worker_capability_tags) && current.worker_capability_tags.length > 0
          ? current.worker_capability_tags
          : definition.tags,
      worker_cost_class: current.worker_cost_class || definition.costClass,
      autonomy_enabled: current.autonomy_enabled ?? true,
      autonomy_idle_minutes: current.autonomy_idle_minutes ?? 30,
      style_mode: styleMode,
      temperature: current.temperature ?? AGENT_STYLE_MODE_PRESETS[styleMode].temperature,
      top_p: current.top_p ?? AGENT_STYLE_MODE_PRESETS[styleMode].top_p
    }
  }

  private async buildInstance(
    definition: WorkerDefinition,
    agent: AgentEntity,
    activeRuns: number
  ): Promise<WorkerRuntimeInstance> {
    const config = AgentConfigurationSchema.parse(agent.configuration ?? {})
    const styleMode = normalizeStyleMode(config.style_mode)
    const stylePreset = AGENT_STYLE_MODE_PRESETS[styleMode]
    const role = normalizeInstanceRole(config.worker_instance_role)
    const workload = {
      activeRuns,
      label: activeRuns > 0 ? `运行 ${activeRuns}` : '空闲'
    }

    let command = config.worker_command?.trim() || definition.defaultCommand
    if (!command) {
      return {
        key: `${definition.type}:${agent.id}`,
        family: definition.type,
        type: definition.type,
        label: agent.name || definition.label,
        engine: definition.engine,
        role,
        agent,
        status: 'missing_command',
        healthLabel: '未配置命令',
        canRun: false,
        workload,
        styleMode,
        styleLabel: stylePreset.label,
        message: 'Agent 已存在，但没有配置 worker_command'
      }
    }

    let probe = await this.probeCommand(definition, command)

    if (
      probe.status === 'missing_command' &&
      config.worker_command?.trim() &&
      definition.defaultCommand &&
      config.worker_command.trim() !== definition.defaultCommand
    ) {
      const fallbackProbe = await this.probeCommand(definition, definition.defaultCommand)
      if (fallbackProbe.status === 'online') {
        command = definition.defaultCommand
        probe = {
          ...fallbackProbe,
          message: `配置命令不可用，已回退到 PATH 中的 ${definition.defaultCommand}`
        }
      }
    }

    const status: WorkerRuntimeStatus = activeRuns > 0 && probe.status === 'online' ? 'running' : probe.status

    return {
      key: `${definition.type}:${agent.id}`,
      family: definition.type,
      type: definition.type,
      label: agent.name || definition.label,
      engine: definition.engine,
      role,
      agent,
      command,
      resolvedCommand: probe.resolvedCommand,
      version: probe.version,
      status,
      healthLabel: status === 'running' ? '运行中' : probe.status === 'online' ? '在线' : '命令不可用',
      canRun: probe.status === 'online',
      workload,
      styleMode,
      styleLabel: stylePreset.label,
      lastHeartbeatAt: probe.heartbeatAt,
      message: probe.message
    }
  }

  private async buildFamily(
    definition: WorkerDefinition,
    instances: WorkerRuntimeInstance[]
  ): Promise<WorkerRuntimeFamily> {
    if (instances.length === 0) {
      const defaultCommand = definition.defaultCommand?.trim()
      if (!defaultCommand) {
        return {
          key: definition.type,
          type: definition.type,
          label: definition.label,
          engine: definition.engine,
          defaultCommand: definition.defaultCommand,
          defaultArgs: definition.defaultArgs,
          tags: definition.tags,
          status: 'unbound',
          healthLabel: '未绑定',
          canRun: false,
          workload: { activeRuns: 0, label: '空闲' },
          styleMode: 'normal',
          styleLabel: AGENT_STYLE_MODE_PRESETS.normal.label,
          message: '还没有绑定真实 Agent',
          instances: []
        }
      }

      const probe = await this.probeCommand(definition, defaultCommand)
      const status: WorkerRuntimeStatus = probe.status === 'online' ? 'online' : probe.status
      return {
        key: definition.type,
        type: definition.type,
        label: definition.label,
        engine: definition.engine,
        defaultCommand: definition.defaultCommand,
        defaultArgs: definition.defaultArgs,
        tags: definition.tags,
        command: defaultCommand,
        resolvedCommand: probe.resolvedCommand,
        version: probe.version,
        status,
        healthLabel: status === 'online' ? '在线' : status === 'missing_command' ? '命令不可用' : '未绑定',
        canRun: probe.status === 'online',
        workload: { activeRuns: 0, label: '空闲' },
        styleMode: 'normal',
        styleLabel: AGENT_STYLE_MODE_PRESETS.normal.label,
        lastHeartbeatAt: probe.heartbeatAt,
        message:
          probe.status === 'online'
            ? `已检测到本机 ${definition.engine} 命令，首次派活时会自动创建实例`
            : (probe.message ?? '还没有绑定真实 Agent'),
        instances: []
      }
    }

    const sortedInstances = [...instances].sort((a, b) => {
      const aRole = a.role === 'primary' ? 0 : a.role === 'router' ? 1 : 2
      const bRole = b.role === 'primary' ? 0 : b.role === 'router' ? 1 : 2
      if (aRole !== bRole) return aRole - bRole
      return a.label.localeCompare(b.label)
    })

    const primary = sortedInstances.find((i) => i.role === 'primary') ?? sortedInstances[0]
    const preferred = sortedInstances.find((i) => i.canRun) ?? primary
    const activeRuns = sortedInstances.reduce((sum, i) => sum + i.workload.activeRuns, 0)
    const anyRunning = sortedInstances.some((i) => i.status === 'running')
    const anyOnline = sortedInstances.some((i) => i.status === 'online')
    const status: WorkerRuntimeStatus = anyRunning ? 'running' : anyOnline ? 'online' : 'missing_command'

    return {
      key: definition.type,
      type: definition.type,
      label: definition.label,
      engine: definition.engine,
      defaultCommand: definition.defaultCommand,
      defaultArgs: definition.defaultArgs,
      tags: definition.tags,
      agent: preferred.agent,
      command: preferred.command,
      resolvedCommand: preferred.resolvedCommand,
      version: preferred.version,
      status,
      healthLabel: status === 'running' ? '运行中' : status === 'online' ? '在线' : '命令不可用',
      canRun: sortedInstances.some((i) => i.canRun),
      workload: {
        activeRuns,
        label: activeRuns > 0 ? `运行 ${activeRuns}` : '空闲'
      },
      styleMode: preferred.styleMode,
      styleLabel: preferred.styleLabel,
      lastHeartbeatAt: preferred.lastHeartbeatAt,
      message: preferred.message,
      primaryInstanceId: primary.agent.id,
      instances: sortedInstances
    }
  }

  async probeCommand(definition: WorkerDefinition, command: string): Promise<ProbeResult> {
    const cacheKey = `${definition.type}:${command}`
    const cached = this.probeCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.result

    // Deduplicate concurrent probes for the same command (prevents parallel bindWorker calls
    // from each spawning shell processes for the same worker)
    const pending = this.pendingProbes.get(cacheKey)
    if (pending) return pending

    const probePromise = this._executeProbe(definition, command, cacheKey)
    this.pendingProbes.set(cacheKey, probePromise)
    try {
      return await probePromise
    } finally {
      this.pendingProbes.delete(cacheKey)
    }
  }

  private async _executeProbe(definition: WorkerDefinition, command: string, cacheKey: string): Promise<ProbeResult> {
    const heartbeatAt = new Date().toISOString()
    const resolvedCommand = await this.resolveCommand(command)

    if (!resolvedCommand) {
      const result: ProbeResult = {
        status: 'missing_command',
        heartbeatAt,
        message: `找不到命令：${command}`
      }
      this.probeCache.set(cacheKey, { expiresAt: Date.now() + PROBE_TTL_MS, result })
      return result
    }

    let version: string | undefined
    if (definition.versionArgs.length > 0) {
      try {
        const shellEnv = await getShellEnv()
        const { stdout, stderr } = await execFileAsync(resolvedCommand, definition.versionArgs, {
          env: { ...process.env, ...shellEnv },
          timeout: VERSION_TIMEOUT_MS,
          maxBuffer: 20_000
        })
        version = trimVersionOutput(`${stdout}${stderr ? `\n${stderr}` : ''}`)
      } catch (error) {
        logger.debug('Worker version probe failed', {
          type: definition.type,
          command: resolvedCommand,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const result: ProbeResult = { resolvedCommand, version, status: 'online', heartbeatAt }
    this.probeCache.set(cacheKey, { expiresAt: Date.now() + PROBE_TTL_MS, result })
    return result
  }

  invalidateFamilyProbeCache(type: string): void {
    for (const key of [...this.probeCache.keys()]) {
      if (key.startsWith(`${type}:`)) this.probeCache.delete(key)
    }
  }

  private async resolveCommand(command: string): Promise<string | undefined> {
    if (path.isAbsolute(command)) return fs.existsSync(command) ? command : undefined
    try {
      const shellEnv = await getShellEnv()
      const pathDirs = ((shellEnv as Record<string, string>).PATH ?? process.env.PATH ?? '').split(':')
      for (const dir of pathDirs) {
        const candidate = path.join(dir, command)
        if (fs.existsSync(candidate)) return candidate
      }
    } catch {
      const pathDirs = (process.env.PATH ?? '').split(':')
      for (const dir of pathDirs) {
        const candidate = path.join(dir, command)
        if (fs.existsSync(candidate)) return candidate
      }
    }
    return undefined
  }

  private async getActiveRunCounts(): Promise<Map<string, number>> {
    const db = await this.getDatabase()
    const rows = await db
      .select({
        workerAgentId: collaborationRoomRunsTable.workerAgentId,
        count: count()
      })
      .from(collaborationRoomRunsTable)
      .where(inArray(collaborationRoomRunsTable.status, ['queued', 'running']))
      .groupBy(collaborationRoomRunsTable.workerAgentId)
    return new Map(rows.map((row) => [row.workerAgentId, Number(row.count)]))
  }
}

export const workerRuntimeService = WorkerRuntimeService.getInstance()
