import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CherryCloudAccountPlans,
  CherryCloudEndpointFact,
  CherryCloudStatus
} from '@shared/ipc/schemas/cherryCloud'

import { SubscriptionSettings } from '../SubscriptionSettings'

const { requestMock, session, receiptFixture } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  receiptFixture: {
    initialFact: undefined as CherryCloudEndpointFact<CherryCloudAccountPlans> | undefined,
    refresh: undefined as (() => Promise<unknown>) | undefined
  },
  session: {
    status: null as CherryCloudStatus | null,
    loadState: 'ready',
    login: vi.fn(),
    cancelLogin: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useCherryAccountSession', () => ({
  useCherryAccountSession: () => ({
    status: session.status,
    loadState: session.loadState,
    login: session.login,
    cancelLogin: session.cancelLogin,
    isAuthorizing: session.status?.phase === 'authorizing',
    isCancellingLogin: false
  })
}))

// This component receives owner facts; transport ordering is covered by the receipt hook tests.
vi.mock('@renderer/hooks/useCherryCloudReceipt', async () => {
  const { default: useSWR } = await import('swr')
  const { useCallback } = await import('react')
  return {
    useCherryCloudReceipt: () => {
      const status = session.status
      const query = useSWR<CherryCloudEndpointFact<CherryCloudAccountPlans>>(
        status?.phase === 'signed-in' ? ['settings-plan-fixture', status.scopeId] : null,
        null,
        { revalidateOnMount: false, revalidateOnFocus: false, fallbackData: receiptFixture.initialFact }
      )
      const { mutate } = query
      const refresh = useCallback(async () => {
        try {
          const value = await requestMock('test.fixture.plans')
          await mutate({ freshness: 'fresh', value, observedRevision: 1 }, { revalidate: false })
          return { outcome: 'refreshed' }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await mutate(
            (current): CherryCloudEndpointFact<CherryCloudAccountPlans> => {
              const previous = current ?? receiptFixture.initialFact
              return previous && previous.freshness !== 'unknown'
                ? { ...previous, freshness: 'stale', error: message }
                : { freshness: 'unknown', error: message }
            },
            { revalidate: false }
          )
          return { outcome: 'failed' }
        }
      }, [mutate])
      receiptFixture.refresh = refresh
      return {
        receipt: status
          ? {
              status,
              reason: 'initial',
              account: { freshness: 'unknown', error: null },
              models: { freshness: 'unknown', error: null },
              plans: query.data ?? { freshness: 'unknown', error: null }
            }
          : undefined,
        refresh,
        reload: query.mutate,
        isRefreshing: false
      }
    }
  }
})

const signedIn = (accountId: string): CherryCloudStatus => ({
  phase: 'signed-in',
  accountId,
  displayName: accountId,
  scopeId: accountId,
  revision: 1
})

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
          subscription_price: { product_name: displayName, currency: 'cny', interval: 'month', unit_amount: 1990 },
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

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: async (route: string, ...args: unknown[]) => {
      if (route === 'cherry_cloud.status.get') return session.status
      const result = await requestMock(route, ...args)
      return route === 'cherry_cloud.account_portal.open' ? { outcome: 'opened' } : result
    }
  }
}))
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
  session.loadState = 'ready'
  receiptFixture.initialFact = undefined
  receiptFixture.refresh = undefined
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

session.status = signedIn('account-1')

describe('SubscriptionSettings', () => {
  it.each([
    ['signed out', { phase: 'signed-out', accountId: null, displayName: null, scopeId: 'out', revision: 1 }],
    ['signed in', signedIn('account-1')]
  ] satisfies [string, CherryCloudStatus][])(
    'opens the FAQ from the section title while %s',
    async (_state, status) => {
      session.status = status
      requestMock.mockImplementation((route: string) => {
        if (route === 'cherry_cloud.account_origin.get') return Promise.resolve('https://cloud.cherryai.com.cn')
        if (route === 'test.fixture.plans') {
          return Promise.resolve({ measured_at: '2026-09-21T00:00:00Z', entitlements: [], available_plans: [] })
        }
        return Promise.resolve()
      })
      renderSettings()

      await userEvent.click(screen.getByRole('button', { name: 'settings.subscription.faq' }))

      expect(requestMock).toHaveBeenCalledWith(
        'system.shell.open_external_website',
        'https://cloud.cherryai.com.cn/account/faq?entry=desktop'
      )
    }
  )

  it('reports the usage view, Manage subscription, and FAQ clicks of a subscribed account', async () => {
    requestMock.mockImplementation((route: string) => {
      if (route === 'test.fixture.plans') return Promise.resolve(paidPlans('Plus'))
      if (route === 'cherry_cloud.account_origin.get') return Promise.resolve('https://cloud.cherryai.com.cn')
      return Promise.resolve()
    })
    renderSettings()

    await userEvent.click(await screen.findByRole('button', { name: /settings.subscription.manage/ }))
    await userEvent.click(screen.getByRole('button', { name: 'settings.subscription.faq' }))

    const tracked = requestMock.mock.calls.filter(([route]) => route === 'cherry_cloud.analytics.track')
    expect(tracked.map(([, envelope]) => envelope.payload)).toEqual([
      { event: 'subscription_usage_view', subscribed: true },
      { event: 'subscription_manage_click' },
      { event: 'subscription_faq_click', subscribed: true }
    ])
  })

  it('opens the production account center on the cloud origin', async () => {
    vi.stubEnv('DEV', false)
    requestMock.mockImplementation((route: string) => {
      if (route === 'cherry_cloud.status.get') return Promise.resolve(session.status)
      if (route === 'cherry_cloud.account_origin.get') return Promise.resolve('https://cloud.cherryai.com')
      if (route === 'test.fixture.plans') {
        return Promise.resolve({ measured_at: '2026-09-21T00:00:00Z', entitlements: [], available_plans: [] })
      }
      return Promise.resolve()
    })

    renderSettings()
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('test.fixture.plans'))

    await userEvent.click(screen.getByRole('button', { name: 'settings.subscription.subscribe' }))

    expect(requestMock).toHaveBeenCalledWith(
      'cherry_cloud.account_portal.open',
      expect.objectContaining({ scopeId: 'account-1', entrySource: 'settings' })
    )
  })

  it('labels a 30-day rolling window by its length, as the web account page does, without backend pool names', async () => {
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
    expect(screen.getByText('100.00% remaining')).toBeInTheDocument()
    expect(screen.getByText('settings.subscription.next_recovery')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '30-day limit' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.queryByText('US$8.00')).not.toBeInTheDocument()
  })

  it('does not tell a subscriber they have no plan when the plans fail to load', async () => {
    requestMock.mockRejectedValue(new Error('offline'))

    renderSettings()

    expect(await screen.findByText('settings.subscription.load_failed')).toBeInTheDocument()
    expect(screen.queryByText('settings.subscription.no_plan')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.subscription.subscribe' })).not.toBeInTheDocument()
  })

  it('does not offer sign-in before the session status is known', () => {
    session.status = null
    session.loadState = 'loading'
    renderSettings()

    expect(screen.queryByRole('button', { name: 'settings.subscription.sign_in' })).not.toBeInTheDocument()
    expect(screen.queryByText('settings.subscription.signed_out')).not.toBeInTheDocument()
  })

  it('signs in from the signed-out section', async () => {
    session.status = { phase: 'signed-out', accountId: null, displayName: null, scopeId: 'out', revision: 1 }
    renderSettings()

    await userEvent.click(screen.getByRole('button', { name: 'settings.subscription.sign_in' }))
    expect(session.login).toHaveBeenCalledTimes(1)
    expect(screen.getByText('settings.subscription.sign_in_usage')).toBeInTheDocument()
  })

  it('blocks a second sign-in while the browser is authorizing and lets the user cancel', async () => {
    session.status = { phase: 'authorizing', accountId: null, displayName: null, scopeId: 'out', revision: 1 }
    renderSettings()

    expect(screen.getByRole('button', { name: 'settings.provider.cherry_cloud.signing_in' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(session.cancelLogin).toHaveBeenCalledTimes(1)
  })

  it('words a paid subscription month as ending with the period rather than recovering', async () => {
    const plans = paidPlans('国内订阅')
    plans.entitlements[0].quota_pools = [
      {
        allocation_id: '44444444-4444-4444-8444-444444444444',
        display_name: '国内订阅',
        measurement_kind: 'requests',
        model_ids: ['cn-model'],
        windows: [
          {
            window_type: 'subscription_month',
            duration_seconds: 2_678_400,
            limit_units: 100,
            used_units: 25,
            active_reserved_units: 0,
            remaining_units: 75,
            period_start: '2026-10-28T07:25:26Z',
            period_end: '2026-11-28T07:25:26Z'
          }
        ]
      }
    ]
    requestMock.mockResolvedValue(plans)

    renderSettings()

    expect(
      await screen.findByRole('progressbar', { name: 'settings.subscription.limit_subscription_month' })
    ).toHaveAttribute('aria-valuenow', '75')
    expect(screen.getByText('settings.subscription.subscription_month_ends')).toBeInTheDocument()
    expect(screen.queryByText('settings.subscription.next_recovery')).not.toBeInTheDocument()
  })

  it('manages a bought plan that has not started yet instead of offering Subscribe', async () => {
    const plans = paidPlans('Cherry Plus')
    plans.entitlements[0].state = 'upcoming'
    requestMock.mockResolvedValue(plans)

    renderSettings()

    expect(await screen.findByText('settings.subscription.upcoming')).toBeInTheDocument()
    expect(screen.getByText('Cherry Plus')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.subscription.manage' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.subscription.subscribe' })).not.toBeInTheDocument()
    expect(screen.queryByText('settings.subscription.no_plan')).not.toBeInTheDocument()
  })

  it.each(['active', 'upcoming'] as const)(
    'keeps Manage for the last-known %s paid plan after a refresh fails with 503',
    async (state) => {
      const plans = paidPlans('Cherry Plus')
      plans.entitlements[0].state = state
      requestMock.mockImplementation((route: string) =>
        route === 'test.fixture.plans' ? Promise.resolve(plans) : Promise.resolve()
      )
      renderSettings()
      await screen.findByText('Cherry Plus')
      requestMock.mockImplementation((route: string) => {
        if (route === 'test.fixture.plans') return Promise.reject(new Error('503'))
        if (route === 'cherry_cloud.account_origin.get') return Promise.resolve('https://cloud.cherryai.com')
        return Promise.resolve()
      })
      requestMock.mockClear()

      await act(async () => receiptFixture.refresh?.())

      expect(screen.getByText('Cherry Plus')).toBeInTheDocument()
      expect(screen.getByText('settings.subscription.load_failed')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'settings.subscription.subscribe' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'settings.subscription.faq' }))
      expect(requestMock.mock.calls.filter(([route]) => route === 'cherry_cloud.analytics.track')).toEqual([])
      await userEvent.click(screen.getByRole('button', { name: 'settings.subscription.manage' }))
      expect(requestMock).toHaveBeenCalledWith(
        'cherry_cloud.account_portal.open',
        expect.objectContaining({ scopeId: 'account-1', entrySource: 'manage' })
      )
    }
  )

  it.each(['paid', 'unpaid'] as const)('does not report or market a stale %s snapshot on mount', async (state) => {
    const plans = paidPlans('Cherry Plus')
    if (state === 'unpaid') plans.entitlements = []
    receiptFixture.initialFact = { freshness: 'stale', value: plans, observedRevision: 1, error: '503' }
    requestMock.mockRejectedValue(new Error('503'))

    renderSettings()

    expect(await screen.findByRole('button', { name: /common.retry/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'settings.subscription.subscribe' })).not.toBeInTheDocument()
    expect(screen.queryByText('settings.subscription.subscribe_hint')).not.toBeInTheDocument()
    expect(requestMock.mock.calls.filter(([route]) => route === 'cherry_cloud.analytics.track')).toEqual([])
    if (state === 'paid') {
      expect(screen.getByText('Cherry Plus')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'settings.subscription.manage' })).toBeEnabled()
    }
  })

  it('shows the backend plan name without a price or renewal interval', async () => {
    requestMock.mockResolvedValue(paidPlans('Plus'))

    renderSettings()

    expect(await screen.findByText('Plus')).toBeInTheDocument()
    expect(screen.queryByText(/19\.9|CNY|month/)).not.toBeInTheDocument()
  })
})
