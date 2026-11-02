import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'

vi.mock('@renderer/services/AppErrorDetailService', () => {
  throw new Error('chunk failed')
})

import { ErrorDetailAction } from '../ErrorDetailAction'

describe('ErrorDetailAction chunk failure', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
  })

  it('retries locally and does not emit an unhandled rejection', async () => {
    const reasons: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      reasons.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    const user = userEvent.setup()

    render(<ErrorDetailAction error={new Error('boom')} operation="file.delete" source="files" />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(toast.error).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))

    expect(toast.error).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { suppressDetail: true },
        timeout: 0,
        title: i18n.t('error.detail_open_failed')
      })
    )
    const retry = vi.mocked(toast.error).mock.calls[0]?.[0]
    expect(retry).toEqual(
      expect.objectContaining({ action: expect.objectContaining({ label: i18n.t('common.retry') }) })
    )
    await act(async () => {
      if (retry && typeof retry === 'object' && 'action' in retry && retry.action) await retry.action.onClick()
    })
    expect(reasons).toEqual([])
    window.removeEventListener('unhandledrejection', onUnhandled)
  })
})
