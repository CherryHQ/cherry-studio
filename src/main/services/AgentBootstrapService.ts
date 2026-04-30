import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { extractRtkBinaries } from '../utils/rtk'
import { channelManager } from './agents/services/channels'
import { registerSessionStreamIpc } from './agents/services/channels/sessionStreamIpc'
import { schedulerService } from './agents/services/SchedulerService'

const logger = loggerService.withContext('AgentBootstrapService')

/**
 * Lifecycle-managed service that orchestrates agent subsystem initialization.
 *
 * Wraps the non-lifecycle agent singletons (schedulerService, channelManager)
 * so their startup/shutdown is managed by the application lifecycle instead of
 * manual calls in index.ts.
 */
@Injectable('AgentBootstrapService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiServerService'])
export class AgentBootstrapService extends BaseService {
  protected async onReady(): Promise<void> {
    await this.extractRtkBinaries()

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

  private async extractRtkBinaries(): Promise<void> {
    try {
      await extractRtkBinaries()
    } catch (error) {
      logger.warn('Failed to extract rtk binaries (non-fatal)', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
