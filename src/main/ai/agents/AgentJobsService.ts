import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { AgentTaskJobHandler } from './AgentTaskJobHandler'

@Injectable('AgentJobsService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['JobManager'])
export class AgentJobsService extends BaseService {
  protected async onInit(): Promise<void> {
    application.get('JobManager').registerHandler('agent.task', AgentTaskJobHandler)
  }

  /** Run a scheduled agent task now (`ai.run_agent_task`). Returns whether the trigger fired. */
  runTask(taskId: string): Promise<boolean> {
    return application.get('JobManager').triggerJobScheduleNowById(taskId)
  }
}
