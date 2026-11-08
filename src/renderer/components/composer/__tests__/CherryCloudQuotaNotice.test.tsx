import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CherryCloudQuotaNotice } from '../CherryCloudQuotaNotice'

const { execute, openSettingsTab, startCherryCloudSubscription } = vi.hoisted(() => ({
  execute: vi.fn(),
  openSettingsTab: vi.fn(),
  startCherryCloudSubscription: vi.fn()
}))

vi.mock('@renderer/hooks/command', () => ({ useCommandRuntime: () => ({ execute }) }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab }))
vi.mock('@renderer/services/cherryCloudSubscription', () => ({ startCherryCloudSubscription }))

const request = vi.mocked(window.api.ipcApi.request)
const tracked = () =>
  request.mock.calls.filter(([route]) => route === 'cherry_cloud.analytics.track').map(([, event]) => event)

beforeEach(() => vi.clearAllMocks())

describe('CherryCloudQuotaNotice', () => {
  it('reports the exhausted free quota and a subscription started from the notice', async () => {
    render(
      <CherryCloudQuotaNotice exhaustion={{ reason: 'quota_exhausted', isFreeModel: true, isSubscribed: false }} />
    )

    expect(tracked()).toContainEqual({
      event: 'subscription_quota_exhausted_view',
      modelType: 'free',
      subscribed: false
    })
    await userEvent.click(screen.getByRole('button', { name: '去订阅' }))

    expect(tracked()).toContainEqual({ event: 'subscription_quota_action', action: 'subscribe', modelType: 'free' })
    expect(startCherryCloudSubscription).toHaveBeenCalledWith('quota_notice')
  })

  it('reports viewing usage and switching models from a paid quota notice', async () => {
    render(
      <CherryCloudQuotaNotice exhaustion={{ reason: 'quota_exhausted', isFreeModel: false, isSubscribed: true }} />
    )

    await userEvent.click(screen.getByRole('button', { name: '查看用量' }))
    await userEvent.click(screen.getByRole('button', { name: '切换模型' }))

    expect(tracked()).toEqual(
      expect.arrayContaining([
        { event: 'subscription_quota_exhausted_view', modelType: 'paid', subscribed: true },
        { event: 'subscription_quota_action', action: 'view_usage', modelType: 'paid' },
        { event: 'subscription_quota_action', action: 'switch_model', modelType: 'paid' }
      ])
    )
    expect(openSettingsTab).toHaveBeenCalledWith('/settings/profile')
    expect(execute).toHaveBeenCalledWith('chat.model.select')
    expect(startCherryCloudSubscription).not.toHaveBeenCalled()
  })

  it('asks a signed-out user to sign in, without reporting a quota notice', async () => {
    render(
      <CherryCloudQuotaNotice exhaustion={{ reason: 'sign_in_required', isFreeModel: false, isSubscribed: false }} />
    )

    expect(screen.getByText('登录后才能使用 CherryAI 订阅模型')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined)
    expect(tracked()).toEqual([])
    expect(startCherryCloudSubscription).not.toHaveBeenCalled()
  })

  it.each([
    ['subscription_required', '订阅后才能使用该模型', true],
    ['not_in_plan', '当前套餐不包含该模型', false]
  ] as const)(
    'explains a locked model (%s) and offers a subscription only when it helps',
    async (reason, text, offers) => {
      render(<CherryCloudQuotaNotice exhaustion={{ reason, isFreeModel: false, isSubscribed: !offers }} />)

      expect(screen.getByText(text)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '去订阅' }) !== null).toBe(offers)
      await userEvent.click(screen.getByRole('button', { name: '切换模型' }))
      expect(execute).toHaveBeenCalledWith('chat.model.select')
      expect(tracked()).not.toContainEqual(
        expect.objectContaining({ event: expect.stringMatching(/^subscription_quota/) })
      )
    }
  )
})
