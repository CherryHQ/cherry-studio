import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { ChannelQrLoginDialog } from '../ChannelQrLoginDialog'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const channel = { id: 'wechat-1', type: 'wechat' } as const

it('keeps the channel inactive when the QR dialog closes during a retry', async () => {
  const stoppedForRetry = Promise.withResolvers<unknown>()
  let active = false
  let pendingStop: Promise<unknown> | undefined = stoppedForRetry.promise
  const onActiveChange = async (enabled: boolean) => {
    active = enabled
    if (enabled) return null
    const stop = pendingStop
    pendingStop = undefined
    return stop
  }
  const user = userEvent.setup()
  const { unmount } = render(
    <ChannelQrLoginDialog channel={channel} onActiveChange={onActiveChange} onClose={() => unmount()} />
  )

  await user.click(await screen.findByRole('button', { name: '重试' }))
  await user.keyboard('{Escape}')
  fireEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '取消' }))
  await act(async () => stoppedForRetry.resolve({}))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(active).toBe(false)
})

it('disables an unconfirmed channel when its host unmounts', () => {
  let active = false
  const onActiveChange = async (enabled: boolean) => {
    active = enabled
  }
  const { unmount } = render(
    <ChannelQrLoginDialog channel={channel} onActiveChange={onActiveChange} onClose={() => {}} />
  )

  expect(active).toBe(true)
  unmount()

  expect(active).toBe(false)
})

it('keeps a confirmed channel enabled when the dialog closes', async () => {
  let confirm: (() => void) | undefined
  let active = false
  const onActiveChange = async (enabled: boolean) => {
    active = enabled
  }
  await vi.mocked(window.api.ipcApi.on).withImplementation(
    (event, callback) => {
      if (event === 'channel.wechat.qr_login') {
        confirm = () => callback({ channelId: channel.id, url: '', status: 'confirmed' })
      }
      return () => {}
    },
    async () => {
      const user = userEvent.setup()
      const { unmount } = render(
        <ChannelQrLoginDialog channel={channel} onActiveChange={onActiveChange} onClose={() => unmount()} />
      )
      act(() => confirm?.())

      await user.click(screen.getByRole('button', { name: '完成' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(active).toBe(true)
    }
  )
})
