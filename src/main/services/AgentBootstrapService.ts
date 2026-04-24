import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { ModelsService } from '@main/apiServer/services/models'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
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
export class AgentBootstrapService extends BaseService {
  protected async onReady(): Promise<void> {
    await this.extractRtkBinaries()

    await bootstrapBuiltinAgents()
    logger.info('Built-in agents bootstrapped')

    await schedulerService.restoreSchedulers()
    logger.info('Schedulers restored')

    registerSessionStreamIpc()
    logger.info('Session stream IPC registered')

    this.ipcHandle(IpcChannel.Agent_ReorderAgents, async (_, orderedIds: string[]) => {
      // TODO: migrate to DataAPI PATCH /agents/:id/order (fractional indexing)
      // when orderKey column is added to agentTable.
      // See docs/references/data/data-ordering-guide.md
      await agentService.reorderAgents(orderedIds)
    })

    this.ipcHandle(IpcChannel.Agent_ReorderSessions, async (_, agentId: string, orderedIds: string[]) => {
      // TODO: migrate to DataAPI PATCH /agents/:agentId/sessions/:id/order
      // when orderKey column is added to agentSessionTable.
      // See docs/references/data/data-ordering-guide.md
      await agentSessionService.reorderSessions(agentId, orderedIds)
    })

    this.ipcHandle(IpcChannel.Agent_RunTask, async (_, agentId: string, taskId: string) => {
      await schedulerService.runTaskNow(agentId, taskId)
    })

    this.ipcHandle(IpcChannel.Agent_GetModels, async (_, filter: Parameters<ModelsService['getModels']>[0]) => {
      const modelsService = new ModelsService()
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
