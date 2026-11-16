import { ipcApi } from '@renderer/ipc'
import type { RendererAnalyticsEvent } from '@shared/ipc/schemas/analytics'

/** Fire-and-forget; main enforces consent and the event catalog. Never throws into its caller. */
export function trackProductEvent(event: RendererAnalyticsEvent): void {
  try {
    void ipcApi.request('analytics.track', event).catch(() => undefined)
  } catch {
    // A missing bridge must not break the feature that reported.
  }
}
