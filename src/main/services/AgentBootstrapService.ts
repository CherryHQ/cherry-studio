import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import { extractRtkBinaries } from '../utils/rtk'
import { listMcpTools } from './agents/agentUtils'
import { channelManager } from './agents/services/channels'
import { schedulerService } from './agents/services/SchedulerService'

const logger = loggerService.withContext('AgentBootstrapService')
const RunTaskArgsSchema = z.strictObject({
  agentId: z.string().min(1),
  taskId: z.string().min(1)
})
const AgentTypeSchema = z.enum(['claude-code'])
const ListToolsArgsSchema = z.strictObject({
  type: AgentTypeSchema.default('claude-code'),
  mcps: z.array(z.string()).default([])
})

export function validateRunTaskArgs(agentId: string, taskId: string) {
  return RunTaskArgsSchema.parse({ agentId, taskId })
}

export function validateListToolsArgs(args: unknown) {
  return ListToolsArgsSchema.parse(args ?? {})
}

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

    this.ipcHandle(IpcChannel.Agent_RunTask, async (_, agentId: string, taskId: string) => {
      const parsed = validateRunTaskArgs(agentId, taskId)
      await schedulerService.runTaskNow(parsed.agentId, parsed.taskId)
    })

    this.ipcHandle(IpcChannel.Agent_ListTools, async (_, args: unknown) => {
      const parsed = validateListToolsArgs(args)
      const tools = await listMcpTools(parsed.type, parsed.mcps)
      return tools
    })

    await channelManager.start()
    logger.info('Channel manager started')
  }

  protected async onStop(): Promise<void> {
    // Cleanup belongs to onStop (not onDestroy) so the service is restartable:
    // a restart after `application.stop('AgentBootstrapService')` would
    // otherwise leak two scheduler poll loops + channel adapter sets.
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
