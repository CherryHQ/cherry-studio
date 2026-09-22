import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SubscriptionSettings } from '../SubscriptionSettings'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('@renderer/hooks/useCherryAccountSession', () => ({
  useCherryAccountSession: () => ({
    status: { phase: 'signed-in', displayName: 'Test user' },
    login: vi.fn()
  })
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@renderer/utils/appEdition', () => ({ getAppEdition: () => 'global' }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === 'settings.subscription.limit_days') return `${values?.count}-day limit`
      if (key === 'settings.subscription.remaining') return `${values?.percent}% remaining`
      if (key === 'settings.subscription.total') return `Total ${values?.total}`
      return key
    },
    i18n: { language: 'en-US' }
  })
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('SubscriptionSettings', () => {
  it('opens the Dev account center externally when the cloud API runs locally', async () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('MAIN_VITE_CHERRY_CLOUD_API_ORIGIN', 'http://127.0.0.1:8084')
    requestMock.mockImplementation((route: string) => {
      if (route === 'cherry_cloud.account_plans.get') {
        return Promise.resolve({ measured_at: '2026-09-21T00:00:00Z', entitlements: [], available_plans: [] })
      }
      return Promise.resolve()
    })

    render(<SubscriptionSettings />)
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('cherry_cloud.account_plans.get'))

    await userEvent.click(screen.getByRole('button', { name: 'settings.subscription.subscribe' }))

    expect(requestMock).toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://accounts-dev.cherryai.com/account/plans'
    )
  })

  it('describes quota windows without exposing backend pool names', async () => {
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

    render(<SubscriptionSettings />)

    expect(await screen.findByText('30-day limit')).toBeInTheDocument()
    expect(screen.queryByText('Flash quota')).not.toBeInTheDocument()
    expect(screen.getByText('100% remaining')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '30-day limit' })).toHaveAttribute('aria-valuenow', '100')
  })
})
