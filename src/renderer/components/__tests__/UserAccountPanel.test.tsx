import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type PropsWithChildren, type ReactElement, useState } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { CherryCloudAccountPlans, CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

import { UserAccountPanel } from '../UserAccountPanel'

const showUserPopup = vi.hoisted(() => vi.fn())

vi.unmock('@cherrystudio/ui')

vi.mock('../UserPopup', () => ({ default: { show: showUserPopup } }))

const request = vi.mocked(window.api.ipcApi.request)
let session: CherryCloudStatus
let plans: CherryCloudAccountPlans

let swrCache = new Map()

function SWRWrapper({ children }: PropsWithChildren) {
  return <SWRConfig value={{ provider: () => swrCache, dedupingInterval: 0 }}>{children}</SWRConfig>
}

function renderAccount(ui: ReactElement) {
  return render(ui, { wrapper: SWRWrapper })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function paidPlans(name: string): CherryCloudAccountPlans {
  return {
    ...plans,
    entitlements: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        source: 'stripe',
        plan: {
          id: '22222222-2222-4222-8222-222222222222',
          display_name: name,
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
            allocation_id: '55555555-5555-4555-8555-555555555555',
            display_name: 'Plan quota',
            measurement_kind: 'requests',
            model_ids: ['test-model'],
            windows: [
              {
                window_type: 'rolling',
                duration_seconds: 604800,
                limit_units: 100,
                used_units: 21,
                active_reserved_units: 0,
                remaining_units: 79
              }
            ]
          }
        ]
      }
    ]
  }
}

beforeEach(async () => {
  swrCache = new Map()
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
  it('keeps the account entry label while loading and after signing out', async () => {
    const pendingStatus = deferred<{ ok: true; data: CherryCloudStatus }>()
    request.mockImplementation(() => pendingStatus.promise)
    renderAccount(<UserAccountPanel />)

    const header = screen.getByRole('button', { name: '用户名' })
    expect(within(header).getByText('个人信息')).toBeVisible()
    await act(async () =>
      pendingStatus.resolve({ ok: true, data: { phase: 'signed-out', accountId: null, displayName: null } })
    )

    expect(await screen.findByRole('button', { name: /去订阅/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
    expect(within(header).getByText('个人信息')).toBeVisible()
    expect(within(header).queryByText('Cherry Cloud')).not.toBeInTheDocument()
  })

  it('keeps account status errors separate from the account entry label', async () => {
    request.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'failed' } })
    renderAccount(<UserAccountPanel />)

    await screen.findByRole('button', { name: '重试' })
    const header = screen.getByRole('button', { name: '用户名' })
    expect(within(header).getByText('个人信息')).toBeVisible()
    expect(within(header).getByRole('alert')).toBeVisible()
  })

  it('uses the account entry label when the signed-in account has no display name', async () => {
    session = { ...session, displayName: null }
    renderAccount(<UserAccountPanel />)

    expect(await screen.findByText('已登录')).toBeVisible()
    expect(within(screen.getByRole('button', { name: '用户名' })).getByText('个人信息')).toBeVisible()
  })

  it('prefers the local nickname and shows the cloud identity separately', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', 'Local nickname')
    renderAccount(<UserAccountPanel />)

    await screen.findByText(session.displayName!)
    const header = screen.getByRole('button', { name: '用户名' })
    expect(within(header).getByText('Local nickname')).toBeVisible()
    expect(within(header).getByText(session.displayName!)).toBeVisible()
  })

  it('places help below appearance and keeps settings as the last menu action', () => {
    renderAccount(
      <UserAccountPanel>
        <button type="button">帮助</button>
      </UserAccountPanel>
    )
    const appearance = screen.getByRole('button', { name: '外观' })
    const help = screen.getByRole('button', { name: '帮助' })
    const settings = screen.getByRole('button', { name: '设置' })

    expect(screen.getAllByRole('button').filter((button) => [appearance, help, settings].includes(button))).toEqual([
      appearance,
      help,
      settings
    ])
  })

  it('closes the entire account menu after selecting an appearance mode', async () => {
    function AccountMenu() {
      const [open, setOpen] = useState(true)
      return open ? (
        <UserAccountPanel onRequestClose={() => setOpen(false)} />
      ) : (
        <button type="button">Open account menu</button>
      )
    }
    const user = userEvent.setup()
    renderAccount(<AccountMenu />)

    await user.hover(screen.getByRole('button', { name: '外观' }))
    await user.click(await screen.findByRole('button', { name: '浅色', pressed: false }))

    expect(screen.getByRole('button', { name: 'Open account menu' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '用户名' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '外观' })).not.toBeInTheDocument()
  })

  it('shows the signed-in email without a name prompt in the global account menu', async () => {
    renderAccount(<UserAccountPanel />)

    expect(await screen.findByText('c***@cherry-ai.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '用户名' })).toHaveTextContent('c***@cherry-ai.com')
    expect(within(screen.getByRole('button', { name: '用户名' })).getByText('个人信息')).toBeVisible()
    expect(screen.getAllByText('c***@cherry-ai.com')).toHaveLength(1)
    expect(screen.queryByText('输入您的姓名')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument()
  })

  it('shows the signed-in account without a name prompt or subscription row in the CN account menu', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')

    renderAccount(<UserAccountPanel />)

    expect(await screen.findByText('c***@cherry-ai.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '用户名' })).toHaveTextContent('c***@cherry-ai.com')
    expect(screen.getAllByText('c***@cherry-ai.com')).toHaveLength(1)
    expect(screen.queryByText('输入您的姓名')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /去订阅|查看用量/ })).not.toBeInTheDocument()
  })

  it('offers CN sign-in in production without a subscription entry', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    vi.stubEnv('DEV', false)
    session = { phase: 'signed-out', accountId: null, displayName: null }
    const user = userEvent.setup()
    renderAccount(<UserAccountPanel />)

    const login = await screen.findByRole('button', { name: '登录' })
    await waitFor(() => expect(login).toBeEnabled())
    expect(screen.queryByRole('button', { name: /去订阅/ })).not.toBeInTheDocument()
    await user.click(login)

    expect(await screen.findByRole('button', { name: '取消' })).toBeEnabled()
    expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined)
    expect(request).not.toHaveBeenCalledWith('cherry_cloud.account_plans.get', undefined)
  })

  it('restores CN sign-in after the account signs out', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    renderAccount(<UserAccountPanel />)
    await screen.findByText(session.displayName!)
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
    const listener = vi
      .mocked(window.api.ipcApi.on)
      .mock.calls.find(([event]) => event === 'cherry_cloud.status_changed')![1]

    act(() => listener({ phase: 'signed-out', accountId: null, displayName: null }))

    expect(await screen.findByRole('button', { name: '登录' })).toBeEnabled()
  })

  it('opens the avatar and name dialog from the CN account menu', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    const user = userEvent.setup()

    renderAccount(<UserAccountPanel />)
    await user.click(await screen.findByRole('button', { name: '用户名' }))

    expect(showUserPopup).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
  })

  it('keeps the personal information page for the global account menu', async () => {
    const user = userEvent.setup()

    renderAccount(<UserAccountPanel />)
    await user.click(await screen.findByRole('button', { name: '用户名' }))

    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
    expect(showUserPopup).not.toHaveBeenCalled()
  })

  it('offers subscription sign-in without querying plans when signed out', async () => {
    session = { phase: 'signed-out', accountId: null, displayName: null }
    const user = userEvent.setup()

    renderAccount(<UserAccountPanel />)

    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
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

    renderAccount(<UserAccountPanel />)

    await user.click(await screen.findByRole('button', { name: /去订阅/ }))

    expect(request).toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud-dev.cherryai.com/account/plans'
    )
  })

  it('shows the plan below the nickname and opens in-app usage with the remaining quota', async () => {
    plans = paidPlans('API Plan 2026')
    const user = userEvent.setup()

    renderAccount(<UserAccountPanel />)

    const usage = await screen.findByRole('button', { name: '用量 剩余 79%' })
    expect(within(screen.getByRole('button', { name: '用户名' })).getByText('API Plan 2026')).toBeVisible()
    expect(screen.queryByText(session.displayName!)).not.toBeInTheDocument()
    await user.click(usage)

    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
    expect(request).not.toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud-dev.cherryai.com/account/plans'
    )
  })

  it('shows the tightest remaining limit instead of adding overlapping quota windows', async () => {
    plans = paidPlans('Pro')
    plans.entitlements[0].quota_pools[0].windows.push({
      window_type: 'calendar_day',
      duration_seconds: 86400,
      limit_units: 20,
      used_units: 13,
      active_reserved_units: 2,
      remaining_units: 5
    })
    renderAccount(<UserAccountPanel />)

    expect(await screen.findByRole('button', { name: '用量 剩余 25%' })).toBeEnabled()
  })

  it('shows zero remaining when a quota window is exhausted', async () => {
    plans = paidPlans('Pro')
    plans.entitlements[0].quota_pools[0].windows[0].remaining_units = 0
    renderAccount(<UserAccountPanel />)

    expect(await screen.findByRole('button', { name: '用量 剩余 0%' })).toBeEnabled()
  })

  it('keeps usage details accessible without inventing a percentage when no quota is configured', async () => {
    plans = paidPlans('Pro')
    plans.entitlements[0].quota_pools = []
    renderAccount(<UserAccountPanel />)

    expect(await screen.findByRole('button', { name: '用量 未配置额度' })).toBeEnabled()
  })

  it('keeps cached account and plan details visible while reopening refreshes them', async () => {
    plans = paidPlans('Flash')
    const first = renderAccount(<UserAccountPanel />)
    expect(await screen.findByRole('button', { name: '用量 剩余 79%' })).toBeEnabled()
    first.unmount()

    const pendingStatus = deferred<{ ok: true; data: CherryCloudStatus }>()
    const pendingPlans = deferred<{ ok: true; data: CherryCloudAccountPlans }>()
    request.mockImplementation((route) => {
      if (route === 'cherry_cloud.status.get') return pendingStatus.promise
      if (route === 'cherry_cloud.account_plans.get') return pendingPlans.promise
      return Promise.resolve({ ok: true, data: undefined })
    })
    renderAccount(<UserAccountPanel />)

    expect(screen.getByRole('button', { name: '用户名' })).toHaveTextContent('Flash')
    expect(screen.getByRole('button', { name: '用量 剩余 79%' })).toBeEnabled()
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
    await waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.account_plans.get', undefined))
    await act(async () => {
      pendingStatus.resolve({ ok: true, data: session })
      pendingPlans.resolve({ ok: true, data: paidPlans('Flash Plus') })
    })

    expect(await screen.findByText('Flash Plus')).toBeVisible()
  })

  it('drops a previous account plan immediately and ignores its late response after switching accounts', async () => {
    const previousPlans = deferred<{ ok: true; data: CherryCloudAccountPlans }>()
    const nextPlans = deferred<{ ok: true; data: CherryCloudAccountPlans }>()
    request.mockImplementation((route) => {
      if (route === 'cherry_cloud.status.get') return Promise.resolve({ ok: true, data: session })
      if (route === 'cherry_cloud.account_plans.get') return previousPlans.promise
      return Promise.resolve({ ok: true, data: undefined })
    })
    renderAccount(<UserAccountPanel />)
    await screen.findByText('c***@cherry-ai.com')
    await waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.account_plans.get', undefined))
    const listener = vi
      .mocked(window.api.ipcApi.on)
      .mock.calls.find(([event]) => event === 'cherry_cloud.status_changed')![1]
    request.mockImplementation((route) =>
      route === 'cherry_cloud.account_plans.get' ? nextPlans.promise : Promise.resolve({ ok: true, data: undefined })
    )
    act(() => listener({ phase: 'signed-in', accountId: 'account-2', displayName: 'new-account' }))
    await screen.findByText('new-account')
    await act(async () => previousPlans.resolve({ ok: true, data: paidPlans('Old Plan') }))
    expect(screen.queryByText('Old Plan')).not.toBeInTheDocument()
    await act(async () => nextPlans.resolve({ ok: true, data: paidPlans('New Plan') }))
    expect(await screen.findByText('New Plan')).toBeVisible()
  })

  it('does not reuse a cached plan for another account with the same display name', async () => {
    plans = paidPlans('Old Plan')
    renderAccount(<UserAccountPanel />)
    await screen.findByText('Old Plan')
    const pendingPlans = deferred<{ ok: true; data: CherryCloudAccountPlans }>()
    request.mockImplementation(() => pendingPlans.promise)
    const listener = vi
      .mocked(window.api.ipcApi.on)
      .mock.calls.find(([event]) => event === 'cherry_cloud.status_changed')![1]

    act(() => listener({ ...session, accountId: 'account-2' }))
    expect(screen.queryByText('Old Plan')).not.toBeInTheDocument()
    await act(async () => pendingPlans.resolve({ ok: true, data: paidPlans('New Plan') }))

    expect(await screen.findByText('New Plan')).toBeVisible()
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

    renderAccount(<UserAccountPanel />)

    await user.click(await screen.findByRole('button', { name: /重试/ }))

    expect(await screen.findByRole('button', { name: /去订阅/ })).toBeInTheDocument()
  })
})
