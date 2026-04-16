/**
 * BuiltinAgentBootstrap
 *
 * Encapsulates all startup initialization logic for built-in skills and agents
 * (CherryClaw, Cherry Assistant, etc.). Keeps business details out of
 * the main entry point (`src/main/index.ts`).
 */
import { loggerService } from '@logger'
import { configManager } from '@main/services/ConfigManager'
import { installBuiltinSkills } from '@main/utils/builtinSkills'

import { agentService } from '../AgentService'
import { schedulerService } from '../SchedulerService'
import { sessionService } from '../SessionService'
import { provisionBuiltinAgent } from './BuiltinAgentProvisioner'

const logger = loggerService.withContext('BuiltinAgentBootstrap')

/** All builtin agent IDs — single source of truth for dismiss/restore logic */
export const BUILTIN_AGENT_IDS = ['cherry-claw-default', 'cherry-assistant-default'] as const

/** Check if an agent ID belongs to a builtin agent */
export const isBuiltinAgentId = (id: string): boolean => BUILTIN_AGENT_IDS.includes(id as (typeof BUILTIN_AGENT_IDS)[number])

/**
 * Initialize all built-in skills and agents. Safe to call multiple times (idempotent).
 *
 * Skills are installed first (shared dependency). Agent inits run in parallel
 * since they operate on different rows and don't conflict.
 */
export async function bootstrapBuiltinAgents(): Promise<void> {
  try {
    await installBuiltinSkills()
  } catch (error) {
    logger.error('Failed to install built-in skills', error as Error)
  }
  await Promise.all([initCherryClaw(), initCherryAssistant()])
}

// ── CherryClaw ──────────────────────────────────────────────────────

async function initCherryClaw(): Promise<void> {
  try {
    const agentId = await agentService.initDefaultCherryClawAgent()
    if (!agentId) return

    // Ensure the default agent has at least one session
    const { total } = await sessionService.listSessions(agentId, { limit: 1 })
    if (total === 0) {
      await sessionService.createSession(agentId, {})
      logger.info('Default session created for CherryClaw agent')
    }

    await schedulerService.ensureHeartbeatTask(agentId, 30)
  } catch (error) {
    logger.warn('Failed to init CherryClaw agent:', error as Error)
  }
}

// ── Cherry Assistant ────────────────────────────────────────────────

export const CHERRY_ASSISTANT_AGENT_ID = 'cherry-assistant-default'

async function initCherryAssistant(): Promise<void> {
  try {
    const agentId = await agentService.initBuiltinAgent({
      id: CHERRY_ASSISTANT_AGENT_ID,
      builtinRole: 'assistant',
      provisionWorkspace: provisionBuiltinAgent
    })
    if (!agentId) return

    // Ensure the assistant agent has at least one session
    const { total } = await sessionService.listSessions(agentId, { limit: 1 })
    if (total === 0) {
      await sessionService.createSession(agentId, {})
      logger.info('Default session created for Cherry Assistant agent')
    }
  } catch (error) {
    logger.warn('Failed to init Cherry Assistant agent:', error as Error)
  }
}

// ── Restore ─────────────────────────────────────────────────────────

/**
 * Restore previously dismissed built-in agents.
 * Clears the dismissed list and recreates any missing agents sequentially.
 * Returns IDs of agents that were actually created.
 */
export async function restoreBuiltinAgents(): Promise<string[]> {
  // Clear dismissed list so init methods won't skip them
  configManager.setDismissedBuiltinAgents([])

  // Re-init each builtin agent sequentially to avoid race conditions
  const cherryClawId = await agentService.initDefaultCherryClawAgent()
  const cherryAssistantId = await agentService.initBuiltinAgent({
    id: CHERRY_ASSISTANT_AGENT_ID,
    builtinRole: 'assistant',
    provisionWorkspace: provisionBuiltinAgent
  })

  // Also ensure sessions and heartbeat for newly created agents
  if (cherryClawId) {
    const { total: clawSessions } = await sessionService.listSessions(cherryClawId, { limit: 1 })
    if (clawSessions === 0) {
      await sessionService.createSession(cherryClawId, {})
    }
    await schedulerService.ensureHeartbeatTask(cherryClawId, 30)
  }

  if (cherryAssistantId) {
    const { total: assistantSessions } = await sessionService.listSessions(cherryAssistantId, { limit: 1 })
    if (assistantSessions === 0) {
      await sessionService.createSession(cherryAssistantId, {})
    }
  }

  const restoredIds: string[] = []
  for (const id of BUILTIN_AGENT_IDS) {
    const exists = await agentService.agentExists(id)
    if (exists) {
      restoredIds.push(id)
    }
  }

  logger.info('Restored builtin agents', { restoredIds })
  return restoredIds
}
