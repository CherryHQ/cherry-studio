import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { ChannelQrLoginDialog } from '../ChannelQrLoginDialog'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const channel = { id: 'wechat-1', type: 'wechat' } as const
const begin = 'channel.qr_login.begin'
const cancel = 'channel.qr_login.cancel'

it('does not start a new attempt when the QR dialog closes during a retry', async () => {
  const stoppedForRetry = Promise.withResolvers<{ ok: true; data: undefined }>()
  const request = vi.mocked(window.api.ipcApi.request)
  let starts = 0
  request.mockImplementation((route) => {
    if (route === begin) {
      starts++
      return Promise.resolve({ ok: true, data: false })
    }
    return stoppedForRetry.promise
  })
  const user = userEvent.setup()
  const { unmount } = render(<ChannelQrLoginDialog channel={channel} onClose={() => unmount()} />)

  await user.click(await screen.findByRole('button', { name: '重试' }))
  await user.keyboard('{Escape}')
  fireEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '取消' }))
  await act(async () => stoppedForRetry.resolve({ ok: true, data: undefined }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(starts).toBe(1)
})

it('cancels the exact unconfirmed attempt when its host unmounts', () => {
  const request = vi.mocked(window.api.ipcApi.request)
  request.mockResolvedValue({ ok: true, data: true })
  const { unmount } = render(<ChannelQrLoginDialog channel={channel} onClose={() => {}} />)

  const attempt = request.mock.calls.find(([route]) => route === begin)?.[1]
  unmount()

  expect(request).toHaveBeenCalledWith(cancel, attempt)
})

it('ignores a stale confirmation and leaves the matching confirmed attempt active', async () => {
  let confirm: ((requestId: string) => void) | undefined
  let attemptId: string | undefined
  const request = vi.mocked(window.api.ipcApi.request)
  request.mockImplementation(async (route, payload) => {
    if (route === begin && payload && typeof payload === 'object' && 'requestId' in payload) {
      attemptId = String(payload.requestId)
    }
    return { ok: true, data: true }
  })
  await vi.mocked(window.api.ipcApi.on).withImplementation(
    (event, callback) => {
      if (event === 'channel.qr_login.status') {
        confirm = (requestId) => callback({ channelId: channel.id, requestId, url: '', status: 'confirmed' })
      }
      return () => {}
    },
    async () => {
      const user = userEvent.setup()
      const { unmount } = render(<ChannelQrLoginDialog channel={channel} onClose={() => unmount()} />)
      act(() => confirm?.('stale-attempt'))
      expect(screen.queryByRole('button', { name: '完成' })).not.toBeInTheDocument()

      act(() => confirm?.(attemptId!))
      await user.click(screen.getByRole('button', { name: '完成' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(request.mock.calls.some(([route]) => route === cancel)).toBe(false)
    }
  )
})
