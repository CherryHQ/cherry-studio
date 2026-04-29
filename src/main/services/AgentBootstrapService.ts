import { loggerService } from '@logger'
import { modelsService } from '@main/apiServer/services/models'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'

import { extractRtkBinaries } from '../utils/rtk'
import { bootstrapBuiltinAgents } from './agents/services/builtin/BuiltinAgentBootstrap'
import { channelManager } from './agents/services/channels'
import { registerSessionStreamIpc } from './agents/services/channels/sessionStreamIpc'
import { schedulerService } from './agents/services/SchedulerService'

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
    await this.extractRtkBinaries()

    await bootstrapBuiltinAgents()
    logger.info('Built-in agents bootstrapped')

    await schedulerService.restoreSchedulers()
    logger.info('Schedulers restored')

    registerSessionStreamIpc()
    logger.info('Session stream IPC registered')

    this.ipcHandle(IpcChannel.Agent_RunTask, async (_, agentId: string, taskId: string) => {
      await schedulerService.runTaskNow(agentId, taskId)
    })

    this.ipcHandle(IpcChannel.Agent_GetModels, async (_, filter: Parameters<typeof modelsService.getModels>[0]) => {
      return modelsService.getModels(filter)
    })

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
