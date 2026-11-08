import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type PropsWithChildren, type ReactElement, useState } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type {
  CherryCloudAccountPlans,
  CherryCloudAccountReceipt,
  CherryCloudStatus
} from '@shared/ipc/schemas/cherryCloud'

import { UserAccountPanel } from '../UserAccountPanel'

vi.unmock('@cherrystudio/ui')

const request = vi.mocked(window.api.ipcApi.request)
let session: Pick<CherryCloudStatus, 'phase' | 'accountId' | 'displayName'>
let plans: CherryCloudAccountPlans

let revision = 0
function receiptFor(status = session, value?: CherryCloudAccountPlans): CherryCloudAccountReceipt {
  const nextRevision = ++revision
  return {
    status: { ...status, scopeId: status.accountId ?? status.phase, revision: nextRevision },
    reason: 'initial',
    account: { freshness: 'unknown', error: null },
    models: { freshness: 'unknown', error: null },
    plans: value ? { freshness: 'fresh', value, observedRevision: nextRevision } : { freshness: 'unknown', error: null }
  }
}
function publishReceipt(receipt: CherryCloudAccountReceipt) {
  vi.mocked(window.api.ipcApi.on)
    .mock.calls.filter(([event]) => event === 'cherry_cloud.account_changed')
    .forEach(([, listener]) => listener(receipt))
}

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
    if (route === 'cherry_cloud.status.get') return { ok: true, data: receiptFor().status }
    if (route === 'cherry_cloud.account.get') return { ok: true, data: receiptFor() }
    if (route === 'cherry_cloud.account_origin.get') return { ok: true, data: 'https://cloud-dev.cherryai.com' }
    if (route === 'cherry_cloud.account.refresh')
      return { ok: true, data: { outcome: 'refreshed', receipt: receiptFor(session, plans) } }
    if (route === 'cherry_cloud.account_portal.open') return { ok: true, data: { outcome: 'opened' } }
    if (route === 'cherry_cloud.login.start') {
      session = { phase: 'authorizing', accountId: null, displayName: null }
      publishReceipt(receiptFor())
      return new Promise(() => undefined)
    }
    return { ok: true, data: undefined }
  })
})

afterEach(() => vi.unstubAllEnvs())

describe('UserAccountPanel', () => {
  it('keeps the account entry label while loading and after signing out', async () => {
    const pendingStatus = deferred<{ ok: true; data: CherryCloudAccountReceipt }>()
    request.mockImplementation(() => pendingStatus.promise)
    renderAccount(<UserAccountPanel />)

    const header = screen.getByRole('button', { name: '用户名' })
    expect(within(header).getByText('个人信息')).toBeVisible()
    await act(async () =>
      pendingStatus.resolve({ ok: true, data: receiptFor({ phase: 'signed-out', accountId: null, displayName: null }) })
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

  it('offers CN sign-in in production', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    vi.stubEnv('DEV', false)
    session = { phase: 'signed-out', accountId: null, displayName: null }
    const user = userEvent.setup()
    renderAccount(<UserAccountPanel />)

    const login = await screen.findByRole('button', { name: '登录' })
    await waitFor(() => expect(login).toBeEnabled())
    await user.click(login)

    expect(await screen.findByRole('button', { name: '取消' })).toBeEnabled()
    expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined)
    expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(false)
  })

  it('restores CN sign-in after the account signs out', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    renderAccount(<UserAccountPanel />)
    await screen.findByText(session.displayName!)
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
    const listener = vi
      .mocked(window.api.ipcApi.on)
      .mock.calls.find(([event]) => event === 'cherry_cloud.account_changed')![1]

    act(() => listener(receiptFor({ phase: 'signed-out', accountId: null, displayName: null })))

    expect(await screen.findByRole('button', { name: '登录' })).toBeEnabled()
  })

  it.each(['cn', 'global'])('offers subscription and personal information in the %s account menu', async (edition) => {
    vi.stubGlobal('__APP_EDITION__', edition)
    const user = userEvent.setup()

    renderAccount(<UserAccountPanel />)

    expect(await screen.findByRole('button', { name: /去订阅/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '用户名' }))
    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
  })

  it.each([
    ['a signed-out user who has not used Subscribe', 'signed-out', false, true],
    ['a user who already used Subscribe', 'signed-out', true, false],
    ['a paying account', 'paid', false, false]
  ] as const)('marks the China-edition Subscribe entry for %s: %s', async (_case, account, seen, marked) => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    MockUseCacheUtils.setPersistCacheValue('ui.cherry_cloud.subscribe_prompt_seen', seen)
    if (account === 'signed-out') session = { phase: 'signed-out', accountId: null, displayName: null }
    else plans = paidPlans('Plus')

    renderAccount(<UserAccountPanel />)

    await screen.findByText(account === 'paid' ? 'Plus' : '去订阅')
    await waitFor(() => expect(screen.queryByTestId('subscribe-reminder-dot') !== null).toBe(marked))
  })

  it('offers subscription sign-in without querying plans when signed out', async () => {
    session = { phase: 'signed-out', accountId: null, displayName: null }
    const user = userEvent.setup()

    renderAccount(<UserAccountPanel />)

    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /去订阅/ }))

    expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined)
    expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(false)
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
      'cherry_cloud.account_portal.open',
      expect.objectContaining({ scopeId: 'account-1' })
    )
  })

  it('shows the plan below the nickname and opens in-app usage with the remaining quota', async () => {
    plans = paidPlans('API Plan 2026')
    const user = userEvent.setup()

    renderAccount(<UserAccountPanel />)

    const usage = await screen.findByRole('button', { name: '用量 剩余 79.00%' })
    expect(within(screen.getByRole('button', { name: '用户名' })).getByText('API Plan 2026')).toBeVisible()
    expect(screen.queryByText(session.displayName!)).not.toBeInTheDocument()
    await user.click(usage)

    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
    expect(request).not.toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud-dev.cherryai.com/account/plans'
    )
  })

  it('shows the tightest remaining limit, from settled usage, instead of adding overlapping quota windows', async () => {
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

    // 13 of 20 settled; the 2 reserved by a running request are not counted yet.
    expect(await screen.findByRole('button', { name: '用量 剩余 35.00%' })).toBeEnabled()
  })

  it('shows zero remaining when a quota window is exhausted', async () => {
    plans = paidPlans('Pro')
    Object.assign(plans.entitlements[0].quota_pools[0].windows[0], { used_units: 100, remaining_units: 0 })
    renderAccount(<UserAccountPanel />)

    expect(await screen.findByRole('button', { name: '用量 剩余 0.00%' })).toBeEnabled()
  })

  it.each([
    [39_969_732, '99.92'],
    [39_999_999, '99.99']
  ])('shows %i of 40M units left as %s%%, never rounding a used window up to full', async (remaining, percent) => {
    plans = paidPlans('Plus')
    Object.assign(plans.entitlements[0].quota_pools[0].windows[0], {
      limit_units: 40_000_000,
      used_units: 40_000_000 - remaining,
      remaining_units: remaining
    })
    renderAccount(<UserAccountPanel />)

    expect(await screen.findByRole('button', { name: `用量 剩余 ${percent}%` })).toBeEnabled()
  })

  it('shows a bought plan that has not started yet without the subscribe prompt or reminder dot', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    MockUseCacheUtils.setPersistCacheValue('ui.cherry_cloud.subscribe_prompt_seen', false)
    plans = paidPlans('Plus')
    plans.entitlements[0].state = 'upcoming'
    renderAccount(<UserAccountPanel />)

    expect(await screen.findByRole('button', { name: '用量 即将生效' })).toBeEnabled()
    expect(screen.queryByText('去订阅')).not.toBeInTheDocument()
    expect(screen.queryByTestId('subscribe-reminder-dot')).not.toBeInTheDocument()
  })

  it.each(['active', 'upcoming'] as const)(
    'keeps the last-known %s paid plan when a refresh publishes a 503 failure',
    async (state) => {
      plans = paidPlans('Plus')
      plans.entitlements[0].state = state
      renderAccount(<UserAccountPanel />)
      await screen.findByText('Plus')

      const stale = receiptFor(session, plans)
      stale.reason = 'focus_refresh'
      stale.plans = { freshness: 'stale', value: plans, observedRevision: revision - 1, error: '503' }
      act(() => publishReceipt(stale))

      expect(screen.getByText('Plus')).toBeVisible()
      expect(screen.queryByText('去订阅')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /用量/ }))
      expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
      expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account_portal.open')).toBe(false)
    }
  )

  it('retries a stale unpaid snapshot instead of offering a new subscription', async () => {
    renderAccount(<UserAccountPanel />)
    await screen.findByRole('button', { name: /去订阅/ })
    const stale = receiptFor(session, plans)
    stale.reason = 'focus_refresh'
    stale.plans = { freshness: 'stale', value: plans, observedRevision: revision - 1, error: '503' }
    request.mockClear()

    act(() => publishReceipt(stale))

    expect(await screen.findByRole('button', { name: /重试/ })).toBeEnabled()
    expect(screen.queryByText('去订阅')).not.toBeInTheDocument()
    expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.analytics.track')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(await screen.findByRole('button', { name: /去订阅/ })).toBeInTheDocument()
    expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.account.refresh')).toBe(true)
  })

  it('keeps usage details accessible without inventing a percentage when no quota is configured', async () => {
    plans = paidPlans('Pro')
    plans.entitlements[0].quota_pools = []
    renderAccount(<UserAccountPanel />)

    expect(await screen.findByRole('button', { name: '用量 未配置额度' })).toBeEnabled()
  })

  it('keeps cached account and plans visible during snapshot revalidation', async () => {
    plans = paidPlans('Flash')
    const first = renderAccount(<UserAccountPanel />)
    expect(await screen.findByRole('button', { name: '用量 剩余 79.00%' })).toBeEnabled()
    first.unmount()
    const pending = deferred<{ ok: true; data: CherryCloudAccountReceipt }>()
    request.mockImplementation(() => pending.promise)
    renderAccount(<UserAccountPanel />)
    expect(screen.getByRole('button', { name: '用户名' })).toHaveTextContent('Flash')
    await act(async () => pending.resolve({ ok: true, data: receiptFor(session, paidPlans('Flash Plus')) }))
    expect(await screen.findByText('Flash Plus')).toBeVisible()
  })

  it('drops a previous account plan and ignores an obsolete receipt', async () => {
    plans = paidPlans('Old Plan')
    renderAccount(<UserAccountPanel />)
    await screen.findByText('Old Plan')
    const old = receiptFor(session, plans)
    session = { ...session, accountId: 'account-2' }
    const unknown = receiptFor()
    const pending = deferred<{ ok: true; data: unknown }>()
    request.mockImplementation(() => pending.promise)
    act(() => publishReceipt(unknown))
    expect(screen.queryByText('Old Plan')).not.toBeInTheDocument()
    act(() => publishReceipt(old))
    expect(screen.queryByText('Old Plan')).not.toBeInTheDocument()
    act(() => publishReceipt(receiptFor(session, paidPlans('New Plan'))))
    expect(await screen.findByText('New Plan')).toBeVisible()
    await act(async () => pending.resolve({ ok: true, data: { outcome: 'superseded', status: unknown.status } }))
  })

  it('shows per-window usage in a hover card that links to the usage page', async () => {
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

    renderAccount(<UserAccountPanel />)

    const row = await screen.findByRole('button', { name: '用量 剩余 40.00%' })
    await user.hover(row)

    expect(await screen.findByRole('progressbar', { name: '30 天额度' })).toHaveAttribute('aria-valuenow', '92')
    await user.click(screen.getByRole('button', { name: '查看用量详情' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'cherry_cloud.account_portal.open',
        expect.objectContaining({ scopeId: 'account-1' })
      )
    )
    expect(request).not.toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
  })

  it('does not label a failed plan lookup as unsubscribed and lets the user retry', async () => {
    let attempts = 0
    request.mockImplementation(async (route) => {
      if (route === 'cherry_cloud.status.get') return { ok: true, data: receiptFor().status }
      if (route === 'cherry_cloud.account.get') return { ok: true, data: receiptFor() }
      if (route === 'cherry_cloud.account.refresh') {
        return ++attempts === 1
          ? { ok: false, error: { code: 'INTERNAL', message: 'failed' } }
          : { ok: true, data: { outcome: 'refreshed', receipt: receiptFor(session, plans) } }
      }
      return { ok: true, data: undefined }
    })
    const user = userEvent.setup()

    renderAccount(<UserAccountPanel />)

    await user.click(await screen.findByRole('button', { name: /重试/ }))

    expect(await screen.findByRole('button', { name: /去订阅/ })).toBeInTheDocument()
  })
})
