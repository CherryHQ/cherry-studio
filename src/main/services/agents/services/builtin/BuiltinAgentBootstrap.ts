/**
 * BuiltinAgentBootstrap
 *
 * Creation helpers for the two built-in agent templates (CherryClaw and
 * Cherry Assistant). These are intentionally NOT called at startup — agents
 * are created on-demand when the user triggers them.
 */
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { modelsService } from '@main/apiServer/services/models'
import { resolveAccessiblePaths, validateAgentModels } from '@main/services/agents/agentUtils'
import { AgentModelValidationError } from '@main/services/agents/errors'
import { seedWorkspaceTemplates } from '@main/services/agents/services/cherryclaw/seedWorkspace'
import { skillService } from '@main/services/agents/skills/SkillService'
import type { CreateAgentDto } from '@shared/data/api/schemas/agents'

import { CHERRY_ASSISTANT_AGENT_ID, CHERRY_CLAW_AGENT_ID } from './BuiltinAgentIds'
import { provisionBuiltinAgent } from './BuiltinAgentProvisioner'

export { CHERRY_ASSISTANT_AGENT_ID }

const logger = loggerService.withContext('BuiltinAgentBootstrap')

export type BuiltinAgentCreateResult =
  | { agentId: string; skippedReason?: undefined }
  | { agentId: null; skippedReason: 'no_model' }

/**
 * Create a CherryClaw agent. Requires at least one Anthropic-compatible model.
 * Returns `{ agentId: null, skippedReason: 'no_model' }` if none is available.
 */
export async function initCherryClaw(): Promise<BuiltinAgentCreateResult> {
  const id = CHERRY_CLAW_AGENT_ID
  try {
    const modelsRes = await modelsService.getModels({ providerType: 'anthropic', limit: 1 })
    const firstModel = modelsRes.data?.[0]
    if (!firstModel) {
      logger.info('No Anthropic-compatible models available — skipping CherryClaw creation')
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

    const resolvedPaths = resolveAccessiblePaths([])

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

    logger.info('Created CherryClaw agent', { id: agent.id })
    return { agentId: agent.id }
  } catch (error) {
    if (error instanceof AgentModelValidationError) {
      logger.warn('Skipping CherryClaw agent: no compatible model', error)
      return { agentId: null, skippedReason: 'no_model' }
    }
    logger.error('Failed to create CherryClaw agent', error as Error)
    throw error
  }
}

/**
 * Create a built-in agent from a template. Requires at least one
 * Anthropic-compatible model. Returns `{ agentId: null, skippedReason: 'no_model' }`
 * if none is available.
 */
export async function initBuiltinAgent(opts: {
  builtinRole: string
  builtinName?: string
  provisionWorkspace?: (
    workspacePath: string,
    builtinRole: string
  ) => Promise<
    { name?: string; description?: string; instructions?: string; configuration?: Record<string, unknown> } | undefined
  >
}): Promise<BuiltinAgentCreateResult> {
  const { builtinRole, builtinName, provisionWorkspace = provisionBuiltinAgent } = opts
  try {
    const modelsRes = await modelsService.getModels({ providerType: 'anthropic', limit: 1 })
    const firstModel = modelsRes.data?.[0]
    if (!firstModel) {
      logger.info(`No Anthropic-compatible models available — skipping ${builtinRole} creation`)
      return { agentId: null, skippedReason: 'no_model' }
    }

    await validateAgentModels('claude-code', { model: firstModel.id })

    const resolvedPaths = resolveAccessiblePaths([])
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
      name: builtinName ?? agentConfig?.name ?? builtinRole,
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
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    logger.info(`Created built-in ${builtinRole} agent`, { id: agent.id })
    return { agentId: agent.id }
  } catch (error) {
    if (error instanceof AgentModelValidationError) {
      logger.warn(`Skipping built-in ${builtinRole} agent: no compatible model`, error)
      return { agentId: null, skippedReason: 'no_model' }
    }
    logger.error(`Failed to create built-in ${builtinRole} agent`, error as Error)
    throw error
  }
}

/**
 * Convenience wrapper: create a Cherry Assistant agent using the default provisioner.
 */
export async function initCherryAssistant(): Promise<BuiltinAgentCreateResult> {
  return initBuiltinAgent({
    builtinRole: 'assistant',
    builtinName: CHERRY_ASSISTANT_AGENT_ID
  })
}
