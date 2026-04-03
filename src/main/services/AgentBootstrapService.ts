import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { bootstrapBuiltinAgents } from './agents/services/builtin/BuiltinAgentBootstrap'
import { channelManager } from './agents/services/channels'
import { registerSessionStreamIpc } from './agents/services/channels/sessionStreamIpc'
import { schedulerService } from './agents/services/SchedulerService'
import { loggerService } from './LoggerService'

const logger = loggerService.withContext('AgentBootstrapService')

/**
 * Lifecycle-managed service that orchestrates agent subsystem initialization.
 *
 * Wraps the non-lifecycle agent singletons (schedulerService, channelManager,
 * bootstrapBuiltinAgents) so their startup/shutdown is managed by the
 * application lifecycle instead of manual calls in index.ts.
 */
@Injectable('AgentBootstrapService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiServerService'])
export class AgentBootstrapService extends BaseService {
  protected async onReady(): Promise<void> {
    await bootstrapBuiltinAgents()
    logger.info('Built-in agents bootstrapped')

    await schedulerService.restoreSchedulers()
    logger.info('Schedulers restored')

    registerSessionStreamIpc()
    logger.info('Session stream IPC registered')

    await channelManager.start()
    logger.info('Channel manager started')
  }

  protected async onDestroy(): Promise<void> {
    schedulerService.stopAll()
    logger.info('Schedulers stopped')

    await channelManager.stop()
    logger.info('Channel manager stopped')
  }
}
