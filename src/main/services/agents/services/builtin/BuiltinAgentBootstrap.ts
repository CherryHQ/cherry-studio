/**
 * BuiltinAgentBootstrap
 *
 * Encapsulates all startup initialization logic for built-in skills and agents
 * (CherryClaw, Cherry Assistant, etc.). Keeps business details out of
 * the main entry point (`src/main/index.ts`).
 *
 * Orchestration for builtin-agent creation (model discovery, workspace
 * provisioning, skill seeding) lives here — NOT in the DataApi AgentService.
 */
import { agentService } from '@data/services/AgentService'
import { agentSessionService as sessionService } from '@data/services/AgentSessionService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { resolveAccessiblePaths, validateAgentModels } from '@main/services/agents/agentUtils'
import { AgentModelValidationError } from '@main/services/agents/errors'
import { seedWorkspaceTemplates } from '@main/services/agents/services/cherryclaw/seedWorkspace'
import { skillService } from '@main/services/agents/skills/SkillService'
import { installBuiltinSkills } from '@main/utils/builtinSkills'
import type { CreateAgentDto, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { schedulerService } from '../SchedulerService'
import { CHERRY_ASSISTANT_AGENT_ID, CHERRY_CLAW_AGENT_ID } from './BuiltinAgentIds'
import { provisionBuiltinAgent } from './BuiltinAgentProvisioner'

const logger = loggerService.withContext('BuiltinAgentBootstrap')
const RETRY_DELAYS_MS = [5000, 15000, 30000]
const retryAttempts = new Map<string, number>()
const retryTimers = new Map<string, NodeJS.Timeout>()

export type BuiltinAgentInitResult =
  | { agentId: string; skippedReason?: undefined }
  | { agentId: null; skippedReason: 'deleted' | 'no_model' }

/**
 * Initialize all built-in skills and agents. Safe to call multiple times (idempotent).
 */
export async function bootstrapBuiltinAgents(): Promise<void> {
  try {
    await installBuiltinSkills()
  } catch (error) {
    logger.error('Failed to install built-in skills', error as Error)
  }

  await Promise.all([initCherryClaw(), initCherryAssistant()])
}

function clearRetry(agentId: string): void {
  const timer = retryTimers.get(agentId)
  if (timer) {
    clearTimeout(timer)
    retryTimers.delete(agentId)
  }
  retryAttempts.delete(agentId)
}

function scheduleRetry(agentId: string, label: string, initFn: () => Promise<void>): void {
  if (retryTimers.has(agentId)) {
    return
  }

  const attempt = retryAttempts.get(agentId) ?? 0
  const delay = RETRY_DELAYS_MS[attempt]
  if (delay === undefined) {
    logger.info(`Built-in ${label} bootstrap retries exhausted`, { agentId, attempts: attempt })
    return
  }

  retryAttempts.set(agentId, attempt + 1)
  logger.info(`Scheduling built-in ${label} bootstrap retry`, {
    agentId,
    attempt: attempt + 1,
    delayMs: delay
  })

  const timer = setTimeout(() => {
    retryTimers.delete(agentId)
    void initFn()
  }, delay)
  retryTimers.set(agentId, timer)
}

async function ensureDefaultSession(agentId: string, label: string): Promise<void> {
  const { total } = await sessionService.listSessions(agentId, { limit: 1 })
  if (total === 0) {
    await sessionService.createSession(agentId, {})
    logger.info(`Default session created for ${label} agent`)
  }
}

async function handleInitResult(
  agentId: string,
  label: string,
  result: BuiltinAgentInitResult,
  initFn: () => Promise<void>,
  onReady?: (resolvedAgentId: string) => Promise<void>
): Promise<void> {
  if (result.agentId) {
    clearRetry(agentId)
    await ensureDefaultSession(result.agentId, label)
    if (onReady) {
      await onReady(result.agentId)
    }
    return
  }

  if (result.skippedReason === 'deleted') {
    clearRetry(agentId)
    return
  }

  scheduleRetry(agentId, label, initFn)
}

// ── CherryClaw ──────────────────────────────────────────────────────

async function initDefaultCherryClawAgent(): Promise<BuiltinAgentInitResult> {
  const id = CHERRY_CLAW_AGENT_ID
  try {
    const status = await agentService.findAgentIncludingDeleted(id)

    if (status?.deletedAt) {
      logger.info('Default CherryClaw agent was deleted by user — skipping recreation', { id })
      return { agentId: null, skippedReason: 'deleted' }
    }

    if (status) {
      return { agentId: id }
    }

    const providers = await providerService.list({ endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES })
    const modelArrays = await Promise.all(providers.map((p) => modelService.list({ providerId: p.id })))
    const firstModel = modelArrays.flat()[0]
    if (!firstModel) {
      logger.info('No Anthropic-compatible models available yet — skipping default CherryClaw creation')
      return { agentId: null, skippedReason: 'no_model' }
    }

    const configuration: CreateAgentDto['configuration'] = {
      avatar: '🦞',
      permission_mode: 'bypassPermissions',
      max_turns: 100,
      soul_enabled: true,
      scheduler_enabled: true,
      scheduler_type: 'interval',
      heartbeat_enabled: true,
      heartbeat_interval: 30,
      env_vars: {}
    }

    await validateAgentModels('claude-code', { model: firstModel.id })

    const resolvedPaths = resolveAccessiblePaths([], id)

    const req: CreateAgentDto = {
      type: 'claude-code',
      name: 'Cherry Claw',
      description: 'Default autonomous CherryClaw agent',
      model: firstModel.id,
      accessiblePaths: resolvedPaths,
      configuration
    }

    const agent = await agentService.createAgent(req)

    const workspace = agent.accessiblePaths?.[0]
    if (workspace) {
      await seedWorkspaceTemplates(workspace)
    }

    try {
      await skillService.initSkillsForAgent(agent.id, workspace)
    } catch (error) {
      logger.warn('Failed to seed builtin skills for CherryClaw agent', {
        agentId: id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    logger.info('Created default CherryClaw agent', { id })
    return { agentId: id }
  } catch (error) {
    if (error instanceof AgentModelValidationError) {
      logger.warn('Skipping default CherryClaw agent: no compatible model', error)
      return { agentId: null, skippedReason: 'no_model' }
    }
    logger.error('Failed to init default CherryClaw agent', error as Error)
    throw error
  }
}

async function initCherryClaw(): Promise<void> {
  try {
    const result = await initDefaultCherryClawAgent()
    await handleInitResult(CHERRY_CLAW_AGENT_ID, 'CherryClaw', result, initCherryClaw, async (agentId) => {
      await schedulerService.ensureHeartbeatTask(agentId, 30)
    })
  } catch (error) {
    logger.warn('Failed to init CherryClaw agent:', error as Error)
  }
}

// ── Cherry Assistant ────────────────────────────────────────────────

export { CHERRY_ASSISTANT_AGENT_ID }

async function initBuiltinAgent(opts: {
  id: string
  builtinRole: string
  provisionWorkspace: (
    workspacePath: string,
    builtinRole: string
  ) => Promise<
    { name?: string; description?: string; instructions?: string; configuration?: Record<string, unknown> } | undefined
  >
}): Promise<BuiltinAgentInitResult> {
  const { id, builtinRole, provisionWorkspace } = opts
  try {
    const status = await agentService.findAgentIncludingDeleted(id)

    if (status?.deletedAt) {
      logger.info(`Built-in ${builtinRole} agent was deleted by user — skipping recreation`, { id })
      return { agentId: null, skippedReason: 'deleted' }
    }

    if (status) {
      // Sync localized description/instructions on every startup.
      const resolvedPaths = resolveAccessiblePaths([], id)
      const workspace = resolvedPaths[0]
      const agentConfig = workspace ? await provisionWorkspace(workspace, builtinRole) : undefined
      if (agentConfig && (agentConfig.description || agentConfig.instructions)) {
        const updateData: UpdateAgentDto = {}
        if (agentConfig.description) updateData.description = agentConfig.description
        if (agentConfig.instructions) updateData.instructions = agentConfig.instructions
        await agentService.updateAgent(id, updateData)
      }
      return { agentId: id }
    }

    const providers = await providerService.list({ endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES })
    const modelArrays = await Promise.all(providers.map((p) => modelService.list({ providerId: p.id })))
    const firstModel = modelArrays.flat()[0]
    if (!firstModel) {
      logger.info(`No Anthropic-compatible models available yet — skipping ${builtinRole} creation`)
      return { agentId: null, skippedReason: 'no_model' }
    }

    await validateAgentModels('claude-code', { model: firstModel.id })

    const resolvedPaths = resolveAccessiblePaths([], id)
    const workspace = resolvedPaths[0]
    const agentConfig = workspace ? await provisionWorkspace(workspace, builtinRole) : undefined

    const configuration: CreateAgentDto['configuration'] = {
      permission_mode: 'default',
      max_turns: 100,
      env_vars: {},
      ...agentConfig?.configuration
    }

    const req: CreateAgentDto = {
      type: 'claude-code',
      name: agentConfig?.name || builtinRole,
      description: agentConfig?.description || `Built-in ${builtinRole} agent`,
      instructions: agentConfig?.instructions || 'You are a helpful assistant.',
      model: firstModel.id,
      accessiblePaths: resolvedPaths,
      configuration
    }

    const agent = await agentService.createAgent(req)

    try {
      await skillService.initSkillsForAgent(agent.id, resolvedPaths?.[0])
    } catch (error) {
      logger.warn('Failed to seed builtin skills for built-in agent', {
        agentId: id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    logger.info(`Created built-in ${builtinRole} agent`, { id })
    return { agentId: id }
  } catch (error) {
    if (error instanceof AgentModelValidationError) {
      logger.warn(`Skipping built-in ${builtinRole} agent: no compatible model`, error)
      return { agentId: null, skippedReason: 'no_model' }
    }
    logger.error(`Failed to init built-in ${builtinRole} agent`, error as Error)
    throw error
  }
}

async function initCherryAssistant(): Promise<void> {
  try {
    const result = await initBuiltinAgent({
      id: CHERRY_ASSISTANT_AGENT_ID,
      builtinRole: 'assistant',
      provisionWorkspace: provisionBuiltinAgent
    })
    await handleInitResult(CHERRY_ASSISTANT_AGENT_ID, 'Cherry Assistant', result, initCherryAssistant)
  } catch (error) {
    logger.warn('Failed to init Cherry Assistant agent:', error as Error)
  }
}
