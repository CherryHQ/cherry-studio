import { application } from '@application'
import { loggerService } from '@logger'
import { modelsService } from '@main/apiServer/services/models'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import { extractRtkBinaries } from '../utils/rtk'
import { listMcpTools } from './agents/agentUtils'
import { channelManager } from './agents/services/channels'
import { registerSessionStreamIpc } from './agents/services/channels/sessionStreamIpc'
import { AgentTaskJobHandler } from './agents/tasks/AgentTaskJobHandler'

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
const AgentTypeSchema = z.enum(['claude-code'])
const ListToolsArgsSchema = z.strictObject({
  type: AgentTypeSchema.default('claude-code'),
  mcps: z.array(z.string()).default([])
})

export function validateRunTaskArgs(agentId: string, taskId: string) {
  return RunTaskArgsSchema.parse({ agentId, taskId })
}

export function validateGetModelsFilter(filter: unknown) {
  return ModelsFilterSchema.parse(filter ?? {})
}

export function validateListToolsArgs(args: unknown) {
  return ListToolsArgsSchema.parse(args ?? {})
}

/**
 * Lifecycle-managed service that orchestrates agent subsystem initialization.
 *
 * Wires the agent.task JobHandler into JobManager (onInit) and brings up the
 * channel manager + IPC surface (onReady). Schedule arming, dispatch, and
 * shutdown of scheduled tasks are owned by JobManager + SchedulerService.
 */
@Injectable('AgentBootstrapService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiServerService', 'JobManager'])
export class AgentBootstrapService extends BaseService {
  protected override onInit(): void {
    // Register handler before JobManager.onAllReady runs startup recovery —
    // otherwise recovery would treat any agent.task row as an orphan and
    // cancel it. onInit runs in dependency order; @DependsOn above pins
    // JobManager before this service so application.get('JobManager') is
    // safe here.
    application.get('JobManager').registerHandler('agent.task', AgentTaskJobHandler)
    logger.info('AgentTaskJobHandler registered')
  }

  protected async onReady(): Promise<void> {
    await this.extractRtkBinaries()

    registerSessionStreamIpc()
    logger.info('Session stream IPC registered')

    this.ipcHandle(IpcChannel.Agent_RunTask, async (_, agentId: string, taskId: string) => {
      const parsed = validateRunTaskArgs(agentId, taskId)
      const triggered = await application.get('JobManager').triggerJobScheduleNowById(parsed.taskId)
      if (!triggered) {
        throw new Error(`Task not found: ${parsed.taskId}`)
      }
    })

    this.ipcHandle(IpcChannel.Agent_GetModels, async (_, filter: Parameters<typeof modelsService.getModels>[0]) => {
      return modelsService.getModels(validateGetModelsFilter(filter))
    })

    this.ipcHandle(IpcChannel.Agent_ListTools, async (_, args: unknown) => {
      const parsed = validateListToolsArgs(args)
      const { tools } = await listMcpTools(parsed.type, parsed.mcps)
      return tools
    })

    await channelManager.start()
    logger.info('Channel manager started')
  }

  protected async onDestroy(): Promise<void> {
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
