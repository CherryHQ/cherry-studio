import { loggerService } from '@logger'
import { modelsService } from '@main/apiServer/services/models'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import { extractRtkBinaries } from '../utils/rtk'
import { channelManager } from './agents/services/channels'
import { schedulerService } from './agents/services/SchedulerService'

const logger = loggerService.withContext('AgentBootstrapService')
const ProviderTypeSchema = z.enum([
  'openai',
  'openai-response',
  'anthropic',
  'gemini',
  'azure-openai',
  'vertexai',
  'mistral',
  'aws-bedrock',
  'vertex-anthropic',
  'new-api',
  'gateway',
  'ollama'
])
const ModelsFilterSchema = z.strictObject({
  providerType: ProviderTypeSchema.optional(),
  offset: z.coerce.number().min(0).default(0).optional(),
  limit: z.coerce.number().min(1).default(20).optional()
})
const RunTaskArgsSchema = z.strictObject({
  agentId: z.string().min(1),
  taskId: z.string().min(1)
})

export function validateRunTaskArgs(agentId: string, taskId: string) {
  return RunTaskArgsSchema.parse({ agentId, taskId })
}

export function validateGetModelsFilter(filter: unknown) {
  return ModelsFilterSchema.parse(filter ?? {})
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

    this.ipcHandle(IpcChannel.Agent_GetModels, async (_, filter: Parameters<typeof modelsService.getModels>[0]) => {
      return modelsService.getModels(validateGetModelsFilter(filter))
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
