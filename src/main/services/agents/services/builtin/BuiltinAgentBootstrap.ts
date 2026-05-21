/**
 * BuiltinAgentBootstrap
 *
 * Encapsulates all startup initialization logic for built-in skills and agents
 * (CherryClaw, Cherry Assistant, etc.). Keeps business details out of
 * the main entry point (`src/main/index.ts`).
 */
import { loggerService } from '@logger'
import { installBuiltinSkills } from '@main/utils/builtinSkills'

import type { BuiltinAgentInitResult } from '../AgentService'
import { agentService } from '../AgentService'
import { schedulerService } from '../SchedulerService'
import { sessionService } from '../SessionService'
import { CHERRY_ASSISTANT_AGENT_ID, CHERRY_CLAW_AGENT_ID } from './BuiltinAgentIds'
import { provisionBuiltinAgent } from './BuiltinAgentProvisioner'

const logger = loggerService.withContext('BuiltinAgentBootstrap')
const RETRY_DELAYS_MS = [5000, 15000, 30000]
/**
 * After the initial fast retries, fall back to a slow poll for the
 * `no_model` skippedReason. This handles the common scenario where the
 * user opens the app, sees the OOBE flow, and takes longer than ~50s
 * to configure a Provider — without the slow poll, bootstrap would give
 * up and the user would have to restart the app to see the default
 * agents. Refs #14252.
 */
const SLOW_POLL_INTERVAL_MS = 60_000
const retryAttempts = new Map<string, number>()
const retryTimers = new Map<string, NodeJS.Timeout>()

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

function scheduleRetry(
  agentId: string,
  label: string,
  initFn: () => Promise<void>,
  recoverable: boolean = false
): void {
  if (retryTimers.has(agentId)) {
    return
  }

  const attempt = retryAttempts.get(agentId) ?? 0
  let delay: number
  let mode: 'fast' | 'slow-poll'

  if (attempt < RETRY_DELAYS_MS.length) {
    delay = RETRY_DELAYS_MS[attempt]
    mode = 'fast'
  } else if (recoverable) {
    // Fast retries exhausted but the failure is the kind that resolves itself
    // when external state changes (e.g. user adds a Provider). Slow-poll
    // indefinitely so the agent appears as soon as the precondition is met,
    // without forcing the user to restart the app.
    delay = SLOW_POLL_INTERVAL_MS
    mode = 'slow-poll'
  } else {
    logger.info(`Built-in ${label} bootstrap retries exhausted`, { agentId, attempts: attempt })
    return
  }

  retryAttempts.set(agentId, attempt + 1)
  logger.info(`Scheduling built-in ${label} bootstrap retry`, {
    agentId,
    attempt: attempt + 1,
    delayMs: delay,
    mode
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

  // `no_model` resolves when the user adds a Provider, so let the retry
  // loop slow-poll instead of giving up after 3 attempts. Other reasons
  // (DB errors, IO failures) still exhaust fast.
  const recoverable = result.skippedReason === 'no_model'
  scheduleRetry(agentId, label, initFn, recoverable)
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
