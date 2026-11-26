import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderQuotaNotice } from '../ProviderQuotaNotice'

const mocks = vi.hoisted(() => ({
  edition: 'cn' as 'cn' | 'global',
  execute: vi.fn(),
  startCherryCloudSubscription: vi.fn(),
  trackSubscriptionEntryView: vi.fn()
}))

vi.mock('@renderer/utils/appEdition', () => ({ getAppEdition: () => mocks.edition }))
vi.mock('@renderer/hooks/command', () => ({ useCommandRuntime: () => ({ execute: mocks.execute }) }))
vi.mock('@renderer/services/cherryCloudSubscription', () => ({
  startCherryCloudSubscription: mocks.startCherryCloudSubscription
}))
vi.mock('@renderer/services/cherryCloudSubscriptionAnalytics', () => ({
  trackSubscriptionEntryView: mocks.trackSubscriptionEntryView
}))

const NOTICE_TEXT = '账户额度不足，请充值、更换服务商，或者订阅 CherryAI 继续使用'

type Phase = 'signed-out' | 'signed-in'
type PlansFact =
  | { freshness: 'unknown'; error: null }
  | { freshness: 'fresh'; value: unknown; observedRevision: number }

function receipt(phase: Phase, plans: PlansFact) {
  return {
    status: { phase, accountId: phase === 'signed-in' ? 'acc' : null, displayName: null, scopeId: phase, revision: 1 },
    reason: 'initial',
    account: { freshness: 'unknown', error: null },
    models: { freshness: 'unknown', error: null },
    plans
  }
}

const unknownPlans: PlansFact = { freshness: 'unknown', error: null }
const plansWith = (entitlements: unknown[]): PlansFact => ({
  freshness: 'fresh',
  observedRevision: 1,
  value: { measured_at: '2026-11-20T00:00:00.000Z', entitlements, available_plans: [] }
})
const paidPlan = (state: 'active' | 'upcoming') => ({ state, plan: { is_free: false }, quota_pools: [] })

function serveAccount(phase: Phase, plans: PlansFact) {
  const current = receipt(phase, plans)
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route) => {
    if (route === 'cherry_cloud.account.get') return { ok: true, data: current }
    if (route === 'cherry_cloud.account.refresh') return { ok: true, data: { outcome: 'refreshed', receipt: current } }
    return { ok: true, data: undefined }
  })
}

async function renderNotice() {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ProviderQuotaNotice />
    </SWRConfig>
  )
  // Let the account receipt (and a signed-in plan refresh) resolve before asserting absence.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.edition = 'cn'
})

describe('ProviderQuotaNotice', () => {
  it('suggests subscribing to a signed-out user and starts the flow from this touchpoint', async () => {
    serveAccount('signed-out', unknownPlans)
    await renderNotice()

    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument()
    expect(mocks.trackSubscriptionEntryView).toHaveBeenCalledWith('provider_quota_notice')

    await userEvent.click(screen.getByRole('button', { name: '去订阅' }))
    expect(mocks.startCherryCloudSubscription).toHaveBeenCalledWith('provider_quota_notice')

    await userEvent.click(screen.getByRole('button', { name: '切换模型' }))
    expect(mocks.execute).toHaveBeenCalledWith('chat.model.select')
  })

  it('suggests subscribing to a signed-in user with only a free plan', async () => {
    serveAccount('signed-in', plansWith([{ state: 'active', plan: { is_free: true }, quota_pools: [] }]))
    await renderNotice()

    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument()
  })

  it.each([
    ['an active paid plan', plansWith([paidPlan('active')])],
    ['an upcoming paid plan', plansWith([paidPlan('upcoming')])],
    ['plans that are not known yet', unknownPlans]
  ])('stays hidden for a signed-in user with %s', async (_, plans) => {
    serveAccount('signed-in', plans)
    await renderNotice()

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.trackSubscriptionEntryView).not.toHaveBeenCalled()
  })

  it('stays hidden in the global edition', async () => {
    mocks.edition = 'global'
    serveAccount('signed-out', unknownPlans)
    await renderNotice()

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
