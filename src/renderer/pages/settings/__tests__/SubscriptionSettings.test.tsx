import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CherryCloudAccountPlans, CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

import { SubscriptionSettings } from '../SubscriptionSettings'

const { requestMock, session } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  session: { status: null as CherryCloudStatus | null }
}))

vi.mock('@renderer/hooks/useCherryAccountSession', () => ({
  useCherryAccountSession: () => ({ status: session.status, login: vi.fn() })
}))

const signedIn = (accountId: string): CherryCloudStatus => ({ phase: 'signed-in', accountId, displayName: accountId })

// A fresh SWR cache per render keeps test cases from sharing fetched plans.
const renderSettings = () =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <SubscriptionSettings />
    </SWRConfig>
  )

function paidPlans(displayName: string): CherryCloudAccountPlans {
  return {
    measured_at: '2026-09-21T00:00:00Z',
    entitlements: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        source: 'stripe',
        plan: {
          id: '22222222-2222-4222-8222-222222222222',
          display_name: displayName,
          is_free: false,
          default_for_new_accounts: false,
          quota_pool_count: 0,
          model_count: 1,
          purchase_available: true
        },
        state: 'active',
        starts_at: '2026-09-01T00:00:00Z',
        quota_pools: []
      }
    ],
    available_plans: []
  }
}

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@renderer/utils/appEdition', () => ({ getAppEdition: () => 'global' }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === 'settings.subscription.limit_days') return `${values?.count}-day limit`
      if (key === 'settings.subscription.remaining') return `${values?.percent}% remaining`
      return key
    },
    i18n: { language: 'en-US' }
  })
}))

afterEach(() => {
  session.status = signedIn('account-1')
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

session.status = signedIn('account-1')

describe('SubscriptionSettings', () => {
  it('opens the production account center on the cloud origin', async () => {
    vi.stubEnv('DEV', false)
    requestMock.mockImplementation((route: string) => {
      if (route === 'cherry_cloud.api_origin.get') return Promise.resolve('https://cloud.cherryai.com')
      if (route === 'cherry_cloud.account_plans.get') {
        return Promise.resolve({ measured_at: '2026-09-21T00:00:00Z', entitlements: [], available_plans: [] })
      }
      return Promise.resolve()
    })

    renderSettings()
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('cherry_cloud.account_plans.get'))

    await userEvent.click(screen.getByRole('button', { name: 'settings.subscription.subscribe' }))

    expect(requestMock).toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud.cherryai.com/account/plans'
    )
  })

  it('describes quota windows without exposing backend pool names or a total summary', async () => {
    requestMock.mockResolvedValue({
      measured_at: '2026-09-21T00:00:00Z',
      entitlements: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          source: 'stripe',
          plan: {
            id: '22222222-2222-4222-8222-222222222222',
            display_name: 'Flash',
            is_free: false,
            default_for_new_accounts: false,
            quota_pool_count: 1,
            model_count: 1,
            purchase_available: true
          },
          state: 'active',
          starts_at: '2026-09-01T00:00:00Z',
          quota_pools: [
            {
              allocation_id: '33333333-3333-4333-8333-333333333333',
              display_name: 'Flash quota',
              measurement_kind: 'money',
              currency: 'USD',
              model_ids: [],
              windows: [
                {
                  window_type: 'rolling',
                  duration_seconds: 30 * 24 * 60 * 60,
                  limit_units: 8_000_000,
                  used_units: 0,
                  active_reserved_units: 0,
                  remaining_units: 8_000_000,
                  next_recovery_at: '2026-10-01T00:00:00Z'
                }
              ]
            }
          ]
        }
      ],
      available_plans: []
    })

    renderSettings()

    expect(await screen.findByText('30-day limit')).toBeInTheDocument()
    expect(screen.queryByText('Flash quota')).not.toBeInTheDocument()
    expect(screen.getByText('100% remaining')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '30-day limit' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.queryByText('US$8.00')).not.toBeInTheDocument()
  })

  it("keeps the current account's plan when a previous account's response arrives late", async () => {
    const accountA = Promise.withResolvers<CherryCloudAccountPlans>()
    requestMock.mockImplementationOnce(() => accountA.promise)
    session.status = signedIn('account-a')
    const view = renderSettings()
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1))

    session.status = { phase: 'signed-out', accountId: null, displayName: null }
    view.rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <SubscriptionSettings />
      </SWRConfig>
    )
    requestMock.mockResolvedValueOnce(paidPlans('Plan B'))
    session.status = signedIn('account-b')
    view.rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <SubscriptionSettings />
      </SWRConfig>
    )
    expect(await screen.findByText('Plan B')).toBeInTheDocument()

    await act(async () => accountA.resolve(paidPlans('Plan A')))
    expect(screen.getByText('Plan B')).toBeInTheDocument()
    expect(screen.queryByText('Plan A')).not.toBeInTheDocument()
  })
})
