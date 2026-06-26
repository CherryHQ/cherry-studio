import { application } from '@application'
import type { TokenUsageData } from '@cherrystudio/analytics-client'
import { AnalyticsClient } from '@cherrystudio/analytics-client'
import { loggerService } from '@logger'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { generateUserAgent, getClientId } from '@main/utils/systemInfo'
import { IpcChannel } from '@shared/IpcChannel'
import { APP_NAME } from '@shared/utils/constants'
import { app } from 'electron'

const logger = loggerService.withContext('AnalyticsService')

@Injectable('AnalyticsService')
@ServicePhase(Phase.WhenReady)
export class AnalyticsService extends BaseService implements Activatable {
  private client: AnalyticsClient | null = null
  /** Latest desired running state — mirrors the `app.privacy.data_collection.enabled` preference. */
  private desiredEnabled = false
  /**
   * Converges the client's running state to `desiredEnabled`. It is the SOLE caller of
   * activate/deactivate, so transitions never run concurrently. Level-triggered against the ACTUAL
   * `isActivated` state and latest-wins: a re-enable that lands while the async `onDeactivate`
   * (`await client.destroy()`) is still in flight is honoured on the next pass instead of being
   * dropped by BaseService's shared `_activating` guard.
   */
  private readonly reconciler: LatestReconciler = createLatestReconciler<{ desired: boolean; actual: boolean }>({
    name: 'analytics',
    getSnapshot: () => ({ desired: this.desiredEnabled, actual: this.isActivated }),
    isSettled: ({ desired, actual }) => desired === actual,
    apply: async ({ desired }) => {
      if (desired) {
        await this.activate()
      } else {
        await this.deactivate()
      }
    }
  })

  protected async onInit() {
    this.registerIpcHandlers()

    // The reconciler is the sole driver of activate/deactivate (latest-wins): a re-enable that lands
    // while the async onDeactivate (`await client.destroy()`) is in flight must not be dropped by the
    // shared `_activating` guard. The reconciler holds no OS resources and is a construct-once field
    // that is NOT recreated on restart (`start()` re-runs `onInit`), so it is deliberately not
    // disposed — disposing it would permanently no-op `request()` after a stop→restart.
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(
      preferenceService.subscribeChange('app.privacy.data_collection.enabled', (enabled: boolean) => {
        this.desiredEnabled = enabled
        this.reconciler.request()
      })
    )
  }

  protected async onReady() {
    this.desiredEnabled = application.get('PreferenceService').get('app.privacy.data_collection.enabled')
    this.reconciler.request()
    await this.reconciler.flush()
  }

  onActivate(): void {
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
