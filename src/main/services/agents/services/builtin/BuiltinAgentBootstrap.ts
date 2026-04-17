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

// ── Hide/Show Built-in Agents ────────────────────────────────────────

/** Get the list of hidden built-in agent IDs */
export function getHiddenBuiltinAgents(): string[] {
  return configManager.getDismissedBuiltinAgents()
}

/** Hide a built-in agent by adding its ID to the hidden list */
export function hideBuiltinAgent(agentId: string): void {
  if (!isBuiltinAgentId(agentId)) {
    throw new Error(`Not a builtin agent ID: ${agentId}`)
  }
  const hidden = configManager.getDismissedBuiltinAgents()
  if (!hidden.includes(agentId)) {
    configManager.setDismissedBuiltinAgents([...hidden, agentId])
  }
  logger.info('Builtin agent hidden', { agentId })
}

/** Show a hidden built-in agent by removing its ID from the hidden list */
export function showBuiltinAgent(agentId: string): void {
  if (!isBuiltinAgentId(agentId)) {
    throw new Error(`Not a builtin agent ID: ${agentId}`)
  }
  const hidden = configManager.getDismissedBuiltinAgents()
  configManager.setDismissedBuiltinAgents(hidden.filter((id) => id !== agentId))
  logger.info('Builtin agent shown', { agentId })
}

// ── Restore ─────────────────────────────────────────────────────────

/**
 * Unhide all built-in agents and recreate any missing DB rows.
 * Returns IDs of agents confirmed to exist in DB after restore.
 */
export async function restoreBuiltinAgents(): Promise<string[]> {
  const previouslyHidden = configManager.getDismissedBuiltinAgents()
  configManager.setDismissedBuiltinAgents([])

  // Re-run init for each builtin to recreate any missing rows (parallel — different rows)
  await Promise.all([initCherryClaw(), initCherryAssistant()])

  // Collect IDs of agents that now exist in DB
  const restoredIds: string[] = []
  for (const id of BUILTIN_AGENT_IDS) {
    const exists = await agentService.agentExists(id)
    if (exists) {
      restoredIds.push(id)
    }
  }

  if (restoredIds.length === 0 && previouslyHidden.length > 0) {
    logger.warn('Restore completed but no builtin agents confirmed in DB', { previouslyHidden })
  } else {
    logger.info('Restored builtin agents', { restoredIds, previouslyHidden })
  }

  return restoredIds
}
