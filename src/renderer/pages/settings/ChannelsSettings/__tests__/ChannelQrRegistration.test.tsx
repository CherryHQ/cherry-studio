import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChannelQrRegistration } from '../ChannelQrRegistration'
import type { ChannelData } from '../channelTypes'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const channel: ChannelData = { id: 'wecom-draft', name: 'WeCom', type: 'wecom', isActive: false, config: {} }
const ok = (data: unknown) => ({ ok: true, data })
const begin = { requestId: 'session', url: 'https://work.weixin.qq.com/ai/qc/c?s=qr', expiresAt: Date.now() + 300_000 }

beforeEach(() => {
  vi.mocked(window.api.ipcApi.request).mockReset()
})

describe('QR setup', () => {
  it('shows the QR code, reports expiration and permits a fresh attempt that saves credentials', async () => {
    let finish!: (value: unknown) => void
    let expired = true
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (route) => {
      if (route === 'channel.registration.begin') return ok(begin)
      if (route === 'channel.registration.poll') {
        if (!expired) return ok({ status: 'confirmed' })
        return new Promise((resolve) => {
          finish = resolve
        })
      }
      return ok(undefined)
    })
    render(<ChannelQrRegistration channel={channel} />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.channels.qrSetup.start' }))
    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.getByRole('button', { name: 'agent.channels.qrSetup.start' })).toBeDisabled()
    finish(ok({ status: 'expired' }))
    expect(await screen.findByText('agent.channels.qrSetup.expired')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expired = false
    fireEvent.click(screen.getByRole('button', { name: 'agent.channels.qrSetup.start' }))
    expect(await screen.findByText('agent.channels.qrSetup.confirmed')).toBeVisible()
  })

  it('cancels an in-flight begin on unmount and never polls its late result', async () => {
    let finish!: (value: unknown) => void
    const requests: string[] = []
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (route) => {
      requests.push(route)
      if (route === 'channel.registration.begin')
        return new Promise((resolve) => {
          finish = resolve
        })
      return ok(undefined)
    })
    const { unmount } = render(<ChannelQrRegistration channel={channel} />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.channels.qrSetup.start' }))
    unmount()
    finish(ok(begin))
    await waitFor(() => expect(requests).toContain('channel.registration.cancel'))
    expect(requests).not.toContain('channel.registration.poll')
  })

  it('requires disabling an active channel before replacing credentials', () => {
    render(<ChannelQrRegistration channel={{ ...channel, isActive: true }} />)
    expect(screen.getByRole('button', { name: 'agent.channels.qrSetup.start' })).toBeDisabled()
  })
})
