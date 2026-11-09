import { MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

const mocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  getStatus: vi.fn(),
  scopeId: 'scope-a',
  edition: 'cn' as 'cn' | 'global'
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => mocks.edition }))
vi.mock('@main/utils/systemInfo', () => ({ getClientId: () => 'anonymous-client' }))

import { trackCherryCloudAnalyticsEvent } from '../subscriptionAnalytics'

const status = (accountId: string | null, scopeId = 'scope-a'): CherryCloudStatus => ({
  phase: accountId ? 'signed-in' : 'signed-out',
  accountId,
  displayName: accountId,
  scopeId,
  revision: 1
})
const click = {
  event: 'subscription_entry_clicked',
  source: 'selector_locked_row',
  signedIn: true,
  flowId: 'bb75457d-ed6e-4b10-bb9a-62f9504b03c4',
  modelId: 'cherryai-subscription::gpt-5'
} as const

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('DEV', false)
  vi.stubEnv('MAIN_VITE_CHERRY_CLOUD_API_ORIGIN', '')
  MockApplicationUtils.setService('CherryCloudService', {
    getCurrentScopeId: () => mocks.scopeId,
    getStatus: mocks.getStatus,
    isCurrentScope: (scopeId: string) => scopeId === mocks.scopeId
  })
  MockApplicationUtils.setService('AnalyticsService', { trackEvent: mocks.trackEvent })
  mocks.scopeId = 'scope-a'
  mocks.edition = 'cn'
  mocks.trackEvent.mockReset()
  mocks.getStatus.mockReset().mockResolvedValue(status('account-a'))
})

describe('Cloud analytics wire formatting', () => {
  it.each([
    ['cn', 'account-a', 'cloud-api:cn:production:account:account-a', true],
    ['cn', null, 'anonymous-client', false],
    ['global', 'account-a', 'anonymous-client', false]
  ] as const)(
    'preserves %s account %s identity and the exact snake_case envelope',
    async (edition, accountId, distinctId, processPersonProfile) => {
      mocks.edition = edition
      mocks.getStatus.mockResolvedValue(status(accountId))
      await trackCherryCloudAnalyticsEvent(click)
      expect(mocks.trackEvent).toHaveBeenCalledWith(
        'subscription_entry_clicked',
        {
          source: 'selector_locked_row',
          signed_in: true,
          flow_id: click.flowId,
          model_id: click.modelId,
          product: 'cloud-api',
          producer: 'client',
          surface: 'desktop',
          entry: 'desktop',
          region: edition,
          environment: 'production',
          test: false,
          schema_version: 1
        },
        { distinctId, processPersonProfile }
      )
    }
  )

  it.each([
    [true, '', 'development'],
    [false, 'https://test.example', 'development'],
    [false, '', 'production']
  ] as const)(
    'preserves development=%s and backend override=%s classification',
    async (development, origin, environment) => {
      vi.stubEnv('DEV', development)
      vi.stubEnv('MAIN_VITE_CHERRY_CLOUD_API_ORIGIN', origin)
      await trackCherryCloudAnalyticsEvent(click, 'scope-a')
      expect(mocks.trackEvent).toHaveBeenCalledWith(
        click.event,
        expect.objectContaining({ environment, test: environment === 'development' }),
        { distinctId: `cloud-api:cn:${environment}:account:account-a`, processPersonProfile: true }
      )
    }
  )

  it('does not attach an explicitly unknown scope to the current account', async () => {
    await trackCherryCloudAnalyticsEvent(click, null)
    expect(mocks.trackEvent).toHaveBeenCalledWith(click.event, expect.anything(), {
      distinctId: 'anonymous-client',
      processPersonProfile: false
    })
  })

  it('keeps a late real click anonymous but drops stale async results', async () => {
    let finish!: (value: CherryCloudStatus) => void
    mocks.getStatus.mockReturnValue(
      new Promise<CherryCloudStatus>((resolve) => {
        finish = resolve
      })
    )
    const pending = trackCherryCloudAnalyticsEvent(click, 'scope-a')
    mocks.scopeId = 'scope-b'
    finish(status('account-b', 'scope-b'))
    await pending
    expect(mocks.trackEvent).toHaveBeenCalledWith(click.event, expect.anything(), {
      distinctId: 'anonymous-client',
      processPersonProfile: false
    })
    mocks.trackEvent.mockClear()
    await trackCherryCloudAnalyticsEvent(
      { event: 'subscription_portal_open', source: 'settings', flowId: click.flowId, result: 'success' },
      'scope-a'
    )
    expect(mocks.trackEvent).not.toHaveBeenCalled()
  })
})
