import { app } from 'electron'
import type { PostHog } from 'posthog-node'

import { application } from '@application'
import type { AnalyticsClient, TokenUsageData } from '@cherrystudio/analytics-client'
import { messageService } from '@data/services/MessageService'
import { loggerService } from '@logger'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppEdition } from '@main/utils/appEdition'
import { isDataCollectionConsented } from '@main/utils/privacyConsent'
import { generateUserAgent, getClientId } from '@main/utils/systemInfo'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { STORED_FILE_REF_PREFIX } from '@shared/data/types/file'
import { BEHAVIOR_ANALYTICS_EVENTS, type ProductAnalyticsEvent } from '@shared/ipc/schemas/analytics'
import type { AppEdition } from '@shared/types/appEdition'
import { APP_NAME } from '@shared/utils/constants'

import { PREFERENCE_ANALYTICS_CATALOG } from './analyticsPreferenceCatalog.gen'

const logger = loggerService.withContext('AnalyticsService')

// Public, write-only keys of the PostHog projects that keep usage insights, like the Sentry DSN.
const POSTHOG_PROJECT_KEYS = {
  cn: 'phc_vwsf7qr54Vk2ff23Nj2B4PEYtSkkpheKrb8VcdfDujna',
  global: 'phc_G0omsYajA6A9BY5c0rnU04ZaZck25xpR0DqKhwfF39n'
} as const satisfies Record<AppEdition, string>
// Product events from both editions go to the Cherry Studio project.
const PRODUCT_POSTHOG_KEY = POSTHOG_PROJECT_KEYS.global
const POSTHOG_HOST = 'https://us.i.posthog.com'
const PRODUCT_EVENT_SCHEMA_VERSION = 1
const MAX_PENDING_PRODUCT_EVENTS = 200
const SETTING_CHANGE_COALESCE_MS = 2_000
const SNAPSHOT_CHECK_INTERVAL_MS = 60 * 60_000
const USER_AVATAR_KEY = 'app.user.avatar'

type SettingsSnapshotEvent = Extract<ProductAnalyticsEvent, { event: 'settings_snapshot' }>

// Development builds record usage insights only in a project set through MAIN_VITE_POSTHOG_KEY.
function resolvePostHogKey(releaseKey: string): string {
  const override = import.meta.env.MAIN_VITE_POSTHOG_KEY?.trim()
  if (override) return override
  return import.meta.env.DEV ? '' : releaseKey
}

// Development builds and builds pointed at another PostHog project or Cloud backend send test traffic.
function isProductTestTraffic(): boolean {
  return (
    import.meta.env.DEV ||
    !!import.meta.env.MAIN_VITE_POSTHOG_KEY?.trim() ||
    !!import.meta.env.MAIN_VITE_CHERRY_CLOUD_API_ORIGIN?.trim()
  )
}

const behaviorEvents: ReadonlySet<string> = new Set(BEHAVIOR_ANALYTICS_EVENTS)
const behaviorEventsEnabled = () => import.meta.env.MAIN_VITE_ANALYTICS_BEHAVIOR_EVENTS === 'true'

/** Booleans, finite numbers, and catalogued fixed options; free text and uncatalogued keys report nothing. */
function reportableSettingValue(key: string, value: unknown): boolean | number | string | undefined {
  const kind = PREFERENCE_ANALYTICS_CATALOG[key]
  if (kind === 'bool') return typeof value === 'boolean' ? value : undefined
  if (kind === 'num') return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  if (Array.isArray(kind)) return typeof value === 'string' && kind.includes(value) ? value : undefined
  return undefined
}

// Free-text settings report only whether they differ from the default; the avatar reports its kind.
function settingsSnapshot(read: (key: UnifiedPreferenceKeyType) => unknown): SettingsSnapshotEvent {
  const event: SettingsSnapshotEvent = { event: 'settings_snapshot' }
  const defaults: Record<string, unknown> = DefaultPreferences.default
  for (const [key, kind] of Object.entries(PREFERENCE_ANALYTICS_CATALOG)) {
    const value = read(key as UnifiedPreferenceKeyType)
    if (key === USER_AVATAR_KEY) {
      event[`setting:${key}`] = !value
        ? 'default'
        : String(value).startsWith(STORED_FILE_REF_PREFIX)
          ? 'image'
          : 'emoji'
    } else if (kind === 'text') {
      event[`setting:${key}`] = (value ?? '') !== (defaults[key] ?? '')
    } else {
      const reportable = reportableSettingValue(key, value)
      if (reportable !== undefined) event[`setting:${key}`] = reportable
    }
  }
  return event
}

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Distinct name so the SDK retry classifier treats it as non-retriable.
class ConsentRevokedError extends Error {
  constructor() {
    super('Analytics consent revoked')
    this.name = 'ConsentRevokedError'
  }
}

function linkSignals(first: AbortSignal, second?: AbortSignal | null): AbortSignal {
  if (!second) return first
  const anySignals = (AbortSignal as typeof AbortSignal & { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof anySignals === 'function') return anySignals.call(AbortSignal, [first, second])
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (first.aborted || second.aborted) abort()
  else {
    first.addEventListener('abort', abort, { once: true })
    second.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

@Injectable('AnalyticsService')
@ServicePhase(Phase.WhenReady)
export class AnalyticsService extends BaseService implements Activatable {
  private client: AnalyticsClient | null = null
  private posthog: PostHog | null = null
  private productPosthog: PostHog | null = null
  /** Signed-in Cherry AI account's distinct id; product events fall back to the device id. */
  private productAccountId: string | null = null
  private identifiedProductAccountId: string | null = null
  private revokeController: AbortController | null = null
  private hasTrackedAppLaunch = false
  /** Consented product events raised while the clients are still starting; replayed once they are up. */
  private pendingProductEvents: ProductAnalyticsEvent[] = []
  private productEventsReady = false
  private readonly pendingSettingChanges = new Map<string, { value: unknown; timer: ReturnType<typeof setTimeout> }>()
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
    this.desiredEnabled = isDataCollectionConsented(
      preferenceService.get('app.privacy.data_collection.enabled'),
      preferenceService.get('app.privacy.policy_version')
    )
    if (!this.desiredEnabled) this.pendingProductEvents = []
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
    this.registerDisposable(
      preferenceService.onRendererPreferencesChanged((changes) => {
        for (const [key, value] of changes) this.recordSettingChange(key, value)
      })
    )
    this.registerDisposable(() => {
      for (const { timer } of this.pendingSettingChanges.values()) clearTimeout(timer)
      this.pendingSettingChanges.clear()
    })
    this.registerInterval(() => this.reportDailySnapshots(), SNAPSHOT_CHECK_INTERVAL_MS)
  }

  protected async onReady() {
    this.refreshDesiredEnabled()
    await this.reconciler.flush()
  }

  async onActivate(): Promise<void> {
    const clientId = getClientId()
    const { AnalyticsClient } = await import('@cherrystudio/analytics-client')

    const revokeController = new AbortController()
    this.revokeController = revokeController
    const revokedFetch: typeof fetch = async (input, init) => {
      if (revokeController.signal.aborted) throw new ConsentRevokedError()
      try {
        return await globalThis.fetch(input, {
          ...init,
          signal: linkSignals(revokeController.signal, init?.signal)
        } as RequestInit)
      } catch (error) {
        if (revokeController.signal.aborted) throw new ConsentRevokedError()
        throw error
      }
    }

    this.client = new AnalyticsClient({
      clientId,
      channel: 'cherry-studio',
      fetch: revokedFetch,
      onError: (error) => logger.error('Analytics error:', error),
      headers: {
        'User-Agent': generateUserAgent(),
        'Client-Id': clientId,
        'App-Name': APP_NAME,
        'App-Version': `v${app.getVersion()}`,
        'X-App-Edition': getAppEdition(),
        OS: process.platform
      }
    })

    const posthogKey = resolvePostHogKey(POSTHOG_PROJECT_KEYS[getAppEdition()])
    const productKey = resolvePostHogKey(PRODUCT_POSTHOG_KEY)
    if (posthogKey || productKey) {
      const { PostHog } = await import('posthog-node')
      const createClient = (key: string) =>
        new PostHog(key, {
          host: POSTHOG_HOST,
          disableGeoip: true,
          enableExceptionAutocapture: false,
          fetch: (url, options) => revokedFetch(url, options)
        })
      this.posthog = posthogKey ? createClient(posthogKey) : null
      this.productPosthog = productKey === posthogKey ? this.posthog : productKey ? createClient(productKey) : null
    }

    this.identifyProductAccount()
    // app_opened precedes replayed events so funnels see the launch first.
    if (!this.hasTrackedAppLaunch) {
      this.client.trackAppLaunch({
        version: app.getVersion(),
        os: process.platform
      })
      this.captureProductEvent({
        event: 'app_opened',
        onboardingStatus: application.get('PreferenceService').get('app.onboarding.provider_setup.status')
      })
      this.hasTrackedAppLaunch = true
    }

    this.productEventsReady = true
    for (const event of this.pendingProductEvents.splice(0)) this.captureProductEvent(event)
    this.reportDailySnapshots()

    logger.info('Analytics service activated')
  }

  async onDeactivate(): Promise<void> {
    this.productEventsReady = false
    this.identifiedProductAccountId = null
    const posthogClients = new Set([this.posthog, this.productPosthog].filter((client) => client !== null))
    if (posthogClients.size > 0) {
      // After a revocation the shared revoke signal fails every request, so the queue is dropped
      // without waiting out PostHog's retries.
      const revoked = !this.desiredEnabled
      if (revoked) this.revokeController?.abort()
      await Promise.all([...posthogClients].map((client) => client.shutdown(revoked ? 1_000 : undefined)))
      this.posthog = null
      this.productPosthog = null
    }
    if (this.client) {
      if (!this.desiredEnabled) {
        this.revokeController?.abort()
        try {
          const pending = this.client.getQueueSize()
          logger.info('Analytics queue discarded after consent revocation', { pending })
        } catch {
          logger.info('Analytics queue discarded after consent revocation')
        }
        await this.client.destroy({ flush: false })
      } else {
        await this.client.destroy()
      }
      this.client = null
    }
    this.revokeController = null
    logger.info('Analytics service deactivated')
  }

  public trackTokenUsage(data: TokenUsageData): void {
    if (!this.isActivated || !this.desiredEnabled || (data.input_tokens === 0 && data.output_tokens === 0)) return
    this.client!.trackTokenUsage(data)
  }

  /** Captures a consented event; callers own domain identity and event properties. */
  public trackEvent(
    eventType: string,
    data: Record<string, string | number | boolean>,
    identity?: { distinctId: string; processPersonProfile: boolean }
  ): void {
    if (!this.isActivated || !this.desiredEnabled) return
    this.capture(eventType, data, identity)
  }

  /** Captures a catalogued product event anonymously; events raised before start-up are replayed. */
  public trackProductEvent(event: ProductAnalyticsEvent): void {
    if (!this.desiredEnabled) return
    if (behaviorEvents.has(event.event) && !behaviorEventsEnabled()) return
    if (this.productEventsReady) {
      this.captureProductEvent(event)
      return
    }
    if (this.pendingProductEvents.length >= MAX_PENDING_PRODUCT_EVENTS) this.pendingProductEvents.shift()
    this.pendingProductEvents.push(event)
  }

  // Settings and branch counts as they stand, once per local day while product events are flowing.
  private reportDailySnapshots(): void {
    if (!this.productEventsReady || !behaviorEventsEnabled()) return
    const cache = application.get('CacheService')
    const today = localDay(new Date())
    if (cache.getPersist('analytics.snapshot.last_day') === today) return
    cache.setPersist('analytics.snapshot.last_day', today)
    const preferenceService = application.get('PreferenceService')
    this.trackProductEvent(settingsSnapshot((key) => preferenceService.get(key)))
    try {
      this.trackProductEvent({ event: 'chat_branch_snapshot', ...messageService.countTopicBranches() })
    } catch (error) {
      logger.warn('Branch snapshot skipped', error as Error)
    }
  }

  // Rapid edits of one setting (sliders, typing) report once with the last value; text values stay out.
  private recordSettingChange(key: string, value: unknown): void {
    const pending = this.pendingSettingChanges.get(key)
    if (pending) clearTimeout(pending.timer)
    const timer = setTimeout(() => {
      const latest = this.pendingSettingChanges.get(key)?.value
      this.pendingSettingChanges.delete(key)
      const value = reportableSettingValue(key, latest)
      this.trackProductEvent({ event: 'setting_changed', key, ...(value !== undefined && { value }) })
    }, SETTING_CHANGE_COALESCE_MS)
    timer.unref?.()
    this.pendingSettingChanges.set(key, { value, timer })
  }

  /** Binds later product events to the signed-in Cherry AI account; null returns them to the device id. */
  public setProductAccount(accountDistinctId: string | null): void {
    this.productAccountId = accountDistinctId
    if (this.productEventsReady) this.identifyProductAccount()
  }

  // Merges this device's earlier anonymous events into the account, once per account and activation.
  private identifyProductAccount(): void {
    const accountId = this.productAccountId
    if (!this.desiredEnabled || !accountId || accountId === this.identifiedProductAccountId) return
    this.identifiedProductAccountId = accountId
    this.capture(
      '$identify',
      { $anon_distinct_id: getClientId() },
      { distinctId: accountId, processPersonProfile: true },
      this.productPosthog
    )
  }

  private captureProductEvent({ event, ...fields }: ProductAnalyticsEvent): void {
    const now = new Date()
    // Local clock only (no time zone name), so activity can be read in users' local time.
    const properties: Record<string, string | number | boolean> = {
      schema_version: PRODUCT_EVENT_SCHEMA_VERSION,
      test: isProductTestTraffic(),
      local_hour: now.getHours(),
      local_weekday: ((now.getDay() + 6) % 7) + 1
    }
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) properties[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = value
    }
    const identity = this.productAccountId
      ? { distinctId: this.productAccountId, processPersonProfile: true }
      : undefined
    this.capture(event, properties, identity, this.productPosthog)
  }

  private capture(
    eventType: string,
    data: Record<string, string | number | boolean>,
    identity?: { distinctId: string; processPersonProfile: boolean },
    posthog = this.posthog
  ): void {
    if (!posthog) return
    posthog.capture({
      distinctId: identity?.distinctId ?? getClientId(),
      event: eventType,
      properties: {
        ...data,
        app_version: app.getVersion(),
        app_edition: getAppEdition(),
        os: process.platform,
        // Keep addresses out of usage insights, including anonymous events.
        $ip: '0.0.0.0',
        $process_person_profile: identity?.processPersonProfile ?? false
      }
    })
  }

  public async trackAppUpdate(): Promise<void> {
    if (!this.client || !this.desiredEnabled) {
      return
    }

    await this.client.trackAppUpdate()
  }
}
