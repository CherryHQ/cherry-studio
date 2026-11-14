import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FeishuForm } from '../ChannelForms'
import type { ChannelData } from '../channelTypes'

const mocks = vi.hoisted(() => ({ request: vi.fn(), onQr: undefined as undefined | ((data: any) => void) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request },
  useIpcOn: (event: string, callback: (data: any) => void) => {
    if (event === 'channel.feishu.qr_login') mocks.onQr = callback
  }
}))
vi.mock('@renderer/components/PermissionModeOption', () => ({
  FullAccessConfirmDialog: () => null,
  PermissionModeSelectItem: () => null
}))

const channel = { id: 'feishu-1', name: 'Feishu', type: 'feishu', isActive: true, config: {} } as ChannelData
const pending = { url: 'https://accounts.feishu.cn/device/pending-qr', expiresAt: Date.now() + 600_000 }

describe('Feishu pending registration recovery', () => {
  beforeEach(() => {
    mocks.request.mockReset()
    mocks.onQr = undefined
  })

  it('shows the pending QR emitted before the editor mounted', async () => {
    mocks.request.mockResolvedValue(pending)
    render(<FeishuForm channel={channel} onConfigChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
    expect(mocks.request).toHaveBeenCalledWith('channel.feishu.pending_qr', 'feishu-1')
    expect(screen.getByRole('dialog').querySelector('svg')).not.toBeNull()
  })

  it.each(['confirmed', 'expired', 'error', 'disconnected'])(
    'does not replay a stale read over a newer %s event',
    async (status) => {
      let finish!: (value: typeof pending) => void
      mocks.request.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      render(<FeishuForm channel={channel} onConfigChange={vi.fn()} />)
      await act(async () => mocks.onQr?.({ channelId: channel.id, status, url: '' }))
      await act(async () => finish(pending))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )

  it('does not show a QR whose lifetime has ended', async () => {
    mocks.request.mockResolvedValue({ ...pending, expiresAt: Date.now() - 1 })
    render(<FeishuForm channel={channel} onConfigChange={vi.fn()} />)
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
