import type { SubscriptionEntrySource } from '@shared/ipc/schemas/cherryCloud'

import { cherryCloudSubscriptionService } from './CherryCloudSubscriptionService'

/** Opens this window's latest Subscribe action, signing in first when required. */
export async function startCherryCloudSubscription(
  source: SubscriptionEntrySource,
  details: { modelId?: string } = {}
): Promise<void> {
  await cherryCloudSubscriptionService.start(source, details)
}
