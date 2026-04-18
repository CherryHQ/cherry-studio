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

import type { BuiltinAgentInitResult } from '../AgentService'
import { agentService } from '../AgentService'
import { schedulerService } from '../SchedulerService'
import { sessionService } from '../SessionService'
import { BUILTIN_AGENT_IDS, CHERRY_ASSISTANT_AGENT_ID, CHERRY_CLAW_AGENT_ID, isBuiltinAgentId } from './BuiltinAgentIds'
import { provisionBuiltinAgent } from './BuiltinAgentProvisioner'

const logger = loggerService.withContext('BuiltinAgentBootstrap')
const RETRY_DELAYS_MS = [5000, 15000, 30000]
const retryAttempts = new Map<string, number>()
const retryTimers = new Map<string, NodeJS.Timeout>()

// Re-export for consumers that import from this module
export { BUILTIN_AGENT_IDS, isBuiltinAgentId }

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

async function initCherryClaw(): Promise<void> {
  try {
    const result = await agentService.initDefaultCherryClawAgent()
    await handleInitResult(CHERRY_CLAW_AGENT_ID, 'CherryClaw', result, initCherryClaw, async (agentId) => {
      await schedulerService.ensureHeartbeatTask(agentId, 30)
    })
  } catch (error) {
    logger.warn('Failed to init CherryClaw agent:', error as Error)
  }
}

// ── Cherry Assistant ────────────────────────────────────────────────

export { CHERRY_ASSISTANT_AGENT_ID }

async function initCherryAssistant(): Promise<void> {
  try {
    const result = await agentService.initBuiltinAgent({
      id: CHERRY_ASSISTANT_AGENT_ID,
      builtinRole: 'assistant',
      provisionWorkspace: provisionBuiltinAgent
    })
    await handleInitResult(CHERRY_ASSISTANT_AGENT_ID, 'Cherry Assistant', result, initCherryAssistant)
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
    logger.info('Builtin agent hidden', { agentId })
  }
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

  // Clear soft-delete markers so re-init can recreate rows
  await agentService.clearBuiltinDeletedAt(BUILTIN_AGENT_IDS)

  // Re-run init for each builtin to recreate any missing rows (parallel — different rows)
  await Promise.all([initCherryClaw(), initCherryAssistant()])

  // Collect IDs of agents that now exist in DB (parallel checks)
  const existsResults = await Promise.all(BUILTIN_AGENT_IDS.map((id) => agentService.agentExists(id)))
  const restoredIds = BUILTIN_AGENT_IDS.filter((_, i) => existsResults[i])

  if (restoredIds.length === 0 && previouslyHidden.length > 0) {
    logger.warn('Restore completed but no builtin agents confirmed in DB', { previouslyHidden })
  } else {
    logger.info('Restored builtin agents', { restoredIds, previouslyHidden })
  }

  return restoredIds
}
