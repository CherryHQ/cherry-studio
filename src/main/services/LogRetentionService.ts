import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { cacheCleanupService } from '@main/services/cacheCleanup'

const logger = loggerService.withContext('LogRetentionService')

// Twice a day: rotation is daily, so this only has to catch the day boundary of a
// long-running app. The sweep also runs at startup and whenever retention changes.
const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000

/**
 * Enforces the user's log retention window over the whole logs directory. The
 * rotating transports keep their own generous `maxFiles` cap purely as a backstop;
 * the retention the user sees is this sweep.
 */
@Injectable('LogRetentionService')
@ServicePhase(Phase.WhenReady)
export class LogRetentionService extends BaseService {
  protected onReady(): void {
    void this.sweep()
    this.registerInterval(() => void this.sweep(), SWEEP_INTERVAL_MS)
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('app.logs.retention_days', () => void this.sweep())
    )
  }

  private async sweep(): Promise<void> {
    const retentionDays = application.get('PreferenceService').get('app.logs.retention_days')
    try {
      const removed = await cacheCleanupService.sweepLogs(retentionDays)
      if (removed > 0) {
        logger.info('Removed log files past the retention window', { retentionDays, removed })
      }
    } catch (error) {
      logger.error('Log retention sweep failed', error as Error)
    }
  }
}
