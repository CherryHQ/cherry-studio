import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { CherryCloudAccountPlans, CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

import { UserAccountPanel } from '../UserAccountPanel'

const request = vi.mocked(window.api.ipcApi.request)
let session: CherryCloudStatus
let plans: CherryCloudAccountPlans

beforeEach(async () => {
  vi.clearAllMocks()
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setPreferenceValue('app.user.name', '')
  vi.stubGlobal('__APP_EDITION__', 'global')
  vi.stubEnv('DEV', true)
  await i18n.changeLanguage('zh-CN')

  session = { phase: 'signed-in', accountId: 'account-1', displayName: 'c***@cherry-ai.com' }
  plans = { measured_at: '2026-09-23T00:00:00Z', entitlements: [], available_plans: [] }
  request.mockImplementation(async (route) => {
    if (route === 'cherry_cloud.status.get') return { ok: true, data: session }
    if (route === 'cherry_cloud.api_origin.get') return { ok: true, data: 'https://cloud-dev.cherryai.com' }
    if (route === 'cherry_cloud.account_plans.get') return { ok: true, data: plans }
    if (route === 'cherry_cloud.login.start') {
      return { ok: true, data: { phase: 'authorizing', accountId: null, displayName: null } }
    }
    return { ok: true, data: undefined }
  })
})

afterEach(() => vi.unstubAllEnvs())

describe('UserAccountPanel', () => {
  it('shows the signed-in email without a name prompt in the global account menu', async () => {
    render(<UserAccountPanel />)

    expect(await screen.findByText('c***@cherry-ai.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '用户名' })).toHaveTextContent('c***@cherry-ai.com')
    expect(screen.getAllByText('c***@cherry-ai.com')).toHaveLength(1)
    expect(screen.queryByText('输入您的姓名')).not.toBeInTheDocument()
  })

  it.each(['cn', 'global'])('offers subscription and personal information in the %s account menu', async (edition) => {
    vi.stubGlobal('__APP_EDITION__', edition)
    const user = userEvent.setup()

    render(<UserAccountPanel />)

    expect(await screen.findByRole('button', { name: /去订阅/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '用户名' }))
    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
  })

  it('offers subscription sign-in without querying plans when signed out', async () => {
    session = { phase: 'signed-out', accountId: null, displayName: null }
    const user = userEvent.setup()

    render(<UserAccountPanel />)

    await user.click(await screen.findByRole('button', { name: /去订阅/ }))

    expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined)
    expect(request).not.toHaveBeenCalledWith('cherry_cloud.account_plans.get', undefined)
  })

  it('opens the subscription page when signed in without a paid plan', async () => {
    vi.stubEnv('DEV', false)
    plans.entitlements = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        source: 'grant',
        plan: {
          id: '44444444-4444-4444-8444-444444444444',
          display_name: 'Free',
          is_free: true,
          default_for_new_accounts: true,
          quota_pool_count: 1,
          model_count: 1,
          purchase_available: false
        },
        state: 'active',
        starts_at: '2026-09-01T00:00:00Z',
        quota_pools: []
      }
    ]
    const user = userEvent.setup()

    render(<UserAccountPanel />)

    await user.click(await screen.findByRole('button', { name: /去订阅/ }))

    expect(request).toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud-dev.cherryai.com/account/plans'
    )
  })

  it('shows the server plan name and opens in-app usage for a paid plan', async () => {
    plans.entitlements = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        source: 'stripe',
        plan: {
          id: '22222222-2222-4222-8222-222222222222',
          display_name: 'API Plan 2026',
          is_free: false,
          default_for_new_accounts: false,
          quota_pool_count: 1,
          model_count: 1,
          purchase_available: true
        },
        state: 'active',
        starts_at: '2026-09-01T00:00:00Z',
        quota_pools: []
      }
    ]
    const user = userEvent.setup()

    render(<UserAccountPanel />)

    await user.click(await screen.findByRole('button', { name: /API Plan 2026.*查看用量/ }))

    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
    expect(request).not.toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud-dev.cherryai.com/account/plans'
    )
  })

  it('shows the tightest remaining quota and a hover card with usage details for a paid plan', async () => {
    const window_ = (durationSeconds: number, remaining: number) => ({
      window_type: 'rolling' as const,
      duration_seconds: durationSeconds,
      limit_units: 100,
      used_units: 100 - remaining,
      active_reserved_units: 0,
      remaining_units: remaining,
      next_recovery_at: '2026-10-01T00:00:00Z'
    })
    plans.entitlements = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        source: 'stripe',
        plan: {
          id: '22222222-2222-4222-8222-222222222222',
          display_name: 'Plus',
          is_free: false,
          default_for_new_accounts: false,
          quota_pool_count: 1,
          model_count: 3,
          purchase_available: true
        },
        state: 'active',
        starts_at: '2026-09-01T00:00:00Z',
        quota_pools: [
          {
            allocation_id: '33333333-3333-4333-8333-333333333333',
            display_name: 'Plus quota',
            measurement_kind: 'money',
            currency: 'CNY',
            model_ids: [],
            windows: [window_(30 * 24 * 60 * 60, 92), window_(5 * 60 * 60, 40)]
          }
        ]
      }
    ]
    const user = userEvent.setup()

    render(<UserAccountPanel />)

    const row = await screen.findByRole('button', { name: /Plus.*40%/ })
    await user.hover(row)

    expect(await screen.findByRole('progressbar', { name: '月度用量' })).toHaveAttribute('aria-valuenow', '92')
    await user.click(screen.getByRole('button', { name: '查看用量详情' }))
    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
  })

  it('does not label a failed plan lookup as unsubscribed and lets the user retry', async () => {
    let attempts = 0
    request.mockImplementation(async (route) => {
      if (route === 'cherry_cloud.status.get') return { ok: true, data: session }
      if (route === 'cherry_cloud.account_plans.get') {
        return ++attempts === 1
          ? { ok: false, error: { code: 'INTERNAL', message: 'failed' } }
          : { ok: true, data: plans }
      }
      return { ok: true, data: undefined }
    })
    const user = userEvent.setup()

    render(<UserAccountPanel />)

    await user.click(await screen.findByRole('button', { name: /重试/ }))

    expect(await screen.findByRole('button', { name: /去订阅/ })).toBeInTheDocument()
  })
})
