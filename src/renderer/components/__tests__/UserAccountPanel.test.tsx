import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor } from '@testing-library/react'
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
        quota_pools: []
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

  it('shows the server plan name and opens in-app usage for a paid plan', async () => {
    plans = paidPlans('API Plan 2026')
    const user = userEvent.setup()

    renderAccount(<UserAccountPanel />)

    await user.click(await screen.findByRole('button', { name: /订阅.*API Plan 2026/ }))

    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
    expect(request).not.toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud-dev.cherryai.com/account/plans'
    )
  })

  it('keeps cached account and plan details visible while reopening refreshes them', async () => {
    plans = paidPlans('Flash')
    const first = renderAccount(<UserAccountPanel />)
    expect(await screen.findByRole('button', { name: /订阅.*Flash/ })).toBeEnabled()
    first.unmount()

    const pendingStatus = deferred<{ ok: true; data: CherryCloudStatus }>()
    const pendingPlans = deferred<{ ok: true; data: CherryCloudAccountPlans }>()
    request.mockImplementation((route) => {
      if (route === 'cherry_cloud.status.get') return pendingStatus.promise
      if (route === 'cherry_cloud.account_plans.get') return pendingPlans.promise
      return Promise.resolve({ ok: true, data: undefined })
    })
    renderAccount(<UserAccountPanel />)

    expect(screen.getByRole('button', { name: '用户名' })).toHaveTextContent(session.displayName!)
    expect(screen.getByRole('button', { name: /订阅.*Flash/ })).toBeEnabled()
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
    await waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.account_plans.get', undefined))
    await act(async () => {
      pendingStatus.resolve({ ok: true, data: session })
      pendingPlans.resolve({ ok: true, data: paidPlans('Flash Plus') })
    })

    expect(await screen.findByRole('button', { name: /订阅.*Flash Plus/ })).toBeEnabled()
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
    expect(await screen.findByRole('button', { name: /订阅.*New Plan/ })).toBeEnabled()
  })

  it('does not reuse a cached plan for another account with the same display name', async () => {
    plans = paidPlans('Old Plan')
    renderAccount(<UserAccountPanel />)
    await screen.findByRole('button', { name: /订阅.*Old Plan/ })
    const pendingPlans = deferred<{ ok: true; data: CherryCloudAccountPlans }>()
    request.mockImplementation(() => pendingPlans.promise)
    const listener = vi
      .mocked(window.api.ipcApi.on)
      .mock.calls.find(([event]) => event === 'cherry_cloud.status_changed')![1]

    act(() => listener({ ...session, accountId: 'account-2' }))
    expect(screen.queryByText('Old Plan')).not.toBeInTheDocument()
    await act(async () => pendingPlans.resolve({ ok: true, data: paidPlans('New Plan') }))

    expect(await screen.findByRole('button', { name: /订阅.*New Plan/ })).toBeEnabled()
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
