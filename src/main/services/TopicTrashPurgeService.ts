import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('TopicTrashPurgeService')

// Run once a day — the 30-day window is not minute-sensitive.
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Enforces the 30-day soft-delete retention window for topics. Topics deleted
 * by the user land in the trash (deletedAt set); this service sweeps expired
 * rows at startup and once a day thereafter.
 */
@Injectable('TopicTrashPurgeService')
@ServicePhase(Phase.WhenReady)
export class TopicTrashPurgeService extends BaseService {
  protected onReady(): void {
    this.sweep()
    this.registerInterval(() => this.sweep(), PURGE_INTERVAL_MS)
  }

  private sweep(): void {
    try {
      topicService.purgeOldTrashed()
    } catch (error) {
      logger.error('Topic trash purge failed', error as Error)
    }
  }
}
