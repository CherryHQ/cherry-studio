import { application } from '@application'

export async function cancelJobOrThrow(jobId: string, reason: string): Promise<void> {
  const result = await application.get('JobManager').cancel(jobId, reason)
  if (result.outcome === 'timed-out') {
    throw new Error(`Job cancel timed out: ${jobId}`)
  }
}
