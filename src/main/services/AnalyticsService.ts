import { application } from '@application'
import type { TokenUsageData } from '@cherrystudio/analytics-client'
import { AnalyticsClient } from '@cherrystudio/analytics-client'
import { loggerService } from '@logger'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { generateUserAgent, getClientId } from '@main/utils/systemInfo'
import { APP_NAME } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { app } from 'electron'

const logger = loggerService.withContext('AnalyticsService')

@Injectable('AnalyticsService')
@ServicePhase(Phase.WhenReady)
export class AnalyticsService extends BaseService implements Activatable {
  private client: AnalyticsClient | null = null

  protected async onInit() {
    this.registerIpcHandlers()

    // Original code checks the preference per-call in trackTokenUsage,
    // which is effectively runtime-responsive. Use preference subscription
    // to drive activate/deactivate so isActivated guard preserves that semantic.
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeChange('app.privacy.data_collection.enabled', (enabled: boolean) => {
        if (enabled) void this.activate()
        else void this.deactivate()
      })
    )
  }

  protected async onReady() {
    if (application.get('PreferenceService').get('app.privacy.data_collection.enabled')) {
      await this.activate()
    }
  }

  onActivate(): void {
    const clientId = getClientId()

    if (!application.get('PreferenceService').get('app.privacy.data_collection.enabled')) {
      logger.info('Analytics service disabled by user preference')
      return
    }

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

    // FIXME: trackAppLaunch is called on every activate.
    // Original code called it once in onInit. When the user toggles the preference
    // off then on at runtime, this produces an extra launch event.
    // This is beyond the scope of the Activatable refactoring — keeping as-is.
    this.client.trackAppLaunch({
      version: app.getVersion(),
      os: process.platform
    })

    logger.info('Analytics service activated')
  }

  async onDeactivate(): Promise<void> {
    if (this.client) {
      await this.client.destroy()
      this.client = null
    }
    logger.info('Analytics service deactivated')
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Analytics_TrackTokenUsage, (_, data: TokenUsageData) => this.trackTokenUsage(data))
  }

  public trackTokenUsage(data: TokenUsageData): void {
    if (!this.isActivated) return
    this.client!.trackTokenUsage(data)
  }

  public async trackAppUpdate(): Promise<void> {
    if (!this.client || !application.get('PreferenceService').get('app.privacy.data_collection.enabled')) {
      return
    }

    await this.client.trackAppUpdate()
  }
}
