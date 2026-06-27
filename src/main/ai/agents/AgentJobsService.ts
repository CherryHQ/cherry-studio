import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { agentTaskJobHandler } from './agentTaskJobHandler'

@Injectable('AgentJobsService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['JobManager'])
export class AgentJobsService extends BaseService {
  protected async onInit(): Promise<void> {
    application.get('JobManager').registerHandler('agent.task', agentTaskJobHandler)
  }

  /** Run a scheduled agent task now (`ai.run_agent_task`). Returns whether the trigger fired. */
  runTask(taskId: string): Promise<boolean> {
    return application.get('JobManager').triggerJobScheduleNowById(taskId)
  }
}
