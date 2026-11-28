import { ipcApi } from '@renderer/ipc'
import type { RendererAnalyticsEvent } from '@shared/ipc/schemas/analytics'

/** Fire-and-forget; main enforces consent and the event catalog. */
export function trackProductEvent(event: RendererAnalyticsEvent): void {
  void ipcApi.request('analytics.track', event).catch(() => undefined)
}
