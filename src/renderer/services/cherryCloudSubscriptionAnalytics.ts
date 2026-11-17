import { ipcApi } from '@renderer/ipc'
import type { CherryCloudAnalyticsEvent, SubscriptionEntrySource } from '@shared/ipc/schemas/cherryCloud'

type ActivationEvent = Extract<CherryCloudAnalyticsEvent, { event: 'subscription_entitlement_refresh_result' }>

/** Per-window entry deduplication and coarse attribution; it owns no account/session mirror. */
export class CherryCloudSubscriptionAnalyticsService {
  private readonly viewedSources = new Set<SubscriptionEntrySource>()
  private lastSubscribeClick: { at: number; flowId: string } | null = null

  /** Fire-and-forget. Unknown account scopes remain anonymous; main enforces consent. */
  track(event: CherryCloudAnalyticsEvent, scopeId?: string | null): void {
    void this.send(event, scopeId).catch(() => undefined)
  }

  private async send(event: CherryCloudAnalyticsEvent, scopeId?: string | null): Promise<void> {
    await ipcApi.request('cherry_cloud.analytics.track', { payload: event, scopeId })
  }

  trackEntryView(source: SubscriptionEntrySource, scopeId?: string | null): void {
    if (this.viewedSources.has(source)) return
    this.viewedSources.add(source)
    this.track({ event: 'subscription_entry_view', source }, scopeId)
  }

  recordClick(): string {
    this.lastSubscribeClick = { at: Date.now(), flowId: crypto.randomUUID() }
    return this.lastSubscribeClick.flowId
  }

  clickAttribution(): Pick<ActivationEvent, 'sinceClick' | 'flowId'> {
    if (this.lastSubscribeClick === null) return { sinceClick: 'none' }
    const minutes = (Date.now() - this.lastSubscribeClick.at) / 60_000
    if (minutes >= 24 * 60) return { sinceClick: 'over_24h' }
    const sinceClick = minutes < 5 ? 'under_5m' : minutes < 30 ? 'under_30m' : 'under_24h'
    return { sinceClick, flowId: this.lastSubscribeClick.flowId }
  }
}

export const cherryCloudSubscriptionAnalyticsService = new CherryCloudSubscriptionAnalyticsService()

export function trackSubscriptionEvent(event: CherryCloudAnalyticsEvent, scopeId?: string | null): void {
  cherryCloudSubscriptionAnalyticsService.track(event, scopeId)
}

/** Records an entry once per source and renderer window. */
export function trackSubscriptionEntryView(source: SubscriptionEntrySource, scopeId?: string | null): void {
  cherryCloudSubscriptionAnalyticsService.trackEntryView(source, scopeId)
}

export function recordSubscribeClick(): string {
  return cherryCloudSubscriptionAnalyticsService.recordClick()
}

/** Joins a detected activation with the last click within a day, without claiming causality. */
export function subscribeClickAttribution(): Pick<ActivationEvent, 'sinceClick' | 'flowId'> {
  return cherryCloudSubscriptionAnalyticsService.clickAttribution()
}
