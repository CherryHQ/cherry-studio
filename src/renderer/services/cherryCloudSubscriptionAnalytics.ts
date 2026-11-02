import { ipcApi } from '@renderer/ipc'
import type { CherryCloudAnalyticsEvent, SubscriptionEntrySource } from '@shared/ipc/schemas/cherryCloud'

/** Fire-and-forget; main drops the event unless data collection is consented. Never throws. */
export function trackSubscriptionEvent(event: CherryCloudAnalyticsEvent): void {
  void send(event).catch(() => undefined)
}

async function send(event: CherryCloudAnalyticsEvent): Promise<void> {
  await ipcApi.request('cherry_cloud.analytics.track', event)
}

const viewedSources = new Set<SubscriptionEntrySource>()

/** Records a Subscribe entry the first time it is shown in this window. */
export function trackSubscriptionEntryView(source: SubscriptionEntrySource): void {
  if (viewedSources.has(source)) return
  viewedSources.add(source)
  trackSubscriptionEvent({ event: 'subscription_entry_view', source })
}

type ActivationEvent = Extract<CherryCloudAnalyticsEvent, { event: 'subscription_activated' }>

let lastSubscribeClick: { at: number; flowId: string } | null = null

/** Starts a subscription flow and returns its id. */
export function recordSubscribeClick(): string {
  lastSubscribeClick = { at: Date.now(), flowId: crypto.randomUUID() }
  return lastSubscribeClick.flowId
}

/**
 * Attributes an activation to the last Subscribe click: a coarse time since it, plus its flow id when the click
 * was within a day.
 */
export function subscribeClickAttribution(): Pick<ActivationEvent, 'sinceClick' | 'flowId'> {
  if (lastSubscribeClick === null) return { sinceClick: 'none' }
  const minutes = (Date.now() - lastSubscribeClick.at) / 60_000
  if (minutes >= 24 * 60) return { sinceClick: 'over_24h' }
  const sinceClick = minutes < 5 ? 'under_5m' : minutes < 30 ? 'under_30m' : 'under_24h'
  return { sinceClick, flowId: lastSubscribeClick.flowId }
}
