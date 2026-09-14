import { app } from 'electron'

import { application } from '@application'
import type { AnalyticsClient, TokenUsageData } from '@cherrystudio/analytics-client'
import { loggerService } from '@logger'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { generateUserAgent, getClientId } from '@main/utils/systemInfo'
import { APP_NAME, LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

const logger = loggerService.withContext('AnalyticsService')

@Injectable('AnalyticsService')
@ServicePhase(Phase.WhenReady)
export class AnalyticsService extends BaseService implements Activatable {
  private client: AnalyticsClient | null = null
  private hasTrackedAppLaunch = false
  /** Latest desired running state — requires both data collection and current policy consent. */
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

  private refreshDesiredEnabled(): void {
    const preferenceService = application.get('PreferenceService')
    this.desiredEnabled =
      preferenceService.get('app.privacy.data_collection.enabled') &&
      preferenceService.get('app.privacy.policy_version') === LATEST_PRIVACY_POLICY_VERSION
    this.reconciler.request()
  }

  protected async onInit() {
    // The reconciler is the sole driver of activate/deactivate (latest-wins): a re-enable that lands
    // while the async onDeactivate (`await client.destroy()`) is in flight must not be dropped by the
    // shared `_activating` guard. The reconciler holds no OS resources and is a construct-once field
    // that is NOT recreated on restart (`start()` re-runs `onInit`), so it is deliberately not
    // disposed — disposing it would permanently no-op `request()` after a stop→restart.
    const preferenceService = application.get('PreferenceService')
    const refreshDesiredEnabled = () => this.refreshDesiredEnabled()
    this.registerDisposable(
      preferenceService.subscribeChange('app.privacy.data_collection.enabled', refreshDesiredEnabled)
    )
    this.registerDisposable(preferenceService.subscribeChange('app.privacy.policy_version', refreshDesiredEnabled))
  }

  protected async onReady() {
    this.refreshDesiredEnabled()
    await this.reconciler.flush()
  }

  async onActivate(): Promise<void> {
    const clientId = getClientId()
    const { AnalyticsClient } = await import('@cherrystudio/analytics-client')

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

    if (!this.hasTrackedAppLaunch) {
      this.client.trackAppLaunch({
        version: app.getVersion(),
        os: process.platform
      })
      this.hasTrackedAppLaunch = true
    }

    logger.info('Analytics service activated')
  }

  async onDeactivate(): Promise<void> {
    if (this.client) {
      await this.client.destroy()
      this.client = null
    }
    logger.info('Analytics service deactivated')
  }

  public trackTokenUsage(data: TokenUsageData): void {
    if (!this.isActivated || !this.desiredEnabled || (data.input_tokens === 0 && data.output_tokens === 0)) return
    this.client!.trackTokenUsage(data)
  }

  public async trackAppUpdate(): Promise<void> {
    if (!this.client || !this.desiredEnabled) {
      return
    }

    await this.client.trackAppUpdate()
  }
}
