import { application } from '@application'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { t } from '@main/i18n'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import type { TaskResultNotificationInput } from '@shared/data/types/notification'

import type { AgentTaskOutput } from './runAgentTask'

export async function publishScheduledTaskResult(jobId: string): Promise<boolean> {
  const job = jobService.getById(jobId)

  if (!job?.scheduleId || !job.finishedAt || !['completed', 'failed', 'cancelled'].includes(job.status)) return false

  if (job.status === 'completed' && (job.output as AgentTaskOutput | null)?.kind !== 'executed') return false
  const schedule = jobScheduleService.getById(job.scheduleId)

  if (!schedule) return false
  const finishedAt = Date.parse(job.finishedAt)

  const input: Omit<TaskResultNotificationInput, 'target'> = {
    resultId: job.id,
    source: 'scheduled-task',
    status:
      job.status === 'completed'
        ? 'succeeded'
        : job.metadata.taskResultStatus === 'cancelled' || job.metadata.taskResultStatus === 'interrupted'
          ? job.metadata.taskResultStatus
          : job.status === 'failed'
            ? 'failed'
            : job.cancelRequested
              ? 'cancelled'
              : 'interrupted',
    name: schedule.name || t('notification.result.failed'),
    finishedAt
  }

  if (job.startedAt) input.durationMs = Math.max(0, finishedAt - Date.parse(job.startedAt))

  if (job.error)
    input.errorSummary = toExecutionFailure({ name: null, stack: null, message: job.error.message }).message

  return application.get('NotificationService').publishTaskResult({
    ...input,
    target: { kind: 'scheduled-task', taskId: job.scheduleId }
  })
}
