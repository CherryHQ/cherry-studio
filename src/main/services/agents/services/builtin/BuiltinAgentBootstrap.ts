/**
 * BuiltinAgentBootstrap
 *
 * Encapsulates all startup initialization logic for built-in skills and agents
 * (CherryClaw, Cherry Assistant, etc.). Keeps business details out of
 * the main entry point (`src/main/index.ts`).
 */
import { loggerService } from '@logger'
import { installBuiltinSkills } from '@main/utils/builtinSkills'

import { agentService } from '../AgentService'
import { schedulerService } from '../SchedulerService'
import { sessionService } from '../SessionService'
import { provisionBuiltinAgent } from './BuiltinAgentProvisioner'

const logger = loggerService.withContext('BuiltinAgentBootstrap')

/**
 * Initialize all built-in skills and agents. Safe to call multiple times (idempotent).
 *
 * Runs sequentially to avoid concurrent SQLite writes (skills and agents share the
 * same database — parallel transactions cause SQLITE_BUSY failures).
 */
export async function bootstrapBuiltinAgents(): Promise<void> {
  try {
    await installBuiltinSkills()
  } catch (error) {
    logger.error('Failed to install built-in skills', error as Error)
  }
  await initCherryClaw()
  await initCherryAssistant()
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
