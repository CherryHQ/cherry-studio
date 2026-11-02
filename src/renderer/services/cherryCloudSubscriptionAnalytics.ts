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

/** Reports a Subscribe entry the first time it is shown in this window. */
export function trackSubscriptionEntryView(source: SubscriptionEntrySource): void {
  if (viewedSources.has(source)) return
  viewedSources.add(source)
  trackSubscriptionEvent({ event: 'subscription_entry_view', source })
}

let lastSubscribeClickAt: number | null = null

export function recordSubscribeClick(): void {
  lastSubscribeClickAt = Date.now()
}

/** Coarse time since the last Subscribe click, so activations can be attributed without exact timing. */
export function timeSinceSubscribeClick(): Extract<
  CherryCloudAnalyticsEvent,
  { event: 'subscription_activated' }
>['sinceClick'] {
  if (lastSubscribeClickAt === null) return 'none'
  const minutes = (Date.now() - lastSubscribeClickAt) / 60_000
  if (minutes < 5) return 'under_5m'
  if (minutes < 30) return 'under_30m'
  if (minutes < 24 * 60) return 'under_24h'
  return 'over_24h'
}
