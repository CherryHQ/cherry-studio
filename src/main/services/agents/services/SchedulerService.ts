import { loggerService } from '@logger'
import type { AgentEntity, CherryClawConfiguration, SchedulerType } from '@types'
import { CronExpressionParser } from 'cron-parser'

import { agentService } from './AgentService'
import { CherryClawService } from './cherryclaw'
import { sessionMessageService } from './SessionMessageService'
import { sessionService } from './SessionService'

const logger = loggerService.withContext('SchedulerService')

const MAX_CONSECUTIVE_ERRORS = 3

type SchedulerEntry = {
  agentId: string
  type: SchedulerType
  timer: ReturnType<typeof setTimeout> | null
  tickInProgress: boolean
  consecutiveErrors: number
  enabled: boolean
  lastRun?: Date
  nextRun?: Date
}

export type SchedulerStatus = {
  running: boolean
  type: SchedulerType
  tickInProgress: boolean
  nextRun?: Date
  lastRun?: Date
  consecutiveErrors: number
}

class SchedulerService {
  private static instance: SchedulerService | null = null
  private readonly schedulers = new Map<string, SchedulerEntry>()
  private cherryClawService: CherryClawService | null = null

  static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService()
    }
    return SchedulerService.instance
  }

  private getCherryClawService(): CherryClawService {
    if (!this.cherryClawService) {
      this.cherryClawService = new CherryClawService()
    }
    return this.cherryClawService
  }

  startScheduler(agent: AgentEntity): void {
    const config = (agent.configuration ?? {}) as CherryClawConfiguration
    if (!config.scheduler_enabled || !config.scheduler_type) {
      logger.info('Scheduler not enabled for agent', { agentId: agent.id })
      return
    }

    // Stop existing scheduler for this agent if any
    this.stopScheduler(agent.id)

    const entry: SchedulerEntry = {
      agentId: agent.id,
      type: config.scheduler_type,
      timer: null,
      tickInProgress: false,
      consecutiveErrors: 0,
      enabled: true
    }

    this.schedulers.set(agent.id, entry)
    this.scheduleNext(agent.id, config)
    logger.info('Started scheduler', { agentId: agent.id, type: config.scheduler_type })
  }

  stopScheduler(agentId: string): void {
    const entry = this.schedulers.get(agentId)
    if (!entry) return

    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    entry.enabled = false
    this.schedulers.delete(agentId)
    logger.info('Stopped scheduler', { agentId })
  }

  stopAll(): void {
    for (const agentId of this.schedulers.keys()) {
      this.stopScheduler(agentId)
    }
    logger.info('All schedulers stopped')
  }

  async restoreSchedulers(): Promise<void> {
    try {
      const { agents } = await agentService.listAgents({ limit: 1000 })
      const clawAgents = agents.filter(
        (a: AgentEntity) => a.type === 'cherry-claw' && (a.configuration as CherryClawConfiguration)?.scheduler_enabled
      )

      for (const agent of clawAgents) {
        try {
          this.startScheduler(agent)
        } catch (error) {
          logger.error('Failed to restore scheduler for agent', {
            agentId: agent.id,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      logger.info('Restored schedulers', { count: clawAgents.length })
    } catch (error) {
      logger.error('Failed to restore schedulers', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  getSchedulerStatus(agentId: string): SchedulerStatus | null {
    const entry = this.schedulers.get(agentId)
    if (!entry) return null

    return {
      running: entry.enabled,
      type: entry.type,
      tickInProgress: entry.tickInProgress,
      nextRun: entry.nextRun,
      lastRun: entry.lastRun,
      consecutiveErrors: entry.consecutiveErrors
    }
  }

  isRunning(agentId: string): boolean {
    return this.schedulers.has(agentId) && (this.schedulers.get(agentId)?.enabled ?? false)
  }

  private scheduleNext(agentId: string, config: CherryClawConfiguration): void {
    const entry = this.schedulers.get(agentId)
    if (!entry || !entry.enabled) return

    const delayMs = this.computeDelayMs(config)
    if (delayMs === null) {
      logger.warn('Could not compute next delay for scheduler', { agentId, type: config.scheduler_type })
      return
    }

    entry.nextRun = new Date(Date.now() + delayMs)

    entry.timer = setTimeout(() => {
      this.onTick(agentId, config).catch((error) => {
        logger.error('Tick handler error', {
          agentId,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }, delayMs)
  }

  private computeDelayMs(config: CherryClawConfiguration): number | null {
    switch (config.scheduler_type) {
      case 'cron': {
        if (!config.scheduler_cron) return null
        try {
          const cron = CronExpressionParser.parse(config.scheduler_cron)
          const next = cron.next().toDate()
          return Math.max(next.getTime() - Date.now(), 1000) // at least 1s
        } catch {
          logger.warn('Invalid cron expression', { cron: config.scheduler_cron })
          return null
        }
      }
      case 'interval': {
        if (!config.scheduler_interval || config.scheduler_interval <= 0) return null
        return config.scheduler_interval * 1000 // seconds to ms
      }
      case 'one-time': {
        if (!config.scheduler_one_time_delay || config.scheduler_one_time_delay <= 0) return null
        return config.scheduler_one_time_delay * 1000 // seconds to ms
      }
      default:
        return null
    }
  }

  private async onTick(agentId: string, config: CherryClawConfiguration): Promise<void> {
    const entry = this.schedulers.get(agentId)
    if (!entry || !entry.enabled) return

    // Tick guard — skip if previous tick still running
    if (entry.tickInProgress) {
      logger.warn('Skipping tick — previous tick still in progress', { agentId })
      // Reschedule for next interval (unless one-time)
      if (config.scheduler_type !== 'one-time') {
        this.scheduleNext(agentId, config)
      }
      return
    }

    entry.tickInProgress = true
    entry.lastRun = new Date()

    try {
      // Read heartbeat content
      const workspacePath = await this.getAgentWorkspacePath(agentId)
      if (!workspacePath) {
        logger.warn('No workspace path for agent, skipping tick', { agentId })
        return
      }

      let heartbeatContent: string | undefined
      if (config.heartbeat_enabled !== false) {
        const clawService = this.getCherryClawService()
        heartbeatContent = await clawService.heartbeatReader.readHeartbeat(workspacePath, config.heartbeat_file)
      }

      if (!heartbeatContent) {
        logger.warn('No heartbeat content, skipping tick', { agentId })
        return
      }

      // Find most recent session by updated_at desc
      const { sessions } = await sessionService.listSessions(agentId, { limit: 1 })
      if (!sessions || sessions.length === 0) {
        logger.warn('No session found for agent, skipping tick', { agentId })
        return
      }

      const session = await sessionService.getSession(agentId, sessions[0].id)
      if (!session) {
        logger.warn('Session not found', { agentId, sessionId: sessions[0].id })
        return
      }

      // Send heartbeat as user message
      logger.info('Delivering heartbeat to session', {
        agentId,
        sessionId: session.id,
        contentLength: heartbeatContent.length
      })

      const abortController = new AbortController()
      await sessionMessageService.createSessionMessage(session, { content: heartbeatContent }, abortController)

      // Update last run in agent configuration
      await agentService.updateAgent(agentId, {
        configuration: {
          ...config,
          scheduler_last_run: new Date().toISOString()
        }
      })

      entry.consecutiveErrors = 0
    } catch (error) {
      entry.consecutiveErrors++
      logger.error('Tick failed', {
        agentId,
        consecutiveErrors: entry.consecutiveErrors,
        error: error instanceof Error ? error.message : String(error)
      })

      if (entry.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.warn('Pausing scheduler after consecutive errors', {
          agentId,
          errors: entry.consecutiveErrors
        })
        this.stopScheduler(agentId)
        return
      }
    } finally {
      const currentEntry = this.schedulers.get(agentId)
      if (currentEntry) {
        currentEntry.tickInProgress = false
      }
    }

    // Schedule next tick (unless one-time)
    if (config.scheduler_type !== 'one-time' && entry.enabled) {
      this.scheduleNext(agentId, config)
    }
  }

  private async getAgentWorkspacePath(agentId: string): Promise<string | undefined> {
    try {
      const agent = await agentService.getAgent(agentId)
      return agent?.accessible_paths?.[0]
    } catch {
      return undefined
    }
  }
}

export const schedulerService = SchedulerService.getInstance()
