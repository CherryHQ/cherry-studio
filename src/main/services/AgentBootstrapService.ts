import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { bootstrapBuiltinAgents } from './agents/services/builtin/BuiltinAgentBootstrap'
import { channelManager } from './agents/services/channels'
import { registerSessionStreamIpc } from './agents/services/channels/sessionStreamIpc'
import { schedulerService } from './agents/services/SchedulerService'
import { loggerService } from './LoggerService'

const logger = loggerService.withContext('AgentBootstrapService')

/**
 * Lifecycle-managed service that orchestrates agent subsystem initialization.
 *
 * Uses Phase.Background — fire-and-forget, never blocks other phases.
 * All operations are idempotent and non-critical for UI startup.
 */
@Injectable('AgentBootstrapService')
@ServicePhase(Phase.Background)
export class AgentBootstrapService extends BaseService {
  protected async onReady(): Promise<void> {
    registerSessionStreamIpc()
    logger.info('Session stream IPC registered')

    await Promise.all([
      bootstrapBuiltinAgents().then(() => logger.info('Built-in agents bootstrapped')),
      schedulerService.restoreSchedulers().then(() => logger.info('Schedulers restored')),
      channelManager.start().then(() => logger.info('Channel manager started'))
    ])
  }

  protected async onDestroy(): Promise<void> {
    schedulerService.stopAll()
    logger.info('Schedulers stopped')

    await channelManager.stop()
    logger.info('Channel manager stopped')
  }
}
