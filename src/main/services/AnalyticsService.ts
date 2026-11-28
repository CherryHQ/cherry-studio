import { app } from 'electron'
import type { PostHog } from 'posthog-node'

import { application } from '@application'
import type { AnalyticsClient, TokenUsageData } from '@cherrystudio/analytics-client'
import { isMigratedFromV1 } from '@data/migration/v1MigrationOrigin'
import { agentService } from '@data/services/AgentService'
import { assistantDataService } from '@data/services/AssistantService'
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
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { BEHAVIOR_ANALYTICS_EVENTS, type ProductAnalyticsEvent } from '@shared/ipc/schemas/analytics'
import { analyticsModelSource } from '@shared/utils/analyticsModelSource'
import { APP_NAME } from '@shared/utils/constants'

import { restoreKeptClientId, takePendingReports } from './analyticsPendingReports'
import { PREFERENCE_ANALYTICS_CATALOG } from './analyticsPreferenceCatalog.gen'
import { versionService } from './VersionService'

const logger = loggerService.withContext('AnalyticsService')

// Public, write-only token for the shared production project (698240).
const POSTHOG_PROJECT_KEY = 'phc_vwsf7qr54Vk2ff23Nj2B4PEYtSkkpheKrb8VcdfDujna'
const POSTHOG_HOST = 'https://us.i.posthog.com'
const PRODUCT_EVENT_SCHEMA_VERSION = 1
const MAX_PENDING_PRODUCT_EVENTS = 200
const ANONYMOUS_ID_KEY = 'analytics.anonymous_id'
const DEVICE_EVENTS: ReadonlySet<string> = new Set([
  'app_opened',
  'app_started',
  'app_active',
  'update_checked',
  'update_downloaded',
  'update_install_started'
])
const SETTING_CHANGE_COALESCE_MS = 2_000
const SNAPSHOT_CHECK_INTERVAL_MS = 60 * 60_000
const USER_AVATAR_KEY = 'app.user.avatar'
// Model choices report where the model comes from, never the model or a user-created provider.
const MODEL_ID_SETTING_KEYS: ReadonlySet<string> = new Set([
  'chat.default_model_id',
  'chat.context_settings.compress.model_id',
  'feature.paintings.default_model_id',
  'feature.quick_assistant.model_id',
  'feature.translate.model_id'
])

const VOICE_MODEL_SETTING_KEYS: ReadonlySet<string> = new Set([
  'feature.voice.recognition.model_id',
  'feature.voice.speech.model_id'
])

// '' picks a model automatically and 'off' disables recognition; local voice models run on the device.
function voiceModelSource(value: unknown): string {
  if (!value) return 'automatic'
  if (value === 'off') return 'off'
  if (typeof value !== 'string' || !value.includes('::')) return 'none'
  const { providerId } = parseUniqueModelId(value as UniqueModelId)
  return providerId === 'local-voice' ? 'local' : analyticsModelSource(providerId)
}

type SettingsSnapshotEvent = Extract<ProductAnalyticsEvent, { event: 'settings_snapshot' }>

// Development builds record usage insights only in a project set through MAIN_VITE_POSTHOG_KEY.
function resolvePostHogKey(): string {
  const override = import.meta.env.MAIN_VITE_POSTHOG_KEY?.trim()
  if (override) return override
  return import.meta.env.DEV ? '' : POSTHOG_PROJECT_KEY
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
    } else if (MODEL_ID_SETTING_KEYS.has(key)) {
      event[`setting:${key}`] =
        typeof value === 'string' && value.includes('::')
          ? analyticsModelSource(parseUniqueModelId(value as UniqueModelId).providerId)
          : 'none'
    } else if (VOICE_MODEL_SETTING_KEYS.has(key)) {
      event[`setting:${key}`] = voiceModelSource(value)
    } else if (kind === 'text') {
      event[`setting:${key}`] = (value ?? '') !== (defaults[key] ?? '')
    } else {
      const reportable = reportableSettingValue(key, value)
      if (reportable !== undefined) event[`setting:${key}`] = reportable
    }
  }
  return event
}

function appOpenedEvent(): Extract<ProductAnalyticsEvent, { event: 'app_opened' }> {
  let migratedFromV1 = false
  try {
    migratedFromV1 = isMigratedFromV1()
  } catch (error) {
    logger.warn('v1 migration origin unavailable', error as Error)
  }
  return {
    event: 'app_opened',
    onboardingStatus: application.get('PreferenceService').get('app.onboarding.provider_setup.status'),
    launch: versionService.getLaunchKind(),
    migratedFromV1,
    lastExit: application.lastExit
  }
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
  /** Signed-in Cherry AI account's distinct id; product events fall back to the device id. */
  private productAccountId: string | null = null
  private identifiedProductAccountId: string | null = null
  private revokeController: AbortController | null = null
  private hasTrackedAppLaunch = false
  /** Consented product events raised while the clients are still starting, with the account and time they were raised. */
  private pendingProductEvents: { event: ProductAnalyticsEvent; accountId: string | null; at: Date }[] = []
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
    if (!this.desiredEnabled) {
      this.pendingProductEvents = []
      this.clearPendingSettingChanges()
    }
    this.reconciler.request()
  }

  protected async onInit() {
    try {
      await restoreKeptClientId()
    } catch (error) {
      logger.warn('Client id kept across restore not applied', error as Error)
    }
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
    this.registerDisposable(() => this.clearPendingSettingChanges())
    this.registerInterval(() => {
      this.reportDailyActive()
      this.reportDailySnapshots()
    }, SNAPSHOT_CHECK_INTERVAL_MS)
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

    const posthogKey = resolvePostHogKey()
    if (posthogKey) {
      const { PostHog } = await import('posthog-node')
      this.posthog = new PostHog(posthogKey, {
        host: POSTHOG_HOST,
        disableGeoip: true,
        enableExceptionAutocapture: false,
        fetch: (url, options) => revokedFetch(url, options)
      })
    }

    this.identifyProductAccount()
    // app_opened precedes replayed events so funnels see the launch first.
    if (!this.hasTrackedAppLaunch) {
      this.client.trackAppLaunch({
        version: app.getVersion(),
        os: process.platform
      })
      this.captureProductEvent(appOpenedEvent())
      this.hasTrackedAppLaunch = true
    }

    this.productEventsReady = true
    for (const { event, accountId, at } of this.pendingProductEvents.splice(0)) {
      this.captureProductEvent(event, accountId, at)
    }
    for (const event of takePendingReports()) this.captureProductEvent(event)
    this.reportDailyActive()
    this.reportDailySnapshots()

    logger.info('Analytics service activated')
  }

  async onDeactivate(): Promise<void> {
    this.productEventsReady = false
    this.identifiedProductAccountId = null
    if (this.posthog) {
      // After a revocation the shared revoke signal fails every request, so the queue is dropped
      // without waiting out PostHog's retries.
      const revoked = !this.desiredEnabled
      if (revoked) this.revokeController?.abort()
      await this.posthog.shutdown(revoked ? 1_000 : undefined)
      this.posthog = null
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
    this.pendingProductEvents.push({ event, accountId: this.productAccountId, at: new Date() })
  }

  // Consent alone gates daily activity; it keeps its own day key so the behavior snapshots cannot suppress it.
  private reportDailyActive(): void {
    if (!this.productEventsReady) return
    const cache = application.get('CacheService')
    const today = localDay(new Date())
    if (cache.getPersist('analytics.active.last_day') === today) return
    cache.setPersist('analytics.active.last_day', today)
    this.trackProductEvent({ event: 'app_active' })
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
    try {
      this.trackProductEvent({ event: 'assistant_snapshot', ...assistantDataService.countConfiguredForAnalytics() })
    } catch (error) {
      logger.warn('Assistant snapshot skipped', error as Error)
    }
    try {
      this.trackProductEvent({ event: 'agent_snapshot', ...agentService.countForAnalytics() })
    } catch (error) {
      logger.warn('Agent snapshot skipped', error as Error)
    }
  }

  // Rapid edits of one setting (sliders, typing) report once with the last value; text values stay out.
  private recordSettingChange(key: string, value: unknown): void {
    // A change made without consent stays out even if consent arrives before the report fires.
    if (!this.desiredEnabled) return
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

  private clearPendingSettingChanges(): void {
    for (const { timer } of this.pendingSettingChanges.values()) clearTimeout(timer)
    this.pendingSettingChanges.clear()
  }

  /** Binds later product events to the signed-in Cherry AI account; null returns them to a fresh anonymous id. */
  public setProductAccount(accountDistinctId: string | null): void {
    // The previous anonymous id was merged into the account, so events after sign-out start a new one.
    if (this.productAccountId && !accountDistinctId) {
      const cache = application.get('CacheService')
      cache.setPersist(ANONYMOUS_ID_KEY, crypto.randomUUID())
      // Written now: a crash inside the debounce would bring back the id already merged into the account.
      try {
        cache.flushPersistForBackup()
      } catch (error) {
        logger.warn('Anonymous id rotation not flushed', error as Error)
      }
      // The new anonymous id has not been merged yet, even into the account it came from.
      this.identifiedProductAccountId = null
    }
    this.productAccountId = accountDistinctId
    if (this.productEventsReady) this.identifyProductAccount()
  }

  private productAnonymousId(): string {
    const cache = application.get('CacheService')
    const stored = cache.getPersist(ANONYMOUS_ID_KEY)
    if (stored) return stored
    const id = crypto.randomUUID()
    cache.setPersist(ANONYMOUS_ID_KEY, id)
    return id
  }

  // Merges this device's earlier anonymous events into the account, once per account and activation.
  private identifyProductAccount(): void {
    const accountId = this.productAccountId
    if (!this.desiredEnabled || !accountId || accountId === this.identifiedProductAccountId) return
    this.identifiedProductAccountId = accountId
    this.capture(
      '$identify',
      { $anon_distinct_id: this.productAnonymousId() },
      { distinctId: accountId, processPersonProfile: true }
    )
  }

  private captureProductEvent(
    { event, ...fields }: ProductAnalyticsEvent,
    accountId = this.productAccountId,
    now = new Date()
  ): void {
    // Local clock only (no time zone name), so activity can be read in users' local time.
    const properties: Record<string, string | number | boolean> = {
      schema_version: PRODUCT_EVENT_SCHEMA_VERSION,
      test: isProductTestTraffic(),
      local_hour: now.getHours(),
      local_weekday: ((now.getDay() + 6) % 7) + 1
    }
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue
      // Prefixed keys (`setting:`, `tool:`, `type:`) carry static ids verbatim, e.g. `tool:Bash`.
      properties[key.includes(':') ? key : key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = value
    }
    // Launch events keep the device id, which is never merged into an account.
    const identity = DEVICE_EVENTS.has(event)
      ? undefined
      : accountId
        ? { distinctId: accountId, processPersonProfile: true }
        : { distinctId: this.productAnonymousId(), processPersonProfile: false }
    this.capture(event, properties, identity)
  }

  private capture(
    eventType: string,
    data: Record<string, string | number | boolean>,
    identity?: { distinctId: string; processPersonProfile: boolean }
  ): void {
    if (!this.posthog) return
    this.posthog.capture({
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
