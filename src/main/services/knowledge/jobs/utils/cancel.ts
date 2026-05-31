import { application } from '@application'
import { JOB_ERROR_CODES } from '@main/core/job/errorCodes'

export async function cancelJobOrThrow(jobId: string, reason: string): Promise<void> {
  const jobManager = application.get('JobManager')
  await jobManager.cancel(jobId, reason)

  const snapshot = await jobManager.get(jobId)
  if (
    snapshot?.error?.code === JOB_ERROR_CODES.CANCELLED &&
    snapshot.error.message.startsWith('Cancel timed out after')
  ) {
    throw new Error(`Job cancel timed out: ${jobId}`)
  }
}
