import type { JobHandler, JobSettledEvent } from '@main/core/job/types'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileProcessingTask, FileProcessingTaskId } from '@shared/data/types/fileProcessing'

import type { SettledFileProcessingTask } from '../types'
import { type FileProcessingJobPayload, FileProcessingJobOutputSchema } from './shared'

type TaskJob = Pick<FileProcessingJobPayload, 'feature' | 'processorId'>
type SettledJob = Pick<JobSettledEvent, 'status' | 'output' | 'error'>

const FILE_PROCESSING_JOB_TYPES: ReadonlySet<string> = new Set([
  'file-processing.background',
  'file-processing.background-local',
  'file-processing.remote-poll'
])

export function isFileProcessingJobType(type: string): boolean {
  return FILE_PROCESSING_JOB_TYPES.has(type)
}

/** A task is the job that runs its conversion, under the same id. */
export function toFileProcessingTaskId(jobId: string): FileProcessingTaskId {
  return jobId as FileProcessingTaskId
}

function taskFields(id: FileProcessingTaskId, job: TaskJob) {
  return { id, feature: job.feature, processorId: job.processorId }
}

export function toQueuedTask(id: FileProcessingTaskId, job: TaskJob): FileProcessingTask {
  return { ...taskFields(id, job), status: 'queued' }
}

export function toSettledTask(id: FileProcessingTaskId, job: TaskJob, settled: SettledJob): SettledFileProcessingTask {
  const fields = taskFields(id, job)
  const error = settled.error?.message ?? 'no error details'
  switch (settled.status) {
    case 'completed':
      return { ...fields, status: 'completed', artifact: FileProcessingJobOutputSchema.parse(settled.output).artifact }
    case 'failed':
      return { ...fields, status: 'failed', error }
    case 'cancelled':
      return { ...fields, status: 'cancelled', error }
  }
}

/** The task a job row describes now. A row records no progress, so `progress` is the latest one reported. */
export function toFileProcessingTask(snapshot: JobSnapshot, progress: number): FileProcessingTask {
  const id = toFileProcessingTaskId(snapshot.id)
  const job = snapshot.input as FileProcessingJobPayload
  switch (snapshot.status) {
    case 'pending':
    case 'delayed':
      return toQueuedTask(id, job)
    case 'running':
      return { ...taskFields(id, job), status: 'processing', progress }
    default:
      return toSettledTask(id, job, { status: snapshot.status, output: snapshot.output, error: snapshot.error })
  }
}

/**
 * Publish a handler's task changes: `processing` when an attempt starts and on
 * each progress report, then the terminal state once the job settles.
 */
export function withTaskUpdates(
  handler: JobHandler<FileProcessingJobPayload>,
  publish: (task: FileProcessingTask) => void
): JobHandler<FileProcessingJobPayload> {
  return {
    ...handler,
    execute(ctx) {
      const id = toFileProcessingTaskId(ctx.jobId)
      const publishProgress = (progress: number) => {
        // A cancelled or timed-out attempt can keep running after its task settled.
        if (!ctx.signal.aborted) publish({ ...taskFields(id, ctx.input), status: 'processing', progress })
      }
      publishProgress(0)
      return handler.execute({
        ...ctx,
        reportProgress: (progress, detail) => {
          ctx.reportProgress(progress, detail)
          publishProgress(progress)
        }
      })
    },
    onSettled(event) {
      publish(toSettledTask(toFileProcessingTaskId(event.jobId), event.input, event))
    }
  }
}
