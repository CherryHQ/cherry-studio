import type { TokenUsageData } from '@cherrystudio/analytics-client'
import { AnalyticsClient } from '@cherrystudio/analytics-client'
import { loggerService } from '@logger'
import { generateUserAgent } from '@main/utils/systemInfo'
import { APP_NAME } from '@shared/config/constant'
import { app } from 'electron'

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
    if (!configManager.getEnableDataCollection()) {
      logger.info('Analytics service disabled by user preference')
      return
    }

    this.client = new AnalyticsClient({
      clientId: configManager.getClientId(),
      channel: 'cherry-studio',
      onError: (error) => logger.error('Analytics error:', error),
      headers: {
        'User-Agent': generateUserAgent(),
        'Client-Id': configManager.getClientId(),
        'App-Name': APP_NAME,
        'App-Version': `v${app.getVersion()}`,
        OS: process.platform
      }
    })

    this.client.trackAppLaunch({
      version: app.getVersion(),
      os: process.platform
    })

    logger.info('Analytics service initialized')
  }

  public trackTokenUsage(data: TokenUsageData): void {
    const enableDataCollection = configManager.getEnableDataCollection()

    if (!this.client || !enableDataCollection) {
      return
    }

    this.client.trackTokenUsage(data)
  }

  public async trackAppUpdate(): Promise<void> {
    if (!this.client || !configManager.getEnableDataCollection()) {
      return
    }

    await this.client.trackAppUpdate()
  }

  public async destroy(): Promise<void> {
    if (!this.client) return
    await this.client.destroy()
    this.client = null
    logger.info('Analytics service destroyed')
  }
}

export const analyticsService = AnalyticsService.getInstance()
