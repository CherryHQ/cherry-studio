import type { TokenUsageData } from '@cherrystudio/analytics-client'
import { AnalyticsClient } from '@cherrystudio/analytics-client'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { generateUserAgent, getClientId } from '@main/utils/systemInfo'
import { APP_NAME } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { app } from 'electron'

const logger = loggerService.withContext('AnalyticsService')

@Injectable('AnalyticsService')
@ServicePhase(Phase.WhenReady)
export class AnalyticsService extends BaseService {
  private client: AnalyticsClient | null = null

  protected async onInit() {
    this.registerIpcHandlers()

    const clientId = getClientId()

    this.client = new AnalyticsClient({
      clientId,
      channel: 'cherry-studio',
      onError: (error) => logger.error('Analytics error:', error),
      headers: {
        'User-Agent': generateUserAgent(),
        'Client-Id': clientId,
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

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Analytics_TrackTokenUsage, (_, data: TokenUsageData) => this.trackTokenUsage(data))
  }

  public trackTokenUsage(data: TokenUsageData): void {
    const enableDataCollection = application.get('PreferenceService').get('app.privacy.data_collection.enabled')

    if (!this.client || !enableDataCollection) {
      return
    }

    this.client.trackTokenUsage(data)
  }

  public async trackAppUpdate(): Promise<void> {
    if (!this.client) {
      return
    }

    await this.client.trackAppUpdate()
  }

  protected async onStop() {
    if (!this.client) return
    await this.client.destroy()
    this.client = null
    logger.info('Analytics service destroyed')
  }
}
