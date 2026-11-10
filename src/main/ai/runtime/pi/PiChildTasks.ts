import type { SubagentView } from '@cherrystudio/agent-behavior'
import type { Subagent } from '@cherrystudio/agent-runtime'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

import type { AgentRuntimeEvent } from '../types'
import { childTaskStatus } from './childTaskStatus'

export class PiChildTasks {
  private readonly states = new Map<string, AgentTaskEventPartData>()

  constructor(
    private readonly origin: (id: string) => Subagent['origin'],
    private readonly emit: (event: AgentRuntimeEvent) => void
  ) {}

  status(id: string): AgentTaskEventPartData['status'] | undefined {
    return this.states.get(id)?.status
  }

  publish(id: string, status: AgentTaskEventPartData['status'], background?: boolean): void {
    const origin = this.origin(id)
    const previous = this.states.get(id)
    const isBackgrounded = background ?? previous?.isBackgrounded ?? false
    if (
      previous &&
      previous.status === status &&
      previous.isBackgrounded === isBackgrounded &&
      previous.toolUseId === origin?.toolCallId
    )
      return
    const data: AgentTaskEventPartData = {
      event: !previous ? 'started' : status === 'in_progress' ? 'updated' : 'notification',
      taskId: id,
      toolUseId: origin?.toolCallId,
      taskType: 'subagent',
      title: origin?.description ?? previous?.title,
      status,
      isBackgrounded
    }
    this.states.set(id, data)
    this.emit({ type: 'background-task-event', data })
  }

  showSubagents(views: readonly SubagentView[], listRunning: boolean): void {
    for (const view of views)
      this.publish(view.sessionId, view.status === 'finished' ? childTaskStatus(view.outcome) : 'in_progress', true)
    if (!listRunning) return
    this.emit({
      type: 'background-tasks',
      tasks: views
        .filter((view) => view.status !== 'finished')
        .map((view) => ({
          id: view.sessionId,
          type: 'subagent',
          description: view.description,
          toolCallId: this.origin(view.sessionId)?.toolCallId
        }))
    })
  }
}
