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

beforeEach(() => vi.clearAllMocks())

describe('CherryCloudQuotaNotice', () => {
  it('offers a subscription when a free quota runs out', async () => {
    render(
      <CherryCloudQuotaNotice exhaustion={{ reason: 'quota_exhausted', isFreeModel: true, isSubscribed: false }} />
    )

    await userEvent.click(screen.getByRole('button', { name: '去订阅' }))

    expect(startCherryCloudSubscription).toHaveBeenCalled()
  })

  it('asks a signed-out user to sign in', async () => {
    render(
      <CherryCloudQuotaNotice exhaustion={{ reason: 'sign_in_required', isFreeModel: false, isSubscribed: false }} />
    )

    expect(screen.getByText('登录后才能使用 CherryAI 订阅模型')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined)
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
      expect(screen.queryByRole('button', { name: '查看用量' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: '切换模型' }))
      expect(execute).toHaveBeenCalledWith('chat.model.select')
    }
  )
})
