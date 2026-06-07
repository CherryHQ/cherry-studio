import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'

import { AgentTaskJobHandler } from './AgentTaskJobHandler'

@Injectable('AgentJobsService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['JobManager'])
export class AgentJobsService extends BaseService {
  protected async onInit(): Promise<void> {
    const jobManager = application.get('JobManager')
    jobManager.registerHandler('agent.task', AgentTaskJobHandler)

    this.ipcHandle(IpcChannel.Ai_Agent_RunTask, async (_event, taskId: string) => {
      return jobManager.triggerJobScheduleNowById(taskId)
    })
  }
}
