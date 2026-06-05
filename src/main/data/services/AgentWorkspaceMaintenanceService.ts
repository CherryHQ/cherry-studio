import { workspaceWorkflowService } from '@data/services/WorkspaceWorkflowService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('AgentWorkspaceMaintenanceService')

@Injectable('AgentWorkspaceMaintenanceService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['DbService'])
export class AgentWorkspaceMaintenanceService extends BaseService {
  protected async onInit(): Promise<void> {
    const removedCount = await workspaceWorkflowService.sweepOrphanSystemWorkspaces()
    if (removedCount > 0) {
      logger.info('Cleaned orphan system workspaces', { count: removedCount })
    }
  }
}
