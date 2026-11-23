import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { HEARTBEAT_PROMPT_SENTINEL } from '@data/services/AgentTaskService'
import { jobService } from '@data/services/JobService'
import type { JobSettledEvent } from '@main/core/job/types'
import { analyticsAgentKind, trackMainProductEvent } from '@main/services/productAnalytics'
import { triggerToFormState } from '@shared/ai/scheduleTrigger'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import type { AgentTaskInput, AgentTaskOutput } from './runAgentTask'

export type ScheduledTaskChangeOrigin = 'ui' | 'agent_tool'

export function trackScheduledTaskChanged(
  action: 'created' | 'updated' | 'paused' | 'resumed' | 'deleted',
  task: ScheduledTaskEntity,
  origin: ScheduledTaskChangeOrigin
): void {
  try {
    trackMainProductEvent({
      event: 'scheduled_task_changed',
      action,
      origin,
      frequency: triggerToFormState(task.trigger).kind,
      agentKind: analyticsAgentKind(task.agentId),
      hasWorkspace: task.workspace.type !== AGENT_WORKSPACE_TYPE.SYSTEM,
      reuseSession: task.reuseSession,
      channelCount: task.channelIds?.length ?? 0
    })
  } catch {
    // Reading the task's agent must not fail the command.
  }
}

// "Run now" requests waiting for their job, then the jobs they produced; in memory, so a restart reads as scheduled.
const pendingManualRuns = new Set<string>()
// Kept on the job row: a queued Run Now can outlive this process and run from startup recovery.
const MANUAL_RUN_METADATA_KEY = 'manualRun'

export function markManualRun(scheduleId: string): void {
  pendingManualRuns.add(scheduleId)
}

export function clearManualRun(scheduleId: string): void {
  pendingManualRuns.delete(scheduleId)
}

export function claimManualRun(scheduleId: string, jobId: string): void {
  if (!pendingManualRuns.delete(scheduleId)) return
  try {
    const db = application.get('DbService').getDb()
    const metadata = jobService.getById(jobId)?.metadata ?? {}
    jobService.setMetadataTx(db, jobId, { ...metadata, [MANUAL_RUN_METADATA_KEY]: true })
  } catch {
    // Losing the label only reports the run as scheduled.
  }
}

function runResult(
  event: JobSettledEvent<AgentTaskInput>,
  cancelRequested: boolean
): 'success' | 'failed' | 'cancelled' | 'interrupted' | 'skipped' {
  if (event.status === 'completed') {
    return (event.output as AgentTaskOutput | undefined)?.kind === 'skipped' ? 'skipped' : 'success'
  }
  const paused = event.metadata.taskResultStatus
  if (paused === 'cancelled' || paused === 'interrupted') return paused
  if (event.status === 'failed') return 'failed'
  return cancelRequested ? 'cancelled' : 'interrupted'
}

/** One event per settled run of a task schedule; ad-hoc jobs without a schedule stay silent. */
export function trackScheduledTaskRun(event: JobSettledEvent<AgentTaskInput>, autoPaused: boolean): void {
  if (!event.scheduleId) return
  const run = event.metadata[MANUAL_RUN_METADATA_KEY] === true ? 'manual' : 'scheduled'
  try {
    const job = jobService.getById(event.jobId)
    const result = runResult(event, job?.cancelRequested === true)
    const skipReason = result === 'skipped' ? (event.output as AgentTaskOutput).skipReason : undefined
    const durationMs =
      job?.startedAt && job.finishedAt ? Math.max(0, Date.parse(job.finishedAt) - Date.parse(job.startedAt)) : undefined
    trackMainProductEvent({
      event: 'scheduled_task_run',
      kind: event.input.prompt === HEARTBEAT_PROMPT_SENTINEL ? 'heartbeat' : 'task',
      result,
      ...(skipReason && { skipReason }),
      run,
      ...(durationMs !== undefined && Number.isFinite(durationMs) && { durationMs }),
      channelCount:
        typeof event.metadata.channelCount === 'number'
          ? event.metadata.channelCount
          : agentChannelService.getSubscribedChannels(event.scheduleId).length,
      ...(autoPaused && { autoPaused })
    })
  } catch {
    // Run bookkeeping must not fail the job's settle hook.
  }
}
