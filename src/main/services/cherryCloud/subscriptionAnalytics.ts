import { application } from '@application'
import { getAppEdition } from '@main/utils/appEdition'
import { getClientId } from '@main/utils/systemInfo'
import type { CherryCloudAnalyticsEvent } from '@shared/ipc/schemas/cherryCloud'

function isTestTraffic(): boolean {
  return import.meta.env.DEV || !!import.meta.env.MAIN_VITE_CHERRY_CLOUD_API_ORIGIN?.trim()
}

function accountDistinctId(accountId: string): string {
  return `cloud-api:${getAppEdition()}:${isTestTraffic() ? 'development' : 'production'}:account:${accountId}`
}

/** Binds product analytics to the signed-in Cherry AI account; null returns it to the device id. */
export function publishProductAnalyticsAccount(accountId: string | null): void {
  application.get('AnalyticsService').setProductAccount(accountId ? accountDistinctId(accountId) : null)
}

/** Formats the existing Cloud funnel contract while generic analytics owns consent and transport. */
export async function trackCherryCloudAnalyticsEvent(
  payload: CherryCloudAnalyticsEvent,
  expectedScopeId?: string | null
): Promise<void> {
  const cloud = application.get('CherryCloudService')
  const admittedScopeId = cloud.getCurrentScopeId()
  const status = await cloud.getStatus()
  const current = cloud.isCurrentScope(admittedScopeId) && status.scopeId === admittedScopeId
  const eventScopeId = expectedScopeId === undefined ? admittedScopeId : expectedScopeId
  const matchesScope = current && eventScopeId === admittedScopeId
  // A real click still happened after its intent was superseded; late results do not belong to a new account.
  const isClick = payload.event === 'subscription_entry_clicked' || payload.event === 'amd_entry_clicked'
  if (!matchesScope && eventScopeId !== null && !isClick) return
  const testTraffic = isTestTraffic()
  const environment = testTraffic ? 'development' : 'production'
  const edition = getAppEdition()
  const subscriptionDistinctId =
    matchesScope && status.accountId && edition === 'cn' ? accountDistinctId(status.accountId) : null
  const { event, ...fields } = payload
  const properties = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value])
  )
  application.get('AnalyticsService').trackEvent(
    event,
    {
      ...properties,
      product: 'cloud-api',
      producer: 'client',
      surface: 'desktop',
      entry: 'desktop',
      region: edition,
      environment,
      test: testTraffic,
      schema_version: 1
    },
    { distinctId: subscriptionDistinctId ?? getClientId(), processPersonProfile: subscriptionDistinctId !== null }
  )
}
