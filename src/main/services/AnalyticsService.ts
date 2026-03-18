import type { TokenUsageData } from '@cherrystudio/analytics-client'
import { AnalyticsClient } from '@cherrystudio/analytics-client'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'

import { configManager } from './ConfigManager'

const logger = loggerService.withContext('AnalyticsService')

class AnalyticsService {
  private client: AnalyticsClient | null = null
  private static instance: AnalyticsService

  public static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService()
    }
    return AnalyticsService.instance
  }

  public init(): void {
    if (!preferenceService.get('app.privacy.data_collection.enabled')) {
      logger.info('Data collection is disabled, skipping analytics initialization')
      return
    }

    this.client = new AnalyticsClient({
      clientId: configManager.getClientId(),
      channel: 'cherry-studio',
      onError: (error) => logger.error('Analytics error:', error)
    })
    logger.info('Analytics service initialized')
  }

  public trackTokenUsage(data: TokenUsageData): void {
    const enableDataCollection = preferenceService.get('app.privacy.data_collection.enabled')

    if (!this.client || !enableDataCollection) {
      return
    }

    this.client.trackTokenUsage(data)
  }

  public async destroy(): Promise<void> {
    if (!this.client) return
    await this.client.destroy()
    this.client = null
    logger.info('Analytics service destroyed')
  }
}

export const analyticsService = AnalyticsService.getInstance()
