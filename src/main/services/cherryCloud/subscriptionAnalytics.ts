import { application } from '@application'
import { getAppEdition } from '@main/utils/appEdition'
import { getClientId } from '@main/utils/systemInfo'
import type { CherryCloudAnalyticsEvent } from '@shared/ipc/schemas/cherryCloud'

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
  if (!matchesScope && eventScopeId !== null && payload.event !== 'subscription_entry_clicked') return
  const testTraffic = import.meta.env.DEV || !!import.meta.env.MAIN_VITE_CHERRY_CLOUD_API_ORIGIN?.trim()
  const environment = testTraffic ? 'development' : 'production'
  const edition = getAppEdition()
  const accountDistinctId =
    matchesScope && status.accountId && edition === 'cn'
      ? `cloud-api:cn:${environment}:account:${status.accountId}`
      : null
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
    { distinctId: accountDistinctId ?? getClientId(), processPersonProfile: accountDistinctId !== null }
  )
}
