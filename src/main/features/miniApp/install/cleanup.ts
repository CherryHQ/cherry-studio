import { loggerService } from '@logger'

const logger = loggerService.withContext('miniAppCleanup')

/**
 * Cleanup is best-effort BY POLICY: a temp file or staging tree that will not delete
 * is a leak to LOG — never a reason to mask the operation's own outcome, success
 * ("errored UI over an app that actually installed") or failure (the original error).
 * Returns whether the cleanup itself succeeded, so a caller that COUNTS (the startup
 * sweep) can report reality; most callers ignore it.
 */
export async function bestEffortCleanup(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (error) {
    logger.warn('Mini app cleanup failed', { label, error })
    return false
  }
}
